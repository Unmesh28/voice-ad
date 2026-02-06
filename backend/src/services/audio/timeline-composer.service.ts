// ===========================================================================
// Timeline Composer Service
//
// The core mixing engine for segment-based ads. Instead of the flat
// "voice over background music" approach, this service:
//
//   1. Takes all audio assets (per-segment voices, music track, SFX files)
//   2. Places each on a precise timeline according to the adFormat plan
//   3. Builds a single FFmpeg filter_complex that:
//      - Positions each asset at its absolute start time (adelay)
//      - Applies per-segment volume envelopes to the music track
//      - Mixes all tracks together (amix)
//      - Applies global fades and loudness normalization
//   4. Outputs the final mixed audio file
//
// Timeline visualization for a cultural_hook ad:
//
//   Track 1 (Music):  [████ full ████|▒▒ ducked ▒▒|████ full ████|▒▒ ducked ▒▒|▓▓ build ▓▓|████ full ████]
//   Track 2 (Voice):  [              |█ intro VO █|              |█ features █|█ CTA ████|              ]
//   Track 3 (SFX):    [              |♦ whoosh    |              |            |♦ cash reg |              ]
//                      0             3.5          13            15           23          28            30
// ===========================================================================

import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../config/logger';
import ffmpegService from './ffmpeg.service';
import type { AdCreativeSegment, MusicBehavior } from '../../types/ad-format';
import type { SegmentTTSResult } from '../tts/segment-tts.service';
import type { SfxGenerationResult } from '../../types/sfx.types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single audio asset placed on the timeline. */
export interface TimelineEntry {
  /** What kind of audio this is */
  type: 'voice' | 'music' | 'sfx';
  /** Path to the audio file */
  filePath: string;
  /** Absolute start time in seconds on the ad timeline */
  startTime: number;
  /** Volume multiplier 0.0-1.0 */
  volume: number;
  /** Duration of this audio in seconds (actual audio duration, not segment duration) */
  duration: number;
  /** Which ad segment this belongs to (for logging) */
  segmentIndex: number;
  /** Human-readable label */
  label: string;
}

/** Music volume segment — defines the music volume at a time range. */
interface MusicVolumeSegment {
  startTime: number;
  endTime: number;
  volume: number;
  behavior: MusicBehavior;
}

/** Full input for the timeline composer. */
export interface TimelineComposerInput {
  /** The adFormat segments (defines the creative structure) */
  segments: AdCreativeSegment[];
  /** Per-segment TTS results (from segment-tts.service) */
  voiceResults: SegmentTTSResult[];
  /** The music track file path (single backing track) */
  musicFilePath: string;
  /** Per-segment SFX results (from sfx.service), keyed by segmentIndex */
  sfxResults: Map<number, SfxGenerationResult>;
  /** Output file path */
  outputPath: string;
  /** Base music volume from LLM metadata (0.0-1.0) */
  baseMusicVolume?: number;
  /** Global fade settings */
  fadeIn?: number;
  fadeOut?: number;
  fadeCurve?: 'linear' | 'exp' | 'qsin';
  /** Loudness normalization */
  normalizeLoudness?: boolean;
  loudnessTargetLUFS?: number;
  loudnessTruePeak?: number;
}

/** Result from the timeline composer. */
export interface TimelineComposerResult {
  /** Path to the final mixed audio file */
  outputPath: string;
  /** Total duration of the output in seconds */
  duration: number;
  /** The computed timeline entries (for debugging/visualization) */
  timeline: TimelineEntry[];
  /** The music volume segments (for debugging) */
  musicVolumeSegments: MusicVolumeSegment[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SAMPLE_RATE = 44100;
const NORMALIZE_FILTER = `aformat=channel_layouts=stereo,aresample=${SAMPLE_RATE}`;

/** Volume ramp duration at music segment boundaries (avoids pops/clicks) */
const VOLUME_RAMP_SEC = 0.08;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class TimelineComposerService {
  /**
   * Compose a segment-based ad from all audio assets.
   *
   * This is the main entry point. It:
   *   1. Computes the timeline (where each asset starts/ends)
   *   2. Computes the music volume envelope (full, ducked, building per segment)
   *   3. Builds and runs the FFmpeg filter_complex
   *   4. Returns the mixed output file
   */
  async compose(input: TimelineComposerInput): Promise<TimelineComposerResult> {
    const {
      segments,
      voiceResults,
      musicFilePath,
      sfxResults,
      outputPath,
      baseMusicVolume = 0.15,
      fadeIn = 0.08,
      fadeOut = 0.4,
      fadeCurve = 'exp',
      normalizeLoudness = true,
      loudnessTargetLUFS = -16,
      loudnessTruePeak = -2,
    } = input;

    logger.info('Timeline composer: starting composition', {
      segments: segments.length,
      voiceResults: voiceResults.length,
      sfxResults: sfxResults.size,
      musicFilePath,
    });

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 1. Compute the timeline
    const { timeline, musicVolumeSegments, totalDuration } = this.computeTimeline(
      segments,
      voiceResults,
      sfxResults,
      baseMusicVolume
    );

    logger.info('Timeline computed', {
      entries: timeline.length,
      musicVolumeSegments: musicVolumeSegments.length,
      totalDuration: totalDuration.toFixed(1),
    });

    // 2. Prepare the music track (trim/extend to match total duration)
    //    When the music is longer and the ad ends with a music outro, preserve
    //    the music's natural ending (Suno button endings sound much better than
    //    an arbitrary trim point).
    const musicDuration = await ffmpegService.getAudioDuration(musicFilePath);
    let preparedMusicPath = musicFilePath;

    if (musicDuration < totalDuration - 0.5) {
      // Music too short — extend by looping
      const extendedPath = path.join(outputDir, `timeline_music_ext_${uuidv4().slice(0, 8)}.mp3`);
      await ffmpegService.extendAudioDuration(musicFilePath, totalDuration, extendedPath);
      preparedMusicPath = extendedPath;
      logger.info(`Music extended from ${musicDuration.toFixed(1)}s to ${totalDuration.toFixed(1)}s`);
    } else if (musicDuration > totalDuration + 1) {
      // Music too long — try to preserve the natural ending for the outro
      const lastSeg = segments[segments.length - 1];
      const lastSegIsOutro =
        lastSeg &&
        (lastSeg.type === 'music_solo' || lastSeg.type === 'silence') &&
        (lastSeg.music?.behavior === 'full' || lastSeg.music?.behavior === 'resolving');
      const outroDuration = lastSegIsOutro ? lastSeg.duration : 0;

      if (outroDuration > 0 && musicDuration >= totalDuration) {
        // Splice: use the start of the music for the body, crossfade into
        // the natural ending of the music for the outro segment.
        const splicedPath = path.join(outputDir, `timeline_music_splice_${uuidv4().slice(0, 8)}.mp3`);
        await this.spliceMusicWithNaturalEnding(
          musicFilePath,
          musicDuration,
          totalDuration,
          outroDuration,
          splicedPath
        );
        preparedMusicPath = splicedPath;
        logger.info(
          `Music spliced: body from start, natural ending for last ${outroDuration.toFixed(1)}s ` +
          `(music ${musicDuration.toFixed(1)}s → ad ${totalDuration.toFixed(1)}s)`
        );
      } else {
        // No outro segment — simple trim from start
        const trimmedPath = path.join(outputDir, `timeline_music_trim_${uuidv4().slice(0, 8)}.mp3`);
        await ffmpegService.trimAudio(musicFilePath, totalDuration, trimmedPath);
        preparedMusicPath = trimmedPath;
        logger.info(`Music trimmed from ${musicDuration.toFixed(1)}s to ${totalDuration.toFixed(1)}s`);
      }
    }

    // 3. Apply volume envelope to music
    const envelopedMusicPath = path.join(outputDir, `timeline_music_env_${uuidv4().slice(0, 8)}.mp3`);
    await this.applyMusicVolumeEnvelope(preparedMusicPath, musicVolumeSegments, totalDuration, envelopedMusicPath);

    // 4. Compute a musical fade-out based on the last segment
    //    When the ad ends with a music outro, use the full outro segment duration
    //    as the fade-out so the music resolves naturally instead of cutting hard.
    const lastSeg = segments[segments.length - 1];
    const lastSegIsOutro =
      lastSeg &&
      (lastSeg.type === 'music_solo' || lastSeg.type === 'silence') &&
      (lastSeg.music?.behavior === 'full' || lastSeg.music?.behavior === 'resolving');
    const effectiveFadeOut = lastSegIsOutro
      ? Math.max(fadeOut, lastSeg.duration * 0.8) // use ~80% of outro for a natural fade
      : fadeOut;

    // 5. Build and run the FFmpeg filter_complex
    await this.buildAndRunMix({
      timeline,
      envelopedMusicPath,
      totalDuration,
      outputPath,
      fadeIn,
      fadeOut: effectiveFadeOut,
      fadeCurve,
      normalizeLoudness,
      loudnessTargetLUFS,
      loudnessTruePeak,
    });

    const finalDuration = await ffmpegService.getAudioDuration(outputPath);

    // 5. Cleanup temp files
    for (const tempPath of [envelopedMusicPath]) {
      if (tempPath !== musicFilePath) {
        ffmpegService.cleanupFile(tempPath).catch(() => {});
      }
    }
    if (preparedMusicPath !== musicFilePath) {
      ffmpegService.cleanupFile(preparedMusicPath).catch(() => {});
    }

    logger.info('Timeline composer: composition complete', {
      outputPath,
      duration: finalDuration.toFixed(1),
    });

    return {
      outputPath,
      duration: finalDuration,
      timeline,
      musicVolumeSegments,
    };
  }

  // -------------------------------------------------------------------------
  // Step 1: Compute the timeline
  // -------------------------------------------------------------------------

  /**
   * Walk through all adFormat segments and compute:
   *   - Where each voice/SFX asset starts on the absolute timeline
   *   - The music volume envelope (what volume the music should be at each point)
   */
  private computeTimeline(
    segments: AdCreativeSegment[],
    voiceResults: SegmentTTSResult[],
    sfxResults: Map<number, SfxGenerationResult>,
    baseMusicVolume: number
  ): {
    timeline: TimelineEntry[];
    musicVolumeSegments: MusicVolumeSegment[];
    totalDuration: number;
  } {
    const timeline: TimelineEntry[] = [];
    const musicVolumeSegments: MusicVolumeSegment[] = [];

    // Build lookup maps
    const voiceBySegment = new Map(voiceResults.map((r) => [r.segmentIndex, r]));

    let cursor = 0; // current time position

    for (const seg of segments) {
      const segStart = cursor;
      const segEnd = cursor + seg.duration;

      // --- Voice ---
      const voiceResult = voiceBySegment.get(seg.segmentIndex);
      if (voiceResult && voiceResult.filePath) {
        timeline.push({
          type: 'voice',
          filePath: voiceResult.filePath,
          startTime: segStart,
          volume: 1.0,
          duration: voiceResult.duration,
          segmentIndex: seg.segmentIndex,
          label: seg.label,
        });
      }

      // --- SFX ---
      const sfxResult = sfxResults.get(seg.segmentIndex);
      if (sfxResult && sfxResult.filePath) {
        timeline.push({
          type: 'sfx',
          filePath: sfxResult.filePath,
          startTime: segStart,
          volume: seg.sfx?.volume ?? 0.8,
          duration: sfxResult.duration,
          segmentIndex: seg.segmentIndex,
          label: seg.label,
        });
      }

      // --- Music volume for this segment ---
      const musicBehavior = seg.music?.behavior ?? 'none';
      const musicVolForSegment = this.resolveMusicVolume(musicBehavior, seg.music?.volume, baseMusicVolume);
      musicVolumeSegments.push({
        startTime: segStart,
        endTime: segEnd,
        volume: musicVolForSegment,
        behavior: musicBehavior,
      });

      cursor = segEnd;
    }

    return { timeline, musicVolumeSegments, totalDuration: cursor };
  }

  /**
   * Resolve the actual music volume for a segment based on its behavior.
   */
  private resolveMusicVolume(
    behavior: MusicBehavior,
    segmentVolume: number | undefined,
    baseMusicVolume: number
  ): number {
    // If the segment specifies an explicit volume, use it
    if (segmentVolume !== undefined) {
      return segmentVolume;
    }

    switch (behavior) {
      case 'full':
        return 1.0;
      case 'ducked':
        return baseMusicVolume;
      case 'building':
        // Start at ducked, will ramp up (handled in envelope)
        return baseMusicVolume * 1.5;
      case 'resolving':
        return baseMusicVolume * 1.2;
      case 'accent':
        return 0.7;
      case 'none':
        return 0.0;
      default:
        return baseMusicVolume;
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: Apply music volume envelope
  // -------------------------------------------------------------------------

  /**
   * Apply a time-based volume envelope to the music track.
   * Uses the same smooth-ramp approach as the existing ffmpeg.service.
   */
  private async applyMusicVolumeEnvelope(
    musicPath: string,
    volumeSegments: MusicVolumeSegment[],
    totalDuration: number,
    outputPath: string
  ): Promise<void> {
    if (volumeSegments.length === 0) {
      // No segments — just copy
      fs.copyFileSync(musicPath, outputPath);
      return;
    }

    // Convert to the format expected by ffmpegService.applyVolumeCurve
    const curve = volumeSegments.map((seg) => ({
      startSeconds: seg.startTime,
      endSeconds: seg.endTime,
      volumeMultiplier: seg.volume,
    }));

    await ffmpegService.applyVolumeCurve(musicPath, curve, totalDuration, outputPath);

    logger.info('Music volume envelope applied', {
      segments: volumeSegments.length,
      totalDuration: totalDuration.toFixed(1),
    });
  }

  // -------------------------------------------------------------------------
  // Step 3b: Splice music with natural ending
  // -------------------------------------------------------------------------

  /**
   * When the music track is longer than needed and the ad ends with a music
   * outro, splice the music so the body uses the start of the track and the
   * outro uses the track's natural ending (Suno button endings).
   *
   * Result: [music 0..bodyEnd] --crossfade--> [music tail..musicDuration]
   * trimmed to exactly totalDuration.
   */
  private async spliceMusicWithNaturalEnding(
    musicPath: string,
    musicDuration: number,
    totalDuration: number,
    outroDuration: number,
    outputPath: string
  ): Promise<void> {
    const crossfade = Math.min(0.5, outroDuration * 0.3); // 0.5s max crossfade
    const bodyEnd = totalDuration - outroDuration + crossfade;
    const tailStart = musicDuration - outroDuration;

    // If the tail start would be before bodyEnd in the original audio,
    // the music isn't long enough to splice — just trim normally
    if (tailStart <= bodyEnd) {
      await ffmpegService.trimAudio(musicPath, totalDuration, outputPath);
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        // Use two inputs from the same file with different seek positions,
        // crossfade them together, then trim to exact duration
        const command = ffmpeg();

        // Input 0: body portion (from start)
        command.input(musicPath);
        // Input 1: tail portion (natural ending)
        command.input(musicPath).inputOptions([`-ss ${tailStart.toFixed(3)}`]);

        const filterStr = [
          // Normalize both portions
          `[0:a]${NORMALIZE_FILTER},atrim=0:${bodyEnd.toFixed(3)},asetpts=PTS-STARTPTS[body]`,
          `[1:a]${NORMALIZE_FILTER},asetpts=PTS-STARTPTS[tail]`,
          // Crossfade body into tail
          `[body][tail]acrossfade=d=${crossfade.toFixed(3)}:c1=tri:c2=tri[spliced]`,
          // Trim to exact target duration
          `[spliced]atrim=0:${totalDuration.toFixed(3)},asetpts=PTS-STARTPTS[out]`,
        ].join(';');

        command.complexFilter(filterStr, 'out');
        command
          .audioCodec('libmp3lame')
          .audioBitrate('192k')
          .audioChannels(2)
          .audioFrequency(SAMPLE_RATE)
          .output(outputPath);

        command
          .on('end', () => {
            logger.info('Music splice with natural ending complete', {
              bodyEnd: bodyEnd.toFixed(1),
              tailStart: tailStart.toFixed(1),
              crossfade: crossfade.toFixed(2),
            });
            resolve();
          })
          .on('error', (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            logger.warn(`Music splice failed, falling back to simple trim: ${msg}`);
            // Fallback: simple trim from start
            ffmpegService
              .trimAudio(musicPath, totalDuration, outputPath)
              .then(() => resolve())
              .catch(reject);
          });

        command.run();
      } catch (error: any) {
        ffmpegService
          .trimAudio(musicPath, totalDuration, outputPath)
          .then(() => resolve())
          .catch(reject);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Step 4: Build and run the FFmpeg mix
  // -------------------------------------------------------------------------

  /**
   * Build and execute the FFmpeg filter_complex that mixes all timeline
   * entries (positioned voices, SFX) with the enveloped music track.
   */
  private async buildAndRunMix(opts: {
    timeline: TimelineEntry[];
    envelopedMusicPath: string;
    totalDuration: number;
    outputPath: string;
    fadeIn: number;
    fadeOut: number;
    fadeCurve: string;
    normalizeLoudness: boolean;
    loudnessTargetLUFS: number;
    loudnessTruePeak: number;
  }): Promise<void> {
    const {
      timeline,
      envelopedMusicPath,
      totalDuration,
      outputPath,
      fadeIn,
      fadeOut,
      fadeCurve,
      normalizeLoudness,
      loudnessTargetLUFS,
      loudnessTruePeak,
    } = opts;

    // Filter to only entries with valid files
    const validEntries = timeline.filter(
      (e) => e.filePath && fs.existsSync(e.filePath)
    );

    return new Promise((resolve, reject) => {
      try {
        const command = ffmpeg();

        // Input 0: the enveloped music track (already has volume curve applied)
        command.input(envelopedMusicPath);

        // Inputs 1..N: voice and SFX assets
        for (const entry of validEntries) {
          command.input(entry.filePath);
        }

        const totalInputs = 1 + validEntries.length; // music + voice/sfx entries
        const filters: string[] = [];

        // Normalize music input
        filters.push(`[0:a]${NORMALIZE_FILTER}[music]`);

        // Normalize and position each voice/SFX input
        const mixLabels: string[] = ['[music]'];

        for (let i = 0; i < validEntries.length; i++) {
          const entry = validEntries[i];
          const inputIdx = i + 1; // 0 is music
          const label = `${entry.type}${entry.segmentIndex}`;
          const delayMs = Math.round(entry.startTime * 1000);

          if (delayMs > 0) {
            filters.push(
              `[${inputIdx}:a]${NORMALIZE_FILTER},volume=${entry.volume},adelay=${delayMs}|${delayMs}[${label}]`
            );
          } else {
            filters.push(
              `[${inputIdx}:a]${NORMALIZE_FILTER},volume=${entry.volume}[${label}]`
            );
          }

          mixLabels.push(`[${label}]`);
        }

        // Mix all tracks together
        const mixInputStr = mixLabels.join('');
        filters.push(
          `${mixInputStr}amix=inputs=${totalInputs}:duration=longest:dropout_transition=2[mixraw]`
        );

        // Trim to exact duration
        const END_PADDING = 0.08;
        const trimDuration = totalDuration + END_PADDING;
        filters.push(`[mixraw]atrim=0:${trimDuration},asetpts=PTS-STARTPTS[trimmed]`);

        // Apply fades
        // Allow up to 4s fade-out for musical outro segments (vs 0.6s for generic)
        const clampedFadeIn = Math.max(0.02, Math.min(0.12, fadeIn));
        const clampedFadeOut = Math.max(0.1, Math.min(4.0, fadeOut));
        const fadeOutStart = Math.max(0, trimDuration - clampedFadeOut);
        const ffmpegCurve = fadeCurve === 'linear' ? 'tri' : fadeCurve === 'qsin' ? 'qsin' : 'exp';

        // Use exp curve for longer musical fades (sounds more natural than linear tri)
        const fadeOutCurve = clampedFadeOut > 1.0 ? 'exp' : 'tri';
        filters.push(
          `[trimmed]afade=t=in:st=0:d=${clampedFadeIn}:curve=${ffmpegCurve},` +
          `afade=t=out:st=${fadeOutStart}:d=${clampedFadeOut}:curve=${fadeOutCurve}[faded]`
        );

        // Loudness normalization
        if (normalizeLoudness) {
          const target = Math.max(-60, Math.min(0, loudnessTargetLUFS));
          const tp = Math.max(-10, Math.min(0, loudnessTruePeak));
          filters.push(`[faded]loudnorm=I=${target}:TP=${tp}:LRA=11.0[out]`);
        } else {
          filters.push('[faded]volume=1.5[out]');
        }

        const filterStr = filters.join(';');
        command.complexFilter(filterStr, 'out');

        // Output settings
        command
          .audioCodec('libmp3lame')
          .audioBitrate('192k')
          .audioChannels(2)
          .audioFrequency(SAMPLE_RATE)
          .output(outputPath);

        command
          .on('start', (commandLine: string) => {
            logger.info('Timeline composer: FFmpeg started', {
              inputs: totalInputs,
              filters: filters.length,
            });
            logger.debug('FFmpeg filter_complex:', filterStr);
            logger.debug('FFmpeg command (first 500):', commandLine.slice(0, 500));
          })
          .on('progress', (progress: any) => {
            if (progress.percent) {
              logger.debug(`Timeline composer FFmpeg: ${Math.round(progress.percent)}%`);
            }
          })
          .on('end', () => {
            logger.info('Timeline composer: FFmpeg mix complete', { outputPath });
            resolve();
          })
          .on('error', (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('Timeline composer: FFmpeg error:', msg);
            reject(new Error(`Timeline composition failed: ${msg}`));
          });

        command.run();
      } catch (error: any) {
        reject(error);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Public helpers
  // -------------------------------------------------------------------------

  /**
   * Compute where each segment starts/ends on the absolute timeline,
   * given the adFormat segments. Pure math — no audio assets needed.
   *
   * Useful for debugging and visualization.
   */
  computeSegmentTimeline(segments: AdCreativeSegment[]): {
    segmentIndex: number;
    label: string;
    type: string;
    startTime: number;
    endTime: number;
    duration: number;
  }[] {
    let cursor = 0;
    return segments.map((seg) => {
      const entry = {
        segmentIndex: seg.segmentIndex,
        label: seg.label,
        type: seg.type,
        startTime: cursor,
        endTime: cursor + seg.duration,
        duration: seg.duration,
      };
      cursor += seg.duration;
      return entry;
    });
  }

  /**
   * Visualize the timeline as ASCII art (for debugging/logging).
   */
  visualizeTimeline(
    segments: AdCreativeSegment[],
    totalDuration: number
  ): string {
    const WIDTH = 80;
    const scale = WIDTH / totalDuration;

    const musicTrack: string[] = new Array(WIDTH).fill(' ');
    const voiceTrack: string[] = new Array(WIDTH).fill(' ');
    const sfxTrack: string[] = new Array(WIDTH).fill(' ');

    let cursor = 0;
    for (const seg of segments) {
      const startCol = Math.floor(cursor * scale);
      const endCol = Math.min(WIDTH - 1, Math.floor((cursor + seg.duration) * scale));

      for (let col = startCol; col <= endCol; col++) {
        // Music track
        if (seg.music) {
          const char = seg.music.behavior === 'full' ? '#'
            : seg.music.behavior === 'ducked' ? '~'
            : seg.music.behavior === 'building' ? '/'
            : seg.music.behavior === 'resolving' ? '\\'
            : seg.music.behavior === 'none' ? ' '
            : '.';
          musicTrack[col] = char;
        }

        // Voice track
        if (seg.voiceover) {
          voiceTrack[col] = '=';
        }

        // SFX track
        if (seg.sfx) {
          sfxTrack[col] = '*';
        }
      }

      cursor += seg.duration;
    }

    const header = `Timeline (${totalDuration.toFixed(1)}s, 1 char = ${(totalDuration / WIDTH).toFixed(2)}s):`;
    return [
      header,
      `  Music: |${musicTrack.join('')}|`,
      `  Voice: |${voiceTrack.join('')}|`,
      `  SFX:   |${sfxTrack.join('')}|`,
      `         0${' '.repeat(WIDTH - 6)}${totalDuration.toFixed(0)}s`,
    ].join('\n');
  }
}

export default new TimelineComposerService();
