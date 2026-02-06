// ===========================================================================
// Music Quality Scoring Service
//
// Post-generation quality assessment for music tracks. Scores the generated
// music on multiple dimensions and returns a composite score (0–1).
// Used by the orchestrator to decide whether to accept or regenerate.
//
// Checks:
//   1. Duration match  — is the track close to requested duration?
//   2. Loudness range   — is the loudness appropriate for background music?
//   3. Silence ratio    — does the track have excessive silence?
//   4. Dynamic range    — does it have enough variation (not flat)?
// ===========================================================================

import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../config/logger';
import ffmpegService from '../audio/ffmpeg.service';

const execAsync = promisify(exec);

export interface MusicQualityInput {
  /** Path to the generated music file */
  musicPath: string;
  /** Requested duration in seconds */
  expectedDuration: number;
  /** Expected BPM (optional — used for tempo check) */
  expectedBPM?: number;
  /** Genre hint (affects loudness expectations) */
  genre?: string;
}

export interface MusicQualityResult {
  /** Composite score 0.0–1.0 (higher is better) */
  score: number;
  /** Per-dimension scores */
  dimensions: {
    durationMatch: number;
    loudnessRange: number;
    silenceRatio: number;
    dynamicRange: number;
    spectralBalance: number;
  };
  /** Raw measurements */
  measurements: {
    actualDuration: number;
    integratedLoudness: number;
    truePeak: number;
    loudnessRange: number;
    silenceSeconds: number;
    silencePercent: number;
    rmsVariation: number;
    spectralCentroid: number;
    lowEnergyRatio: number;
    highEnergyRatio: number;
  };
  /** Human-readable assessment */
  summary: string;
  /** Whether the track should be accepted */
  acceptable: boolean;
}

// Weights for each dimension in the composite score
// Spectral balance catches "muddy" or "thin" music that passes basic checks.
const WEIGHTS = {
  durationMatch: 0.25,
  loudnessRange: 0.18,
  silenceRatio: 0.22,
  dynamicRange: 0.20,
  spectralBalance: 0.15,
};

// Thresholds
const ACCEPT_THRESHOLD = 0.55;

class MusicQualityService {
  /**
   * Score a generated music track on multiple quality dimensions.
   * Returns a composite score (0–1) and per-dimension breakdown.
   */
  async scoreTrack(input: MusicQualityInput): Promise<MusicQualityResult> {
    const { musicPath, expectedDuration, genre } = input;

    logger.info('Scoring music quality', { musicPath, expectedDuration, genre });

    // Run all measurements in parallel
    const [loudnessData, silenceData, statsData, actualDuration, spectralData] = await Promise.all([
      this.measureLoudness(musicPath),
      this.detectSilence(musicPath),
      this.measureStats(musicPath),
      this.getDuration(musicPath),
      ffmpegService.measureSpectralBalance(musicPath),
    ]);

    // 1. Duration match score
    const durationRatio = actualDuration / expectedDuration;
    const durationMatch = this.scoreDurationMatch(durationRatio);

    // 2. Loudness range score
    const loudnessRange = this.scoreLoudness(loudnessData.integrated, loudnessData.lra, genre);

    // 3. Silence ratio score
    const silencePercent = actualDuration > 0 ? (silenceData.totalSilence / actualDuration) * 100 : 0;
    const silenceRatio = this.scoreSilence(silencePercent);

    // 4. Dynamic range score
    const dynamicRange = this.scoreDynamicRange(statsData.rmsVariation);

    // 5. Spectral balance score
    const spectralBalance = this.scoreSpectralBalance(
      spectralData.spectralCentroid,
      spectralData.lowEnergyRatio,
      spectralData.highEnergyRatio
    );

    // Composite score
    const score =
      WEIGHTS.durationMatch * durationMatch +
      WEIGHTS.loudnessRange * loudnessRange +
      WEIGHTS.silenceRatio * silenceRatio +
      WEIGHTS.dynamicRange * dynamicRange +
      WEIGHTS.spectralBalance * spectralBalance;

    const acceptable = score >= ACCEPT_THRESHOLD;

    const result: MusicQualityResult = {
      score: Math.round(score * 100) / 100,
      dimensions: {
        durationMatch: Math.round(durationMatch * 100) / 100,
        loudnessRange: Math.round(loudnessRange * 100) / 100,
        silenceRatio: Math.round(silenceRatio * 100) / 100,
        dynamicRange: Math.round(dynamicRange * 100) / 100,
        spectralBalance: Math.round(spectralBalance * 100) / 100,
      },
      measurements: {
        actualDuration,
        integratedLoudness: loudnessData.integrated,
        truePeak: loudnessData.truePeak,
        loudnessRange: loudnessData.lra,
        silenceSeconds: silenceData.totalSilence,
        silencePercent: Math.round(silencePercent * 10) / 10,
        rmsVariation: statsData.rmsVariation,
        spectralCentroid: Math.round(spectralData.spectralCentroid),
        lowEnergyRatio: Math.round(spectralData.lowEnergyRatio * 100) / 100,
        highEnergyRatio: Math.round(spectralData.highEnergyRatio * 100) / 100,
      },
      summary: this.buildSummary(score, { durationMatch, loudnessRange, silenceRatio, dynamicRange, spectralBalance }),
      acceptable,
    };

    logger.info('Music quality score', {
      score: result.score,
      acceptable,
      dimensions: result.dimensions,
      summary: result.summary,
    });

    return result;
  }

  // -------------------------------------------------------------------------
  // Dimension scorers
  // -------------------------------------------------------------------------

  /** Score duration match: 1.0 = perfect, drops off for shorter/longer tracks */
  private scoreDurationMatch(ratio: number): number {
    if (ratio >= 0.9 && ratio <= 1.15) return 1.0;       // Within 10% shorter or 15% longer
    if (ratio >= 0.7 && ratio <= 1.5) {
      // Linear dropoff
      if (ratio < 0.9) return 0.5 + (ratio - 0.7) * 2.5;  // 0.5 at 0.7, 1.0 at 0.9
      return 1.0 - (ratio - 1.15) * 1.43;                  // 1.0 at 1.15, 0.5 at 1.5
    }
    if (ratio < 0.5) return 0.0;
    if (ratio > 2.0) return 0.2;
    return 0.3;
  }

  /** Score loudness: background music should be -25 to -12 LUFS */
  private scoreLoudness(integrated: number, lra: number, genre?: string): number {
    // Ideal range for ad background music
    const idealMin = -25;
    const idealMax = -12;

    if (integrated >= idealMin && integrated <= idealMax) return 1.0;
    if (integrated < -35 || integrated > -5) return 0.2;  // Way out of range
    if (integrated < idealMin) {
      // Too quiet
      return 0.5 + (integrated - (-35)) / 20;
    }
    // Too loud
    return 0.5 + ((-5) - integrated) / 14;
  }

  /** Score silence: less silence = better (for background music) */
  private scoreSilence(silencePercent: number): number {
    if (silencePercent <= 5) return 1.0;      // <5% silence is fine
    if (silencePercent <= 15) return 0.8;      // 5-15% is acceptable
    if (silencePercent <= 30) return 0.5;      // 15-30% is concerning
    if (silencePercent <= 50) return 0.3;      // 30-50% is poor
    return 0.1;                                // >50% is unacceptable
  }

  /** Score dynamic range: some variation is good, too flat or too wild is bad */
  private scoreDynamicRange(rmsVariation: number): number {
    // rmsVariation is the coefficient of variation of per-frame RMS
    // Ideal: 0.1-0.5 (moderate dynamics)
    if (rmsVariation >= 0.1 && rmsVariation <= 0.5) return 1.0;
    if (rmsVariation < 0.05) return 0.4;       // Too flat/static
    if (rmsVariation < 0.1) return 0.7;        // Slightly flat
    if (rmsVariation <= 0.8) return 0.7;       // Slightly too dynamic
    return 0.4;                                 // Too erratic
  }

  /**
   * Score spectral balance: good ad background music should have:
   *   - Spectral centroid between 800–3500 Hz (not too bass-heavy, not too thin)
   *   - Low energy ratio (bass) between 0.15–0.45 (not boomy, not anemic)
   *   - Some high energy (brightness) but not dominated by it
   *
   * Bass-heavy music (centroid < 600Hz, low ratio > 0.5) sounds muddy under voice.
   * Thin music (centroid > 5000Hz, low ratio < 0.10) lacks warmth and body.
   */
  private scoreSpectralBalance(
    spectralCentroid: number,
    lowEnergyRatio: number,
    highEnergyRatio: number
  ): number {
    let score = 1.0;

    // Centroid scoring: ideal 800–3500 Hz for voice-support background music
    if (spectralCentroid < 500) score *= 0.4;         // Very bass-heavy, will be muddy
    else if (spectralCentroid < 800) score *= 0.7;    // Slightly bass-heavy
    else if (spectralCentroid > 5000) score *= 0.5;   // Very thin/bright
    else if (spectralCentroid > 3500) score *= 0.8;   // Slightly thin

    // Bass energy scoring: ideal 0.15–0.45
    if (lowEnergyRatio > 0.55) score *= 0.5;          // Too boomy
    else if (lowEnergyRatio > 0.45) score *= 0.75;    // Slightly boomy
    else if (lowEnergyRatio < 0.08) score *= 0.6;     // No bass warmth
    else if (lowEnergyRatio < 0.15) score *= 0.8;     // Light on bass

    // High energy scoring: a little brightness is good
    if (highEnergyRatio > 0.4) score *= 0.6;          // Harsh/sizzly
    else if (highEnergyRatio < 0.02) score *= 0.7;    // Too dull

    return Math.max(0.1, Math.min(1.0, score));
  }

  // -------------------------------------------------------------------------
  // FFmpeg measurements
  // -------------------------------------------------------------------------

  /** Measure integrated loudness, true peak, and loudness range via ebur128 */
  private async measureLoudness(
    filePath: string
  ): Promise<{ integrated: number; truePeak: number; lra: number }> {
    try {
      const { stderr } = await execAsync(
        `ffmpeg -i "${filePath}" -af "ebur128=peak=true" -f null - 2>&1`,
        { maxBuffer: 5 * 1024 * 1024, timeout: 30000 }
      );

      const integrated = this.extractFloat(stderr, /I:\s*(-?[\d.]+)\s*LUFS/i) ?? -16;
      const truePeak = this.extractFloat(stderr, /Peak:\s*(-?[\d.]+)\s*dBFS/i) ?? -2;
      const lra = this.extractFloat(stderr, /LRA:\s*([\d.]+)\s*LU/i) ?? 10;

      return { integrated, truePeak, lra };
    } catch (err: any) {
      logger.warn(`Loudness measurement failed: ${err.message}`);
      return { integrated: -16, truePeak: -2, lra: 10 };
    }
  }

  /** Detect total silence duration using silencedetect */
  private async detectSilence(
    filePath: string
  ): Promise<{ totalSilence: number; silenceSegments: number }> {
    try {
      const { stderr } = await execAsync(
        `ffmpeg -i "${filePath}" -af "silencedetect=noise=-40dB:d=0.5" -f null - 2>&1`,
        { maxBuffer: 5 * 1024 * 1024, timeout: 30000 }
      );

      // Parse silence_duration entries
      const durations = [...stderr.matchAll(/silence_duration:\s*([\d.]+)/g)];
      const totalSilence = durations.reduce((sum, m) => sum + parseFloat(m[1]), 0);

      return { totalSilence, silenceSegments: durations.length };
    } catch (err: any) {
      logger.warn(`Silence detection failed: ${err.message}`);
      return { totalSilence: 0, silenceSegments: 0 };
    }
  }

  /** Measure audio statistics (RMS variation) using astats */
  private async measureStats(
    filePath: string
  ): Promise<{ rmsVariation: number }> {
    try {
      const { stderr } = await execAsync(
        `ffmpeg -i "${filePath}" -af "astats=metadata=1:reset=1" -f null - 2>&1`,
        { maxBuffer: 10 * 1024 * 1024, timeout: 30000 }
      );

      // Extract RMS levels from astats output
      const rmsValues = [...stderr.matchAll(/RMS level dB:\s*(-?[\d.]+)/g)]
        .map((m) => parseFloat(m[1]))
        .filter((v) => isFinite(v) && v > -100);

      if (rmsValues.length < 2) {
        return { rmsVariation: 0.3 }; // Default moderate variation
      }

      const mean = rmsValues.reduce((a, b) => a + b, 0) / rmsValues.length;
      const variance = rmsValues.reduce((sum, v) => sum + (v - mean) ** 2, 0) / rmsValues.length;
      const stdDev = Math.sqrt(variance);
      const coeffOfVariation = mean !== 0 ? Math.abs(stdDev / mean) : 0;

      return { rmsVariation: Math.round(coeffOfVariation * 1000) / 1000 };
    } catch (err: any) {
      logger.warn(`Stats measurement failed: ${err.message}`);
      return { rmsVariation: 0.3 };
    }
  }

  /** Get audio duration in seconds */
  private async getDuration(filePath: string): Promise<number> {
    try {
      const { stdout } = await execAsync(
        `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`,
        { timeout: 10000 }
      );
      return parseFloat(stdout.trim()) || 0;
    } catch {
      return 0;
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private extractFloat(text: string, regex: RegExp): number | null {
    const match = regex.exec(text);
    return match ? parseFloat(match[1]) : null;
  }

  private buildSummary(
    score: number,
    dims: { durationMatch: number; loudnessRange: number; silenceRatio: number; dynamicRange: number; spectralBalance: number }
  ): string {
    const issues: string[] = [];
    if (dims.durationMatch < 0.6) issues.push('duration mismatch');
    if (dims.loudnessRange < 0.6) issues.push('loudness out of range');
    if (dims.silenceRatio < 0.6) issues.push('excessive silence');
    if (dims.dynamicRange < 0.6) issues.push('poor dynamics');
    if (dims.spectralBalance < 0.6) issues.push('poor spectral balance');

    if (score >= 0.8) return 'High quality track';
    if (score >= ACCEPT_THRESHOLD) return `Acceptable quality${issues.length ? ` (minor: ${issues.join(', ')})` : ''}`;
    return `Below threshold: ${issues.join(', ')}`;
  }
}

export default new MusicQualityService();
