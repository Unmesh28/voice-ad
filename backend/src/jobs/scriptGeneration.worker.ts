import { loadEnv } from '../config/env';
loadEnv();

import { Worker, Job } from 'bullmq';
import { scriptGenerationQueue } from '../config/redis';
import { Script } from '../models/Script';
import { Job as JobModel } from '../models/Job';
import { UsageRecord } from '../models/UsageRecord';
import openAIService from '../services/llm/openai.service';
import { logger } from '../config/logger';
import redisConnection from '../config/redis';
import mongoose from 'mongoose';
import type { AdProductionLLMResponse } from '../types/ad-production';
import { createFallbackAdProductionResponse } from '../types/ad-production';

interface ScriptGenerationJobData {
  userId: string;
  projectId: string;
  prompt: string;
  tone?: string;
  length?: 'short' | 'medium' | 'long';
  durationSeconds?: number;
  targetAudience?: string;
  productName?: string;
  additionalContext?: string;
}

/**
 * Process script generation jobs.
 * When durationSeconds is provided (e.g. from quick production), uses generateAdProductionJSON
 * and persists script + full metadata (context, music, fades, volume) for the pipeline.
 */
const processScriptGeneration = async (job: Job<ScriptGenerationJobData>) => {
  const { userId, projectId, prompt, tone, length, durationSeconds, targetAudience, productName, additionalContext } =
    job.data;

  const useAdProductionJson = typeof durationSeconds === 'number' && durationSeconds > 0;

  logger.info(`Processing script generation job ${job.id}`, {
    userId,
    projectId,
    useAdProductionJson,
  });

  try {
    await job.updateProgress(10);

    if (useAdProductionJson) {
      // Pipeline path: single LLM call returns script + context + music + fades + volume
      let fullResponse: AdProductionLLMResponse;
      try {
        fullResponse = await openAIService.generateAdProductionJSON({
          prompt,
          durationSeconds,
          tone,
        });
      } catch (openAIError: any) {
        // Fallback when OpenAI fails or returns invalid JSON so the pipeline can still complete
        const status = openAIError?.response?.status;
        const msg = openAIError?.message || '';
        const isQuotaOrAuth = status === 429 || status === 401 || status === 402;
        const isInvalidJson = msg.includes('Invalid JSON from LLM') || msg.includes('LLM response validation failed');
        if (isQuotaOrAuth || msg.includes('quota') || msg.includes('rate limit') || msg.includes('API key') || isInvalidJson) {
          logger.warn(`Using fallback ad-production response`, {
            jobId: job.id,
            reason: isInvalidJson ? 'invalid JSON' : status || msg.slice(0, 50),
          });
          fullResponse = createFallbackAdProductionResponse({ prompt, durationSeconds, tone });
        } else {
          throw openAIError;
        }
      }

      await job.updateProgress(70);

      const script = new Script({
        projectId: new mongoose.Types.ObjectId(projectId),
        title: `Generated Script - ${new Date().toLocaleString()}`,
        content: fullResponse.script,
        metadata: {
          prompt,
          tone,
          durationSeconds,
          generatedAt: new Date().toISOString(),
          jobId: job.id,
          productionContext: fullResponse.context,
          music: fullResponse.music,
          fades: fullResponse.fades,
          volume: fullResponse.volume,
          mixPreset: fullResponse.mixPreset,
          adFormat: fullResponse.adFormat,
          llmResponseVersion: fullResponse.version,
          /** Full LLM ad-production JSON for display/debug (script, context, music, fades, volume, adFormat). */
          adProductionJson: fullResponse as AdProductionLLMResponse,
        },
      });
      await script.save();

      await job.updateProgress(90);

      const usageRecord = new UsageRecord({
        userId: new mongoose.Types.ObjectId(userId),
        resourceType: 'SCRIPT_GENERATION',
        quantity: 1,
        metadata: {
          scriptId: script.id,
          promptLength: prompt.length,
          jobId: job.id,
          adProductionJson: true,
        },
      });
      await usageRecord.save();

      await job.updateProgress(100);

      logger.info(`Script generation (ad production JSON) completed for job ${job.id}`, {
        scriptId: script.id,
        adCategory: fullResponse.context.adCategory,
      });
      logger.info('Ad production LLM JSON (full)', {
        service: 'voice-ad-backend',
        scriptId: script.id,
        adProductionJson: fullResponse,
      });

      return {
        success: true,
        scriptId: script.id,
        script,
        fullResponse: fullResponse as AdProductionLLMResponse,
      };
    }

    // Standalone script path: legacy generateScript, no pipeline metadata
    const generatedContent = await openAIService.generateScript({
      prompt,
      tone,
      length,
      durationSeconds,
      targetAudience,
      productName,
      additionalContext,
    });

    await job.updateProgress(70);

    const script = new Script({
      projectId: new mongoose.Types.ObjectId(projectId),
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
    });
    await script.save();

    await job.updateProgress(90);

    const usageRecord = new UsageRecord({
      userId: new mongoose.Types.ObjectId(userId),
      resourceType: 'SCRIPT_GENERATION',
      quantity: 1,
      metadata: {
        scriptId: script.id,
        promptLength: prompt.length,
        jobId: job.id,
      },
    });
    await usageRecord.save();

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
    const jobRecord = new JobModel({
      type: 'SCRIPT_GENERATION',
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
