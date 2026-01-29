import { Worker, Job } from 'bullmq';
import { ttsGenerationQueue } from '../config/redis';
import prisma from '../config/database';
import elevenLabsService from '../services/tts/elevenlabs.service';
import { logger } from '../config/logger';
import redisConnection from '../config/redis';
import { v4 as uuidv4 } from 'uuid';

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
    const script = await prisma.script.findFirst({
      where: {
        id: scriptId,
        project: {
          userId,
        },
      },
      include: {
        project: true,
      },
    });

    if (!script) {
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

    // Generate speech
    logger.info(`Generating speech for script ${scriptId}`);
    const { filePath, audioBuffer } = await elevenLabsService.generateAndSave(
      {
        voiceId,
        text: script.content,
        voiceSettings: settings,
      },
      filename
    );

    await job.updateProgress(80);

    // Get file stats
    const characterCount = elevenLabsService.getCharacterCount(script.content);
    const estimatedDuration = elevenLabsService.estimateAudioDuration(script.content);

    const audioUrl = `/uploads/audio/${filename}`;

    // Update script metadata with audio info
    await prisma.script.update({
      where: { id: script.id },
      data: {
        metadata: {
          ...(script.metadata as object),
          lastTTS: {
            voiceId,
            voiceSettings: settings,
            audioUrl,
            characterCount,
            estimatedDuration,
            generatedAt: new Date().toISOString(),
            jobId: job.id,
          },
        },
      },
    });

    // Track usage
    await prisma.usageRecord.create({
      data: {
        userId,
        resourceType: 'TTS_CHARACTERS',
        quantity: characterCount,
        metadata: {
          scriptId: script.id,
          voiceId,
          duration: estimatedDuration,
          jobId: job.id,
        },
      },
    });

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
    await prisma.job.create({
      data: {
        id: job.id as string,
        type: 'TTS_GENERATION',
        payload: job.data,
        status: 'FAILED',
        errorMessage: error.message,
        attempts: job.attemptsMade,
      },
    });

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
