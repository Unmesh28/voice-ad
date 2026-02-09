/**
 * Voice-Music Alignment Engine
 *
 * After we have the music analysis (beat grid, energy curve) and the
 * voice sentence timings, this service calculates how to align them:
 *   1. Pre-roll alignment: voice enters on a downbeat
 *   2. Beat-aware ducking: duck on beat boundaries, not mid-bar
 *   3. Button ending: clean cut on a bar boundary after the last word
 *
 * This is the "spotting" step -- like a human composer/engineer
 * placing the voice precisely on the musical grid.
 */

import { logger } from '../../config/logger';
import type { MusicAnalysis } from './music-analyzer.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SentenceTiming {
  text: string;
  startSeconds: number;
  endSeconds: number;
}

export interface DuckingSegment {
  /** When to start ducking (aligned to beat before voice) */
  startTime: number;
  /** When to stop ducking (aligned to beat after voice) */
  endTime: number;
  /** Duck level: 0 = full duck, 1 = no duck. Typically 0.2-0.4 under voice. */
  duckLevel: number;
  /** Ramp time in seconds to reach duck level (typically 1 beat) */
  rampIn: number;
  /** Ramp time in seconds to return to full level */
  rampOut: number;
}

export interface AlignmentResult {
  /** How many seconds into the music to place time 0 of the voice */
  voiceDelay: number;
  /** Which downbeat the voice enters on */
  voiceEntryBar: number;
  /** Where to trim the music for a clean ending (bar-aligned) */
  musicCutoffTime: number;
  /** Bar number of the last bar (button ending starts here) */
  buttonEndingBar: number;
  /** Beat-aware ducking segments */
  duckingSegments: DuckingSegment[];
  /** Quality score: how well the music aligns (0-1, higher = better) */
  alignmentScore: number;
}

// ---------------------------------------------------------------------------
// Pre-Roll Alignment
// ---------------------------------------------------------------------------

/**
 * Find the best downbeat for voice entry based on the blueprint's pre-roll
 * and the music analysis.
 *
 * Strategy: We want the voice to enter on a downbeat. The blueprint tells us
 * how many pre-roll bars we want. We find the downbeat closest to the
 * desired pre-roll duration.
 */
function alignVoiceEntry(
  analysis: MusicAnalysis,
  desiredPreRollDuration: number
): { voiceDelay: number; voiceEntryBar: number } {
  const downbeats = analysis.downbeatPositions;

  if (downbeats.length === 0) {
    return { voiceDelay: desiredPreRollDuration, voiceEntryBar: 1 };
  }

  // Find the downbeat closest to the desired pre-roll
  let bestIdx = 0;
  let bestDiff = Infinity;

  for (let i = 0; i < downbeats.length; i++) {
    const diff = Math.abs(downbeats[i] - desiredPreRollDuration);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
    // Stop searching once we're past the desired point + 1 bar
    if (downbeats[i] > desiredPreRollDuration * 2) break;
  }

  return {
    voiceDelay: downbeats[bestIdx],
    voiceEntryBar: bestIdx + 1, // 1-indexed
  };
}

// ---------------------------------------------------------------------------
// Beat-Aware Ducking
// ---------------------------------------------------------------------------

/**
 * Build ducking segments that snap to beat boundaries.
 *
 * Instead of ducking exactly when voice starts/stops (which often falls
 * mid-beat and creates unnatural volume jumps), we snap to the nearest
 * beat boundary so the duck feels musical.
 *
 * For each sentence:
 *   - Duck starts on the beat just BEFORE the sentence starts
 *   - Duck ends on the beat just AFTER the sentence ends
 *   - Ramp time = 1 beat duration (smooth transition)
 */
function buildBeatAwareDucking(
  sentenceTimings: SentenceTiming[],
  analysis: MusicAnalysis,
  voiceDelay: number,
  options: {
    duckLevel?: number;
    musicVolumeMultipliers?: Map<number, number>;
  } = {}
): DuckingSegment[] {
  const beats = analysis.beatPositions;
  const beatDuration = beats.length > 1 ? beats[1] - beats[0] : 0.6;
  const baseDuckLevel = options.duckLevel ?? 0.25;

  if (beats.length < 2 || sentenceTimings.length === 0) {
    // Fallback: non-beat-aligned ducking
    return sentenceTimings.map((s) => ({
      startTime: s.startSeconds + voiceDelay,
      endTime: s.endSeconds + voiceDelay,
      duckLevel: baseDuckLevel,
      rampIn: 0.1,
      rampOut: 0.1,
    }));
  }

  const segments: DuckingSegment[] = [];

  for (let i = 0; i < sentenceTimings.length; i++) {
    const sentence = sentenceTimings[i];
    const absStart = sentence.startSeconds + voiceDelay;
    const absEnd = sentence.endSeconds + voiceDelay;

    // Find beat just before sentence starts
    let duckStart = absStart;
    for (let b = beats.length - 1; b >= 0; b--) {
      if (beats[b] <= absStart) {
        duckStart = beats[b];
        break;
      }
    }

    // Find beat just after sentence ends
    let duckEnd = absEnd;
    for (const b of beats) {
      if (b >= absEnd) {
        duckEnd = b;
        break;
      }
    }

    // Per-sentence duck level (from LLM sentenceCues musicVolumeMultiplier)
    const multiplier = options.musicVolumeMultipliers?.get(i) ?? 1;
    // musicVolumeMultiplier > 1 means "more music", < 1 means "less music"
    // We invert this for ducking: higher multiplier = less ducking (higher duckLevel)
    const duckLevel = Math.max(0.1, Math.min(0.8, baseDuckLevel * (1 / multiplier)));

    segments.push({
      startTime: duckStart,
      endTime: duckEnd,
      duckLevel,
      rampIn: beatDuration, // 1 beat ramp
      rampOut: beatDuration,
    });
  }

  // Merge overlapping segments
  return mergeOverlappingSegments(segments);
}

/**
 * Merge ducking segments that overlap (consecutive sentences with small gaps).
 */
function mergeOverlappingSegments(segments: DuckingSegment[]): DuckingSegment[] {
  if (segments.length <= 1) return segments;

  const sorted = [...segments].sort((a, b) => a.startTime - b.startTime);
  const merged: DuckingSegment[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];

    // If current starts before previous ends (or very close), merge them
    if (curr.startTime <= prev.endTime + prev.rampOut * 0.5) {
      prev.endTime = Math.max(prev.endTime, curr.endTime);
      prev.duckLevel = Math.min(prev.duckLevel, curr.duckLevel); // Use the deeper duck
    } else {
      merged.push(curr);
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Button Ending Alignment
// ---------------------------------------------------------------------------

/**
 * Find the right cutoff point for a clean button ending.
 *
 * After the voice's last word, the music should:
 * 1. Continue to the next downbeat
 * 2. Play 1-2 bars of button ending (sustained chord / resolution)
 * 3. Cut cleanly on a bar boundary
 */
function alignButtonEnding(
  lastWordEnd: number,
  analysis: MusicAnalysis,
  barDuration: number,
  postRollBars: number = 1
): { buttonStartTime: number; cutoffTime: number; buttonEndingBar: number } {
  const downbeats = analysis.downbeatPositions;

  // Find the first downbeat after the last word
  let buttonStart = lastWordEnd + 0.3; // default: small gap after last word
  let buttonBar = -1;

  for (let i = 0; i < downbeats.length; i++) {
    if (downbeats[i] >= lastWordEnd) {
      buttonStart = downbeats[i];
      buttonBar = i + 1;
      break;
    }
  }

  // Button ending = postRollBars bars of music after the button start
  const cutoffTime = buttonStart + postRollBars * barDuration;

  // If we couldn't find a downbeat, estimate
  if (buttonBar < 0) {
    const estimatedBar = Math.ceil(lastWordEnd / barDuration);
    return {
      buttonStartTime: estimatedBar * barDuration,
      cutoffTime: (estimatedBar + postRollBars) * barDuration,
      buttonEndingBar: estimatedBar,
    };
  }

  return {
    buttonStartTime: buttonStart,
    cutoffTime,
    buttonEndingBar: buttonBar,
  };
}

// ---------------------------------------------------------------------------
// Quality Score
// ---------------------------------------------------------------------------

/**
 * Calculate how well the alignment worked.
 * Factors: voice entry on a downbeat, button ending on a downbeat,
 * ducking segments aligned to beats.
 */
function calculateAlignmentScore(
  voiceDelay: number,
  cutoffTime: number,
  analysis: MusicAnalysis
): number {
  const beatDuration = analysis.beatPositions.length > 1
    ? analysis.beatPositions[1] - analysis.beatPositions[0]
    : 0.6;

  // Voice entry alignment: how close is voiceDelay to a downbeat?
  let voiceEntryScore = 0;
  for (const db of analysis.downbeatPositions) {
    const offset = Math.abs(voiceDelay - db);
    if (offset < beatDuration * 0.25) {
      voiceEntryScore = 1.0;
      break;
    } else if (offset < beatDuration * 0.5) {
      voiceEntryScore = 0.7;
      break;
    }
  }

  // Button ending alignment: how close is cutoff to a downbeat?
  let endingScore = 0;
  for (const db of analysis.downbeatPositions) {
    const offset = Math.abs(cutoffTime - db);
    if (offset < beatDuration * 0.25) {
      endingScore = 1.0;
      break;
    } else if (offset < beatDuration * 0.5) {
      endingScore = 0.7;
      break;
    }
  }

  return (voiceEntryScore + endingScore) / 2;
}

// ---------------------------------------------------------------------------
// Main alignment function
// ---------------------------------------------------------------------------

/**
 * Compute the full alignment between voice and music.
 *
 * Takes the music analysis, sentence timings from TTS, and blueprint
 * parameters, and returns everything the mixing worker needs to
 * produce a professionally aligned mix.
 */
export function alignVoiceToMusic(
  analysis: MusicAnalysis,
  sentenceTimings: SentenceTiming[],
  options: {
    preRollDuration: number;
    postRollBars: number;
    barDuration: number;
    duckLevel?: number;
    musicVolumeMultipliers?: Map<number, number>;
  }
): AlignmentResult {
  const { preRollDuration, postRollBars, barDuration, duckLevel, musicVolumeMultipliers } = options;

  // 1. Align voice entry to nearest downbeat
  const entry = alignVoiceEntry(analysis, preRollDuration);

  // 2. Build beat-aware ducking
  const duckingSegments = buildBeatAwareDucking(
    sentenceTimings,
    analysis,
    entry.voiceDelay,
    { duckLevel, musicVolumeMultipliers }
  );

  // 3. Align button ending
  const lastSentence = sentenceTimings[sentenceTimings.length - 1];
  const lastWordEnd = lastSentence
    ? lastSentence.endSeconds + entry.voiceDelay
    : entry.voiceDelay + 10;

  const buttonEnding = alignButtonEnding(lastWordEnd, analysis, barDuration, postRollBars);

  // 4. Quality score
  const alignmentScore = calculateAlignmentScore(
    entry.voiceDelay,
    buttonEnding.cutoffTime,
    analysis
  );

  logger.info('Voice-music alignment computed', {
    voiceDelay: entry.voiceDelay.toFixed(2),
    voiceEntryBar: entry.voiceEntryBar,
    cutoffTime: buttonEnding.cutoffTime.toFixed(2),
    buttonEndingBar: buttonEnding.buttonEndingBar,
    duckingSegments: duckingSegments.length,
    alignmentScore: alignmentScore.toFixed(2),
  });

  return {
    voiceDelay: entry.voiceDelay,
    voiceEntryBar: entry.voiceEntryBar,
    musicCutoffTime: buttonEnding.cutoffTime,
    buttonEndingBar: buttonEnding.buttonEndingBar,
    duckingSegments,
    alignmentScore,
  };
}

export default { alignVoiceToMusic };
