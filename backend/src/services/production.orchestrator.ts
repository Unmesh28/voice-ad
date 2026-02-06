import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Project } from '../models/Project';
import { Production } from '../models/Production';
import { Script } from '../models/Script';
import { MusicTrack } from '../models/MusicTrack';
import {
  scriptGenerationQueue,
  ttsGenerationQueue,
  musicGenerationQueue,
  audioMixingQueue,
  QUEUE_NAMES,
} from '../config/redis';
import { QueueEvents } from 'bullmq';
import redisConnection from '../config/redis';
import { logger, ttmPromptLogger } from '../config/logger';
import voiceSelectorService from './voice-selector.service';
import { buildSunoPromptFromScriptAnalysis, buildSunoPromptFromBlueprint } from './music/suno-prompt-builder';
import { generateMusicalBlueprint, type MusicalBlueprint } from './music/musical-blueprint.service';
import mongoose from 'mongoose';

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
      const project = new Project({
        userId: new mongoose.Types.ObjectId(userId),
        name: `Quick Production - ${new Date().toLocaleDateString()}`,
        description: prompt,
        status: 'ACTIVE',
      });
      await project.save();

      // Create production record to track progress
      const production = new Production({
        projectId: project._id,
        status: 'PENDING',
        progress: 0,
        settings: {
          prompt,
          voiceId,
          duration,
          tone,
          automated: true,
        } as any,
      });
      await production.save();

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

      // Pass user's raw prompt and duration/tone so script worker can use generateAdProductionJSON
      const scriptJob = await scriptGenerationQueue.add('generate-script', {
        userId,
        projectId,
        prompt,
        tone,
        durationSeconds: duration,
        length: duration <= 15 ? 'short' : duration <= 30 ? 'medium' : 'long',
        variations: 1,
      });

      const scriptResult = await scriptJob.waitUntilFinished(scriptQueueEvents);

      if (!scriptResult?.scriptId) {
        throw new Error('Script generation failed - no script ID returned');
      }

      const script = await Script.findById(scriptResult.scriptId);
      if (!script) {
        throw new Error('Script not found after generation');
      }

      logger.info(`[Pipeline ${productionId}] Script generated: ${script.id}`);
      await this.updateProductionStatus(productionId, 'GENERATING_VOICE', 25, 'Script generated! Selecting perfect voice...');

      // Update production with script ID
      await Production.findByIdAndUpdate(productionId, {
        scriptId: script._id,
      });

      // Intelligent Voice Selection - analyze user prompt first, then script
      logger.info(`[Pipeline ${productionId}] Analyzing script and selecting voice`);
      let selectedVoiceId = voiceId;

      if (voiceId === 'default' || !voiceId) {
        try {
          // Pass both user prompt and script for comprehensive voice selection
          const voiceMatch = await voiceSelectorService.selectVoiceForScript(script.content, prompt);
          selectedVoiceId = voiceMatch.voiceId;
          logger.info(`[Pipeline ${productionId}] Intelligently selected voice: ${voiceMatch.name} (${voiceMatch.voiceId}) - ${voiceMatch.reason}`);
        } catch (error: any) {
          logger.warn(`[Pipeline ${productionId}] Voice selection failed, fetching first available voice:`, error.message);
          // If voice selection fails, get the first available voice from ElevenLabs
          try {
            const elevenLabsService = (await import('./tts/elevenlabs.service')).default;
            const voices = await elevenLabsService.getVoices();
            if (voices && voices.length > 0) {
              selectedVoiceId = voices[0].voice_id;
              logger.info(`[Pipeline ${productionId}] Using fallback voice: ${voices[0].name} (${selectedVoiceId})`);
            } else {
              throw new Error('No voices available from ElevenLabs');
            }
          } catch (fallbackError: any) {
            logger.error(`[Pipeline ${productionId}] Failed to get fallback voice:`, fallbackError.message);
            throw new Error(`Voice selection failed and no fallback voice available: ${fallbackError.message}`);
          }
        }
      }

      await this.updateProductionStatus(productionId, 'GENERATING_VOICE', 30, 'Voice selected! Generating speech...');

      // Stage 2: Generate TTS (Voice)
      logger.info(`[Pipeline ${productionId}] Stage 2: Generating TTS with voice ${selectedVoiceId}`);
      const ttsJob = await ttsGenerationQueue.add('generate-tts', {
        userId,
        scriptId: script.id,
        voiceId: selectedVoiceId,
        voiceSettings: {
          stability: 0.75,
          similarity_boost: 0.75,
          style: 0.5,
          use_speaker_boost: true,
        },
      });

      await ttsJob.waitUntilFinished(ttsQueueEvents);
      await this.updateProductionStatus(productionId, 'GENERATING_MUSIC', 50, 'Speech generated! Creating background music...');

      // Re-fetch script so we have lastTTS.sentenceTimings (computed by TTS worker) for sentence-level music prompt
      const scriptAfterTts = await Script.findById(script.id);
      const scriptForMusic = scriptAfterTts ?? script;
      const scriptMetadata = (scriptForMusic as any)?.metadata as any;

      // ========== MUSIC DIRECTION (single source: LLM metadata) ==========
      // The LLM already produced music direction during script generation.
      // We use that directly -- no separate Music Director service to avoid
      // conflicting direction from two systems.
      let musicPrompt = `${tone} background music for advertisement`;
      let musicGenre = 'corporate';
      let musicMood = tone;
      let targetBPM: number | undefined;

      if (scriptMetadata?.music?.prompt) {
        musicPrompt = scriptMetadata.music.prompt;
        if (scriptMetadata.music.genre) musicGenre = scriptMetadata.music.genre;
        if (scriptMetadata.music.mood) musicMood = scriptMetadata.music.mood;
        if (typeof scriptMetadata.music?.targetBPM === 'number') targetBPM = scriptMetadata.music.targetBPM;
        logger.info(`[Pipeline ${productionId}] Using LLM music direction: ${musicPrompt.slice(0, 80)}...`, {
          genre: musicGenre,
          mood: musicMood,
          targetBPM,
        });
      } else {
        try {
          musicPrompt = await voiceSelectorService.generateMusicPrompt(scriptForMusic.content, duration);
          logger.info(`[Pipeline ${productionId}] Generated music prompt (fallback): ${musicPrompt.slice(0, 60)}...`);
        } catch (err: any) {
          logger.warn(`[Pipeline ${productionId}] Music prompt fallback failed: ${err.message}`);
        }
      }

      // ========== MUSICAL BLUEPRINT (Tier 2) ==========
      // When TTS sentence timings are available, generate a precise musical
      // blueprint with bar/beat alignment. The blueprint produces a bar-based
      // Suno prompt that describes musical structure (bars, sections, energy)
      // instead of timestamps (which Suno can't hit reliably).
      const sentenceTimings = scriptMetadata?.lastTTS?.sentenceTimings as
        | { text: string; startSeconds: number; endSeconds: number }[]
        | undefined;
      const hasSentenceTimings = Array.isArray(sentenceTimings) && sentenceTimings.length > 0;

      let blueprint: MusicalBlueprint | undefined;
      let sunoPayload: { customMode?: boolean; title?: string; style?: string; prompt: string } | undefined;

      if (hasSentenceTimings && sentenceTimings) {
        // Compute voice duration from sentence timings
        const voiceDuration = sentenceTimings[sentenceTimings.length - 1].endSeconds;

        blueprint = generateMusicalBlueprint({
          script: scriptForMusic.content,
          sentenceTimings,
          sentenceCues: scriptMetadata.sentenceCues,
          targetBPM: targetBPM ?? 100,
          genre: musicGenre,
          mood: musicMood,
          totalVoiceDuration: voiceDuration,
          composerDirection: scriptMetadata?.music?.composerDirection,
          instrumentation: scriptMetadata?.music?.instrumentation,
          arc: scriptMetadata?.music?.arc,
          buttonEnding: scriptMetadata?.music?.buttonEnding,
          musicalStructure: scriptMetadata?.music?.musicalStructure,
        });

        // Use blueprint's fine-tuned BPM
        targetBPM = blueprint.finalBPM;

        // Build Suno payload from the blueprint's bar-based prompt
        const sunoResult = buildSunoPromptFromBlueprint(blueprint, musicGenre, duration);
        sunoPayload = {
          customMode: sunoResult.customMode,
          title: sunoResult.title || undefined,
          style: sunoResult.style || undefined,
          prompt: sunoResult.prompt,
        };

        logger.info(`[Pipeline ${productionId}] Blueprint: ${blueprint.totalBars} bars @ ${blueprint.finalBPM} BPM, ` +
          `pre-roll=${blueprint.preRollBars} bars, post-roll=${blueprint.postRollBars} bars, ` +
          `${blueprint.sections.length} sections, ${blueprint.syncPoints.length} sync points`);
        const logPrompt = sunoResult.style;
        logger.info(`[Pipeline ${productionId}] Bar-based Suno prompt: ${logPrompt.slice(0, 120)}...`);
        ttmPromptLogger.info(logPrompt, {
          pipelineId: productionId,
          provider: 'suno',
          mode: 'custom',
          title: sunoResult.title || undefined,
          blueprintBPM: blueprint.finalBPM,
          blueprintBars: blueprint.totalBars,
        });
      } else {
        // Fallback: no sentence timings available, use the old prompt builder
        logger.info(`[Pipeline ${productionId}] No sentence timings -- using legacy prompt builder`);
        if (scriptMetadata?.music && typeof scriptMetadata.music === 'object') {
          const productionContext = scriptMetadata.productionContext || scriptMetadata.adProductionJson?.context;
          const contextForMusic =
            productionContext &&
              typeof productionContext.adCategory === 'string' &&
              typeof productionContext.tone === 'string'
              ? {
                adCategory: productionContext.adCategory,
                tone: productionContext.tone,
                emotion: productionContext.emotion ?? productionContext.tone,
                pace: productionContext.pace ?? 'moderate',
              }
              : undefined;
          const sunoResult = buildSunoPromptFromScriptAnalysis({
            music: {
              prompt: musicPrompt,
              targetBPM: targetBPM ?? 100,
              genre: musicGenre,
              mood: musicMood,
              arc: scriptMetadata.music.arc,
              composerDirection: scriptMetadata.music.composerDirection,
            },
            durationSeconds: duration,
            context: contextForMusic ?? undefined,
            fades: scriptMetadata.fades,
            volume: scriptMetadata.volume,
            mixPreset: scriptMetadata.mixPreset,
            sentenceCues: scriptMetadata.sentenceCues,
          });
          sunoPayload = {
            customMode: sunoResult.customMode,
            title: sunoResult.title || undefined,
            style: sunoResult.style || undefined,
            prompt: sunoResult.prompt,
          };

          const logPrompt = sunoResult.customMode ? sunoResult.style : sunoResult.prompt;
          logger.info(`[Pipeline ${productionId}] Suno composition prompt: ${logPrompt.slice(0, 120)}...`);
          ttmPromptLogger.info(logPrompt, {
            pipelineId: productionId,
            provider: 'suno',
            mode: sunoResult.customMode ? 'custom' : 'non-custom',
            title: sunoResult.title || undefined,
          });
        }
      }

      // SINGLE-TRACK GENERATION ONLY.
      // Segment mode is disabled -- one continuous track produces better results
      // than crossfading separate clips.
      const musicRequestDuration = blueprint ? Math.ceil(blueprint.totalDuration) : duration;
      const musicJob = await musicGenerationQueue.add('generate-music', {
        userId,
        text: targetBPM != null ? `${targetBPM} BPM, ${musicPrompt}` : musicPrompt,
        duration_seconds: musicRequestDuration,
        prompt_influence: 0.3,
        genre: musicGenre,
        mood: musicMood,
        targetBPM,
        sunoCustomMode: sunoPayload?.customMode,
        sunoTitle: sunoPayload?.title,
        sunoStyle: sunoPayload?.style,
        sunoPrompt: sunoPayload?.prompt,
        segmentBasedGeneration: false,
      });
      let musicResult = await musicJob.waitUntilFinished(musicQueueEvents);
      if (!musicResult?.musicId) throw new Error('Music generation failed - no music ID returned');
      logger.info(`[Pipeline ${productionId}] Music generated: ${musicResult.musicId}`);

      // ========== MUSIC QUALITY GATE (Tier 4) ==========
      // Quick check: is the generated track's duration within acceptable range?
      // If it's way too short (>30% below requested), regenerate once.
      const requestedDuration = musicRequestDuration;
      try {
        const musicTrack = await MusicTrack.findById(musicResult.musicId);
        if (musicTrack?.duration && requestedDuration > 0) {
          const actualDuration = musicTrack.duration;
          const durationRatio = actualDuration / requestedDuration;
          logger.info(`[Pipeline ${productionId}] Quality gate: requested=${requestedDuration}s, actual=${actualDuration}s, ratio=${durationRatio.toFixed(2)}`);

          if (durationRatio < 0.7) {
            logger.warn(`[Pipeline ${productionId}] Music too short (${actualDuration}s vs ${requestedDuration}s). Regenerating once...`);
            await this.updateProductionStatus(productionId, 'GENERATING_MUSIC', 55, 'Regenerating music for better match...');

            const retryJob = await musicGenerationQueue.add('generate-music', {
              userId,
              text: targetBPM != null ? `${targetBPM} BPM, ${musicPrompt}` : musicPrompt,
              duration_seconds: requestedDuration,
              prompt_influence: 0.3,
              genre: musicGenre,
              mood: musicMood,
              targetBPM,
              sunoCustomMode: sunoPayload?.customMode,
              sunoTitle: sunoPayload?.title,
              sunoStyle: sunoPayload?.style,
              sunoPrompt: sunoPayload?.prompt,
              segmentBasedGeneration: false,
            });
            const retryResult = await retryJob.waitUntilFinished(musicQueueEvents);
            if (retryResult?.musicId) {
              musicResult = retryResult;
              logger.info(`[Pipeline ${productionId}] Retry music generated: ${retryResult.musicId}`);
            }
          }
        }
      } catch (gateErr: any) {
        // Non-fatal: quality gate failure should not block the pipeline
        logger.warn(`[Pipeline ${productionId}] Quality gate check failed: ${gateErr.message}`);
      }

      await Production.findByIdAndUpdate(productionId, {
        musicId: new mongoose.Types.ObjectId(musicResult.musicId),
      });

      await this.updateProductionStatus(productionId, 'MIXING', 70, 'Music generated! Mixing audio...');

      // Stage 4: Mix Audio – use LLM fades/volume from script metadata when available
      logger.info(`[Pipeline ${productionId}] Stage 4: Mixing audio`);
      // Loudness: crossPlatform = -16 LUFS, -2 dBTP (Spotify/podcasts); broadcast = -24 LUFS, -2 dBTP (FCC/EBU)
      const mixSettings: Record<string, unknown> = {
        voiceVolume: 1.0,
        musicVolume: 0.15,
        fadeIn: 0.1,
        fadeOut: 0.4,
        audioDucking: true,
        outputFormat: 'mp3',
        normalizeLoudness: true,
        loudnessPreset: 'crossPlatform',
        loudnessTargetLUFS: -16,
        loudnessTruePeak: -2,
        // Pass BPM + genre so mixing worker can do bar-aligned trim/loop
        targetBPM: targetBPM ?? 100,
        genre: musicGenre,
        // Blueprint data for the mixing worker (when available)
        ...(blueprint ? {
          blueprintPreRollDuration: blueprint.preRollDuration,
          blueprintPostRollDuration: blueprint.postRollDuration,
          blueprintTotalDuration: blueprint.totalDuration,
          blueprintBarDuration: blueprint.barDuration,
          blueprintTotalBars: blueprint.totalBars,
        } : {}),
      };
      if (scriptMetadata?.fades) {
        mixSettings.fadeIn = scriptMetadata.fades.fadeInSeconds ?? 0.1;
        mixSettings.fadeOut = scriptMetadata.fades.fadeOutSeconds ?? 0.4;
        if (scriptMetadata.fades.curve) mixSettings.fadeCurve = scriptMetadata.fades.curve;
      }
      if (scriptMetadata?.volume) {
        mixSettings.voiceVolume = scriptMetadata.volume.voiceVolume ?? 1.0;
        mixSettings.musicVolume = scriptMetadata.volume.musicVolume ?? 0.15;
        if (scriptMetadata.volume.segments?.length) mixSettings.volumeSegments = scriptMetadata.volume.segments;
      }
      if (scriptMetadata?.mixPreset) {
        mixSettings.mixPreset = scriptMetadata.mixPreset;
        const presetDucking: Record<string, number> = {
          voiceProminent: 0.6,
          balanced: 0.35,
          musicEmotional: 0.2,
        };
        mixSettings.duckingAmount = presetDucking[scriptMetadata.mixPreset] ?? 0.35;
      } else {
        mixSettings.duckingAmount = 0.35;
      }

      const productionDoc = await Production.findById(productionId).lean();
      const existingSettings = (productionDoc?.settings as Record<string, unknown>) || {};
      await Production.findByIdAndUpdate(productionId, {
        settings: { ...existingSettings, ...mixSettings },
      });

      const mixingJob = await audioMixingQueue.add('mix-audio', {
        userId,
        productionId,
      });

      const mixingResult = await mixingJob.waitUntilFinished(mixingQueueEvents);

      if (!mixingResult?.outputUrl) {
        throw new Error('Audio mixing failed - no output URL returned');
      }

      logger.info(`[Pipeline ${productionId}] Audio mixed successfully: ${mixingResult.outputUrl}`);

      // Final: Update production as completed
      await Production.findByIdAndUpdate(productionId, {
        status: 'COMPLETED',
        progress: 100,
        outputUrl: mixingResult.outputUrl,
        duration: mixingResult.duration,
      });

      logger.info(`[Pipeline ${productionId}] ✓ Production completed successfully!`);
    } catch (error: any) {
      logger.error(`[Pipeline ${productionId}] Pipeline failed:`, error);
      await this.updateProductionStatus(productionId, 'FAILED', 0, error.message || 'Pipeline execution failed');
      throw error;
    } finally {
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
    const production = await Production.findById(productionId)
      .populate('scriptId')
      .populate('musicId')
      .exec();

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

    // When scriptId is populated it's a full document; extract id so progress.scriptId is always an ID string.
    const scriptId =
      production.scriptId != null
        ? (typeof (production.scriptId as any)._id !== 'undefined'
          ? (production.scriptId as any)._id
          : production.scriptId
        ).toString()
        : undefined;
    const musicId =
      production.musicId != null
        ? (typeof (production.musicId as any)._id !== 'undefined'
          ? (production.musicId as any)._id
          : production.musicId
        ).toString()
        : undefined;

    return {
      stage: stageMap[production.status] || 'script',
      progress: production.progress,
      message: this.getStatusMessage(production.status, production.progress),
      scriptId,
      musicId,
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
    await Production.findByIdAndUpdate(productionId, {
      status: status as any,
      progress,
      errorMessage: status === 'FAILED' ? message : null,
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
