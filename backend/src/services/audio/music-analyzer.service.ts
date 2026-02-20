/**
 * Music Analysis Engine
 *
 * After Suno generates a track, we analyze it to understand what we actually
 * got: beat grid, energy curve, detected sections. This feeds the alignment
 * engine so we can fit the music to the voice like a human engineer.
 *
 * Strategy: Since we know the target BPM (from the blueprint), we construct
 * a beat grid and phase-align it to the audio's first strong onset using
 * FFmpeg energy extraction. No external beat-tracking library needed.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../config/logger';
import ffmpegService from './ffmpeg.service';

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MusicAnalysis {
  /** Detected or confirmed BPM */
  detectedBPM: number;
  /** Beat positions in seconds (every beat) */
  beatPositions: number[];
  /** Downbeat positions in seconds (bar starts, every beatsPerBar beats) */
  downbeatPositions: number[];
  /** Energy curve: RMS energy sampled at regular intervals */
  energyCurve: { time: number; energy: number }[];
  /** Total duration of the audio */
  totalDuration: number;
  /** Phase offset: how much the first downbeat is offset from time 0 */
  phaseOffset: number;
  /** Detected sections based on energy changes */
  detectedSections: {
    startTime: number;
    endTime: number;
    avgEnergy: number;
    label: 'low' | 'building' | 'peak' | 'resolving';
  }[];
}

// ---------------------------------------------------------------------------
// Energy extraction via FFmpeg
// ---------------------------------------------------------------------------

/**
 * Extract RMS energy levels from an audio file using FFmpeg's astats filter.
 * Returns energy samples at roughly `intervalMs` intervals.
 */
async function extractEnergyCurve(
  filePath: string,
  intervalMs: number = 50
): Promise<{ time: number; energy: number }[]> {
  // Use FFmpeg volumedetect approach: extract short segments and measure RMS
  // More reliable: use the ebur128 filter which outputs momentary loudness
  const intervalSec = intervalMs / 1000;

  try {
    // Use ebur128 for momentary loudness at 100ms intervals (its native rate)
    const { stdout, stderr } = await execAsync(
      `ffmpeg -i "${filePath}" -af "ebur128=framelog=verbose" -f null - 2>&1 | grep "M:" | head -2000`,
      { maxBuffer: 10 * 1024 * 1024, timeout: 30000 }
    );

    const combined = stdout + stderr;
    const lines = combined.split('\n');
    const curve: { time: number; energy: number }[] = [];

    // ebur128 outputs lines like: "t: 0.1     M: -23.4  S: -25.1  ..."
    const momentaryRegex = /t:\s*([\d.]+)\s+M:\s*(-?[\d.]+)/;

    for (const line of lines) {
      const match = momentaryRegex.exec(line);
      if (match) {
        const time = parseFloat(match[1]);
        const momentaryLUFS = parseFloat(match[2]);
        // Convert LUFS to a 0-1 energy scale (LUFS typically -70 to 0)
        const energy = Math.max(0, Math.min(1, (momentaryLUFS + 70) / 70));
        curve.push({ time, energy });
      }
    }

    if (curve.length > 0) {
      return curve;
    }
  } catch {
    // ebur128 approach failed, fall back to simpler method
    logger.debug('ebur128 extraction failed, using fallback energy estimation');
  }

  // Fallback: use FFmpeg astats with periodic reset to get RMS values
  try {
    const resetFrames = Math.round(48000 * intervalMs / 1000);
    const { stderr } = await execAsync(
      `ffmpeg -i "${filePath}" -af "astats=metadata=1:reset=${resetFrames}" -f null - 2>&1`,
      { maxBuffer: 10 * 1024 * 1024, timeout: 30000 }
    );

    const curve: { time: number; energy: number }[] = [];
    const rmsRegex = /RMS level dB:\s*(-?[\d.]+|inf)/g;
    let match: RegExpExecArray | null;
    let idx = 0;

    while ((match = rmsRegex.exec(stderr)) !== null) {
      const rmsDb = match[1] === 'inf' ? -100 : parseFloat(match[1]);
      const energy = Math.max(0, Math.min(1, (rmsDb + 60) / 60));
      curve.push({ time: idx * (intervalMs / 1000), energy });
      idx++;
    }

    if (curve.length > 0) return curve;
  } catch {
    logger.debug('astats extraction also failed');
  }

  // Final fallback: return a flat energy curve
  logger.warn('Could not extract energy curve, using flat estimate');
  const totalDuration = await ffmpegService.getAudioDuration(filePath);
  const curve: { time: number; energy: number }[] = [];
  for (let t = 0; t < totalDuration; t += intervalMs / 1000) {
    curve.push({ time: t, energy: 0.5 });
  }
  return curve;
}

/**
 * Find the first strong onset in the audio (used for phase alignment).
 * Looks for the first energy value that exceeds a threshold.
 */
function findFirstOnset(
  energyCurve: { time: number; energy: number }[],
  threshold: number = 0.15
): number {
  for (const point of energyCurve) {
    if (point.energy >= threshold) {
      return point.time;
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Section detection
// ---------------------------------------------------------------------------

/**
 * Detect musical sections from energy curve by looking for sustained
 * energy level changes. Groups consecutive similar-energy windows.
 */
function detectSections(
  energyCurve: { time: number; energy: number }[],
  barDuration: number
): MusicAnalysis['detectedSections'] {
  if (energyCurve.length === 0) return [];

  // Smooth energy with a bar-length moving average
  const windowSize = Math.max(1, Math.round(barDuration / 0.1)); // ~1 bar worth of samples
  const smoothed: { time: number; energy: number }[] = [];

  for (let i = 0; i < energyCurve.length; i++) {
    const start = Math.max(0, i - Math.floor(windowSize / 2));
    const end = Math.min(energyCurve.length, i + Math.ceil(windowSize / 2));
    let sum = 0;
    for (let j = start; j < end; j++) sum += energyCurve[j].energy;
    smoothed.push({ time: energyCurve[i].time, energy: sum / (end - start) });
  }

  // Quantize energy into levels: low (0-0.3), medium (0.3-0.55), high (0.55-0.75), peak (0.75+)
  function energyLabel(e: number): 'low' | 'building' | 'peak' | 'resolving' {
    if (e < 0.3) return 'low';
    if (e < 0.55) return 'building';
    if (e < 0.75) return 'peak';
    return 'peak';
  }

  // Group into sections of similar energy
  const sections: MusicAnalysis['detectedSections'] = [];
  let sectionStart = smoothed[0].time;
  let currentLabel = energyLabel(smoothed[0].energy);
  let energySum = smoothed[0].energy;
  let count = 1;

  for (let i = 1; i < smoothed.length; i++) {
    const label = energyLabel(smoothed[i].energy);
    if (label !== currentLabel) {
      // Section boundary
      sections.push({
        startTime: sectionStart,
        endTime: smoothed[i].time,
        avgEnergy: energySum / count,
        label: currentLabel,
      });
      sectionStart = smoothed[i].time;
      currentLabel = label;
      energySum = smoothed[i].energy;
      count = 1;
    } else {
      energySum += smoothed[i].energy;
      count++;
    }
  }

  // Final section
  const lastTime = smoothed[smoothed.length - 1].time;
  sections.push({
    startTime: sectionStart,
    endTime: lastTime,
    avgEnergy: energySum / count,
    label: currentLabel,
  });

  // Merge very short sections (< 1 bar) into neighbors
  const merged: MusicAnalysis['detectedSections'] = [];
  for (const section of sections) {
    const dur = section.endTime - section.startTime;
    if (dur < barDuration && merged.length > 0) {
      // Extend the previous section
      merged[merged.length - 1].endTime = section.endTime;
    } else {
      merged.push({ ...section });
    }
  }

  // Label transitions: if energy increases between sections, label the higher one as 'building' -> 'peak'
  for (let i = 1; i < merged.length; i++) {
    const prev = merged[i - 1];
    const curr = merged[i];
    if (curr.avgEnergy > prev.avgEnergy && curr.label !== 'peak') {
      curr.label = 'building';
    } else if (curr.avgEnergy < prev.avgEnergy && prev.label === 'peak') {
      curr.label = 'resolving';
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Main analysis function
// ---------------------------------------------------------------------------

/**
 * Analyze a generated music track.
 *
 * Since we requested music at a specific BPM, we use that as the basis for
 * the beat grid. We phase-align the grid to the audio's first strong onset
 * (Suno usually starts on beat 1, but there may be a tiny offset).
 */
export async function analyzeMusic(
  filePath: string,
  expectedBPM: number,
  beatsPerBar: number = 4
): Promise<MusicAnalysis> {
  logger.info(`Analyzing music: ${filePath}, expected ${expectedBPM} BPM`);

  // 1. Get duration
  const totalDuration = await ffmpegService.getAudioDuration(filePath);

  // 2. Extract energy curve
  const energyCurve = await extractEnergyCurve(filePath, 100);

  // 3. Find first onset for phase alignment
  const firstOnset = findFirstOnset(energyCurve, 0.15);
  // Snap phase offset to the nearest 16th note for precision
  const sixteenthNote = 60 / expectedBPM / 4;
  const phaseOffset = Math.round(firstOnset / sixteenthNote) * sixteenthNote;

  // 4. Build beat grid from known BPM + phase offset
  const beatDuration = 60 / expectedBPM;
  const barDuration = beatDuration * beatsPerBar;
  const beatPositions: number[] = [];
  const downbeatPositions: number[] = [];

  let beatTime = phaseOffset;
  let beatCount = 0;
  while (beatTime <= totalDuration + beatDuration) {
    beatPositions.push(beatTime);
    if (beatCount % beatsPerBar === 0) {
      downbeatPositions.push(beatTime);
    }
    beatTime += beatDuration;
    beatCount++;
  }

  // 5. Detect sections from energy
  const detectedSections = detectSections(energyCurve, barDuration);

  logger.info('Music analysis complete', {
    totalDuration: totalDuration.toFixed(1),
    beats: beatPositions.length,
    bars: downbeatPositions.length,
    sections: detectedSections.length,
    phaseOffset: phaseOffset.toFixed(3),
  });

  return {
    detectedBPM: expectedBPM,
    beatPositions,
    downbeatPositions,
    energyCurve,
    totalDuration,
    phaseOffset,
    detectedSections,
  };
}

export default { analyzeMusic };
