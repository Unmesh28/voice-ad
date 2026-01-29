import { Worker, Job } from 'bullmq';
import { scriptGenerationQueue } from '../config/redis';
import prisma from '../config/database';
import openAIService from '../services/llm/openai.service';
import { logger } from '../config/logger';
import redisConnection from '../config/redis';

interface ScriptGenerationJobData {
  userId: string;
  projectId: string;
  prompt: string;
  tone?: string;
  length?: 'short' | 'medium' | 'long';
  targetAudience?: string;
  productName?: string;
  additionalContext?: string;
}

/**
 * Process script generation jobs
 */
const processScriptGeneration = async (job: Job<ScriptGenerationJobData>) => {
  const { userId, projectId, prompt, tone, length, targetAudience, productName, additionalContext } =
    job.data;

  logger.info(`Processing script generation job ${job.id}`, {
    userId,
    projectId,
  });

  try {
    // Update job progress
    await job.updateProgress(10);

    // Generate script using OpenAI
    const generatedContent = await openAIService.generateScript({
      prompt,
      tone,
      length,
      targetAudience,
      productName,
      additionalContext,
    });

    await job.updateProgress(70);

    // Save script to database
    const script = await prisma.script.create({
      data: {
        projectId,
        title: `Generated Script - ${new Date().toLocaleString()}`,
        content: generatedContent,
        metadata: {
          prompt,
          tone,
          length,
          targetAudience,
          productName,
          generatedAt: new Date().toISOString(),
          jobId: job.id,
        },
      },
    });

    await job.updateProgress(90);

    // Track usage
    await prisma.usageRecord.create({
      data: {
        userId,
        resourceType: 'SCRIPT_GENERATION',
        quantity: 1,
        metadata: {
          scriptId: script.id,
          promptLength: prompt.length,
          jobId: job.id,
        },
      },
    });

    await job.updateProgress(100);

    logger.info(`Script generation completed for job ${job.id}`, {
      scriptId: script.id,
    });

    return {
      success: true,
      scriptId: script.id,
      script,
    };
  } catch (error: any) {
    logger.error(`Script generation failed for job ${job.id}:`, {
      error: error.message,
      stack: error.stack,
    });

    // Create a job record in database for tracking
    await prisma.job.create({
      data: {
        type: 'SCRIPT_GENERATION',
        payload: job.data as any,
        status: 'FAILED',
        errorMessage: error.message,
        attempts: job.attemptsMade,
      },
    });

    throw error;
  }
};

/**
 * Create and start the script generation worker
 */
export const createScriptGenerationWorker = () => {
  const worker = new Worker('script-generation', processScriptGeneration, {
    connection: redisConnection,
    concurrency: 5, // Process up to 5 jobs concurrently
    limiter: {
      max: 10, // Max 10 jobs
      duration: 60000, // Per 60 seconds
    },
  });

  worker.on('completed', (job) => {
    logger.info(`Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Job ${job?.id} failed:`, {
      error: err.message,
      attempts: job?.attemptsMade,
    });
  });

  worker.on('error', (err) => {
    logger.error('Worker error:', err);
  });

  logger.info('Script generation worker started');

  return worker;
};

export default createScriptGenerationWorker;
