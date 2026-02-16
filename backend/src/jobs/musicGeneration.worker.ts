import { loadEnv } from '../config/env';
loadEnv();

import { Worker, Job } from 'bullmq';
import { musicGenerationQueue } from '../config/redis';
import { MusicTrack } from '../models/MusicTrack';
import { Job as JobModel } from '../models/Job';
import { UsageRecord } from '../models/UsageRecord';
import elevenLabsMusicService from '../services/music/elevenlabs-music.service';
import kieSunoMusicService from '../services/music/kie-suno-music.service';
import { ELEVENLABS_MUSIC_PROMPT_MAX } from '../services/music/suno-prompt-builder';
import musicLibraryService from '../services/music/music-library.service';
import { logger, ttmPromptLogger } from '../config/logger';
import redisConnection from '../config/redis';
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';
import ffmpegService from '../services/audio/ffmpeg.service';
import path from 'path';
import fs from 'fs';

interface MusicArcSegment {
  startSeconds: number;
  endSeconds: number;
  label: string;
  musicPrompt: string;
  targetBPM?: number;
  energyLevel?: number;
}

interface MusicGenerationJobData {
  userId: string;
  text: string;
  duration_seconds?: number;
  prompt_influence?: number;
  name?: string;
  genre?: string;
  mood?: string;
  /** From LLM music.targetBPM; may be reflected in text (e.g. "100 BPM, ...") for ElevenLabs */
  targetBPM?: number;
  /** Suno: timestamped composition (custom mode). When set, use style + title for product-intro etc. */
  sunoCustomMode?: boolean;
  sunoTitle?: string;
  sunoStyle?: string;
  sunoPrompt?: string;
  /** If true and arc is provided, generate separate clips per segment and crossfade them */
  segmentBasedGeneration?: boolean;
  /** Music arc segments for segment-based generation */
  arc?: MusicArcSegment[];
  /** Crossfade duration for segment-based generation (optional, calculated dynamically per segment) */
  crossfadeDuration?: number;
  /** Enable smart overlap calculation (default true when segment mode enabled) */
  enableSmartOverlap?: boolean;
  /** Full music metadata for segment-based generation */
  musicMetadata?: {
    instrumentation?: {
      drums: string;
      bass: string;
      mids: string;
      effects: string;
    };
    composerDirection?: string;
    buttonEnding?: {
      type: string;
      timing?: string;
      description?: string;
    };
  };
  /** When set, use pre-analyzed music from library instead of generating via API */
  libraryTrackFilename?: string;
  /** Reasoning for why this track was selected */
  libraryTrackReasoning?: string;
}

/**
 * Calculate smart overlap duration based on musical differences between segments.
 * Larger differences in BPM or energy require longer overlaps for smooth transitions.
 * 
 * @param currentSegment Current music arc segment
 * @param nextSegment Next music arc segment (null if last segment)
 * @param defaultOverlap Default overlap duration (default 2.0s)
 * @returns Overlap duration in seconds (0 for last segment)
 */
function calculateOverlapDuration(
  currentSegment: MusicArcSegment,
  nextSegment: MusicArcSegment | null,
  defaultOverlap: number = 2.0
): number {
  if (!nextSegment) return 0; // Last segment, no overlap needed

  const currentBPM = currentSegment.targetBPM || 100;
  const nextBPM = nextSegment.targetBPM || 100;
  const currentEnergy = currentSegment.energyLevel || 5;
  const nextEnergy = nextSegment.energyLevel || 5;

  // Calculate BPM difference percentage
  const bpmDiff = Math.abs(currentBPM - nextBPM) / currentBPM;
  const energyDiff = Math.abs(currentEnergy - nextEnergy);

  // Small changes: 1.5s, Medium: 2.5s, Large: 3.5s
  if (bpmDiff < 0.1 && energyDiff <= 2) return 1.5; // Subtle transition
  if (bpmDiff < 0.2 && energyDiff <= 3) return 2.5; // Medium transition
  return 3.5; // Significant transition needs more time
}

/**
 * Generate music in segment-based mode: one clip per arc segment, then crossfade them.
 * Each segment generates its own music clip with segment-specific musicPrompt, BPM, and energy.
 * Uses smart overlapping and contextual prompting for seamless transitions.
 */
const processSegmentBasedGeneration = async (job: Job<MusicGenerationJobData>) => {
  const { userId, arc, crossfadeDuration = 0.5, genre, mood, name, targetBPM, musicMetadata, enableSmartOverlap = true } = job.data;

  if (!arc || arc.length < 2) {
    throw new Error('Segment-based generation requires at least 2 arc segments');
  }

  logger.info(`Processing segment-based music generation: ${arc.length} segments (smart overlap: ${enableSmartOverlap})`);

  try {
    await job.updateProgress(10);

    // Calculate overlap durations for each segment pair
    const overlapDurations: number[] = [];
    for (let i = 0; i < arc.length; i++) {
      const nextSegment = i < arc.length - 1 ? arc[i + 1] : null;
      const overlap = enableSmartOverlap
        ? calculateOverlapDuration(arc[i], nextSegment)
        : (nextSegment ? crossfadeDuration : 0);
      overlapDurations.push(overlap);
      if (nextSegment) {
        logger.info(`Overlap ${arc[i].label} → ${nextSegment.label}: ${overlap.toFixed(2)}s`);
      }
    }

    const segmentFiles: { filePath: string; duration: number; crossfadeDuration: number }[] = [];
    const tempFiles: string[] = [];

    // Generate each segment with overlap
    for (let i = 0; i < arc.length; i++) {
      const segment = arc[i];
      const prevSegment = i > 0 ? arc[i - 1] : null;
      const nextSegment = i < arc.length - 1 ? arc[i + 1] : null;

      const baseDuration = segment.endSeconds - segment.startSeconds;
      const preOverlap = prevSegment && enableSmartOverlap ? overlapDurations[i - 1] : 0;
      const postOverlap = enableSmartOverlap ? overlapDurations[i] : 0;

      // Extended duration includes pre and post overlap
      const extendedDuration = baseDuration + preOverlap + postOverlap;
      const segmentFilename = `music_segment_${uuidv4()}_${i}.mp3`;
      const segmentBPM = segment.targetBPM || targetBPM || 100;

      logger.info(
        `Generating segment ${i + 1}/${arc.length}: ${segment.label} ` +
        `(base: ${baseDuration}s, extended: ${extendedDuration.toFixed(2)}s with ` +
        `pre-overlap: ${preOverlap.toFixed(2)}s, post-overlap: ${postOverlap.toFixed(2)}s, ` +
        `BPM: ${segmentBPM}, energy: ${segment.energyLevel})`
      );

      const progressStep = 70 / arc.length;
      await job.updateProgress(10 + progressStep * i);

      // Build comprehensive prompt with contextual information
      const promptParts: string[] = [];

      // Add context from previous segment (for smooth transition)
      if (prevSegment) {
        const prevBPM = prevSegment.targetBPM || targetBPM || 100;
        const prevEnergy = prevSegment.energyLevel || 5;
        promptParts.push(
          `TRANSITION FROM: ${prevSegment.label} (${prevBPM} BPM, energy ${prevEnergy}/10). ` +
          `Maintain musical key and harmonic continuity. ` +
          `Smooth tempo transition from ${prevBPM} to ${segmentBPM} BPM.`
        );
      }

      // Core metadata
      if (genre) promptParts.push(`genre: ${genre}.`);
      promptParts.push(`targetBPM: ${segmentBPM}.`);
      if (mood) promptParts.push(`mood: ${mood}.`);

      // Energy level for this segment
      if (segment.energyLevel) {
        promptParts.push(`Energy: ${segment.energyLevel}/10 (arrangement density).`);
      }

      // Instrumentation (if provided)
      if (musicMetadata?.instrumentation) {
        const inst = musicMetadata.instrumentation;
        promptParts.push(`Instrumentation: drums: ${inst.drums}. bass: ${inst.bass}. mids: ${inst.mids}. effects: ${inst.effects}.`);
      }

      // Composer direction (overall context)
      if (musicMetadata?.composerDirection) {
        promptParts.push(`Direction: ${musicMetadata.composerDirection}`);
      }

      // Segment-specific prompt
      promptParts.push(`Segment [${segment.startSeconds}-${segment.endSeconds}s]: ${segment.label}. ${segment.musicPrompt}`);

      // Add lookahead context for next segment
      if (nextSegment) {
        const nextBPM = nextSegment.targetBPM || targetBPM || 100;
        promptParts.push(
          `LEADING INTO: ${nextSegment.label} (${nextBPM} BPM). ` +
          `Prepare musical transition, maintain same key/scale.`
        );
      }

      // Button ending hint (if last segment)
      if (i === arc.length - 1 && musicMetadata?.buttonEnding) {
        promptParts.push(`Ending: ${musicMetadata.buttonEnding.type}. CLEAN ENDING, NO FADE-OUT.`);
      }

      // Emphasize continuity for seamless blending
      promptParts.push(
        'CRITICAL: This segment must blend seamlessly with adjacent sections. ' +
        'No abrupt stops or starts. Continuous musical flow. ' +
        'Match instrumentation and maintain harmonic progression.'
      );

      promptParts.push('Instrumental, no vocals, ad background. Professional broadcast quality.');

      const fullSegmentPrompt = promptParts.join(' ');

      // Generate music for this segment
      let segmentResult: { filePath: string; audioBuffer: Buffer; duration: number };

      if (kieSunoMusicService.isConfigured()) {
        try {
          const sunoOptions = {
            customMode: true,
            title: `${segment.label} (${baseDuration}s)`,
            style: fullSegmentPrompt,
            prompt: fullSegmentPrompt,
            instrumental: true,
            model: 'V5' as const,
          };

          // Log FULL TTM prompt for this segment
          ttmPromptLogger.info(
            sunoOptions.style,
            {
              jobId: job.id,
              provider: 'suno',
              mode: 'segment-based',
              segmentIndex: i,
              totalSegments: arc.length,
              segmentLabel: segment.label,
              title: sunoOptions.title,
            }
          );

          segmentResult = await kieSunoMusicService.generateAndSave(sunoOptions, segmentFilename);
        } catch (sunoError: any) {
          logger.warn(`Kie Suno failed for segment ${i}, falling back to ElevenLabs: ${sunoError.message}`);
          const elevenLabsPrompt = fullSegmentPrompt.slice(0, ELEVENLABS_MUSIC_PROMPT_MAX);

          // Log FULL TTM prompt (ElevenLabs fallback)
          ttmPromptLogger.info(
            `ORIGINAL (full):\n${fullSegmentPrompt}\n\nTRUNCATED (ElevenLabs - 450 chars max):\n${elevenLabsPrompt}`,
            {
              jobId: job.id,
              provider: 'elevenlabs (fallback from suno)',
              mode: 'segment-based',
              segmentIndex: i,
              totalSegments: arc.length,
              segmentLabel: segment.label,
            }
          );

          const options = elevenLabsMusicService.validateOptions({
            text: elevenLabsPrompt,
            duration_seconds: extendedDuration,
            prompt_influence: 0.7,
          });
          segmentResult = await elevenLabsMusicService.generateAndSave(options, segmentFilename);
        }
      } else {
        const elevenLabsPrompt = fullSegmentPrompt.slice(0, ELEVENLABS_MUSIC_PROMPT_MAX);

        // Log FULL TTM prompt (ElevenLabs primary)
        ttmPromptLogger.info(
          `ORIGINAL (full):\n${fullSegmentPrompt}\n\nTRUNCATED (ElevenLabs - 450 chars max):\n${elevenLabsPrompt}`,
          {
            jobId: job.id,
            provider: 'elevenlabs',
            mode: 'segment-based',
            segmentIndex: i,
            totalSegments: arc.length,
            segmentLabel: segment.label,
          }
        );

        const options = elevenLabsMusicService.validateOptions({
          text: elevenLabsPrompt,
          duration_seconds: extendedDuration,
          prompt_influence: 0.7,
        });
        segmentResult = await elevenLabsMusicService.generateAndSave(options, segmentFilename);
      }

      segmentFiles.push({
        filePath: segmentResult.filePath,
        duration: segmentResult.duration,
        crossfadeDuration: postOverlap > 0 ? postOverlap : crossfadeDuration,
      });
      tempFiles.push(segmentResult.filePath);
    }

    await job.updateProgress(80);

    // Combine segments with crossfade
    const finalFilename = `music_${uuidv4()}.mp3`;
    const finalPath = path.join(process.cwd(), 'uploads', 'music', finalFilename);

    logger.info(`Crossfading ${segmentFiles.length} segments (crossfade: ${crossfadeDuration}s)`);
    await ffmpegService.crossfadeAudioSegments(segmentFiles, crossfadeDuration, finalPath);

    // Calculate total duration (segments overlap by crossfade amount)
    const totalDuration = segmentFiles.reduce((acc, seg, i) => {
      return acc + seg.duration - (i > 0 ? crossfadeDuration : 0);
    }, 0);

    await job.updateProgress(90);

    const musicUrl = `/uploads/music/${finalFilename}`;

    // Save to database
    const musicTrack = new MusicTrack({
      name: name || `Generated Music (Segmented) - ${new Date().toLocaleString()}`,
      description: `Segment-based music: ${arc.map((s) => s.label).join(' → ')}`,
      genre: genre || undefined,
      mood: mood || undefined,
      duration: totalDuration,
      fileUrl: musicUrl,
      isGenerated: true,
      metadata: {
        segmentBased: true,
        segments: arc.map((s, i) => ({
          index: i,
          label: s.label,
          prompt: s.musicPrompt,
          targetBPM: s.targetBPM,
          energyLevel: s.energyLevel,
          startSeconds: s.startSeconds,
          endSeconds: s.endSeconds,
        })),
        crossfadeDuration,
        provider: kieSunoMusicService.isConfigured() ? 'kie_suno' : 'elevenlabs',
        generatedAt: new Date().toISOString(),
        jobId: job.id,
      },
    });
    await musicTrack.save();

    // Track usage (count as one generation, even though multiple segments)
    const usageRecord = new UsageRecord({
      userId: new mongoose.Types.ObjectId(userId),
      resourceType: 'MUSIC_GENERATION',
      quantity: arc.length, // Count segments for usage
      metadata: {
        musicId: musicTrack.id,
        duration: totalDuration,
        segmentBased: true,
        segmentCount: arc.length,
        jobId: job.id,
      },
    });
    await usageRecord.save();

    // Clean up temp segment files
    for (const tempFile of tempFiles) {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
          logger.debug(`Cleaned up temp segment: ${tempFile}`);
        }
      } catch (err) {
        logger.warn(`Failed to clean up temp file ${tempFile}:`, err);
      }
    }

    await job.updateProgress(100);

    logger.info(`Segment-based music generation completed for job ${job.id}`, {
      musicId: musicTrack.id,
      duration: totalDuration,
      segments: arc.length,
    });

    return {
      success: true,
      musicId: musicTrack.id,
      musicUrl,
      duration: totalDuration,
      segmentBased: true,
      segmentCount: arc.length,
    };
  } catch (error: any) {
    logger.error(`Segment-based music generation failed for job ${job.id}:`, {
      error: error.message,
      stack: error.stack,
    });

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
 * Process library-based music selection: copy the pre-analyzed track from the
 * music library instead of generating via API. This is instant (no polling).
 */
const processLibraryTrackSelection = async (job: Job<MusicGenerationJobData>) => {
  const { userId, libraryTrackFilename, libraryTrackReasoning, name, genre, mood } = job.data;

  logger.info(`Processing library-based music selection for job ${job.id}: ${libraryTrackFilename}`);

  try {
    await job.updateProgress(20);

    // Resolve source path from library
    const sourcePath = musicLibraryService.getTrackFilePath(libraryTrackFilename!);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Library track not found: ${sourcePath}`);
    }

    await job.updateProgress(40);

    // Copy to uploads directory
    const ext = path.extname(libraryTrackFilename!);
    const outputFilename = `music_${uuidv4()}${ext}`;
    const uploadsDir = path.join(process.cwd(), 'uploads', 'music');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const destPath = path.join(uploadsDir, outputFilename);
    fs.copyFileSync(sourcePath, destPath);

    await job.updateProgress(70);

    // Get track info from catalog for metadata
    const trackInfo = musicLibraryService.getTrackByFilename(libraryTrackFilename!);
    const duration = trackInfo?.technical?.file_info?.duration_seconds ?? 0;

    const musicUrl = `/uploads/music/${outputFilename}`;

    // Save to database
    const musicTrack = new MusicTrack({
      name: name || `Library Track: ${libraryTrackFilename}`,
      description: libraryTrackReasoning || `Selected from music library: ${libraryTrackFilename}`,
      genre: genre || trackInfo?.human_analysis?.genre || undefined,
      mood: mood || trackInfo?.human_analysis?.mood || undefined,
      duration,
      fileUrl: musicUrl,
      isGenerated: false,
      metadata: {
        provider: 'music_library',
        libraryTrack: libraryTrackFilename,
        selectionReasoning: libraryTrackReasoning,
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
        provider: 'music_library',
        libraryTrack: libraryTrackFilename,
        jobId: job.id,
      },
    });
    await usageRecord.save();

    await job.updateProgress(100);

    logger.info(`Library music selection completed for job ${job.id}`, {
      musicId: musicTrack.id,
      track: libraryTrackFilename,
      duration,
    });

    return {
      success: true,
      musicId: musicTrack.id,
      musicUrl,
      duration,
      provider: 'music_library',
    };
  } catch (error: any) {
    logger.error(`Library music selection failed for job ${job.id}:`, {
      error: error.message,
      track: libraryTrackFilename,
    });

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
 * Process music generation jobs
 */
const processMusicGeneration = async (job: Job<MusicGenerationJobData>) => {
  const {
    userId,
    text,
    duration_seconds,
    prompt_influence,
    name,
    genre,
    mood,
    targetBPM,
    sunoCustomMode,
    sunoTitle,
    sunoStyle,
    sunoPrompt,
  } = job.data;

  logger.info(`Processing music generation job ${job.id}`, {
    userId,
    textLength: text.length,
  });

  try {
    // Update job progress
    await job.updateProgress(10);

    // ========== LIBRARY-BASED MUSIC SELECTION ==========
    // When libraryTrackFilename is provided, copy the pre-analyzed track
    // from the music library instead of generating via API.
    if (job.data.libraryTrackFilename) {
      return await processLibraryTrackSelection(job);
    }

    const segmentBasedGeneration = job.data.segmentBasedGeneration && job.data.arc && job.data.arc.length >= 2;

    // If segment-based generation: generate each arc segment separately and crossfade
    if (segmentBasedGeneration) {
      return await processSegmentBasedGeneration(job);
    }

    await job.updateProgress(20);

    // Generate unique filename
    const filename = `music_${uuidv4()}.mp3`;

    // Generate music: same TTM composition for both providers; Suno gets full style, ElevenLabs gets truncated
    let filePath: string;
    let audioBuffer: Buffer;
    let duration: number;
    let provider: string;

    if (kieSunoMusicService.isConfigured()) {
      try {
        const useSunoCustom =
          sunoCustomMode && sunoTitle && sunoStyle;
        const sunoOptions = useSunoCustom
          ? {
            customMode: true,
            title: sunoTitle,
            style: sunoStyle,
            prompt: sunoPrompt || sunoStyle,
            instrumental: true,
            model: 'V5' as const,
          }
          : {
            prompt: sunoPrompt ?? text,
            instrumental: true,
            model: 'V5' as const,
          };
        logger.info(
          useSunoCustom
            ? `Generating music with Kie.ai Suno (timestamped): ${sunoStyle.slice(0, 80)}...`
            : `Generating music with Kie.ai Suno: ${(sunoOptions.prompt || text).slice(0, 80)}...`
        );

        // Log FULL TTM prompt
        if (useSunoCustom) {
          ttmPromptLogger.info(
            sunoStyle,
            {
              jobId: job.id,
              provider: 'suno',
              mode: 'custom',
              title: sunoTitle,
            }
          );
        } else {
          ttmPromptLogger.info(
            sunoOptions.prompt || text,
            {
              jobId: job.id,
              provider: 'suno',
              mode: 'non-custom',
            }
          );
        }

        const result = await kieSunoMusicService.generateAndSave(
          sunoOptions,
          filename
        );
        filePath = result.filePath;
        audioBuffer = result.audioBuffer;
        duration = result.duration;
        provider = 'kie_suno';
      } catch (sunoError: any) {
        logger.warn(`Kie Suno music generation failed, falling back to ElevenLabs: ${sunoError.message}`);
        const originalText = sunoStyle && sunoStyle.trim() ? sunoStyle : sunoPrompt && sunoPrompt.trim() ? sunoPrompt : text;
        const fallbackText =
          sunoStyle && sunoStyle.trim()
            ? sunoStyle.slice(0, ELEVENLABS_MUSIC_PROMPT_MAX)
            : sunoPrompt && sunoPrompt.trim()
              ? sunoPrompt.slice(0, ELEVENLABS_MUSIC_PROMPT_MAX)
              : text;

        // Log FULL TTM prompt (ElevenLabs fallback)
        ttmPromptLogger.info(
          originalText.length > ELEVENLABS_MUSIC_PROMPT_MAX
            ? `ORIGINAL (full): ${originalText}\n\nTRUNCATED (ElevenLabs): ${fallbackText}`
            : fallbackText,
          {
            jobId: job.id,
            provider: 'elevenlabs (fallback)',
            mode: 'standard',
          }
        );

        const options = elevenLabsMusicService.validateOptions({
          text: fallbackText,
          duration_seconds,
          prompt_influence,
        });
        const result = await elevenLabsMusicService.generateAndSave(options, filename);
        filePath = result.filePath;
        audioBuffer = result.audioBuffer;
        duration = result.duration;
        provider = 'elevenlabs';
      }
    } else {
      const originalText = sunoStyle && sunoStyle.trim() ? sunoStyle : sunoPrompt && sunoPrompt.trim() ? sunoPrompt : text;
      const elevenLabsText =
        sunoStyle && sunoStyle.trim()
          ? sunoStyle.slice(0, ELEVENLABS_MUSIC_PROMPT_MAX)
          : sunoPrompt && sunoPrompt.trim()
            ? sunoPrompt.slice(0, ELEVENLABS_MUSIC_PROMPT_MAX)
            : text;

      // Log FULL TTM prompt (ElevenLabs primary)
      ttmPromptLogger.info(
        originalText.length > ELEVENLABS_MUSIC_PROMPT_MAX
          ? `ORIGINAL (full): ${originalText}\n\nTRUNCATED (ElevenLabs): ${elevenLabsText}`
          : elevenLabsText,
        {
          jobId: job.id,
          provider: 'elevenlabs',
          mode: 'standard',
        }
      );

      const options = elevenLabsMusicService.validateOptions({
        text: elevenLabsText,
        duration_seconds,
        prompt_influence,
      });
      const result = await elevenLabsMusicService.generateAndSave(options, filename);
      filePath = result.filePath;
      audioBuffer = result.audioBuffer;
      duration = result.duration;
      provider = 'elevenlabs';
    }

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
        targetBPM,
        provider,
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
