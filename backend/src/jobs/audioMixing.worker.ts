import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from the backend root directory
dotenv.config({ path: path.join(__dirname, '../../.env') });

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

    // Prepare file paths
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const voicePath = voiceAudioUrl ? path.join(uploadDir, voiceAudioUrl.replace('/uploads/', '')) : undefined;
    const musicPath = musicAudioUrl ? path.join(uploadDir, musicAudioUrl.replace('/uploads/', '')) : undefined;

    // Get settings
    const settings = (production.settings as any) || {};
    const voiceVolume = settings.voiceVolume !== undefined ? settings.voiceVolume : 1.0;
    const musicVolume = settings.musicVolume !== undefined ? settings.musicVolume : 0.15; // Reduced from 0.3 to 0.15
    const fadeIn = settings.fadeIn || 0;
    const fadeOut = settings.fadeOut || 0;
    const audioDucking = settings.audioDucking !== false;
    const outputFormat = settings.outputFormat || 'mp3';

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

    // Extend music to match voice duration if needed
    let finalMusicPath = musicPath;
    if (voicePath && musicPath) {
      logger.info('Checking if music needs to be extended to match voice duration');

      const voiceDuration = await ffmpegService.getAudioDuration(voicePath);
      const musicDuration = await ffmpegService.getAudioDuration(musicPath);

      logger.info(`Voice duration: ${voiceDuration}s, Music duration: ${musicDuration}s`);

      if (musicDuration < voiceDuration) {
        // Extend music to match voice duration
        const extendedFilename = `extended_music_${uuidv4()}.mp3`;
        const extendedMusicPath = path.join(uploadDir, 'music', extendedFilename);

        logger.info(`Extending music from ${musicDuration}s to ${voiceDuration}s`);
        await ffmpegService.extendAudioDuration(musicPath, voiceDuration, extendedMusicPath);
        finalMusicPath = extendedMusicPath;

        await job.updateProgress(50);
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
      } : undefined,
      musicInput: finalMusicPath ? {
        filePath: finalMusicPath,
        volume: musicVolume,
        fadeIn,
        fadeOut,
      } : undefined,
      outputPath,
      outputFormat: outputFormat as any,
      audioDucking,
      normalize: true,
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
