import path from 'path';
import { loadEnv } from '../config/env';
loadEnv();

import { Worker, Job } from 'bullmq';
import { audioMixingQueue } from '../config/redis';
import { Production } from '../models/Production';
import { Job as JobModel } from '../models/Job';
import { UsageRecord } from '../models/UsageRecord';
import { Project } from '../models/Project';
import ffmpegService from '../services/audio/ffmpeg.service';
import { logger } from '../config/logger';
import redisConnection from '../config/redis';
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';

interface AudioMixingJobData {
  userId: string;
  productionId: string;
}

/**
 * Process audio mixing jobs
 */
const processAudioMixing = async (job: Job<AudioMixingJobData>) => {
  const { userId, productionId } = job.data;

  logger.info(`Processing audio mixing job ${job.id}`, {
    userId,
    productionId,
  });

  try {
    // Update job progress
    await job.updateProgress(10);

    // Get production with related data
    const production = await Production.findById(productionId)
      .populate('scriptId')
      .populate('musicId')
      .populate('projectId')
      .exec();

    if (!production) {
      throw new Error('Production not found');
    }

    // Verify the production's project belongs to the user
    const project = production.projectId as any;
    if (!project || project.userId.toString() !== userId) {
      throw new Error('Production not found or access denied');
    }

    // Update production status
    production.status = 'MIXING' as any;
    production.progress = 20;
    await production.save();

    await job.updateProgress(20);

    // Get voice audio URL from script metadata
    const script = production.scriptId as any;
    const scriptMetadata = script?.metadata as any;
    const voiceAudioUrl = scriptMetadata?.lastTTS?.audioUrl;

    if (!voiceAudioUrl) {
      throw new Error('No voice audio found for this script. Please generate TTS first.');
    }

    // Get music audio URL
    const music = production.musicId as any;
    const musicAudioUrl = music?.fileUrl;

    // Prepare file paths - use absolute path for uploads directory
    const uploadDir = path.join(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
    const voicePath = voiceAudioUrl ? path.join(uploadDir, voiceAudioUrl.replace('/uploads/', '')) : undefined;
    const musicPath = musicAudioUrl ? path.join(uploadDir, musicAudioUrl.replace('/uploads/', '')) : undefined;

    // Get settings (fadeIn/fadeOut from LLM or defaults)
    const settings = (production.settings as any) || {};
    const voiceVolume = settings.voiceVolume !== undefined ? settings.voiceVolume : 1.0;
    const musicVolume = settings.musicVolume !== undefined ? settings.musicVolume : 0.15;
    const rawFadeIn = settings.fadeIn ?? 0.1;
    const rawFadeOut = settings.fadeOut ?? 0.4;
    const fadeIn = Math.max(0.02, Math.min(0.12, rawFadeIn));
    const fadeOut = Math.max(0.1, Math.min(0.6, rawFadeOut));
    const fadeCurve = settings.fadeCurve as 'linear' | 'exp' | 'qsin' | undefined;
    const audioDucking = settings.audioDucking !== false;
    const duckingAmount = settings.duckingAmount !== undefined ? Math.max(0, Math.min(1, settings.duckingAmount)) : 0.35;
    const outputFormat = settings.outputFormat || 'mp3';
    const normalizeLoudness = settings.normalizeLoudness === true;
    const loudnessPreset = settings.loudnessPreset as 'broadcast' | 'crossPlatform' | undefined;
    const loudnessTargetLUFS =
      settings.loudnessTargetLUFS !== undefined
        ? settings.loudnessTargetLUFS
        : loudnessPreset === 'broadcast'
          ? -24
          : -16;
    const loudnessTruePeak =
      settings.loudnessTruePeak !== undefined
        ? settings.loudnessTruePeak
        : -2;

    // Generate output filename
    const filename = `production_${production.id}_${uuidv4()}.${outputFormat}`;
    const outputPath = path.join(uploadDir, 'productions', filename);

    // Ensure productions directory exists
    const fs = require('fs');
    const productionsDir = path.join(uploadDir, 'productions');
    if (!fs.existsSync(productionsDir)) {
      fs.mkdirSync(productionsDir, { recursive: true });
    }

    await job.updateProgress(30);

    // Align music timeline to voice: stretch or extend so music is exactly voiceDuration (beats and speech match).
    let finalMusicPath = musicPath;
    if (voicePath && musicPath) {
      const voiceDuration = await ffmpegService.getAudioDuration(voicePath);
      const musicDuration = await ffmpegService.getAudioDuration(musicPath);

      logger.info(`Aligning music to voice: voice ${voiceDuration}s, music ${musicDuration}s`);

      if (musicDuration > voiceDuration) {
        // Time-stretch music down to voice duration so timelines match (no hard cut; music fits the speech).
        const stretchedFilename = `stretched_music_${uuidv4()}.mp3`;
        const stretchedMusicPath = path.join(uploadDir, 'music', stretchedFilename);
        logger.info(`Stretching music from ${musicDuration}s to ${voiceDuration}s for beat/speech alignment`);
        await ffmpegService.stretchAudioToDuration(musicPath, voiceDuration, stretchedMusicPath);
        finalMusicPath = stretchedMusicPath;
        await job.updateProgress(50);
      } else if (musicDuration < voiceDuration) {
        // Extend music by looping to match voice duration.
        const extendedFilename = `extended_music_${uuidv4()}.mp3`;
        const extendedMusicPath = path.join(uploadDir, 'music', extendedFilename);
        logger.info(`Extending music from ${musicDuration}s to ${voiceDuration}s`);
        await ffmpegService.extendAudioDuration(musicPath, voiceDuration, extendedMusicPath);
        finalMusicPath = extendedMusicPath;
        await job.updateProgress(50);
      }
      // else same duration: use as-is
    }

    // Per-sentence music volume: when script has sentenceCues + lastTTS.sentenceTimings, apply volume curve to music
    const sentenceCues = scriptMetadata?.sentenceCues as { index: number; musicVolumeMultiplier?: number }[] | undefined;
    const sentenceTimings = scriptMetadata?.lastTTS?.sentenceTimings as
      | { startSeconds: number; endSeconds: number }[]
      | undefined;
    const hasSentenceVolume =
      Array.isArray(sentenceCues) &&
      sentenceCues.length > 0 &&
      Array.isArray(sentenceTimings) &&
      sentenceTimings.length > 0 &&
      finalMusicPath &&
      voicePath;

    if (hasSentenceVolume && finalMusicPath) {
      const voiceDuration = await ffmpegService.getAudioDuration(voicePath);
      const cueByIndex = new Map(sentenceCues!.map((c) => [c.index, c]));
      const curve: { startSeconds: number; endSeconds: number; volumeMultiplier: number }[] = [];
      for (let i = 0; i < sentenceTimings!.length; i++) {
        const t = sentenceTimings![i];
        const cue = cueByIndex.get(i);
        const mult = cue?.musicVolumeMultiplier != null ? Math.max(0.1, Math.min(3, cue.musicVolumeMultiplier)) : 1;
        curve.push({
          startSeconds: Math.max(0, t.startSeconds),
          endSeconds: Math.min(voiceDuration, t.endSeconds),
          volumeMultiplier: mult,
        });
      }
      if (curve.length > 0) {
        const curvedFilename = `curved_music_${uuidv4()}.mp3`;
        const curvedMusicPath = path.join(uploadDir, 'music', curvedFilename);
        const musicDir = path.join(uploadDir, 'music');
        if (!fs.existsSync(musicDir)) fs.mkdirSync(musicDir, { recursive: true });
        await ffmpegService.applyVolumeCurve(finalMusicPath, curve, voiceDuration, curvedMusicPath);
        finalMusicPath = curvedMusicPath;
        logger.info(`Applied per-sentence music volume (${curve.length} segments) for production ${productionId}`);
      }
    }

    // Mix audio
    logger.info(`Mixing audio for production ${productionId}`);
    await ffmpegService.mixAudio({
      voiceInput: voicePath ? {
        filePath: voicePath,
        volume: voiceVolume,
        fadeIn,
        fadeOut,
        fadeCurve,
      } : undefined,
      musicInput: finalMusicPath ? {
        filePath: finalMusicPath,
        volume: musicVolume,
      } : undefined,
      outputPath,
      outputFormat: outputFormat as any,
      audioDucking,
      duckingAmount,
      fadeCurve,
      normalize: !normalizeLoudness,
      normalizeLoudness,
      loudnessTargetLUFS,
      loudnessTruePeak,
    });

    await job.updateProgress(80);

    // Get duration
    const duration = await ffmpegService.getAudioDuration(outputPath);

    const productionUrl = `/uploads/productions/${filename}`;

    // Update production
    production.status = 'COMPLETED' as any;
    production.progress = 100;
    production.outputUrl = productionUrl;
    production.duration = Math.round(duration);
    await production.save();

    // Track usage
    const usageRecord = new UsageRecord({
      userId: new mongoose.Types.ObjectId(userId),
      resourceType: 'AUDIO_MIXING',
      quantity: 1,
      metadata: {
        productionId: production.id,
        duration: Math.round(duration),
        jobId: job.id,
      },
    });
    await usageRecord.save();

    await job.updateProgress(100);

    logger.info(`Audio mixing completed for job ${job.id}`, {
      productionId: production.id,
      outputUrl: productionUrl,
    });

    return {
      success: true,
      productionId: production.id,
      outputUrl: productionUrl,
      duration: Math.round(duration),
    };
  } catch (error: any) {
    logger.error(`Audio mixing failed for job ${job.id}:`, {
      error: error.message,
      stack: error.stack,
    });

    // Update production status to failed
    await Production.findByIdAndUpdate(productionId, {
      status: 'FAILED',
      errorMessage: error.message,
    });

    // Create a job record in database for tracking
    const jobRecord = new JobModel({
      type: 'AUDIO_MIXING',
      payload: job.data as any,
      status: 'FAILED',
      errorMessage: error.message,
      attempts: job.attemptsMade,
    });
    await jobRecord.save();

    throw error;
  }
};

/**
 * Create and start the audio mixing worker
 */
export const createAudioMixingWorker = () => {
  const worker = new Worker('audio-mixing', processAudioMixing, {
    connection: redisConnection,
    concurrency: 2, // Process up to 2 jobs concurrently
    limiter: {
      max: 5, // Max 5 jobs
      duration: 60000, // Per 60 seconds
    },
  });

  worker.on('completed', (job) => {
    logger.info(`Audio mixing job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Audio mixing job ${job?.id} failed:`, {
      error: err.message,
      attempts: job?.attemptsMade,
    });
  });

  worker.on('error', (err) => {
    logger.error('Audio mixing worker error:', err);
  });

  logger.info('Audio mixing worker started');

  return worker;
};

export default createAudioMixingWorker;
