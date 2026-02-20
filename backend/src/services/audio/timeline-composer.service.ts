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

const SAMPLE_RATE = 48000;
const NORMALIZE_FILTER = `aformat=channel_layouts=stereo,aresample=${SAMPLE_RATE}`;

/** Volume ramp duration at music segment boundaries.
 *  0.5s gives a smooth, gradual transition between volume levels.
 *  (Was 0.08s which felt like a hard cut.) */
const VOLUME_RAMP_SEC = 0.5;

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
      fadeOut = 2.5,
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

    // Detailed music volume log for debugging
    logger.info('=== [TIMELINE] MUSIC VOLUME SEGMENTS ===', {
      baseMusicVolume,
      segments: musicVolumeSegments.map((s, i) => ({
        idx: i,
        time: `${s.startTime.toFixed(1)}s → ${s.endTime.toFixed(1)}s`,
        volume: s.volume.toFixed(3),
        behavior: s.behavior,
      })),
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

    // 4. Apply sidechain compression: music auto-ducks when voice is present.
    //    Uses voice → acompressor → sidechain key for sidechaincompress on music.
    //    The volume envelope handles creative shape (full/building/resolving),
    //    while sidechain handles dynamic real-time ducking under voice.
    const voiceEntriesForSC = timeline.filter(
      (e) => e.type === 'voice' && e.filePath && fs.existsSync(e.filePath)
    );

    let finalMusicPath = envelopedMusicPath;

    if (voiceEntriesForSC.length > 0) {
      try {
        // Create combined voice reference track (all positioned voices merged)
        const voiceRefPath = path.join(outputDir, `timeline_voice_ref_${uuidv4().slice(0, 8)}.mp3`);
        await ffmpegService.createVoiceReference(
          voiceEntriesForSC.map((e) => ({ filePath: e.filePath, startTime: e.startTime, volume: e.volume })),
          totalDuration,
          voiceRefPath
        );

        // Apply sidechain compression to music using voice as key signal
        const sidechainedPath = path.join(outputDir, `timeline_music_sc_${uuidv4().slice(0, 8)}.mp3`);
        await this.applySidechainToMusic(voiceRefPath, envelopedMusicPath, sidechainedPath);
        finalMusicPath = sidechainedPath;

        logger.info('Sidechain compression applied to music track');

        // Cleanup voice reference temp file
        ffmpegService.cleanupFile(voiceRefPath).catch(() => {});
      } catch (scErr: any) {
        logger.warn(`Sidechain compression failed, using envelope-only: ${scErr.message}`);
        finalMusicPath = envelopedMusicPath;
      }
    }

    // 5. Compute fade-out: only fade the music tail after voice ends.
    //    fadeOutStart must be >= lastVoiceEndTime so voice is never faded.
    const trailingMusic = totalDuration - lastVoiceEndTime;
    const effectiveFadeOut = trailingMusic > 0.3
      ? Math.min(trailingMusic, fadeOut > 0 ? Math.max(fadeOut, trailingMusic) : trailingMusic)
      : 0; // No fade if there's no real tail

    // 6. Build and run the FFmpeg filter_complex
    await this.buildAndRunMix({
      timeline,
      envelopedMusicPath: finalMusicPath,
      totalDuration,
      lastVoiceEndTime,
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

      // --- Voice ---
      const voiceResult = voiceBySegment.get(seg.segmentIndex);

      // For voiceover segments, use actual voice duration instead of the
      // LLM-planned segment duration. This eliminates dead-air gaps where
      // only music plays between voice segments (e.g. TTS produces 12.6s
      // for a 15s segment → 2.4s gap of silence). A small breath gap
      // (0.3s) is added for natural spacing between sentences.
      const BREATH_GAP = 0.3;
      const hasVoice = voiceResult && voiceResult.filePath && voiceResult.duration > 0;
      const effectiveDuration = hasVoice && voiceResult.duration < seg.duration
        ? voiceResult.duration + BREATH_GAP
        : seg.duration;
      const segEnd = cursor + effectiveDuration;
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

      logger.info(`=== [TIMELINE] Segment ${segIdx} "${seg.label}" music volume ===`, {
        behavior: musicBehavior,
        llmExplicitVolume: seg.music?.volume,
        resolvedVolume: musicVolForSegment.toFixed(3),
        timeRange: `${segStart.toFixed(1)}s → ${segEnd.toFixed(1)}s`,
      });

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
            // Gentle duck: music eases down slightly at the boundary.
            // Only a subtle dip (90% of current volume) — the real ducking
            // is handled by the volume envelope + sidechain compression.
            const duckDur = Math.min(transitionDur, 0.5);
            if (duckDur > 0.05) {
              // Gentle dip: 90% of current volume (not 50% of minimum!)
              const duckVol = musicVolForSegment * 0.90;

              // Add a duck region at the end of this segment
              const duckStart = Math.max(segStart, segEnd - duckDur);
              musicVolumeSegments[musicVolumeSegments.length - 1].endTime = duckStart;
              musicVolumeSegments.push({
                startTime: duckStart,
                endTime: segEnd,
                volume: duckVol,
                behavior: 'ducked',
              });

              logger.debug(`Transition: duck ${duckDur.toFixed(2)}s at end of "${seg.label}" (${musicVolForSegment.toFixed(2)} → ${duckVol.toFixed(2)})`);
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

    // ── Ensure voice content is never cut off ───────────────────────
    // TTS may produce audio longer than the segment's allocated duration.
    // Always extend the timeline to fit ALL voice content — never cut
    // off a voiceover mid-sentence just because we hit the target duration.
    const lastVoiceEntry = [...timeline].reverse().find((e) => e.type === 'voice');
    const lastVoiceEnd = lastVoiceEntry
      ? lastVoiceEntry.startTime + lastVoiceEntry.duration
      : cursor;

    if (lastVoiceEnd > cursor) {
      // Extend the last music volume segment to cover the voice overshoot
      const lastMvs = musicVolumeSegments[musicVolumeSegments.length - 1];
      if (lastMvs) {
        lastMvs.endTime = lastVoiceEnd;
      }
      logger.info(
        `Voice extends past segments: extending timeline ${cursor.toFixed(1)}s → ${lastVoiceEnd.toFixed(1)}s`
      );
      cursor = lastVoiceEnd;
    }

    // ── Music tail: continue after voice, then smooth fade-out ─────
    // Keep music at its current volume after voice ends, add 3s tail,
    // and let FFmpeg's afade handle a smooth gradual fade to silence.
    // No volume envelope changes in the tail — just a clean fade.
    const MUSIC_TAIL = 5.0;
    const desiredEnd = lastVoiceEnd + MUSIC_TAIL;

    if (cursor > desiredEnd && lastVoiceEntry) {
      // Trim trailing music that's too long
      for (let i = musicVolumeSegments.length - 1; i >= 0; i--) {
        if (musicVolumeSegments[i].startTime >= desiredEnd) {
          musicVolumeSegments.splice(i, 1);
        } else if (musicVolumeSegments[i].endTime > desiredEnd) {
          musicVolumeSegments[i].endTime = desiredEnd;
        }
      }
      logger.info(`Trimmed trailing music: ${cursor.toFixed(1)}s → ${desiredEnd.toFixed(1)}s`);
      cursor = desiredEnd;
    } else if (cursor < desiredEnd) {
      // Extend last music volume segment to cover the tail
      const lastMvs = musicVolumeSegments[musicVolumeSegments.length - 1];
      if (lastMvs) {
        lastMvs.endTime = desiredEnd;
      }
      logger.info(
        `Music tail: voice ends ${lastVoiceEnd.toFixed(1)}s, music continues to ${desiredEnd.toFixed(1)}s (+${MUSIC_TAIL}s fade-out)`
      );
      cursor = desiredEnd;
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
   *
   * Key design rule: ducked music should only be 20% quieter than full music.
   * The LLM often outputs very low values (0.15-0.20) which make the music
   * essentially disappear. We enforce a minimum of 80% of full volume for
   * ducked segments so the music bed stays present under the voice.
   */
  private resolveMusicVolume(
    behavior: MusicBehavior,
    segmentVolume: number | undefined,
    baseMusicVolume: number
  ): number {
    switch (behavior) {
      case 'full':
        // Full music: use explicit volume if given, otherwise strong presence
        return segmentVolume !== undefined ? Math.max(segmentVolume, 0.30) : 0.50;
      case 'ducked':
        // Ducked = only 20% reduction from full. The sidechain compressor
        // handles real-time dynamic ducking on top of this, so the base
        // level must stay high. Ignore LLM's low values (0.15-0.20).
        return 0.40;
      case 'building':
        return segmentVolume !== undefined ? segmentVolume : baseMusicVolume * 2.0;
      case 'resolving':
        return segmentVolume !== undefined ? segmentVolume : baseMusicVolume * 1.1;
      case 'accent':
        return segmentVolume !== undefined ? segmentVolume : 0.6;
      case 'none':
        return 0.0;
      default:
        return segmentVolume !== undefined ? segmentVolume : baseMusicVolume;
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

      // Apply energy multiplier based on behavior:
      //   - full/building/accent: wider range (0.8 - 1.15) for musical dynamics
      //   - ducked/resolving: very narrow range (0.97 - 1.03) to keep music
      //     consistent under voice — big swings here sound like "different music"
      //   - none: skip entirely
      if (mvs.behavior === 'none') continue;

      const isDuckedBehavior = mvs.behavior === 'ducked' || mvs.behavior === 'resolving';
      const energyMultiplier = isDuckedBehavior
        ? 0.97 + normalizedEnergy * 0.06   // 0.97 - 1.03 (barely noticeable)
        : 0.80 + normalizedEnergy * 0.35;  // 0.80 - 1.15 (musical dynamics)
      mvs.volume = mvs.volume * energyMultiplier;
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
  // Step 3b: Sidechain compression (voice ducks music)
  // -------------------------------------------------------------------------

  /**
   * Apply sidechain compression to music using voice as the key signal.
   *
   * Uses the same approach as professional radio/podcast production:
   *   1. Compress the voice reference for a consistent sidechain signal
   *   2. Use the compressed voice as the key for sidechaincompress on music
   *
   * This makes the music automatically and smoothly duck whenever voice
   * is present, and recover when voice stops.
   */
  private async applySidechainToMusic(
    voiceRefPath: string,
    musicPath: string,
    outputPath: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const command = ffmpeg();
        command.input(voiceRefPath);  // [0:a] = voice reference
        command.input(musicPath);     // [1:a] = enveloped music

        const filters = [
          // Compress voice reference for consistent sidechain trigger signal
          `[0:a]${NORMALIZE_FILTER},acompressor=threshold=-18dB:ratio=3:attack=15:release=200[vcomp]`,
          // Normalize music
          `[1:a]${NORMALIZE_FILTER}[mus]`,
          // Sidechain compress: very gentle ducking when voice is present.
          // threshold=0.25: only strong voice triggers ducking
          // ratio=1.5: barely noticeable compression (was 3 — too aggressive)
          // attack=300ms: slow onset for gradual smooth fade down
          // release=1200ms: very long recovery so music comes back slowly
          // mix=0.3: blend only 30% of compressed signal (keeps most of original level)
          `[mus][vcomp]sidechaincompress=threshold=0.25:ratio=1.5:attack=300:release=1200:mix=0.3[out]`,
        ];

        const filterStr = filters.join(';');
        command.complexFilter(filterStr, 'out');

        command
          .audioCodec('libmp3lame')
          .audioBitrate('320k')
          .audioChannels(2)
          .audioFrequency(SAMPLE_RATE);
        command.output(outputPath);

        command
          .on('start', (commandLine: string) => {
            logger.debug('Sidechain FFmpeg:', commandLine.slice(0, 400));
          })
          .on('end', () => {
            resolve();
          })
          .on('error', (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            reject(new Error(`Sidechain compression failed: ${msg}`));
          });

        command.run();
      } catch (error: any) {
        reject(error);
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
    lastVoiceEndTime: number;
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
      lastVoiceEndTime,
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

        // Normalize music input with gentle fade-in for smooth start
        filters.push(`[0:a]${NORMALIZE_FILTER},afade=t=in:st=0:d=0.8:curve=tri[music]`);

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

        // Mix all tracks together (normalize=0: sidechain handles levels, loudnorm at end)
        const mixInputStr = mixLabels.join('');
        filters.push(
          `${mixInputStr}amix=inputs=${totalInputs}:duration=longest:dropout_transition=2:normalize=0[mixraw]`
        );

        // Trim to exact duration
        const END_PADDING = 0.08;
        const trimDuration = totalDuration + END_PADDING;
        filters.push(`[mixraw]atrim=0:${trimDuration},asetpts=PTS-STARTPTS[trimmed]`);

        // Apply fades
        // Fade-in: tiny anti-click
        // Fade-out: ONLY applied to the music tail after voice ends.
        //   fadeOutStart is guaranteed >= lastVoiceEndTime so voice is never faded.
        const clampedFadeIn = Math.max(0.02, Math.min(0.12, fadeIn));
        const ffmpegCurve = fadeCurve === 'linear' ? 'tri' : fadeCurve === 'qsin' ? 'qsin' : 'exp';

        if (fadeOut > 0.1) {
          const clampedFadeOut = Math.max(0.1, Math.min(5.0, fadeOut));
          // Ensure fade starts after voice ends, never during voice
          const fadeOutStart = Math.max(lastVoiceEndTime, trimDuration - clampedFadeOut);
          const fadeOutCurve = clampedFadeOut > 1.0 ? 'exp' : 'tri';
          filters.push(
            `[trimmed]afade=t=in:st=0:d=${clampedFadeIn}:curve=${ffmpegCurve},` +
            `afade=t=out:st=${fadeOutStart}:d=${clampedFadeOut}:curve=${fadeOutCurve}[faded]`
          );
        } else {
          // No fade-out needed — just apply anti-click fade-in
          filters.push(
            `[trimmed]afade=t=in:st=0:d=${clampedFadeIn}:curve=${ffmpegCurve}[faded]`
          );
        }

        // Loudness normalization
        if (normalizeLoudness) {
          const target = Math.max(-60, Math.min(0, loudnessTargetLUFS));
          const tp = Math.max(-10, Math.min(0, loudnessTruePeak));
          filters.push(`[faded]loudnorm=I=${target}:TP=${tp}:LRA=3.0[out]`);
        } else {
          filters.push('[faded]volume=1.5[out]');
        }

        const filterStr = filters.join(';');
        command.complexFilter(filterStr, 'out');

        // Output settings
        command
          .audioCodec('libmp3lame')
          .audioBitrate('320k')
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
