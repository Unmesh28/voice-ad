import { loadEnv } from '../config/env';
loadEnv();

import fs from 'fs';
import { Worker, Job } from 'bullmq';
import { ttsGenerationQueue } from '../config/redis';
import { Script } from '../models/Script';
import { Job as JobModel } from '../models/Job';
import { UsageRecord } from '../models/UsageRecord';
import elevenLabsService from '../services/tts/elevenlabs.service';
import ffmpegService from '../services/audio/ffmpeg.service';
import { alignmentToSentenceTimings, alignmentToWordTimings, buildAlignmentPayload } from '../utils/alignment-to-sentences';
import { logger } from '../config/logger';
import redisConnection from '../config/redis';
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';

interface TTSGenerationJobData {
  userId: string;
  scriptId: string;
  voiceId: string;
  voiceSettings?: {
    stability?: number;
    similarity_boost?: number;
    style?: number;
    use_speaker_boost?: boolean;
  };
}

/**
 * Process TTS generation jobs
 */
const processTTSGeneration = async (job: Job<TTSGenerationJobData>) => {
  const { userId, scriptId, voiceId, voiceSettings } = job.data;

  logger.info(`Processing TTS generation job ${job.id}`, {
    userId,
    scriptId,
    voiceId,
  });

  try {
    // Update job progress
    await job.updateProgress(10);

    // Get script
    const script = await Script.findById(scriptId)
      .populate('projectId')
      .exec();

    if (!script) {
      throw new Error('Script not found');
    }

    // Verify the script's project belongs to the user
    const project = script.projectId as any;
    if (!project || project.userId.toString() !== userId) {
      throw new Error('Script not found or access denied');
    }

    await job.updateProgress(20);

    // Validate and sanitize voice settings
    const settings = voiceSettings
      ? elevenLabsService.validateVoiceSettings(voiceSettings)
      : elevenLabsService.getDefaultVoiceSettings();

    // Generate unique filename
    const filename = `tts_${script.id}_${uuidv4()}.mp3`;

    await job.updateProgress(30);

    // Prefer with-timestamps for pipeline runs (sentence-by-sentence composition)
    const isPipelineRun = !!(script.metadata as any)?.adProductionJson;
    let sentenceTimings: { text: string; startSeconds: number; endSeconds: number }[] | undefined;
    let wordTimings: { text: string; startSeconds: number; endSeconds: number }[] | undefined;
    let filePath: string;
    let audioBuffer: Buffer;

    if (isPipelineRun) {
      try {
        const result = await elevenLabsService.generateSpeechWithTimestamps({
          voiceId,
          text: script.content,
          voiceSettings: settings,
        });
        audioBuffer = result.audioBuffer;
        filePath = await elevenLabsService.saveAudioToFile(audioBuffer, filename);
        if (result.alignment) {
          sentenceTimings = alignmentToSentenceTimings(script.content, result.alignment);
          wordTimings = alignmentToWordTimings(script.content, result.alignment);
          logger.info(`Sentence timings computed for script ${scriptId}: ${sentenceTimings.length} sentences, ${wordTimings.length} words`);
        }
      } catch (err: any) {
        logger.warn(`TTS with-timestamps failed, falling back to standard TTS: ${err.message}`);
        const fallback = await elevenLabsService.generateAndSave(
          { voiceId, text: script.content, voiceSettings: settings },
          filename
        );
        filePath = fallback.filePath;
        audioBuffer = fallback.audioBuffer;
      }
    } else {
      const result = await elevenLabsService.generateAndSave(
        { voiceId, text: script.content, voiceSettings: settings },
        filename
      );
      filePath = result.filePath;
      audioBuffer = result.audioBuffer;
    }

    // ── Duration enforcement ──────────────────────────────────────────
    // When the script has a target duration (ad production pipeline),
    // adjust voice speed with FFmpeg atempo so the voiceover fits the ad.
    // Voice should fill: targetDuration minus music intro padding (0.5s)
    // and sound tail (2.0s).
    const scriptMeta = script.metadata as Record<string, unknown> | undefined;
    const adProdJson = scriptMeta?.adProductionJson as any;
    const targetDurationSec: number | undefined =
      adProdJson?.context?.durationSeconds
      || (scriptMeta?.durationSeconds as number | undefined)
      || undefined;

    if (isPipelineRun && targetDurationSec && targetDurationSec > 0) {
      const actualDuration = await ffmpegService.getAudioDuration(filePath);
      // Voice target: total ad duration minus intro padding (0.5s) and sound tail (2.0s)
      const voiceTargetDuration = targetDurationSec - 2.5;

      if (voiceTargetDuration > 0 && actualDuration > 0) {
        const ratio = actualDuration / voiceTargetDuration;
        // Adjust if voice is >12% too long or >20% too short.
        // Cap atempo to 0.85–1.25 range to keep speech natural-sounding.
        if (ratio > 1.12 || ratio < 0.80) {
          const clampedRatio = Math.max(0.85, Math.min(1.25, ratio));
          const adjustedTarget = actualDuration / clampedRatio;
          const adjustedPath = filePath.replace('.mp3', '_speed.mp3');

          await ffmpegService.stretchAudioToDuration(filePath, adjustedTarget, adjustedPath);

          // Replace original with speed-adjusted version
          fs.unlinkSync(filePath);
          fs.renameSync(adjustedPath, filePath);

          const newDuration = await ffmpegService.getAudioDuration(filePath);
          logger.info(`TTS duration adjusted: ${actualDuration.toFixed(1)}s → ${newDuration.toFixed(1)}s (target voice: ${voiceTargetDuration.toFixed(1)}s, atempo ratio: ${clampedRatio.toFixed(2)})`, {
            scriptId,
            targetDurationSec,
          });
        } else {
          logger.info(`TTS duration OK: ${actualDuration.toFixed(1)}s (target voice: ${voiceTargetDuration.toFixed(1)}s, ratio: ${ratio.toFixed(2)})`, {
            scriptId,
          });
        }
      }
    }

    await job.updateProgress(80);

    // Get file stats
    const characterCount = elevenLabsService.getCharacterCount(script.content);
    const estimatedDuration = elevenLabsService.estimateAudioDuration(script.content);

    const audioUrl = `/uploads/audio/${filename}`;

    // Build canonical alignment payload when we have word timings and arc (for TTM and mix)
    const meta = script.metadata as Record<string, unknown> | undefined;
    const musicMeta = meta?.music ?? (meta?.adProductionJson as any)?.music;
    const musicArc = musicMeta && typeof musicMeta === 'object' && (musicMeta as any).arc;
    let alignment: { total_duration_seconds: number; words: unknown[]; sections: unknown[] } | undefined;
    if (wordTimings?.length) {
      const totalDuration =
        wordTimings[wordTimings.length - 1].endSeconds ||
        (sentenceTimings?.length ? sentenceTimings[sentenceTimings.length - 1].endSeconds : 0);
      alignment = buildAlignmentPayload(wordTimings, musicArc, totalDuration);
    }

    // Update script metadata with audio info and optional sentence/word timings and alignment
    script.metadata = {
      ...(script.metadata as object),
      lastTTS: {
        voiceId,
        voiceSettings: settings as any,
        audioUrl,
        characterCount,
        estimatedDuration,
        generatedAt: new Date().toISOString(),
        jobId: job.id,
        ...(sentenceTimings?.length ? { sentenceTimings } : {}),
        ...(wordTimings?.length ? { wordTimings } : {}),
        ...(alignment ? { alignment } : {}),
      },
    };
    await script.save();

    // Track usage
    const usageRecord = new UsageRecord({
      userId: new mongoose.Types.ObjectId(userId),
      resourceType: 'TTS_CHARACTERS',
      quantity: characterCount,
      metadata: {
        scriptId: script.id,
        voiceId,
        duration: estimatedDuration,
        jobId: job.id,
      },
    });
    await usageRecord.save();

    await job.updateProgress(100);

    logger.info(`TTS generation completed for job ${job.id}`, {
      scriptId: script.id,
      audioUrl,
      characterCount,
    });

    return {
      success: true,
      scriptId: script.id,
      audioUrl,
      characterCount,
      estimatedDuration,
    };
  } catch (error: any) {
    logger.error(`TTS generation failed for job ${job.id}:`, {
      error: error.message,
      stack: error.stack,
    });

    // Create a job record in database for tracking
    const jobRecord = new JobModel({
      type: 'TTS_GENERATION',
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
 * Create and start the TTS generation worker
 */
export const createTTSGenerationWorker = () => {
  const worker = new Worker('tts-generation', processTTSGeneration, {
    connection: redisConnection,
    concurrency: 3, // Process up to 3 jobs concurrently
    limiter: {
      max: 5, // Max 5 jobs
      duration: 60000, // Per 60 seconds
    },
  });

  worker.on('completed', (job) => {
    logger.info(`TTS job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`TTS job ${job?.id} failed:`, {
      error: err.message,
      attempts: job?.attemptsMade,
    });
  });

  worker.on('error', (err) => {
    logger.error('TTS worker error:', err);
  });

  logger.info('TTS generation worker started');

  return worker;
};

export default createTTSGenerationWorker;
