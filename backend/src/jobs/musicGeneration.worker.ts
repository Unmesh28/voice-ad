import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from the backend root directory
dotenv.config({ path: path.join(__dirname, '../../.env') });

import { Worker, Job } from 'bullmq';
import { musicGenerationQueue } from '../config/redis';
import { MusicTrack } from '../models/MusicTrack';
import { Job as JobModel } from '../models/Job';
import { UsageRecord } from '../models/UsageRecord';
import elevenLabsMusicService from '../services/music/elevenlabs-music.service';
import { logger } from '../config/logger';
import redisConnection from '../config/redis';
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';

interface MusicGenerationJobData {
  userId: string;
  text: string;
  duration_seconds?: number;
  prompt_influence?: number;
  name?: string;
  genre?: string;
  mood?: string;
}

/**
 * Process music generation jobs
 */
const processMusicGeneration = async (job: Job<MusicGenerationJobData>) => {
  const { userId, text, duration_seconds, prompt_influence, name, genre, mood } = job.data;

  logger.info(`Processing music generation job ${job.id}`, {
    userId,
    textLength: text.length,
  });

  try {
    // Update job progress
    await job.updateProgress(10);

    // Validate options
    const options = elevenLabsMusicService.validateOptions({
      text,
      duration_seconds,
      prompt_influence,
    });

    await job.updateProgress(20);

    // Generate unique filename
    const filename = `music_${uuidv4()}.mp3`;

    // Generate music
    logger.info(`Generating music with prompt: ${text}`);
    const { filePath, audioBuffer, duration } = await elevenLabsMusicService.generateAndSave(
      options,
      filename
    );

    await job.updateProgress(80);

    const musicUrl = `/uploads/music/${filename}`;

    // Save to database
    const musicTrack = new MusicTrack({
      name: name || `Generated Music - ${new Date().toLocaleString()}`,
      description: text,
      genre: genre || undefined,
      mood: mood || undefined,
      duration,
      fileUrl: musicUrl,
      isGenerated: true,
      metadata: {
        prompt: text,
        duration_seconds,
        prompt_influence,
        generatedAt: new Date().toISOString(),
        jobId: job.id,
      },
    });
    await musicTrack.save();

    // Track usage
    const usageRecord = new UsageRecord({
      userId: new mongoose.Types.ObjectId(userId),
      resourceType: 'MUSIC_GENERATION',
      quantity: 1,
      metadata: {
        musicId: musicTrack.id,
        duration,
        prompt: text,
        jobId: job.id,
      },
    });
    await usageRecord.save();

    await job.updateProgress(100);

    logger.info(`Music generation completed for job ${job.id}`, {
      musicId: musicTrack.id,
      duration,
    });

    return {
      success: true,
      musicId: musicTrack.id,
      musicUrl,
      duration,
    };
  } catch (error: any) {
    logger.error(`Music generation failed for job ${job.id}:`, {
      error: error.message,
      stack: error.stack,
    });

    // Create a job record in database for tracking
    const jobRecord = new JobModel({
      type: 'MUSIC_GENERATION',
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
 * Create and start the music generation worker
 */
export const createMusicGenerationWorker = () => {
  const worker = new Worker('music-generation', processMusicGeneration, {
    connection: redisConnection,
    concurrency: 2, // Process up to 2 jobs concurrently
    limiter: {
      max: 5, // Max 5 jobs
      duration: 60000, // Per 60 seconds
    },
  });

  worker.on('completed', (job) => {
    logger.info(`Music job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Music job ${job?.id} failed:`, {
      error: err.message,
      attempts: job?.attemptsMade,
    });
  });

  worker.on('error', (err) => {
    logger.error('Music worker error:', err);
  });

  logger.info('Music generation worker started');

  return worker;
};

export default createMusicGenerationWorker;
