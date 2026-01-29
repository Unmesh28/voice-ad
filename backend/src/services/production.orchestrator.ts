import prisma from '../config/database';
import {
  scriptGenerationQueue,
  ttsGenerationQueue,
  musicGenerationQueue,
  audioMixingQueue,
  QUEUE_NAMES,
} from '../config/redis';
import { QueueEvents } from 'bullmq';
import redisConnection from '../config/redis';
import { logger } from '../config/logger';
import voiceSelectorService from './voice-selector.service';

interface QuickProductionInput {
  userId: string;
  prompt: string;
  voiceId?: string;
  duration?: number;
  tone?: string;
}

interface ProductionProgress {
  stage: 'script' | 'music' | 'tts' | 'mixing' | 'completed' | 'failed';
  progress: number;
  message: string;
  scriptId?: string;
  musicId?: string;
  productionId?: string;
  outputUrl?: string;
}

export class ProductionOrchestrator {
  /**
   * One-click production: Generate everything from a single prompt
   */
  async createQuickProduction(input: QuickProductionInput): Promise<string> {
    const { userId, prompt, voiceId = 'default', duration = 30, tone = 'professional' } = input;

    try {
      // Create a project for this production
      const project = await prisma.project.create({
        data: {
          userId,
          name: `Quick Production - ${new Date().toLocaleDateString()}`,
          description: prompt,
          status: 'ACTIVE',
        },
      });

      // Create production record to track progress
      const production = await prisma.production.create({
        data: {
          projectId: project.id,
          status: 'PENDING',
          progress: 0,
          settings: {
            prompt,
            voiceId,
            duration,
            tone,
            automated: true,
          } as any,
        },
      });

      // Start the pipeline asynchronously
      this.runPipeline(production.id, project.id, userId, prompt, voiceId, duration, tone).catch((error) => {
        logger.error('Pipeline execution failed:', error);
        this.updateProductionStatus(production.id, 'FAILED', 0, error.message);
      });

      return production.id;
    } catch (error: any) {
      logger.error('Failed to create quick production:', error);
      throw error;
    }
  }

  /**
   * Run the complete production pipeline
   */
  private async runPipeline(
    productionId: string,
    projectId: string,
    userId: string,
    prompt: string,
    voiceId: string,
    duration: number,
    tone: string
  ): Promise<void> {
    // Create QueueEvents for job completion tracking
    const scriptQueueEvents = new QueueEvents(QUEUE_NAMES.SCRIPT_GENERATION, { connection: redisConnection });
    const ttsQueueEvents = new QueueEvents(QUEUE_NAMES.TTS_GENERATION, { connection: redisConnection });
    const musicQueueEvents = new QueueEvents(QUEUE_NAMES.MUSIC_GENERATION, { connection: redisConnection });
    const mixingQueueEvents = new QueueEvents(QUEUE_NAMES.AUDIO_MIXING, { connection: redisConnection });

    try {
      // Stage 1: Generate Script
      logger.info(`[Pipeline ${productionId}] Stage 1: Generating script`);
      await this.updateProductionStatus(productionId, 'GENERATING_VOICE', 10, 'Generating AI script...');

      const scriptJob = await scriptGenerationQueue.add('generate-script', {
        userId,
        projectId,
        prompt: `Create a ${duration}-second ${tone} advertisement script for: ${prompt}`,
        tone,
        length: duration <= 15 ? 'short' : duration <= 30 ? 'medium' : 'long',
        variations: 1,
      });

      const scriptResult = await scriptJob.waitUntilFinished(scriptQueueEvents);

      if (!scriptResult?.scriptId) {
        throw new Error('Script generation failed - no script ID returned');
      }

      const script = await prisma.script.findUnique({ where: { id: scriptResult.scriptId } });
      if (!script) {
        throw new Error('Script not found after generation');
      }

      logger.info(`[Pipeline ${productionId}] Script generated: ${script.id}`);
      await this.updateProductionStatus(productionId, 'GENERATING_VOICE', 25, 'Script generated! Selecting perfect voice...');

      // Update production with script ID
      await prisma.production.update({
        where: { id: productionId },
        data: { scriptId: script.id },
      });

      // Intelligent Voice Selection - analyze script and select best voice
      logger.info(`[Pipeline ${productionId}] Analyzing script and selecting voice`);
      let selectedVoiceId = voiceId;

      if (voiceId === 'default' || !voiceId) {
        try {
          const voiceMatch = await voiceSelectorService.selectVoiceForScript(script.content);
          selectedVoiceId = voiceMatch.voiceId;
          logger.info(`[Pipeline ${productionId}] Intelligently selected voice: ${voiceMatch.name} (${voiceMatch.voiceId}) - ${voiceMatch.reason}`);
        } catch (error: any) {
          logger.warn(`[Pipeline ${productionId}] Voice selection failed, using first available voice:`, error.message);
          // If voice selection fails, we'll let the TTS service handle it
        }
      }

      await this.updateProductionStatus(productionId, 'GENERATING_VOICE', 30, 'Voice selected! Generating speech...');

      // Stage 2: Generate TTS (Voice)
      logger.info(`[Pipeline ${productionId}] Stage 2: Generating TTS with voice ${selectedVoiceId}`);
      const ttsJob = await ttsGenerationQueue.add('generate-tts', {
        scriptId: script.id,
        voiceId: selectedVoiceId,
        settings: {
          stability: 0.75,
          similarityBoost: 0.75,
          style: 0.5,
          useSpeakerBoost: true,
        },
      });

      await ttsJob.waitUntilFinished(ttsQueueEvents);
      await this.updateProductionStatus(productionId, 'GENERATING_MUSIC', 50, 'Speech generated! Creating background music...');

      // Stage 3: Generate Music - intelligently based on script
      logger.info(`[Pipeline ${productionId}] Stage 3: Generating music based on script analysis`);

      // Generate intelligent music prompt based on script
      let musicPrompt = `${tone} background music for advertisement`;
      try {
        musicPrompt = await voiceSelectorService.generateMusicPrompt(script.content, duration);
        logger.info(`[Pipeline ${productionId}] Generated music prompt: ${musicPrompt}`);
      } catch (error: any) {
        logger.warn(`[Pipeline ${productionId}] Music prompt generation failed, using default:`, error.message);
      }

      const musicJob = await musicGenerationQueue.add('generate-music', {
        userId,
        text: musicPrompt,
        duration_seconds: Math.min(duration, 22), // ElevenLabs max is 22 seconds
        prompt_influence: 0.3,
        genre: 'corporate',
        mood: tone,
      });

      const musicResult = await musicJob.waitUntilFinished(musicQueueEvents);

      if (!musicResult?.musicId) {
        throw new Error('Music generation failed - no music ID returned');
      }

      logger.info(`[Pipeline ${productionId}] Music generated: ${musicResult.musicId}`);
      await this.updateProductionStatus(productionId, 'MIXING', 70, 'Music generated! Mixing audio...');

      // Update production with music ID
      await prisma.production.update({
        where: { id: productionId },
        data: { musicId: musicResult.musicId },
      });

      // Stage 4: Mix Audio
      logger.info(`[Pipeline ${productionId}] Stage 4: Mixing audio`);
      const mixingJob = await audioMixingQueue.add('mix-audio', {
        productionId,
        scriptId: script.id,
        musicId: musicResult.musicId,
        settings: {
          voiceVolume: 100,
          musicVolume: 25,
          fadeIn: 2,
          fadeOut: 2,
          ducking: true,
          format: 'mp3',
        },
      });

      const mixingResult = await mixingJob.waitUntilFinished(mixingQueueEvents);

      if (!mixingResult?.outputUrl) {
        throw new Error('Audio mixing failed - no output URL returned');
      }

      logger.info(`[Pipeline ${productionId}] Audio mixed successfully: ${mixingResult.outputUrl}`);

      // Final: Update production as completed
      await prisma.production.update({
        where: { id: productionId },
        data: {
          status: 'COMPLETED',
          progress: 100,
          outputUrl: mixingResult.outputUrl,
          duration: mixingResult.duration,
        },
      });

      logger.info(`[Pipeline ${productionId}] ✓ Production completed successfully!`);
    } catch (error: any) {
      logger.error(`[Pipeline ${productionId}] Pipeline failed:`, error);
      await this.updateProductionStatus(productionId, 'FAILED', 0, error.message || 'Pipeline execution failed');
      throw error;
    } finally {
      // Clean up QueueEvents connections
      await scriptQueueEvents.close();
      await ttsQueueEvents.close();
      await musicQueueEvents.close();
      await mixingQueueEvents.close();
    }
  }

  /**
   * Get production progress
   */
  async getProductionProgress(productionId: string): Promise<ProductionProgress> {
    const production = await prisma.production.findUnique({
      where: { id: productionId },
      include: {
        script: true,
        music: true,
      },
    });

    if (!production) {
      throw new Error('Production not found');
    }

    const stageMap: Record<string, ProductionProgress['stage']> = {
      PENDING: 'script',
      GENERATING_VOICE: 'tts',
      GENERATING_MUSIC: 'music',
      MIXING: 'mixing',
      COMPLETED: 'completed',
      FAILED: 'failed',
    };

    return {
      stage: stageMap[production.status] || 'script',
      progress: production.progress,
      message: this.getStatusMessage(production.status, production.progress),
      scriptId: production.scriptId || undefined,
      musicId: production.musicId || undefined,
      productionId: production.id,
      outputUrl: production.outputUrl || undefined,
    };
  }

  /**
   * Update production status
   */
  private async updateProductionStatus(
    productionId: string,
    status: string,
    progress: number,
    message: string
  ): Promise<void> {
    await prisma.production.update({
      where: { id: productionId },
      data: {
        status: status as any,
        progress,
        errorMessage: status === 'FAILED' ? message : null,
      },
    });
  }

  /**
   * Get user-friendly status message
   */
  private getStatusMessage(status: string, progress: number): string {
    switch (status) {
      case 'PENDING':
        return 'Initializing production pipeline...';
      case 'GENERATING_VOICE':
        return progress < 30 ? 'Generating AI script...' : 'Converting script to speech...';
      case 'GENERATING_MUSIC':
        return 'Creating background music...';
      case 'MIXING':
        return 'Mixing voice and music...';
      case 'COMPLETED':
        return 'Production completed!';
      case 'FAILED':
        return 'Production failed';
      default:
        return 'Processing...';
    }
  }
}

export default new ProductionOrchestrator();
