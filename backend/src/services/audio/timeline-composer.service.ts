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
      baseMusicVolume = 0.12,
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

    // 1. Compute the timeline (also trims trailing music-only segments)
    const { timeline, musicVolumeSegments, totalDuration, lastVoiceEndTime } = this.computeTimeline(
      segments,
      voiceResults,
      sfxResults,
      baseMusicVolume
    );

    // 1b. Apply energy arc modeling to the music volume envelope.
    //     This modulates volumes based on the ad's narrative arc,
    //     creating a natural "breathing" quality that follows the story.
    this.computeEnergyArc(segments, musicVolumeSegments);

    logger.info('Timeline computed', {
      entries: timeline.length,
      musicVolumeSegments: musicVolumeSegments.length,
      totalDuration: totalDuration.toFixed(1),
      lastVoiceEndTime: lastVoiceEndTime.toFixed(1),
    });

    // 2a. Apply voice presence EQ to voice tracks for enhanced clarity.
    //     Boosts 2.5kHz presence + 7kHz air, removes proximity boominess.
    const voiceEntries = timeline.filter((e) => e.type === 'voice' && e.filePath && fs.existsSync(e.filePath));
    for (const vEntry of voiceEntries) {
      try {
        const eqPath = vEntry.filePath.replace(/\.(mp3|wav)$/, '_veq.$1');
        await ffmpegService.applyVoicePresenceEQ(vEntry.filePath, eqPath);
        vEntry.filePath = eqPath;
      } catch (veqErr: any) {
        logger.warn(`Voice presence EQ failed for segment ${vEntry.segmentIndex}: ${veqErr.message}`);
      }
    }

    // 2. Prepare the music track (trim/extend to match total duration)
    const musicDuration = await ffmpegService.getAudioDuration(musicFilePath);
    let preparedMusicPath = musicFilePath;

    if (musicDuration < totalDuration - 0.5) {
      // Music too short — extend with beat-aware crossfaded looping
      const extendedPath = path.join(outputDir, `timeline_music_ext_${uuidv4().slice(0, 8)}.mp3`);
      // Estimate bar duration from first two music volume segments for loop alignment
      const firstFullSeg = musicVolumeSegments.find((s) => s.behavior === 'full');
      const estimatedBarDuration = firstFullSeg ? Math.min(2.0, firstFullSeg.endTime - firstFullSeg.startTime) : undefined;
      await ffmpegService.extendAudioWithCrossfade(musicFilePath, totalDuration, extendedPath, {
        barDuration: estimatedBarDuration,
        crossfadeDuration: 0.5,
      });
      preparedMusicPath = extendedPath;
      logger.info(`Music extended from ${musicDuration.toFixed(1)}s to ${totalDuration.toFixed(1)}s (beat-aware crossfade)`);
    } else if (musicDuration > totalDuration + 1) {
      // Music too long — simple trim from start
      const trimmedPath = path.join(outputDir, `timeline_music_trim_${uuidv4().slice(0, 8)}.mp3`);
      await ffmpegService.trimAudio(musicFilePath, totalDuration, trimmedPath);
      preparedMusicPath = trimmedPath;
      logger.info(`Music trimmed from ${musicDuration.toFixed(1)}s to ${totalDuration.toFixed(1)}s`);
    }

    // 3. Apply volume envelope to music
    const envelopedMusicPath = path.join(outputDir, `timeline_music_env_${uuidv4().slice(0, 8)}.mp3`);
    await this.applyMusicVolumeEnvelope(preparedMusicPath, musicVolumeSegments, totalDuration, envelopedMusicPath);

    // 4. Sidechain ducking: dynamically compress music when voice is present.
    //    This makes ducking responsive to actual speech rhythm rather than
    //    static volume levels. Falls back to envelope-only if sidechain fails.
    let finalMusicPath = envelopedMusicPath;
    // voiceEntries already computed above (step 2a) with presence EQ applied

    if (voiceEntries.length > 0) {
      try {
        // Create a combined voice reference track for the sidechain key
        const voiceRefPath = path.join(outputDir, `timeline_voiceref_${uuidv4().slice(0, 8)}.mp3`);
        await ffmpegService.createVoiceReference(
          voiceEntries.map((e) => ({ filePath: e.filePath, startTime: e.startTime, volume: e.volume })),
          totalDuration,
          voiceRefPath
        );

        // Apply 5-band sidechain ducking (surgical ducking in 150Hz–5kHz voice range)
        const sidechainedPath = path.join(outputDir, `timeline_music_sc_${uuidv4().slice(0, 8)}.mp3`);
        await ffmpegService.applySidechainDucking(envelopedMusicPath, voiceRefPath, sidechainedPath);
        finalMusicPath = sidechainedPath;

        logger.info('Sidechain ducking applied to music');

        // Cleanup voice reference
        ffmpegService.cleanupFile(voiceRefPath).catch(() => {});
      } catch (scErr: any) {
        logger.warn(`Sidechain ducking failed, using envelope-only: ${scErr.message}`);
        finalMusicPath = envelopedMusicPath;
      }
    }

    // 5. Compute fade-out: use the trailing music-after-voice duration
    //    so the music fades out smoothly right as the voice ends.
    const trailingMusic = totalDuration - lastVoiceEndTime;
    const effectiveFadeOut = Math.max(fadeOut, trailingMusic);

    // 6. Build and run the FFmpeg filter_complex
    await this.buildAndRunMix({
      timeline,
      envelopedMusicPath: finalMusicPath,
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

    // 7. Cleanup temp files
    const tempFiles = [envelopedMusicPath, finalMusicPath, preparedMusicPath].filter(
      (p) => p !== musicFilePath
    );
    for (const tempPath of new Set(tempFiles)) {
      ffmpegService.cleanupFile(tempPath).catch(() => {});
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
    lastVoiceEndTime: number;
  } {
    const timeline: TimelineEntry[] = [];
    const musicVolumeSegments: MusicVolumeSegment[] = [];

    // Build lookup maps
    const voiceBySegment = new Map(voiceResults.map((r) => [r.segmentIndex, r]));

    let cursor = 0; // current time position

    for (let segIdx = 0; segIdx < segments.length; segIdx++) {
      const seg = segments[segIdx];
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
        // For sfx_hit segments: SFX is the main audio, full volume at segment start.
        // For other segments (voiceover + SFX overlay): lower volume and offset
        // slightly so the SFX doesn't clash with voice entry.
        const isSfxHit = seg.type === 'sfx_hit';
        const sfxVolume = isSfxHit
          ? (seg.sfx?.volume ?? 0.7)
          : Math.min(seg.sfx?.volume ?? 0.4, 0.45); // Overlay SFX stays subtle
        const sfxOffset = isSfxHit ? 0 : 0.1; // Slight delay for overlays

        timeline.push({
          type: 'sfx',
          filePath: sfxResult.filePath,
          startTime: segStart + sfxOffset,
          volume: sfxVolume,
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

      // --- Transition to next segment ---
      // Apply transition effects between this segment and the next one.
      // This modifies the cursor position and/or music volume at boundaries.
      const nextSeg = segIdx < segments.length - 1 ? segments[segIdx + 1] : null;
      if (nextSeg) {
        const transition = seg.transition || 'hard_cut';
        const transitionDur = seg.transitionDuration ?? this.defaultTransitionDuration(transition);

        switch (transition) {
          case 'crossfade': {
            // Overlap: pull the next segment back by transitionDur.
            // Both segments play simultaneously during the overlap region.
            // Music crossfades between the two segments' volumes.
            const overlap = Math.min(transitionDur, seg.duration * 0.5);
            if (overlap > 0.05) {
              cursor = segEnd - overlap;

              // Add a transition music volume ramp during the overlap
              const nextMusicBehavior = nextSeg.music?.behavior ?? 'none';
              const nextMusicVol = this.resolveMusicVolume(nextMusicBehavior, nextSeg.music?.volume, baseMusicVolume);
              const midVol = (musicVolForSegment + nextMusicVol) / 2;

              // Shorten the current music segment and add a ramp region
              musicVolumeSegments[musicVolumeSegments.length - 1].endTime = segEnd - overlap;
              musicVolumeSegments.push({
                startTime: segEnd - overlap,
                endTime: segEnd,
                volume: midVol,
                behavior: 'resolving', // Use resolving for smooth ramp
              });

              logger.debug(`Transition: crossfade ${overlap.toFixed(2)}s between "${seg.label}" → "${nextSeg.label}"`);
            } else {
              cursor = segEnd;
            }
            break;
          }

          case 'duck_transition': {
            // Duck: briefly drop music volume at the boundary, then bring it back.
            // Creates a momentary "dip" that makes the transition feel clean.
            const duckDur = Math.min(transitionDur, 0.5);
            if (duckDur > 0.05) {
              const duckVol = Math.min(musicVolForSegment, baseMusicVolume) * 0.5;

              // Add a duck region at the end of this segment
              const duckStart = Math.max(segStart, segEnd - duckDur);
              musicVolumeSegments[musicVolumeSegments.length - 1].endTime = duckStart;
              musicVolumeSegments.push({
                startTime: duckStart,
                endTime: segEnd,
                volume: duckVol,
                behavior: 'ducked',
              });

              logger.debug(`Transition: duck ${duckDur.toFixed(2)}s at end of "${seg.label}"`);
            }
            cursor = segEnd;
            break;
          }

          case 'natural': {
            // Natural: let the music phrase handle the transition.
            // We just ensure a smooth volume ramp at the boundary (handled by
            // applyVolumeCurve's ramp logic) — no special timeline changes.
            cursor = segEnd;
            break;
          }

          case 'hard_cut':
          default: {
            // Hard cut: no overlap, no ducking — immediate switch.
            cursor = segEnd;
            break;
          }
        }
      } else {
        cursor = segEnd;
      }
    }

    // ── Align music ending with voiceover ending ───────────────────────
    // 1. Trim trailing music-only segments so the ad ends with the voice.
    // 2. Add a smooth resolving fade so music doesn't cut abruptly —
    //    it fades down during the last ~2s of the final voiceover.
    const lastVoiceEntry = [...timeline].reverse().find((e) => e.type === 'voice');
    const lastVoiceEnd = lastVoiceEntry
      ? lastVoiceEntry.startTime + lastVoiceEntry.duration
      : cursor;

    const MUSIC_TAIL = 0.3; // tiny tail for final fade cleanup

    if (cursor > lastVoiceEnd + MUSIC_TAIL && lastVoiceEntry) {
      const newDuration = lastVoiceEnd + MUSIC_TAIL;

      logger.info(
        `Trimming trailing music: ${cursor.toFixed(1)}s → ${newDuration.toFixed(1)}s ` +
        `(voice ends at ${lastVoiceEnd.toFixed(1)}s)`
      );

      // Remove music volume segments fully past the new end,
      // and trim segments that straddle the boundary
      for (let i = musicVolumeSegments.length - 1; i >= 0; i--) {
        if (musicVolumeSegments[i].startTime >= newDuration) {
          musicVolumeSegments.splice(i, 1);
        } else if (musicVolumeSegments[i].endTime > newDuration) {
          musicVolumeSegments[i].endTime = newDuration;
        }
      }

      cursor = newDuration;
    }

    // ── Resolving fade: smooth music fade-out during final voiceover ──
    // Instead of the music cutting at voice end, gradually reduce the
    // music volume over the last RESOLVE_DURATION seconds. This creates
    // stepped volume reductions that applyVolumeCurve turns into
    // smooth ramps, so music naturally resolves with the voice.
    // 2.5s with 5 steps produces a very natural, broadcast-quality fade.
    const RESOLVE_DURATION = 2.5; // fade music over last 2.5s
    const RESOLVE_STEPS = 5;

    if (lastVoiceEntry && musicVolumeSegments.length > 0) {
      const resolveStart = Math.max(0, lastVoiceEnd - RESOLVE_DURATION);

      // Find the music volume segment that covers the resolve period
      const lastMvsIdx = musicVolumeSegments.length - 1;
      const lastMvs = musicVolumeSegments[lastMvsIdx];

      if (lastMvs && lastMvs.startTime < resolveStart && lastMvs.endTime > resolveStart) {
        const originalVol = lastMvs.volume;
        const originalEnd = lastMvs.endTime;

        // Truncate the existing segment to end where the resolve starts
        lastMvs.endTime = resolveStart;

        // Add stepped fade-down segments
        const stepDuration = (originalEnd - resolveStart) / RESOLVE_STEPS;
        for (let step = 0; step < RESOLVE_STEPS; step++) {
          const stepStart = resolveStart + step * stepDuration;
          const stepEnd = stepStart + stepDuration;
          // Fade from originalVol down to near-zero (0.1 is applyVolumeCurve min)
          const stepVol = originalVol * (1 - ((step + 1) / RESOLVE_STEPS) * 0.9);
          musicVolumeSegments.push({
            startTime: stepStart,
            endTime: stepEnd,
            volume: Math.max(0.1, stepVol),
            behavior: 'resolving',
          });
        }

        logger.info(
          `Music resolving fade: ${originalVol.toFixed(2)} → 0.1 over ${RESOLVE_DURATION}s ` +
          `(${resolveStart.toFixed(1)}s → ${originalEnd.toFixed(1)}s)`
        );
      }
    }

    return { timeline, musicVolumeSegments, totalDuration: cursor, lastVoiceEndTime: lastVoiceEnd };
  }

  /**
   * Default transition duration when not specified by the LLM.
   */
  private defaultTransitionDuration(transition: string): number {
    switch (transition) {
      case 'crossfade': return 0.3;
      case 'duck_transition': return 0.25;
      case 'natural': return 0;
      case 'hard_cut':
      default: return 0;
    }
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
        // Lower ducking = cleaner voice separation
        return baseMusicVolume * 0.85;
      case 'building':
        // Start subtle, will ramp up (handled in envelope)
        return baseMusicVolume * 1.3;
      case 'resolving':
        return baseMusicVolume * 1.1;
      case 'accent':
        return 0.6;
      case 'none':
        return 0.0;
      default:
        return baseMusicVolume;
    }
  }

  // -------------------------------------------------------------------------
  // Step 2b: Energy Arc Modeling
  // -------------------------------------------------------------------------

  /**
   * Model the energy arc of the ad and blend it into the music volume envelope.
   *
   * A human composer shapes music energy to match the narrative:
   *   - Intro: low energy, anticipation
   *   - Body/features: medium energy, steady groove
   *   - Peak/climax: high energy, full arrangement
   *   - CTA: confident resolve, slight lift
   *   - Outro: gentle resolution
   *
   * This method analyzes the ad's segment structure and creates smooth
   * energy multipliers that modulate the music volume envelope, creating
   * a natural "breathing" quality that follows the ad's emotional arc.
   */
  private computeEnergyArc(
    segments: AdCreativeSegment[],
    musicVolumeSegments: MusicVolumeSegment[]
  ): void {
    if (segments.length < 2 || musicVolumeSegments.length === 0) return;

    // Map each segment to an energy level (0-10 scale)
    const segmentEnergies: { startTime: number; endTime: number; energy: number }[] = [];
    let cursor = 0;
    for (const seg of segments) {
      const energy = this.inferSegmentEnergy(seg);
      segmentEnergies.push({
        startTime: cursor,
        endTime: cursor + seg.duration,
        energy,
      });
      cursor += seg.duration;
    }

    // Normalize energies to a multiplier range (0.7 - 1.15)
    // This modulates the existing volume curve without overriding it.
    // The range is intentionally subtle — big swings sound unnatural.
    const maxEnergy = Math.max(...segmentEnergies.map((s) => s.energy));
    const minEnergy = Math.min(...segmentEnergies.map((s) => s.energy));
    const energyRange = maxEnergy - minEnergy || 1;

    for (const mvs of musicVolumeSegments) {
      // Find the energy of the segment(s) that overlap this volume segment
      const overlapping = segmentEnergies.filter(
        (se) => se.startTime < mvs.endTime && se.endTime > mvs.startTime
      );

      if (overlapping.length === 0) continue;

      // Weighted average energy (by overlap duration)
      let weightedEnergy = 0;
      let totalWeight = 0;
      for (const se of overlapping) {
        const overlapStart = Math.max(mvs.startTime, se.startTime);
        const overlapEnd = Math.min(mvs.endTime, se.endTime);
        const weight = overlapEnd - overlapStart;
        weightedEnergy += se.energy * weight;
        totalWeight += weight;
      }

      const avgEnergy = totalWeight > 0 ? weightedEnergy / totalWeight : 5;
      const normalizedEnergy = (avgEnergy - minEnergy) / energyRange; // 0-1

      // Map to multiplier: low energy → 0.7x, high energy → 1.15x
      // Don't apply to 'none' behavior segments
      if (mvs.behavior !== 'none') {
        const energyMultiplier = 0.7 + normalizedEnergy * 0.45;
        mvs.volume = mvs.volume * energyMultiplier;
      }
    }

    logger.info('Energy arc applied to music volume envelope', {
      segmentCount: segmentEnergies.length,
      energyRange: `${minEnergy}-${maxEnergy}`,
    });
  }

  /**
   * Infer energy level (0-10) for an ad segment based on its type,
   * label, and music behavior.
   */
  private inferSegmentEnergy(seg: AdCreativeSegment): number {
    const label = (seg.label || '').toLowerCase();
    const musicBehavior = seg.music?.behavior || 'none';

    // Explicit energy from music behavior
    if (musicBehavior === 'full') return 8;
    if (musicBehavior === 'accent') return 7;
    if (musicBehavior === 'building') return 6;
    if (musicBehavior === 'none') return 0;

    // Infer from segment type
    if (seg.type === 'music_solo') return 7;
    if (seg.type === 'sfx_hit') return 5;
    if (seg.type === 'silence') return 1;

    // Infer from label keywords
    if (/intro|hook|opening/i.test(label)) return 4;
    if (/feature|benefit|product/i.test(label)) return 6;
    if (/peak|climax|highlight/i.test(label)) return 8;
    if (/cta|call.to.action|act.now|order|buy/i.test(label)) return 7;
    if (/deal|offer|discount|sale|price/i.test(label)) return 6;
    if (/close|outro|ending|resolve/i.test(label)) return 4;

    // Default: moderate energy for voiceover segments
    return 5;
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
        // Allow up to 5s fade-out for musical outro segments (broadcast standard)
        const clampedFadeIn = Math.max(0.02, Math.min(0.12, fadeIn));
        const clampedFadeOut = Math.max(0.1, Math.min(5.0, fadeOut));
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
