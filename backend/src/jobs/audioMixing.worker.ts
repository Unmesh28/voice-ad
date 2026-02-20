import path from 'path';
import { loadEnv } from '../config/env';
loadEnv();

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
import { alignMusicToVoice } from '../utils/musical-timing';
import { analyzeMusic } from '../services/audio/music-analyzer.service';
import { alignVoiceToMusic, type AlignmentResult } from '../services/audio/music-aligner.service';

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

    // Prepare file paths - use absolute path for uploads directory
    const uploadDir = path.join(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
    const voicePath = voiceAudioUrl ? path.join(uploadDir, voiceAudioUrl.replace('/uploads/', '')) : undefined;
    const musicPath = musicAudioUrl ? path.join(uploadDir, musicAudioUrl.replace('/uploads/', '')) : undefined;

    // Get settings (fadeIn/fadeOut from LLM or defaults)
    const settings = (production.settings as any) || {};
    const voiceVolume = settings.voiceVolume !== undefined ? settings.voiceVolume : 1.0;
    const musicVolume = settings.musicVolume !== undefined ? settings.musicVolume : 0.25;
    // Fade-in: tiny anti-click (0.05s). Fade-out: applied to music tail after voice ends.
    const rawFadeIn = settings.fadeIn ?? 0.05;
    const rawFadeOut = settings.fadeOut ?? 2.0;
    const fadeIn = Math.max(0.02, Math.min(0.15, rawFadeIn));
    const fadeOut = Math.max(0.5, Math.min(3.0, rawFadeOut));
    const fadeCurve = (settings.fadeCurve as 'linear' | 'exp' | 'qsin' | 'log' | undefined) ?? 'exp';
    const audioDucking = settings.audioDucking !== false;
    const duckingAmount = settings.duckingAmount !== undefined ? Math.max(0, Math.min(1, settings.duckingAmount)) : 0.35;
    const outputFormat = settings.outputFormat || 'mp3';
    const normalizeLoudness = settings.normalizeLoudness === true;
    const loudnessPreset = settings.loudnessPreset as 'broadcast' | 'crossPlatform' | undefined;
    const loudnessTargetLUFS =
      settings.loudnessTargetLUFS !== undefined
        ? settings.loudnessTargetLUFS
        : loudnessPreset === 'broadcast'
          ? -24
          : -16;
    const loudnessTruePeak =
      settings.loudnessTruePeak !== undefined
        ? settings.loudnessTruePeak
        : -2;

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

    // ========== BAR-ALIGNED MUSIC ALIGNMENT ==========
    // Instead of stretching music with atempo (which destroys musical structure),
    // we trim or loop on bar boundaries to preserve bars, beats, and phrasing.
    let finalMusicPath = musicPath;
    const targetBPM: number = settings.targetBPM ?? 100;
    const genre: string = settings.genre ?? '';

    // Blueprint data from orchestrator (when available)
    const blueprintPreRoll: number | undefined = settings.blueprintPreRollDuration;
    const blueprintPostRollBars: number = settings.blueprintTotalBars
      ? Math.max(1, Math.round((settings.blueprintPostRollDuration ?? 0) / (settings.blueprintBarDuration ?? 2.4)))
      : 1;
    const blueprintBarDuration: number | undefined = settings.blueprintBarDuration;

    // Sentence timings + cues for ducking
    const sentenceCues = scriptMetadata?.sentenceCues as { index: number; musicVolumeMultiplier?: number }[] | undefined;
    const sentenceTimings = scriptMetadata?.lastTTS?.sentenceTimings as
      | { text: string; startSeconds: number; endSeconds: number }[]
      | undefined;

    let voiceDelaySec = 0; // How much to delay voice in the mix (for pre-roll)
    let alignmentResult: AlignmentResult | undefined;

    if (voicePath && musicPath) {
      const voiceDuration = await ffmpegService.getAudioDuration(voicePath);
      const musicDuration = await ffmpegService.getAudioDuration(musicPath);

      const alignment = alignMusicToVoice(musicDuration, voiceDuration, targetBPM, { genre });

      logger.info(`Bar-aligned music alignment: voice=${voiceDuration.toFixed(1)}s, music=${musicDuration.toFixed(1)}s`, {
        action: alignment.action,
        targetDuration: alignment.targetDuration.toFixed(1),
        targetBars: alignment.targetBars,
        barDuration: alignment.barDuration.toFixed(2),
        bpm: targetBPM,
        preRollBars: alignment.preRollBars,
        preRollDuration: alignment.preRollDuration.toFixed(2),
      });

      const musicDir = path.join(uploadDir, 'music');
      if (!fs.existsSync(musicDir)) fs.mkdirSync(musicDir, { recursive: true });

      if (alignment.action === 'trim') {
        const trimmedFilename = `trimmed_music_${uuidv4()}.mp3`;
        const trimmedMusicPath = path.join(musicDir, trimmedFilename);
        logger.info(`Trimming music from ${musicDuration.toFixed(1)}s to ${alignment.targetDuration.toFixed(1)}s (${alignment.targetBars} bars at ${targetBPM} BPM)`);
        await ffmpegService.trimAudio(musicPath, alignment.targetDuration, trimmedMusicPath);
        finalMusicPath = trimmedMusicPath;
      } else if (alignment.action === 'loop') {
        const loopedFilename = `looped_music_${uuidv4()}.mp3`;
        const loopedMusicPath = path.join(musicDir, loopedFilename);
        logger.info(`Looping music from ${musicDuration.toFixed(1)}s to ${alignment.targetDuration.toFixed(1)}s (${alignment.loopCount} loops, ${alignment.targetBars} bars)`);
        await ffmpegService.extendAudioDuration(musicPath, alignment.targetDuration, loopedMusicPath);
        finalMusicPath = loopedMusicPath;
      }

      await job.updateProgress(45);

      // ========== MUSIC ANALYSIS + VOICE-MUSIC ALIGNMENT (Tier 3) ==========
      // Analyze the music to detect its actual beat grid and energy curve,
      // then compute intelligent alignment: voice delay (enters on a downbeat),
      // beat-aware ducking, and bar-aligned button ending.
      if (finalMusicPath && Array.isArray(sentenceTimings) && sentenceTimings.length > 0) {
        try {
          logger.info(`[Tier 3] Running music analysis on ${finalMusicPath}`);
          const musicAnalysis = await analyzeMusic(finalMusicPath, targetBPM);

          // Build per-sentence volume multiplier map from cues
          const volumeMultipliers = new Map<number, number>();
          if (Array.isArray(sentenceCues)) {
            for (const cue of sentenceCues) {
              if (cue.musicVolumeMultiplier != null) {
                volumeMultipliers.set(cue.index, cue.musicVolumeMultiplier);
              }
            }
          }

          const preRollDuration = blueprintPreRoll ?? alignment.preRollDuration;
          const barDur = blueprintBarDuration ?? alignment.barDuration;

          alignmentResult = alignVoiceToMusic(musicAnalysis, sentenceTimings, {
            preRollDuration,
            postRollBars: blueprintPostRollBars,
            barDuration: barDur,
            duckLevel: duckingAmount,
            musicVolumeMultipliers: volumeMultipliers.size > 0 ? volumeMultipliers : undefined,
          });

          voiceDelaySec = alignmentResult.voiceDelay;

          // If the alignment says to cut earlier than the current music, trim to button ending
          if (alignmentResult.musicCutoffTime < musicDuration && alignmentResult.musicCutoffTime > 0) {
            const cutFilename = `button_music_${uuidv4()}.mp3`;
            const cutMusicPath = path.join(musicDir, cutFilename);
            logger.info(`[Tier 3] Trimming music for button ending at ${alignmentResult.musicCutoffTime.toFixed(1)}s (bar ${alignmentResult.buttonEndingBar})`);
            await ffmpegService.trimAudio(finalMusicPath, alignmentResult.musicCutoffTime, cutMusicPath);
            finalMusicPath = cutMusicPath;
          }

          logger.info(`[Tier 3] Alignment complete: voiceDelay=${voiceDelaySec.toFixed(2)}s, ` +
            `cutoff=${alignmentResult.musicCutoffTime.toFixed(1)}s, ` +
            `${alignmentResult.duckingSegments.length} ducking segments, ` +
            `score=${alignmentResult.alignmentScore.toFixed(2)}`);
        } catch (analysisError: any) {
          // Non-fatal: if analysis fails, fall back to Tier 1 behavior (no voice delay)
          logger.warn(`[Tier 3] Music analysis/alignment failed, using Tier 1 fallback: ${analysisError.message}`);
          voiceDelaySec = 0;
        }
      }

      await job.updateProgress(55);
    }

    // ========== BEAT-AWARE DUCKING ==========
    // When alignment result is available, apply beat-aware ducking
    // (duck boundaries snap to beats). Otherwise fall back to per-sentence volume.
    if (alignmentResult && alignmentResult.duckingSegments.length > 0 && finalMusicPath) {
      // Convert ducking segments to volume curve entries
      // The ducking segments are in absolute mix time (music time, with voice delay applied)
      const totalMusicDuration = await ffmpegService.getAudioDuration(finalMusicPath);
      const curve: { startSeconds: number; endSeconds: number; volumeMultiplier: number }[] = [];

      for (const seg of alignmentResult.duckingSegments) {
        curve.push({
          startSeconds: Math.max(0, seg.startTime),
          endSeconds: Math.min(totalMusicDuration, seg.endTime),
          volumeMultiplier: seg.duckLevel,
        });
      }

      if (curve.length > 0) {
        const curvedFilename = `ducked_music_${uuidv4()}.mp3`;
        const musicDir = path.join(uploadDir, 'music');
        const curvedMusicPath = path.join(musicDir, curvedFilename);
        if (!fs.existsSync(musicDir)) fs.mkdirSync(musicDir, { recursive: true });
        await ffmpegService.applyVolumeCurve(finalMusicPath, curve, totalMusicDuration, curvedMusicPath);
        finalMusicPath = curvedMusicPath;
        logger.info(`[Tier 3] Applied beat-aware ducking (${curve.length} segments) for production ${productionId}`);
      }
    } else if (
      Array.isArray(sentenceCues) &&
      sentenceCues.length > 0 &&
      Array.isArray(sentenceTimings) &&
      sentenceTimings.length > 0 &&
      finalMusicPath &&
      voicePath
    ) {
      // Fallback: simple per-sentence volume curve (Tier 1 behavior)
      const voiceDuration = await ffmpegService.getAudioDuration(voicePath);
      const cueByIndex = new Map(sentenceCues.map((c) => [c.index, c]));
      const curve: { startSeconds: number; endSeconds: number; volumeMultiplier: number }[] = [];
      for (let i = 0; i < sentenceTimings.length; i++) {
        const t = sentenceTimings[i];
        const cue = cueByIndex.get(i);
        const mult = cue?.musicVolumeMultiplier != null ? Math.max(0.1, Math.min(3, cue.musicVolumeMultiplier)) : 1;
        curve.push({
          startSeconds: Math.max(0, t.startSeconds),
          endSeconds: Math.min(voiceDuration, t.endSeconds),
          volumeMultiplier: mult,
        });
      }
      if (curve.length > 0) {
        const curvedFilename = `curved_music_${uuidv4()}.mp3`;
        const musicDir = path.join(uploadDir, 'music');
        const curvedMusicPath = path.join(musicDir, curvedFilename);
        if (!fs.existsSync(musicDir)) fs.mkdirSync(musicDir, { recursive: true });
        await ffmpegService.applyVolumeCurve(finalMusicPath, curve, voiceDuration, curvedMusicPath);
        finalMusicPath = curvedMusicPath;
        logger.info(`Applied per-sentence music volume (${curve.length} segments) for production ${productionId}`);
      }
    }

    // Target ad duration from the production context — used to cap the mix
    // so content never runs over the selected duration (graceful fade-out, not hard cut).
    const maxDuration: number | undefined =
      settings.durationSeconds ?? scriptMetadata?.durationSeconds ?? scriptMetadata?.productionContext?.durationSeconds ?? undefined;

    // Mix audio
    logger.info(`Mixing audio for production ${productionId}`, {
      voiceDelay: voiceDelaySec.toFixed(2),
      hasAlignment: !!alignmentResult,
      maxDuration,
    });
    await ffmpegService.mixAudio({
      voiceInput: voicePath ? {
        filePath: voicePath,
        volume: voiceVolume,
        delay: voiceDelaySec > 0 ? voiceDelaySec : undefined,
        fadeIn,
        fadeOut,
        fadeCurve,
      } : undefined,
      musicInput: finalMusicPath ? {
        filePath: finalMusicPath,
        volume: musicVolume,
      } : undefined,
      outputPath,
      outputFormat: outputFormat as any,
      audioDucking: alignmentResult ? false : audioDucking, // When we have beat-aware ducking, disable the basic ducking
      duckingAmount,
      fadeCurve,
      normalize: !normalizeLoudness,
      normalizeLoudness,
      loudnessTargetLUFS,
      loudnessTruePeak,
      maxDuration,
    });

    await job.updateProgress(75);

    // ========== TWO-PASS MIXING (Tier 4) ==========
    // After the first mix, measure its loudness. If it's more than 3 LU off
    // target, adjust music volume and remix for a tighter result.
    if (normalizeLoudness && finalMusicPath && voicePath) {
      try {
        const measuredLoudness = await ffmpegService.measureLoudness(outputPath);
        const loudnessGap = measuredLoudness - loudnessTargetLUFS;

        logger.info(`[Two-pass] First mix loudness: ${measuredLoudness.toFixed(1)} LUFS (target: ${loudnessTargetLUFS}, gap: ${loudnessGap.toFixed(1)})`, {
          productionId,
        });

        // If the gap is large, the music volume might be competing with the voice.
        // Adjust: if mix is too loud (loudnessGap > 3), reduce music. If too quiet, boost music slightly.
        if (Math.abs(loudnessGap) > 3) {
          const adjustFactor = loudnessGap > 0 ? 0.7 : 1.3;
          const adjustedMusicVolume = Math.max(0.05, Math.min(0.5, musicVolume * adjustFactor));

          logger.info(`[Two-pass] Remixing: musicVolume ${musicVolume.toFixed(2)} → ${adjustedMusicVolume.toFixed(2)}`, {
            productionId,
            adjustFactor,
          });

          await ffmpegService.mixAudio({
            voiceInput: {
              filePath: voicePath,
              volume: voiceVolume,
              delay: voiceDelaySec > 0 ? voiceDelaySec : undefined,
              fadeIn,
              fadeOut,
              fadeCurve,
            },
            musicInput: {
              filePath: finalMusicPath,
              volume: adjustedMusicVolume,
            },
            outputPath,
            outputFormat: outputFormat as any,
            audioDucking: alignmentResult ? false : audioDucking,
            duckingAmount,
            fadeCurve,
            normalize: !normalizeLoudness,
            normalizeLoudness,
            loudnessTargetLUFS,
            loudnessTruePeak,
            maxDuration,
          });

          const remeasured = await ffmpegService.measureLoudness(outputPath);
          logger.info(`[Two-pass] Remixed loudness: ${remeasured.toFixed(1)} LUFS`, { productionId });
        }
      } catch (twoPassErr: any) {
        // Non-fatal: if two-pass measurement fails, keep the first mix
        logger.warn(`[Two-pass] Analysis failed, keeping first mix: ${twoPassErr.message}`);
      }
    }

    await job.updateProgress(85);

    // Get duration
    let duration = await ffmpegService.getAudioDuration(outputPath);

    // ── Post-mix duration enforcement ────────────────────────────────
    // If the final mix significantly exceeds the target duration,
    // apply atempo to compress it to fit. This catches cases where
    // the TTS-level adjustment wasn't enough.
    if (maxDuration && maxDuration > 0 && duration > maxDuration * 1.05) {
      const ratio = duration / maxDuration;
      // Only adjust up to 1.25x speed to keep audio natural
      const clampedRatio = Math.min(1.25, ratio);
      const adjustedTarget = duration / clampedRatio;

      logger.info(`Post-mix duration enforcement: ${duration.toFixed(1)}s exceeds target ${maxDuration}s by ${((ratio - 1) * 100).toFixed(0)}%. Applying atempo=${clampedRatio.toFixed(2)}`, {
        productionId,
      });

      const adjustedPath = outputPath.replace(/\.(mp3|wav|aac)$/, '_adj.$1');
      try {
        await ffmpegService.stretchAudioToDuration(outputPath, adjustedTarget, adjustedPath);
        const fsSync = require('fs');
        fsSync.unlinkSync(outputPath);
        fsSync.renameSync(adjustedPath, outputPath);
        duration = await ffmpegService.getAudioDuration(outputPath);
        logger.info(`Post-mix adjusted: ${duration.toFixed(1)}s (target: ${maxDuration}s)`, { productionId });
      } catch (atempoErr: any) {
        logger.warn(`Post-mix atempo failed, keeping original: ${atempoErr.message}`, { productionId });
      }
    }

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
