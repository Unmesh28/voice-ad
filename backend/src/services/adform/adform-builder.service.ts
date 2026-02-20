import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../config/logger';
import ttsManager from '../tts/tts-manager.service';
import soundTemplateService from '../music/sound-template.service';
import masteringPresetsService, { getMasteringConfig, getFormatOptions } from '../audio/mastering-presets.service';
import ffmpegService from '../audio/ffmpeg.service';
import type {
  AdForm,
  AdFormBuildResult,
  AdFormBatchRequest,
  AdFormBatchResult,
  AdFormSoundTemplate,
  AudioFormatPreset,
} from '../../types/adform';
import { resolvePlaceholders, getLoudnessValues } from '../../types/adform';

// ===========================================================================
// AdForm Builder Service
//
// The core pipeline that takes an AdForm JSON document and builds
// a complete audio production through 4 stages:
//
//   1. CONTENT  — Resolve scripts, placeholders, sections
//   2. SPEECH   — Generate TTS for each section/segment
//   3. PRODUCTION — Assemble sound template + mix voice + music + SFX
//   4. DELIVERY — Encode to output formats, generate URLs
//
// This is our equivalent of AudioStack's Audioform processing service.
// ===========================================================================

/** Internal state tracked during a build. */
interface BuildState {
  buildId: string;
  adform: AdForm;
  workDir: string;
  progress: number;
  stage: string;
  /** Resolved script texts per section (or single flat script) */
  resolvedTexts: { name: string; text: string; voice?: string }[];
  /** TTS audio files per section */
  ttsFiles: { name: string; filePath: string; duration: number }[];
  /** Assembled music bed file */
  musicFilePath?: string;
  /** Mixed output file (before final encoding) */
  mixedFilePath?: string;
  /** Final output files */
  outputs: { format: AudioFormatPreset; filePath: string; url?: string; duration?: number }[];
  /** Timing metrics */
  timing: {
    contentMs?: number;
    speechMs?: number;
    productionMs?: number;
    deliveryMs?: number;
    totalMs?: number;
  };
}

class AdFormBuilderService {
  private uploadsDir: string;

  constructor() {
    this.uploadsDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
  }

  /**
   * Build a single AdForm. Main entry point.
   */
  async build(adform: AdForm): Promise<AdFormBuildResult> {
    const buildId = uuidv4();
    const totalStart = Date.now();

    // Create working directory
    const workDir = path.join(this.uploadsDir, 'adform-builds', buildId);
    fs.mkdirSync(workDir, { recursive: true });

    const state: BuildState = {
      buildId,
      adform,
      workDir,
      progress: 0,
      stage: 'initializing',
      resolvedTexts: [],
      ttsFiles: [],
      outputs: [],
      timing: {},
    };

    try {
      // Stage 1: Content
      const contentStart = Date.now();
      state.stage = 'content';
      state.progress = 10;
      await this.processContent(state);
      state.timing.contentMs = Date.now() - contentStart;

      // Stage 2: Speech
      const speechStart = Date.now();
      state.stage = 'speech';
      state.progress = 30;
      await this.processSpeech(state);
      state.timing.speechMs = Date.now() - speechStart;

      // Stage 3: Production
      const productionStart = Date.now();
      state.stage = 'production';
      state.progress = 60;
      await this.processProduction(state);
      state.timing.productionMs = Date.now() - productionStart;

      // Stage 4: Delivery
      const deliveryStart = Date.now();
      state.stage = 'delivery';
      state.progress = 85;
      await this.processDelivery(state);
      state.timing.deliveryMs = Date.now() - deliveryStart;

      state.timing.totalMs = Date.now() - totalStart;
      state.progress = 100;
      state.stage = 'completed';

      logger.info(`AdForm build complete: ${buildId} in ${state.timing.totalMs}ms`);

      return {
        buildId,
        status: 'completed',
        progress: 100,
        stage: 'completed',
        outputs: state.outputs.map((o) => ({
          format: o.format,
          url: o.url || o.filePath,
          duration: o.duration,
        })),
        timing: state.timing,
      };
    } catch (err: any) {
      logger.error(`AdForm build failed: ${buildId}: ${err.message}`);
      return {
        buildId,
        status: 'failed',
        progress: state.progress,
        stage: state.stage,
        error: err.message,
        timing: { ...state.timing, totalMs: Date.now() - totalStart },
      };
    }
  }

  /**
   * Build multiple AdForms in parallel (batch processing).
   */
  async buildBatch(request: AdFormBatchRequest): Promise<AdFormBatchResult> {
    const batchId = uuidv4();
    const total = request.adforms.length;

    logger.info(`AdForm batch started: ${batchId}, ${total} items`);

    // Process in parallel with concurrency limit
    const CONCURRENCY = 5;
    const results: AdFormBuildResult[] = [];
    let completed = 0;
    let failed = 0;

    for (let i = 0; i < total; i += CONCURRENCY) {
      const chunk = request.adforms.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map((adform) => {
          // Override delivery if batch-level delivery is set
          if (request.delivery) {
            adform.delivery = { ...adform.delivery, ...request.delivery };
          }
          return this.build(adform);
        })
      );

      for (const result of chunkResults) {
        results.push(result);
        if (result.status === 'completed') completed++;
        else failed++;
      }
    }

    const status = failed === total ? 'failed' : failed > 0 ? 'partial' : 'completed';

    logger.info(`AdForm batch complete: ${batchId}, ${completed}/${total} succeeded`);

    return { batchId, status, total, completed, failed, results };
  }

  // =========================================================================
  // STAGE 1: CONTENT — Resolve scripts, placeholders, sections
  // =========================================================================

  private async processContent(state: BuildState): Promise<void> {
    const { content, speech } = state.adform;

    if (content.sections && content.sections.length > 0) {
      // Section-based content
      state.resolvedTexts = content.sections.map((section) => {
        let text = section.text;

        // Resolve placeholders
        if (content.placeholders && content.placeholders.length > 0) {
          text = resolvePlaceholders(text, content.placeholders, speech.audience);
        }

        return {
          name: section.name,
          text,
          voice: section.voice || undefined,
        };
      });
    } else if (content.scriptText) {
      // Flat script
      let text = content.scriptText;

      if (content.placeholders && content.placeholders.length > 0) {
        text = resolvePlaceholders(text, content.placeholders, speech.audience);
      }

      state.resolvedTexts = [{ name: 'main', text }];
    }

    logger.info(`Content resolved: ${state.resolvedTexts.length} sections, ${state.resolvedTexts.reduce((sum, s) => sum + s.text.length, 0)} chars total`);
  }

  // =========================================================================
  // STAGE 2: SPEECH — Generate TTS for each section
  // =========================================================================

  private async processSpeech(state: BuildState): Promise<void> {
    const { speech } = state.adform;
    const defaultVoice = speech.voice;

    // Generate TTS for each section in parallel
    const results = await Promise.all(
      state.resolvedTexts.map(async (section, i) => {
        // Use section-specific voice if available
        const sectionVoice = speech.sectionVoices?.[section.name] || defaultVoice;
        const outputPath = path.join(state.workDir, `speech_${i}_${section.name}.mp3`);

        const ttsResult = await ttsManager.generate(sectionVoice.provider, {
          voiceId: section.voice || sectionVoice.voiceId,
          text: section.text,
          speed: sectionVoice.speed,
          settings: sectionVoice.settings,
          withTimestamps: true,
        });

        // Save audio to file
        fs.writeFileSync(outputPath, ttsResult.audioBuffer);
        const duration = await ffmpegService.getAudioDuration(outputPath);

        return {
          name: section.name,
          filePath: outputPath,
          duration,
        };
      })
    );

    state.ttsFiles = results;

    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
    logger.info(`Speech generated: ${results.length} sections, ${totalDuration.toFixed(1)}s total`);
  }

  // =========================================================================
  // STAGE 3: PRODUCTION — Assemble sound template + mix
  // =========================================================================

  private async processProduction(state: BuildState): Promise<void> {
    const { production } = state.adform;
    const masteringPreset = production.masteringPreset || 'balanced';
    const loudnessPreset = production.loudnessPreset || 'crossPlatform';
    const config = getMasteringConfig(masteringPreset);
    const loudness = getLoudnessValues(loudnessPreset);

    // Calculate total speech duration
    const totalSpeechDuration = state.ttsFiles.reduce((sum, f) => sum + f.duration, 0);

    // Professional ad structure:
    //   [intro music only: 1.5s] → [voice over music] → [outro music swell: 3s]
    // The intro lets the music establish before voice enters (like a radio ad).
    // The outro lets the music swell back to full volume and fade out gracefully.
    const introPadding = production.timelineProperties?.introPadding ?? 1.5;
    const soundTail = production.timelineProperties?.soundTail ?? 3.0;
    const targetDuration = state.adform.metadata?.targetDuration
      || production.timelineProperties?.forceLength
      || (totalSpeechDuration + introPadding + soundTail);

    // Step 1: Assemble elastic sound template
    const musicOutputPath = path.join(state.workDir, 'music_assembled.mp3');

    if (typeof production.soundTemplate === 'string') {
      // Template ID reference — assemble from catalog
      await soundTemplateService.assembleElastic(
        production.soundTemplate,
        targetDuration,
        musicOutputPath
      );
    } else {
      // Full template definition
      await soundTemplateService.assembleFromDefinition(
        production.soundTemplate as AdFormSoundTemplate,
        targetDuration,
        musicOutputPath
      );
    }

    state.musicFilePath = musicOutputPath;

    // Step 2: Apply voice-support EQ to music if configured
    let processedMusicPath = musicOutputPath;
    if (config.musicSupportEQ) {
      const eqPath = path.join(state.workDir, 'music_eq.mp3');
      try {
        await ffmpegService.applyVoiceSupportEQ(musicOutputPath, eqPath);
        processedMusicPath = eqPath;
      } catch {
        // Use unprocessed music
      }
    }

    // Step 3: Concatenate all speech sections into one voice track
    const voicePaths = state.ttsFiles.map((f) => f.filePath);
    let voiceFilePath: string;

    if (voicePaths.length === 1) {
      voiceFilePath = voicePaths[0];
    } else {
      voiceFilePath = path.join(state.workDir, 'voice_combined.mp3');
      await ffmpegService.concatAudioFiles(voicePaths, voiceFilePath);
    }

    // Step 4: Apply voice presence EQ if configured
    if (config.voicePresenceEQ) {
      const voiceEqPath = path.join(state.workDir, 'voice_eq.mp3');
      try {
        await ffmpegService.applyVoicePresenceEQ(voiceFilePath, voiceEqPath);
        voiceFilePath = voiceEqPath;
      } catch {
        // Use unprocessed voice
      }
    }

    // Step 5: Mix voice + music
    // Professional fade values: 1.5s fade-in and 3.5s fade-out with logarithmic curves
    const fadeIn = production.timelineProperties?.fadeIn ?? 1.5;
    const fadeOut = production.timelineProperties?.fadeOut ?? 3.5;
    const fadeCurve = production.timelineProperties?.fadeCurve ?? 'log';

    const rawMixPath = path.join(state.workDir, 'mix_raw.mp3');

    // Voice enters after the intro music-only padding so the music
    // can establish before the voiceover starts (standard radio ad technique).
    const voiceDelay = introPadding;

    // If a target duration was specified, enforce it so content never runs over.
    // If voice overflows, the mix will apply a graceful fade-out at the boundary.
    const maxDuration = state.adform.metadata?.targetDuration
      || production.timelineProperties?.forceLength
      || undefined;

    if (config.sidechainDucking) {
      // Use frequency-aware sidechain ducking
      const duckedMusicPath = path.join(state.workDir, 'music_ducked.mp3');
      await ffmpegService.applySidechainDucking(
        processedMusicPath,
        voiceFilePath,
        duckedMusicPath
      );

      await ffmpegService.mixAudio({
        voiceInput: { filePath: voiceFilePath, volume: config.voiceVolume, delay: voiceDelay, fadeIn, fadeOut, fadeCurve: fadeCurve as any },
        musicInput: { filePath: duckedMusicPath, volume: config.musicVolume },
        outputPath: rawMixPath,
        audioDucking: false, // Already ducked
        normalizeLoudness: true,
        loudnessTargetLUFS: loudness.lufs,
        loudnessTruePeak: loudness.truePeak,
        maxDuration,
      });
    } else {
      // Simple volume-based mixing
      await ffmpegService.mixAudio({
        voiceInput: { filePath: voiceFilePath, volume: config.voiceVolume, delay: voiceDelay, fadeIn, fadeOut, fadeCurve: fadeCurve as any },
        musicInput: { filePath: processedMusicPath, volume: config.musicVolume },
        outputPath: rawMixPath,
        audioDucking: true,
        duckingAmount: config.duckingAmount,
        normalizeLoudness: true,
        loudnessTargetLUFS: loudness.lufs,
        loudnessTruePeak: loudness.truePeak,
        maxDuration,
      });
    }

    // Step 6: Apply mastering chain
    const masteredPath = path.join(state.workDir, 'mastered.mp3');
    await masteringPresetsService.applyPreset(rawMixPath, masteredPath, masteringPreset, loudnessPreset);

    state.mixedFilePath = masteredPath;
    logger.info(`Production complete: mastering="${masteringPreset}", loudness="${loudnessPreset}"`);
  }

  // =========================================================================
  // STAGE 4: DELIVERY — Encode to output formats
  // =========================================================================

  private async processDelivery(state: BuildState): Promise<void> {
    const { delivery } = state.adform;

    if (!state.mixedFilePath) {
      throw new Error('No mixed audio available for delivery');
    }

    // Determine output formats
    const formats: AudioFormatPreset[] = delivery.formats
      || [delivery.format || 'mp3_medium'];

    // Ensure productions output directory exists
    const outputDir = path.join(this.uploadsDir, 'productions');
    fs.mkdirSync(outputDir, { recursive: true });

    // Encode to each format
    for (const format of formats) {
      const ext = getFormatOptions(format).extension;
      const filename = `adform_${state.buildId}.${ext}`;
      const outputPath = path.join(outputDir, filename);

      await masteringPresetsService.encode(state.mixedFilePath, outputPath, format);

      const duration = await ffmpegService.getAudioDuration(outputPath);
      const fileSize = fs.statSync(outputPath).size;

      const url = delivery.public
        ? `/uploads/productions/${filename}`
        : outputPath;

      state.outputs.push({
        format,
        filePath: outputPath,
        url,
        duration,
      });
    }

    logger.info(`Delivery complete: ${state.outputs.length} format(s) encoded`);
  }
}

export default new AdFormBuilderService();
