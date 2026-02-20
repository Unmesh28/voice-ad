import path from 'path';
import fs from 'fs';
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
import segmentTTSService from './tts/segment-tts.service';
import sfxService from './sfx/sfx.service';
import timelineComposerService from './audio/timeline-composer.service';
import ffmpegService from './audio/ffmpeg.service';
import type { AdCreativePlan } from '../types/ad-format';
import type { MusicSelectionResult } from '../types/ad-production';
import musicQualityService from './music/music-quality.service';
import openaiService from './llm/openai.service';
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

      // ========== CHECK FOR SEGMENT-BASED AD FORMAT ==========
      const adFormat = (script.metadata as any)?.adFormat as AdCreativePlan | undefined;
      const useSegmentPipeline = !!adFormat && Array.isArray(adFormat.segments) && adFormat.segments.length > 0;

      if (useSegmentPipeline) {
        logger.info(`[Pipeline ${productionId}] Segment-based adFormat detected: "${adFormat!.templateName}" (${adFormat!.segments.length} segments)`);
        await this.runSegmentBasedPipeline({
          productionId,
          projectId,
          userId,
          script,
          adFormat: adFormat!,
          selectedVoiceId,
          duration,
          tone,
          musicQueueEvents,
        });
        return;
      }

      // ========== LEGACY SINGLE-PASS PIPELINE ==========
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
      await this.updateProductionStatus(productionId, 'GENERATING_MUSIC', 50, 'Speech generated! Selecting background music...');

      // Re-fetch script so we have lastTTS.sentenceTimings
      const scriptAfterTts = await Script.findById(script.id);
      const scriptForMusic = scriptAfterTts ?? script;
      const scriptMetadata = (scriptForMusic as any)?.metadata as any;

      // ========== MUSIC SELECTION FROM LIBRARY (RAG) ==========
      // Instead of generating music via Suno/ElevenLabs API, we select
      // the best pre-analyzed track from the music library using LLM.
      logger.info(`[Pipeline ${productionId}] Stage 3: Selecting music from library`);

      let musicSelection: MusicSelectionResult;
      try {
        const selectionResult = await openaiService.generateAdWithMusicSelection({
          prompt,
          durationSeconds: duration,
          tone,
        });
        musicSelection = selectionResult.musicSelection;
        logger.info(`[Pipeline ${productionId}] LLM selected track: ${musicSelection.selectedTrack.filename} - ${musicSelection.selectedTrack.reasoning}`);
      } catch (selErr: any) {
        logger.warn(`[Pipeline ${productionId}] Full music selection failed, trying standalone: ${selErr.message}`);
        // Fallback: use the already-generated script metadata for selection
        const llmMusicSelector = (await import('./music/llm-music-selector.service')).default;
        musicSelection = await llmMusicSelector.selectMusic({
          userPrompt: prompt,
          script: script.content,
          tone,
          duration,
          adCategory: scriptMetadata?.context?.adCategory,
          emotion: scriptMetadata?.context?.emotion,
          pace: scriptMetadata?.context?.pace,
        });
      }

      const musicGenre = scriptMetadata?.music?.genre || 'corporate';
      const musicMood = scriptMetadata?.music?.mood || tone;

      // Use the library track via music generation queue (instant file copy)
      const musicJob = await musicGenerationQueue.add('generate-music', {
        userId,
        text: musicSelection.selectedTrack.reasoning,
        genre: musicGenre,
        mood: musicMood,
        libraryTrackFilename: musicSelection.selectedTrack.filename,
        libraryTrackReasoning: musicSelection.selectedTrack.reasoning,
      });
      let musicResult = await musicJob.waitUntilFinished(musicQueueEvents);
      if (!musicResult?.musicId) throw new Error('Music selection failed - no music ID returned');
      logger.info(`[Pipeline ${productionId}] Music selected: ${musicResult.musicId} (${musicSelection.selectedTrack.filename})`);

      await Production.findByIdAndUpdate(productionId, {
        musicId: new mongoose.Types.ObjectId(musicResult.musicId),
      });

      await this.updateProductionStatus(productionId, 'MIXING', 70, 'Music selected! Mixing audio...');

      // Stage 4: Mix Audio – use LLM-selected mixing parameters from music selection
      logger.info(`[Pipeline ${productionId}] Stage 4: Mixing audio`);
      const mp = musicSelection.mixingParameters;
      const mixSettings: Record<string, unknown> = {
        voiceVolume: mp.voiceVolume,
        musicVolume: mp.musicVolume,
        fadeIn: mp.fadeInSeconds,
        fadeOut: mp.fadeOutSeconds,
        fadeCurve: mp.fadeCurve,
        audioDucking: mp.audioDucking,
        duckingAmount: mp.duckingAmount,
        musicDelay: mp.musicDelay,
        outputFormat: 'mp3',
        normalizeLoudness: true,
        loudnessPreset: 'crossPlatform',
        loudnessTargetLUFS: -16,
        loudnessTruePeak: -2,
        genre: musicGenre,
        durationSeconds: duration, // Pass target duration so mixing worker can enforce it
      };
      // Override with script metadata if available (finer control)
      if (scriptMetadata?.fades) {
        mixSettings.fadeIn = scriptMetadata.fades.fadeInSeconds ?? mp.fadeInSeconds;
        mixSettings.fadeOut = scriptMetadata.fades.fadeOutSeconds ?? mp.fadeOutSeconds;
        if (scriptMetadata.fades.curve) mixSettings.fadeCurve = scriptMetadata.fades.curve;
      }
      if (scriptMetadata?.volume) {
        mixSettings.voiceVolume = scriptMetadata.volume.voiceVolume ?? mp.voiceVolume;
        mixSettings.musicVolume = scriptMetadata.volume.musicVolume ?? mp.musicVolume;
        if (scriptMetadata.volume.segments?.length) mixSettings.volumeSegments = scriptMetadata.volume.segments;
      }
      if (scriptMetadata?.mixPreset) {
        mixSettings.mixPreset = scriptMetadata.mixPreset;
        const presetDucking: Record<string, number> = {
          voiceProminent: 0.6,
          balanced: 0.35,
          musicEmotional: 0.2,
        };
        mixSettings.duckingAmount = presetDucking[scriptMetadata.mixPreset] ?? mp.duckingAmount;
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

  // =========================================================================
  // Segment-Based Pipeline (Layers 2–4)
  //
  // When adFormat is present, uses per-segment TTS, SFX generation, and
  // timeline composition instead of the legacy single-pass flow.
  // =========================================================================

  private async runSegmentBasedPipeline(opts: {
    productionId: string;
    projectId: string;
    userId: string;
    script: any;
    adFormat: AdCreativePlan;
    selectedVoiceId: string;
    duration: number;
    tone: string;
    musicQueueEvents: QueueEvents;
  }): Promise<void> {
    const {
      productionId,
      projectId,
      userId,
      script,
      adFormat,
      selectedVoiceId,
      duration,
      tone,
      musicQueueEvents,
    } = opts;

    const scriptMetadata = (script as any)?.metadata as any;
    const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');

    // Log timeline visualization
    const viz = timelineComposerService.visualizeTimeline(adFormat.segments, adFormat.totalDuration);
    logger.info(`[Pipeline ${productionId}] Ad timeline:\n${viz}`);

    // ── Stage 2a: Per-segment TTS ──────────────────────────────────────
    logger.info(`[Pipeline ${productionId}] Stage 2a: Generating per-segment TTS`);
    await this.updateProductionStatus(productionId, 'GENERATING_VOICE', 35, 'Generating segment voiceovers...');

    const ttsResult = await segmentTTSService.generateForSegments({
      segments: adFormat.segments,
      voiceId: selectedVoiceId,
    });

    logger.info(`[Pipeline ${productionId}] Per-segment TTS complete: ${ttsResult.segmentResults.length} segments, ${ttsResult.totalVoiceDuration.toFixed(1)}s total voice`);

    // ── Duration enforcement: adjust segment TTS speed to match target ──
    // Voice should fill: targetDuration minus intro padding (0.5s) and tail (2.0s)
    const voiceTargetDuration = duration - 2.5;
    if (voiceTargetDuration > 0 && ttsResult.totalVoiceDuration > 0) {
      const ratio = ttsResult.totalVoiceDuration / voiceTargetDuration;
      // Only adjust if voice is >12% too long or >20% too short.
      // Cap atempo to 0.85–1.25 to keep speech natural.
      if (ratio > 1.12 || ratio < 0.80) {
        const clampedRatio = Math.max(0.85, Math.min(1.25, ratio));
        logger.info(`[Pipeline ${productionId}] Voice duration off by ${((ratio - 1) * 100).toFixed(0)}%: ${ttsResult.totalVoiceDuration.toFixed(1)}s vs target ${voiceTargetDuration.toFixed(1)}s. Adjusting speed (atempo=${clampedRatio.toFixed(2)})`);

        for (const segResult of ttsResult.segmentResults) {
          if (segResult.filePath && segResult.duration > 0) {
            const segTargetDur = segResult.duration / clampedRatio;
            const adjustedPath = segResult.filePath.replace('.mp3', '_speed.mp3');
            await ffmpegService.stretchAudioToDuration(segResult.filePath, segTargetDur, adjustedPath);
            fs.unlinkSync(segResult.filePath);
            fs.renameSync(adjustedPath, segResult.filePath);
            segResult.duration = await ffmpegService.getAudioDuration(segResult.filePath);
          }
        }

        const newTotal = ttsResult.segmentResults.reduce((s, r) => s + r.duration, 0);
        logger.info(`[Pipeline ${productionId}] Voice duration adjusted: ${ttsResult.totalVoiceDuration.toFixed(1)}s → ${newTotal.toFixed(1)}s`);
        ttsResult.totalVoiceDuration = newTotal;
      } else {
        logger.info(`[Pipeline ${productionId}] Voice duration OK: ${ttsResult.totalVoiceDuration.toFixed(1)}s (target: ${voiceTargetDuration.toFixed(1)}s, ratio: ${ratio.toFixed(2)})`);
      }
    }

    // Save TTS metadata to script for backward compat
    const absoluteTimeline = segmentTTSService.computeAbsoluteTimeline(adFormat.segments, ttsResult.segmentResults);
    const allSentenceTimings = absoluteTimeline.flatMap((seg) => seg.sentenceTimings);
    script.metadata = {
      ...(script.metadata as object),
      lastTTS: {
        voiceId: selectedVoiceId,
        generatedAt: new Date().toISOString(),
        sentenceTimings: allSentenceTimings,
        segmentBased: true,
        segmentCount: ttsResult.segmentResults.length,
        totalVoiceDuration: ttsResult.totalVoiceDuration,
      },
    };
    await script.save();

    await this.updateProductionStatus(productionId, 'GENERATING_MUSIC', 50, 'Speech generated! Creating music and sound effects...');

    // ── Stage 2b: SFX Generation (parallel with music) ────────────────
    // Only use SFX that the LLM explicitly included in the ad format.
    // Auto-enrichment was too aggressive — it added generic whooshes/chimes
    // that clashed with voice and didn't match ad context.
    const sfxInputs = sfxService.extractSfxFromAdFormat(adFormat.segments);
    let sfxResultMap = new Map<number, any>();

    // Start SFX generation in parallel with music
    const sfxPromise = sfxInputs.length > 0
      ? sfxService.generateBatch({ items: sfxInputs, productionId }).then((batch) => {
          // Map results back to segment indices
          const resultMap = new Map<number, any>();
          for (let i = 0; i < sfxInputs.length; i++) {
            if (batch.results[i]?.filePath) {
              resultMap.set(sfxInputs[i].segmentIndex!, batch.results[i]);
            }
          }
          logger.info(`[Pipeline ${productionId}] SFX generation complete: ${batch.succeeded}/${batch.results.length} succeeded`);
          return resultMap;
        })
      : Promise.resolve(new Map<number, any>());

    // ── Stage 3: Music Selection from Library (RAG) ────────────────────
    logger.info(`[Pipeline ${productionId}] Stage 3: Selecting music from library`);

    let musicGenre = scriptMetadata?.music?.genre || 'corporate';
    let musicMood = scriptMetadata?.music?.mood || tone;

    // Select music from library via LLM
    let segmentMusicSelection: MusicSelectionResult;
    try {
      const llmMusicSelector = (await import('./music/llm-music-selector.service')).default;
      segmentMusicSelection = await llmMusicSelector.selectMusic({
        userPrompt: (script as any).metadata?.prompt || script.content,
        script: script.content,
        tone,
        duration,
        adCategory: scriptMetadata?.context?.adCategory,
        emotion: scriptMetadata?.context?.emotion,
        pace: scriptMetadata?.context?.pace,
      });
      logger.info(`[Pipeline ${productionId}] LLM selected track: ${segmentMusicSelection.selectedTrack.filename}`);
    } catch (selErr: any) {
      logger.warn(`[Pipeline ${productionId}] Music selection failed, using fallback: ${selErr.message}`);
      const musicLibrary = (await import('./music/music-library.service')).default;
      const summaries = musicLibrary.getTrackSummaries();
      segmentMusicSelection = {
        selectedTrack: { filename: summaries[0]?.filename || '', reasoning: 'Fallback' },
        mixingParameters: { musicVolume: 0.15, fadeInSeconds: 0.1, fadeOutSeconds: 0.4, fadeCurve: 'exp', voiceVolume: 1.0, audioDucking: true, duckingAmount: 0.35, musicDelay: 1.0 },
      };
    }

    const musicJob = await musicGenerationQueue.add('generate-music', {
      userId,
      text: segmentMusicSelection.selectedTrack.reasoning,
      genre: musicGenre,
      mood: musicMood,
      libraryTrackFilename: segmentMusicSelection.selectedTrack.filename,
      libraryTrackReasoning: segmentMusicSelection.selectedTrack.reasoning,
    });
    let musicResult = await musicJob.waitUntilFinished(musicQueueEvents);
    if (!musicResult?.musicId) throw new Error('Music selection failed - no music ID returned');

    await Production.findByIdAndUpdate(productionId, {
      musicId: new mongoose.Types.ObjectId(musicResult.musicId),
    });

    logger.info(`[Pipeline ${productionId}] Music selected: ${musicResult.musicId} (${segmentMusicSelection.selectedTrack.filename})`);

    // Wait for SFX to finish
    sfxResultMap = await sfxPromise;

    await this.updateProductionStatus(productionId, 'MIXING', 75, 'Composing final audio from all segments...');

    // ── Stage 4: Timeline Composition ─────────────────────────────────
    logger.info(`[Pipeline ${productionId}] Stage 4: Timeline composition`);

    // Resolve music file path
    const musicTrack = await MusicTrack.findById(musicResult.musicId);
    if (!musicTrack?.fileUrl) throw new Error('Music track file URL not found');
    const rawMusicPath = path.join(uploadDir, musicTrack.fileUrl.replace('/uploads/', ''));

    // Apply voice-support EQ to the music track (carves 3kHz for voice clarity)
    const eqMusicPath = rawMusicPath.replace(/\.mp3$/, '_eq.mp3');
    let musicFilePath: string;
    try {
      await ffmpegService.applyVoiceSupportEQ(rawMusicPath, eqMusicPath);
      musicFilePath = eqMusicPath;
      logger.info(`[Pipeline ${productionId}] Voice-support EQ applied to music`);
    } catch (eqErr: any) {
      logger.warn(`[Pipeline ${productionId}] EQ failed, using raw music: ${eqErr.message}`);
      musicFilePath = rawMusicPath;
    }

    // Ensure productions directory exists
    const productionsDir = path.join(uploadDir, 'productions');
    if (!fs.existsSync(productionsDir)) {
      fs.mkdirSync(productionsDir, { recursive: true });
    }
    const outputFilename = `production_${productionId}_${uuidv4()}.mp3`;
    const outputPath = path.join(productionsDir, outputFilename);

    // Resolve mix settings from LLM metadata
    const baseMusicVolume = scriptMetadata?.volume?.musicVolume ?? 0.15;
    const fadeIn = scriptMetadata?.fades?.fadeInSeconds ?? 0.08;
    const fadeOut = scriptMetadata?.fades?.fadeOutSeconds ?? 0.4;
    const fadeCurve = scriptMetadata?.fades?.curve ?? 'exp';

    const composerResult = await timelineComposerService.compose({
      segments: adFormat.segments,
      voiceResults: ttsResult.segmentResults,
      musicFilePath,
      sfxResults: sfxResultMap,
      outputPath,
      baseMusicVolume,
      fadeIn,
      fadeOut,
      fadeCurve,
      normalizeLoudness: true,
      loudnessTargetLUFS: -16,
      loudnessTruePeak: -2,
    });

    // ── Post-composition duration enforcement ──────────────────────────
    // If the final composition significantly exceeds the target duration,
    // apply atempo to compress it.
    let finalDuration = composerResult.duration;
    if (duration > 0 && finalDuration > duration * 1.05) {
      const ratio = finalDuration / duration;
      const clampedRatio = Math.min(1.25, ratio);
      const adjustedTarget = finalDuration / clampedRatio;

      logger.info(`[Pipeline ${productionId}] Post-composition duration enforcement: ${finalDuration.toFixed(1)}s exceeds target ${duration}s. Applying atempo=${clampedRatio.toFixed(2)}`);

      const adjustedPath = outputPath.replace('.mp3', '_adj.mp3');
      try {
        await ffmpegService.stretchAudioToDuration(outputPath, adjustedTarget, adjustedPath);
        fs.unlinkSync(outputPath);
        fs.renameSync(adjustedPath, outputPath);
        finalDuration = await ffmpegService.getAudioDuration(outputPath);
        logger.info(`[Pipeline ${productionId}] Post-composition adjusted: ${finalDuration.toFixed(1)}s`);
      } catch (atempoErr: any) {
        logger.warn(`[Pipeline ${productionId}] Post-composition atempo failed: ${atempoErr.message}`);
      }
    }

    const productionUrl = `/uploads/productions/${outputFilename}`;

    // Update production as completed
    await Production.findByIdAndUpdate(productionId, {
      status: 'COMPLETED',
      progress: 100,
      outputUrl: productionUrl,
      duration: Math.round(finalDuration),
      settings: {
        prompt: scriptMetadata?.prompt,
        voiceId: selectedVoiceId,
        duration,
        tone,
        automated: true,
        segmentBased: true,
        templateId: adFormat.templateId,
        templateName: adFormat.templateName,
        segmentCount: adFormat.segments.length,
        sfxCount: sfxResultMap.size,
      } as any,
    });

    logger.info(`[Pipeline ${productionId}] Segment-based production completed! ${composerResult.duration.toFixed(1)}s, ${adFormat.segments.length} segments, ${sfxResultMap.size} SFX`);
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
