/**
 * Musical timing utilities for bar/beat-aware audio alignment.
 *
 * Human composers think in bars, beats, and phrases – not arbitrary seconds.
 * This module provides the math to convert between musical structure and time.
 */

/** Standard time signatures. Ads almost always use 4/4, but cultural genres may use others. */
export type TimeSignature = '4/4' | '3/4' | '6/8' | '7/8' | '12/8';

/** Get beats per bar for a time signature. Compound meters (6/8, 12/8) count in dotted-quarter groups. */
export function beatsPerBarForTimeSignature(ts: TimeSignature): number {
  switch (ts) {
    case '3/4': return 3;
    case '6/8': return 6;   // 2 groups of 3 eighth notes
    case '7/8': return 7;
    case '12/8': return 12; // 4 groups of 3 eighth notes
    case '4/4':
    default: return 4;
  }
}

/** Get the beat unit duration multiplier relative to a quarter note.
 *  For x/4 time: beat = quarter note (1.0).
 *  For x/8 time: beat = eighth note (0.5). */
function beatUnitMultiplier(ts: TimeSignature): number {
  if (ts === '6/8' || ts === '7/8' || ts === '12/8') return 0.5;
  return 1.0;
}

export interface BarGrid {
  /** BPM used for this grid */
  bpm: number;
  /** Beats per bar (4 for 4/4, 3 for 3/4) */
  beatsPerBar: number;
  /** Duration of one beat in seconds */
  beatDuration: number;
  /** Duration of one bar in seconds */
  barDuration: number;
  /** Total number of whole bars */
  totalBars: number;
  /** Exact total duration that aligns to bar boundaries */
  totalDuration: number;
}

export interface BarAlignedDuration {
  /** The bar-aligned duration in seconds (always a whole number of bars) */
  duration: number;
  /** Number of whole bars */
  bars: number;
  /** The BPM used */
  bpm: number;
  /** Duration of one bar */
  barDuration: number;
}

export interface PrePostRoll {
  /** Bars of music before voice enters */
  preRollBars: number;
  /** Pre-roll duration in seconds */
  preRollDuration: number;
  /** Bars of music after voice ends (for button ending) */
  postRollBars: number;
  /** Post-roll duration in seconds */
  postRollDuration: number;
  /** Total music duration needed (pre + voice + post) */
  totalMusicDuration: number;
}

export interface LoopPlan {
  /**
   * Duration to request from the music generator (bar-aligned, ≤ maxGenDuration).
   * This is the "seed" that we loop.
   */
  seedDuration: number;
  /** Number of bars in the seed */
  seedBars: number;
  /** How many full loops of the seed are needed */
  fullLoops: number;
  /** Final trim point (bar-aligned) for the total output */
  trimDuration: number;
  /** Total bars in the final output */
  totalBars: number;
  /** BPM and bar duration */
  bpm: number;
  barDuration: number;
}

/**
 * Build a bar grid for a given BPM and time signature.
 */
export function buildBarGrid(
  bpm: number,
  totalDurationHint: number,
  timeSignature: TimeSignature = '4/4'
): BarGrid {
  const bpb = beatsPerBarForTimeSignature(timeSignature);
  const quarterDuration = 60 / bpm;
  const beatDuration = quarterDuration * beatUnitMultiplier(timeSignature);
  const barDuration = beatDuration * bpb;
  const totalBars = Math.ceil(totalDurationHint / barDuration);
  const totalDuration = totalBars * barDuration;

  return { bpm, beatsPerBar: bpb, beatDuration, barDuration, totalBars, totalDuration };
}

/**
 * Round a duration UP to the nearest whole bar boundary.
 */
export function ceilToBar(seconds: number, bpm: number, timeSignature: TimeSignature = '4/4'): BarAlignedDuration {
  const bpb = beatsPerBarForTimeSignature(timeSignature);
  const barDuration = (60 / bpm) * beatUnitMultiplier(timeSignature) * bpb;
  const bars = Math.ceil(seconds / barDuration);
  return { duration: bars * barDuration, bars, bpm, barDuration };
}

/**
 * Round a duration DOWN to the nearest whole bar boundary.
 */
export function floorToBar(seconds: number, bpm: number, timeSignature: TimeSignature = '4/4'): BarAlignedDuration {
  const bpb = beatsPerBarForTimeSignature(timeSignature);
  const barDuration = (60 / bpm) * beatUnitMultiplier(timeSignature) * bpb;
  const bars = Math.max(1, Math.floor(seconds / barDuration));
  return { duration: bars * barDuration, bars, bpm, barDuration };
}

/**
 * Round a duration to the NEAREST whole bar boundary.
 */
export function roundToBar(seconds: number, bpm: number, timeSignature: TimeSignature = '4/4'): BarAlignedDuration {
  const bpb = beatsPerBarForTimeSignature(timeSignature);
  const barDuration = (60 / bpm) * beatUnitMultiplier(timeSignature) * bpb;
  const bars = Math.max(1, Math.round(seconds / barDuration));
  return { duration: bars * barDuration, bars, bpm, barDuration };
}

/**
 * Calculate pre-roll and post-roll durations (in bars) for the music track.
 *
 * Pre-roll: music plays alone before voice enters (sets the mood).
 * Post-roll: music plays alone after voice ends (button ending / resolution).
 *
 * Short ads get shorter rolls; longer / cinematic ads get longer rolls.
 */
export function calculatePrePostRoll(
  voiceDuration: number,
  bpm: number,
  options: {
    genre?: string;
    adDuration?: number;
    timeSignature?: TimeSignature;
  } = {}
): PrePostRoll {
  const ts = options.timeSignature || '4/4';
  const barDuration = (60 / bpm) * beatUnitMultiplier(ts) * beatsPerBarForTimeSignature(ts);

  // Decide pre-roll bars based on ad length
  const totalHint = options.adDuration || voiceDuration;
  let preRollBars: number;
  let postRollBars: number;

  if (totalHint <= 15) {
    // Very short ad: 1 bar pre, 1 bar post
    preRollBars = 1;
    postRollBars = 1;
  } else if (totalHint <= 30) {
    // Standard 30s ad: 1-2 bars pre, 1-2 bars post
    preRollBars = barDuration <= 1.5 ? 2 : 1; // 2 bars if bars are short (high BPM)
    postRollBars = barDuration <= 1.5 ? 2 : 1;
  } else {
    // Longer ad: 2 bars pre, 2 bars post
    preRollBars = 2;
    postRollBars = 2;
  }

  // Cinematic / ambient genres get an extra bar of pre-roll
  const genre = (options.genre || '').toLowerCase();
  if (genre.includes('cinematic') || genre.includes('ambient')) {
    preRollBars = Math.min(preRollBars + 1, 4);
  }

  const preRollDuration = preRollBars * barDuration;
  const postRollDuration = postRollBars * barDuration;
  const totalMusicDuration = preRollDuration + voiceDuration + postRollDuration;

  return {
    preRollBars,
    preRollDuration,
    postRollBars,
    postRollDuration,
    totalMusicDuration,
  };
}

/**
 * Create a loop plan for when the music generator has a max duration limit
 * (e.g. ElevenLabs max 22s) but we need a longer track.
 *
 * Strategy:
 *   1. Calculate how many bars fit in the max generation duration.
 *   2. Request exactly that many bars (bar-aligned seed).
 *   3. Loop the seed to cover the total needed duration.
 *   4. Trim the final output on a bar boundary.
 *
 * This way the loop point always falls on a bar boundary, making it
 * musically seamless (the downbeat of bar N+1 follows the last beat of bar N).
 */
export function createLoopPlan(
  totalNeededDuration: number,
  bpm: number,
  maxGenDuration: number = 22,
  timeSignature: TimeSignature = '4/4'
): LoopPlan {
  const bpb = beatsPerBarForTimeSignature(timeSignature);
  const barDuration = (60 / bpm) * beatUnitMultiplier(timeSignature) * bpb;

  // How many whole bars fit in the max generation window?
  const maxBars = Math.floor(maxGenDuration / barDuration);
  // Ensure at least 4 bars for musical coherence (a phrase)
  const seedBars = Math.max(4, maxBars);
  const seedDuration = seedBars * barDuration;

  // How many bars do we need total?
  const totalBars = Math.ceil(totalNeededDuration / barDuration);
  const trimDuration = totalBars * barDuration;

  // How many full loops?
  const fullLoops = Math.ceil(totalBars / seedBars);

  return {
    seedDuration: Math.min(seedDuration, maxGenDuration), // respect the hard limit
    seedBars,
    fullLoops,
    trimDuration,
    totalBars,
    bpm,
    barDuration,
  };
}

/**
 * Find the nearest bar boundary (downbeat) to a given timestamp.
 * Returns the time of the nearest downbeat.
 */
export function nearestDownbeat(
  timestamp: number,
  bpm: number,
  timeSignature: TimeSignature = '4/4'
): { time: number; bar: number; offset: number } {
  const bpb = beatsPerBarForTimeSignature(timeSignature);
  const barDuration = (60 / bpm) * beatUnitMultiplier(timeSignature) * bpb;
  const bar = Math.round(timestamp / barDuration);
  const time = bar * barDuration;
  return { time, bar, offset: timestamp - time };
}

/**
 * Find the nearest beat to a given timestamp.
 */
export function nearestBeat(
  timestamp: number,
  bpm: number
): { time: number; beat: number; offset: number } {
  const beatDuration = 60 / bpm;
  const beat = Math.round(timestamp / beatDuration);
  const time = beat * beatDuration;
  return { time, beat, offset: timestamp - time };
}

/**
 * Given a target BPM and a required total duration, find the BPM in a small
 * range around the target that gives the best bar alignment (i.e. total
 * duration closest to a whole number of bars while staying near the target BPM).
 *
 * This is useful for requesting music where we want the bars to fit perfectly.
 */
export function optimizeBPMForDuration(
  targetBPM: number,
  targetDuration: number,
  options: {
    bpmRange?: number;       // How far from target to search (default ±5)
    timeSignature?: TimeSignature;
  } = {}
): { bpm: number; bars: number; exactDuration: number; error: number } {
  const range = options.bpmRange ?? 5;
  const ts = options.timeSignature || '4/4';
  const bpb = beatsPerBarForTimeSignature(ts);
  const bum = beatUnitMultiplier(ts);

  let bestBPM = targetBPM;
  let bestError = Infinity;
  let bestBars = 0;
  let bestDuration = targetDuration;

  // Search integer BPMs in range
  for (let bpm = targetBPM - range; bpm <= targetBPM + range; bpm++) {
    if (bpm < 40 || bpm > 200) continue;

    const barDuration = (60 / bpm) * bum * bpb;
    const bars = Math.round(targetDuration / barDuration);
    if (bars < 1) continue;

    const exactDuration = bars * barDuration;
    const error = Math.abs(exactDuration - targetDuration);

    if (error < bestError) {
      bestError = error;
      bestBPM = bpm;
      bestBars = bars;
      bestDuration = exactDuration;
    }
  }

  return { bpm: bestBPM, bars: bestBars, exactDuration: bestDuration, error: bestError };
}

/**
 * Generate an array of downbeat timestamps for a bar grid.
 */
export function generateDownbeats(
  bpm: number,
  totalBars: number,
  timeSignature: TimeSignature = '4/4'
): number[] {
  const bpb = beatsPerBarForTimeSignature(timeSignature);
  const barDuration = (60 / bpm) * beatUnitMultiplier(timeSignature) * bpb;
  const downbeats: number[] = [];
  for (let i = 0; i <= totalBars; i++) {
    downbeats.push(i * barDuration);
  }
  return downbeats;
}

/**
 * Main entry point: plan how music should be aligned to voice.
 *
 * With Suno (up to 8 min), the generated track is usually long enough.
 * The key operation is trimming on bar boundaries (not stretching with atempo).
 * If Suno output is somehow shorter than needed, we loop on bar boundaries.
 */
export function planMusicDuration(
  voiceDuration: number,
  bpm: number,
  options: {
    genre?: string;
    maxGenDuration?: number;   // Suno V5 = 480 (8 min)
    timeSignature?: TimeSignature;
  } = {}
): {
  prePostRoll: PrePostRoll;
  loopPlan: LoopPlan;
  requestDuration: number;     // What to request from music generator (bar-aligned)
  needsLoop: boolean;          // Whether the seed needs to be looped
} {
  const maxGen = options.maxGenDuration ?? 480; // Suno V5 default: up to 8 minutes
  const ts = options.timeSignature || '4/4';

  const prePost = calculatePrePostRoll(voiceDuration, bpm, {
    genre: options.genre,
    adDuration: voiceDuration,
    timeSignature: ts,
  });

  const plan = createLoopPlan(prePost.totalMusicDuration, bpm, maxGen, ts);
  const needsLoop = plan.fullLoops > 1;

  // The actual duration to request from the generator
  // Must be ≤ maxGen and bar-aligned
  const requestDuration = Math.min(plan.seedDuration, maxGen);

  return { prePostRoll: prePost, loopPlan: plan, requestDuration, needsLoop };
}

/**
 * Given a generated music track's actual duration and the needed duration,
 * decide whether to trim or loop, and return the bar-aligned trim/loop point.
 *
 * This replaces the old atempo stretching approach.
 */
export function alignMusicToVoice(
  musicDuration: number,
  voiceDuration: number,
  bpm: number,
  options: {
    genre?: string;
    timeSignature?: TimeSignature;
  } = {}
): {
  action: 'trim' | 'loop' | 'use_as_is';
  /** Bar-aligned target duration for the music */
  targetDuration: number;
  targetBars: number;
  barDuration: number;
  /** For 'loop': how many full loops needed */
  loopCount: number;
  /** Pre-roll duration (music before voice) -- voice should be delayed by this much */
  preRollDuration: number;
  preRollBars: number;
} {
  const ts = options.timeSignature || '4/4';
  const prePost = calculatePrePostRoll(voiceDuration, bpm, {
    genre: options.genre,
    adDuration: voiceDuration,
    timeSignature: ts,
  });

  const barDuration = (60 / bpm) * beatUnitMultiplier(ts) * beatsPerBarForTimeSignature(ts);

  // Total music needed = pre-roll + voice + post-roll, rounded up to whole bars
  const totalNeeded = prePost.totalMusicDuration;
  const targetBars = Math.ceil(totalNeeded / barDuration);
  const targetDuration = targetBars * barDuration;

  let action: 'trim' | 'loop' | 'use_as_is';
  let loopCount = 1;

  // Tolerance: within half a bar is close enough
  const tolerance = barDuration * 0.5;

  if (Math.abs(musicDuration - targetDuration) <= tolerance) {
    action = 'use_as_is';
  } else if (musicDuration > targetDuration) {
    action = 'trim';
  } else {
    action = 'loop';
    loopCount = Math.ceil(targetDuration / musicDuration);
  }

  return {
    action,
    targetDuration,
    targetBars,
    barDuration,
    loopCount,
    preRollDuration: prePost.preRollDuration,
    preRollBars: prePost.preRollBars,
  };
}
