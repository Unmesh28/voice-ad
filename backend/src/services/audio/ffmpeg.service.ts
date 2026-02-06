import ffmpeg from 'fluent-ffmpeg';
import { logger } from '../../config/logger';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import type { AudioLayer, MultiLayerMixOptions, MasteringOptions } from '../../types/audio.types';

const unlinkAsync = promisify(fs.unlink);

/** Fade curve: linear (tri), exp, qsin – maps to FFmpeg afade curve param */
export type FadeCurveType = 'linear' | 'exp' | 'qsin';

interface AudioInput {
  filePath: string;
  volume?: number; // 0-1
  delay?: number; // seconds
  fadeIn?: number; // seconds
  fadeOut?: number; // seconds
  fadeCurve?: FadeCurveType;
}

interface MixOptions {
  voiceInput?: AudioInput;
  musicInput?: AudioInput;
  outputPath: string;
  outputFormat?: 'mp3' | 'wav' | 'aac';
  /** Lower music volume when voice plays (sidechain ducking) */
  audioDucking?: boolean;
  /** How much to duck music 0–1 (maps to compressor ratio); from preset or LLM defaults */
  duckingAmount?: number;
  /** Legacy: simple volume boost. Prefer normalizeLoudness for broadcast-style output. */
  normalize?: boolean;
  /** Fade curve for head/tail fades (from LLM or defaults) */
  fadeCurve?: FadeCurveType;
  /** EBU R128 loudness normalization (e.g. -24 LUFS) */
  normalizeLoudness?: boolean;
  /** Target LUFS when normalizeLoudness is true (default -24) */
  loudnessTargetLUFS?: number;
  /** True peak in dB (e.g. -2 for cross-platform). Used in loudnorm TP= (default -2). */
  loudnessTruePeak?: number;
}

class FFmpegService {
  /**
   * Mix voice and music audio files
   */
  async mixAudio(options: MixOptions): Promise<string> {
    const {
      voiceInput,
      musicInput,
      outputPath,
      outputFormat = 'mp3',
      audioDucking = true,
      duckingAmount = 0.35,
      normalize = true,
      fadeCurve,
      normalizeLoudness = false,
      loudnessTargetLUFS = -24,
      loudnessTruePeak = -2,
    } = options;

    try {
      logger.info('Starting audio mixing with FFmpeg', {
        hasVoice: !!voiceInput,
        hasMusic: !!musicInput,
        outputFormat,
        audioDucking,
        normalizeLoudness,
      });

      // If only voice, just copy/convert
      if (voiceInput && !musicInput) {
        return await this.processAudio(voiceInput, outputPath, outputFormat);
      }

      // If only music, just copy/convert
      if (musicInput && !voiceInput) {
        return await this.processAudio(musicInput, outputPath, outputFormat);
      }

      // Mix voice and music
      if (voiceInput && musicInput) {
        return await this.mixVoiceAndMusic({
          voiceInput,
          musicInput,
          outputPath,
          outputFormat,
          audioDucking,
          duckingAmount,
          normalize,
          fadeCurve: fadeCurve ?? voiceInput.fadeCurve,
          normalizeLoudness,
          loudnessTargetLUFS,
          loudnessTruePeak,
        });
      }

      throw new Error('No audio inputs provided');
    } catch (error: any) {
      logger.error('Error mixing audio:', error.message);
      throw error;
    }
  }

  /**
   * Map our fade curve names to FFmpeg afade curve parameter (tri | exp | qsin)
   */
  private fadeCurveToFFmpeg(curve: FadeCurveType | undefined): string {
    if (!curve || curve === 'linear') return 'tri';
    return curve;
  }

  /**
   * Mix voice and music with volume-based ducking (music quieter under voice), fades, and optional loudness normalization.
   * Uses amix only (no sidechaincompress) for maximum compatibility across FFmpeg builds.
   */
  private async mixVoiceAndMusic(opts: {
    voiceInput: AudioInput;
    musicInput: AudioInput;
    outputPath: string;
    outputFormat: string;
    audioDucking: boolean;
    duckingAmount: number;
    normalize: boolean;
    fadeCurve?: FadeCurveType;
    normalizeLoudness: boolean;
    loudnessTargetLUFS: number;
    loudnessTruePeak: number;
  }): Promise<string> {
    const {
      voiceInput,
      musicInput,
      outputPath,
      outputFormat,
      audioDucking,
      duckingAmount,
      normalize,
      fadeCurve,
      normalizeLoudness,
      loudnessTargetLUFS,
      loudnessTruePeak,
    } = opts;

    return new Promise(async (resolve, reject) => {
      try {
        const command = ffmpeg();
        command.input(voiceInput.filePath);
        command.input(musicInput.filePath);

        const voiceDuration = await this.getAudioDuration(voiceInput.filePath);
        const voiceVol = voiceInput.volume !== undefined ? voiceInput.volume : 1.0;
        // When ducking: lower music level so voice stands out; otherwise use optional music volume or default 0.2
        const baseMusicVol = musicInput.volume !== undefined ? musicInput.volume : 0.2;
        const musicVolume = audioDucking
          ? Math.max(0.05, baseMusicVol * (1 - duckingAmount * 0.6))
          : baseMusicVol;

        // Voice delay: when blueprint alignment says voice should enter on a
        // downbeat, we pad silence before the voice so it starts at the right
        // musical moment. The delay is in seconds on the voice stream.
        const voiceDelaySec = voiceInput.delay ?? 0;

        // Single, compatible filter chain: normalize both to same format and sample rate for proper sync, then mix.
        // Same sample rate (44100) and stereo ensures music and speech stay sample-aligned with no drift.
        const END_PADDING = 0.08;
        const mixDuration = voiceDuration + voiceDelaySec + END_PADDING;
        const SAMPLE_RATE = 44100;
        const normalizeSync = `aformat=channel_layouts=stereo,aresample=${SAMPLE_RATE}`;

        // If voice has a delay, pad it with silence so it enters on the right beat
        const voiceFilter = voiceDelaySec > 0
          ? `[0:a]${normalizeSync},volume=${voiceVol},adelay=${Math.round(voiceDelaySec * 1000)}|${Math.round(voiceDelaySec * 1000)}[v]`
          : `[0:a]${normalizeSync},volume=${voiceVol}[v]`;

        const filters: string[] = [
          voiceFilter,
          `[1:a]${normalizeSync},volume=${musicVolume}[m]`,
          `[v][m]amix=inputs=2:duration=longest:dropout_transition=2[mixraw]`,
          `[mixraw]atrim=0:${mixDuration},asetpts=PTS-STARTPTS[mixed]`,
        ];

        // Production fades: short fade-in; longer, gentle fade-out so the end never feels cut off (use linear curve for smoother tail).
        const MAX_FADE_IN = 0.12;
        const MAX_FADE_OUT = 0.6;
        const rawFadeIn = voiceInput.fadeIn ?? 0.08;
        const rawFadeOut = voiceInput.fadeOut ?? 0.4;
        const fadeIn = Math.max(0.02, Math.min(MAX_FADE_IN, rawFadeIn));
        const fadeOut = Math.max(0.1, Math.min(MAX_FADE_OUT, rawFadeOut));
        const fadeOutStart = Math.max(0, mixDuration - fadeOut);
        const curveParam = this.fadeCurveToFFmpeg(fadeCurve);
        // Use linear (tri) for fade-out so the tail doesn't drop too fast; keeps end smooth
        const fadeOutCurve = 'tri';

        logger.info('Applying audio fades:', {
          fadeIn: `${fadeIn}s`,
          fadeOut: `${fadeOut}s`,
          fadeOutStart: `${fadeOutStart}s`,
          curve: curveParam,
          mixDuration: `${mixDuration}s`,
        });

        const fadeInFilter = `afade=t=in:st=0:d=${fadeIn}:curve=${curveParam}`;
        const fadeOutFilter = `afade=t=out:st=${fadeOutStart}:d=${fadeOut}:curve=${fadeOutCurve}`;
        filters.push(`[mixed]${fadeInFilter},${fadeOutFilter}[faded]`);

        if (normalizeLoudness) {
          const target = Math.max(-60, Math.min(0, loudnessTargetLUFS));
          const tp = Math.max(-10, Math.min(0, loudnessTruePeak));
          filters.push(`[faded]loudnorm=I=${target}:TP=${tp}:LRA=11.0[out]`);
        } else if (normalize) {
          filters.push('[faded]volume=1.5[out]');
        } else {
          filters.push('[faded]anull[out]');
        }

        const filterStr = filters.join(';');
        command.complexFilter(filterStr, 'out');
        this.setOutputOptions(command, outputFormat);
        command.output(outputPath);

        command
          .on('start', (commandLine: string) => {
            logger.info('FFmpeg command started');
            logger.debug('FFmpeg filter_complex: %s', filterStr);
            logger.debug('FFmpeg command (first 500 chars): %s', commandLine.substring(0, 500));
          })
          .on('progress', (progress: any) => {
            if (progress.percent) logger.debug('FFmpeg progress:', Math.round(progress.percent) + '%');
          })
          .on('end', () => {
            logger.info('Audio mixing completed:', outputPath);
            resolve(outputPath);
          })
          .on('error', (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('FFmpeg error: %s', msg);
            reject(new Error(`FFmpeg processing failed: ${msg}`));
          });

        command.run();
      } catch (error: any) {
        reject(error);
      }
    });
  }

  /**
   * Process single audio file (convert, apply effects, add fades)
   */
  private async processAudio(
    input: AudioInput,
    outputPath: string,
    outputFormat: string
  ): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        const command = ffmpeg(input.filePath);

        // Get duration for fade out calculation
        const audioDuration = await this.getAudioDuration(input.filePath);

        // Build filter
        const filters: string[] = [];

        // Apply volume
        if (input.volume !== undefined && input.volume !== 1) {
          filters.push(`volume=${input.volume}`);
        }

        const curveParam = this.fadeCurveToFFmpeg(input.fadeCurve);
        const fadeIn = input.fadeIn ?? 0.1;
        const fadeOut = input.fadeOut ?? 0.1;
        const fadeOutStart = Math.max(0, audioDuration - fadeOut);
        filters.push(`afade=t=in:st=0:d=${fadeIn}:curve=${curveParam}`);
        filters.push(`afade=t=out:st=${fadeOutStart}:d=${fadeOut}:curve=${curveParam}`);

        logger.info('Processing single audio with fades:', {
          fadeIn: `${fadeIn}s`,
          fadeOut: `${fadeOut}s`,
          duration: `${audioDuration}s`,
        });

        // Apply filters if any
        if (filters.length > 0) {
          command.audioFilters(filters);
        }

        // Set output options
        this.setOutputOptions(command, outputFormat);

        // Set output
        command.output(outputPath);

        // Handle events
        command
          .on('end', () => {
            logger.info('Audio processing completed:', outputPath);
            resolve(outputPath);
          })
          .on('error', (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('FFmpeg error: %s', msg);
            reject(new Error(`FFmpeg processing failed: ${msg}`));
          });

        // Run
        command.run();
      } catch (error: any) {
        reject(error);
        return;
      }
    });
  }

  /**
   * Set output options based on format
   */
  private setOutputOptions(command: ffmpeg.FfmpegCommand, format: string) {
    switch (format) {
      case 'mp3':
        command
          .audioCodec('libmp3lame')
          .audioBitrate('192k')
          .audioChannels(2)
          .audioFrequency(44100);
        break;
      case 'wav':
        command
          .audioCodec('pcm_s16le')
          .audioChannels(2)
          .audioFrequency(44100);
        break;
      case 'aac':
        command
          .audioCodec('aac')
          .audioBitrate('192k')
          .audioChannels(2)
          .audioFrequency(44100);
        break;
      default:
        command
          .audioCodec('libmp3lame')
          .audioBitrate('192k');
    }
  }

  /**
   * Get audio duration in seconds
   */
  async getAudioDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(err);
        } else {
          resolve(metadata.format.duration || 0);
        }
      });
    });
  }

  /**
   * Trim audio to an exact duration (cut at a specific point, no tempo change).
   * Used for bar-aligned trimming where we cut on a bar boundary.
   */
  async trimAudio(
    inputPath: string,
    targetDuration: number,
    outputPath: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        logger.info(`Trimming audio to ${targetDuration.toFixed(2)}s (bar-aligned cut)`);

        const command = ffmpeg(inputPath)
          .setDuration(targetDuration);

        this.setOutputOptions(command, 'mp3');
        command.output(outputPath);

        command
          .on('end', () => {
            logger.info('Audio trim completed:', outputPath);
            resolve(outputPath);
          })
          .on('error', (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('FFmpeg trim error:', msg);
            reject(new Error(`Failed to trim audio: ${msg}`));
          });

        command.run();
      } catch (error: any) {
        reject(error);
      }
    });
  }

  /**
   * Time-stretch audio to an exact target duration (so music and voice timelines match).
   * Uses atempo = currentDuration/targetDuration. Use when music is longer than voice.
   */
  async stretchAudioToDuration(
    inputPath: string,
    targetDuration: number,
    outputPath: string
  ): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        const currentDuration = await this.getAudioDuration(inputPath);
        if (currentDuration <= 0) {
          reject(new Error('Invalid or zero duration for stretch'));
          return;
        }
        const atempo = currentDuration / targetDuration;
        // atempo valid range typically 0.5–100
        const safeTempo = Math.max(0.5, Math.min(100, atempo));

        logger.info(`Stretching audio from ${currentDuration}s to ${targetDuration}s (atempo=${safeTempo.toFixed(3)})`);

        const command = ffmpeg(inputPath).audioFilters([`atempo=${safeTempo}`]);
        this.setOutputOptions(command, 'mp3');
        command.output(outputPath);

        command
          .on('end', () => {
            logger.info('Audio stretch completed:', outputPath);
            resolve(outputPath);
          })
          .on('error', (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('FFmpeg stretch error:', msg);
            reject(new Error(`Failed to stretch audio: ${msg}`));
          });

        command.run();
      } catch (error: any) {
        reject(error);
      }
    });
  }

  /**
   * Concatenate multiple audio files in order (for composer-style arc: intro + product intro + CTA).
   */
  async concatAudioFiles(inputPaths: string[], outputPath: string): Promise<string> {
    if (inputPaths.length === 0) throw new Error('concatAudioFiles requires at least one input');
    if (inputPaths.length === 1) {
      return this.processAudio({ filePath: inputPaths[0] }, outputPath, 'mp3');
    }

    return new Promise((resolve, reject) => {
      try {
        const listPath = path.join(path.dirname(outputPath), `concat_list_${Date.now()}.txt`);
        const listContent = inputPaths
          .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
          .join('\n');
        fs.writeFileSync(listPath, listContent, 'utf8');

        const command = ffmpeg()
          .input(listPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions(['-c', 'copy'])
          .output(outputPath);

        command
          .on('end', () => {
            try {
              fs.unlinkSync(listPath);
            } catch (_) { }
            logger.info('Audio concat completed:', outputPath);
            resolve(outputPath);
          })
          .on('error', (err: unknown) => {
            try {
              fs.unlinkSync(listPath);
            } catch (_) { }
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('FFmpeg concat error:', msg);
            reject(new Error(`Failed to concat audio: ${msg}`));
          });

        command.run();
      } catch (error: any) {
        reject(error);
      }
    });
  }

  /**
   * Concatenate multiple audio segments with smooth crossfades between them.
   * Each segment fades out at its end while the next segment fades in (overlap).
   * @param segments Array of objects with `filePath`, optional `duration`, and optional `crossfadeDuration` per segment
   * @param crossfadeDuration Default crossfade duration in seconds (default 0.5s, used when segment doesn't specify)
   * @param outputPath Output path for the final combined audio
   * @returns Path to the output file
   */
  async crossfadeAudioSegments(
    segments: { filePath: string; duration?: number; crossfadeDuration?: number }[],
    crossfadeDuration: number = 0.5,
    outputPath: string
  ): Promise<string> {
    if (segments.length === 0) throw new Error('crossfadeAudioSegments requires at least one segment');
    if (segments.length === 1) {
      return this.processAudio({ filePath: segments[0].filePath }, outputPath, 'mp3');
    }

    return new Promise(async (resolve, reject) => {
      try {
        logger.info(`Crossfading ${segments.length} audio segments (crossfade: ${crossfadeDuration}s)`);

        // Get durations for all segments
        const segmentsWithDurations = await Promise.all(
          segments.map(async (seg) => ({
            filePath: seg.filePath,
            duration: seg.duration ?? (await this.getAudioDuration(seg.filePath)),
            crossfadeDuration: seg.crossfadeDuration,
          }))
        );

        // Build filter complex for crossfading
        // Strategy: chain acrossfade filters, each takes 2 inputs and outputs 1
        const command = ffmpeg();
        segmentsWithDurations.forEach((seg) => command.input(seg.filePath));

        const SAMPLE_RATE = 44100;
        const normalizeSync = `aformat=channel_layouts=stereo,aresample=${SAMPLE_RATE}`;
        const filters: string[] = [];

        // Normalize all inputs first
        segmentsWithDurations.forEach((seg, i) => {
          filters.push(`[${i}:a]${normalizeSync}[a${i}]`);
        });

        // Chain crossfades: [a0][a1] -> [cf0], [cf0][a2] -> [cf1], ...
        let currentLabel = 'a0';
        for (let i = 1; i < segmentsWithDurations.length; i++) {
          const nextLabel = `a${i}`;
          const outputLabel = i === segmentsWithDurations.length - 1 ? 'out' : `cf${i - 1}`;

          // Use per-segment crossfade duration if provided, otherwise use default
          const segmentCrossfade = segmentsWithDurations[i - 1].crossfadeDuration ?? crossfadeDuration;

          // acrossfade requires knowing when the fade should start (at end of first input)
          const d1 = segmentsWithDurations[i - 1].duration;
          const fadeStart = Math.max(0, d1 - segmentCrossfade);

          // Use exponential curves for more natural music fading
          // c1=exp (exponential fade out), c2=log (logarithmic fade in)
          filters.push(
            `[${currentLabel}][${nextLabel}]acrossfade=d=${segmentCrossfade}:c1=exp:c2=log[${outputLabel}]`
          );

          currentLabel = outputLabel;
        }

        const filterStr = filters.join(';');
        command.outputOptions(['-filter_complex', filterStr, '-map', '[out]']);
        this.setOutputOptions(command, 'mp3');
        command.output(outputPath);

        command
          .on('start', (commandLine) => {
            logger.info('Crossfading audio segments with FFmpeg');
            logger.debug('FFmpeg crossfade filter:', filterStr);
          })
          .on('end', () => {
            logger.info('Audio crossfade completed:', outputPath);
            resolve(outputPath);
          })
          .on('error', (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('FFmpeg crossfade error:', msg);
            reject(new Error(`Failed to crossfade audio segments: ${msg}`));
          });

        command.run();
      } catch (error: any) {
        reject(error);
      }
    });
  }

  /**
   * Extend audio file to match target duration by looping
   */
  async extendAudioDuration(
    inputPath: string,
    targetDuration: number,
    outputPath: string
  ): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        // Get current duration
        const currentDuration = await this.getAudioDuration(inputPath);

        // If already long enough, just copy
        if (currentDuration >= targetDuration) {
          logger.info('Audio already meets target duration, copying file');
          return await this.processAudio(
            { filePath: inputPath },
            outputPath,
            'mp3'
          ).then(resolve).catch(reject);
        }

        // Calculate how many times to loop
        const loopCount = Math.ceil(targetDuration / currentDuration);

        logger.info(`Extending audio from ${currentDuration}s to ${targetDuration}s (looping ${loopCount} times)`);

        // Use FFmpeg to loop the audio
        const command = ffmpeg();

        // Add input with loop option
        command.input(inputPath);

        // Create filter to loop and trim to exact duration
        const filters = [
          `aloop=loop=${loopCount - 1}:size=44100*${Math.ceil(currentDuration)}`,
          `atrim=0:${targetDuration}`,
          'asetpts=PTS-STARTPTS'
        ];

        command.audioFilters(filters);

        // Set output options
        this.setOutputOptions(command, 'mp3');

        // Set output
        command.output(outputPath);

        // Handle events
        command
          .on('start', (commandLine) => {
            logger.info('Extending audio duration with FFmpeg');
            logger.debug('FFmpeg extend command:', commandLine.substring(0, 200));
          })
          .on('end', () => {
            logger.info('Audio extension completed:', outputPath);
            resolve(outputPath);
          })
          .on('error', (err) => {
            logger.error('FFmpeg extend error:', err.message);
            reject(new Error(`Failed to extend audio: ${err.message}`));
          });

        // Run
        command.run();
      } catch (error: any) {
        reject(error);
      }
    });
  }

  /**
   * Apply a time-based volume curve (e.g. sentence-by-sentence music level).
   * Uses a single volume expression with smooth ramps at boundaries so the music
   * never cuts or pops at sentence boundaries.
   */
  async applyVolumeCurve(
    inputPath: string,
    curve: { startSeconds: number; endSeconds: number; volumeMultiplier: number }[],
    totalDuration: number,
    outputPath: string
  ): Promise<string> {
    if (!curve.length) {
      return this.processAudio({ filePath: inputPath }, outputPath, 'mp3');
    }

    const sorted = [...curve].sort((a, b) => a.startSeconds - b.startSeconds);
    const segments: { start: number; end: number; mult: number }[] = [];
    let pos = 0;

    for (const seg of sorted) {
      const start = Math.max(0, seg.startSeconds);
      const end = Math.min(totalDuration, seg.endSeconds);
      if (start > pos) {
        segments.push({ start: pos, end: start, mult: 1 });
      }
      if (end > start) {
        segments.push({ start, end, mult: Math.max(0.1, Math.min(3, seg.volumeMultiplier ?? 1)) });
      }
      pos = Math.max(pos, end);
    }
    if (pos < totalDuration) {
      segments.push({ start: pos, end: totalDuration, mult: 1 });
    }

    if (segments.length === 0) {
      return this.processAudio({ filePath: inputPath }, outputPath, 'mp3');
    }
    if (segments.length === 1 && segments[0].mult === 1) {
      return this.processAudio({ filePath: inputPath }, outputPath, 'mp3');
    }

    // Ramp duration at each boundary (smooth transition, no hard cuts)
    const RAMP = 0.08;
    const volumeExpr = this.buildSmoothVolumeExpression(segments, totalDuration, RAMP);

    return new Promise((resolve, reject) => {
      try {
        const command = ffmpeg(inputPath);
        const SAMPLE_RATE = 44100;
        const normalizeSync = `aformat=channel_layouts=stereo,aresample=${SAMPLE_RATE}`;
        // Single stream + time-based volume with smooth ramps; eval=frame so t updates per frame
        const filterStr = `[0:a]${normalizeSync},volume=volume='${volumeExpr}':eval=frame[out]`;
        command.outputOptions(['-filter_complex', filterStr, '-map', '[out]']);
        command.output(outputPath);

        command
          .on('end', () => {
            logger.info('Volume curve applied (smooth ramps):', outputPath);
            resolve(outputPath);
          })
          .on('error', (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('FFmpeg applyVolumeCurve error:', msg);
            reject(new Error(`Failed to apply volume curve: ${msg}`));
          });
        command.run();
      } catch (error: any) {
        reject(error);
      }
    });
  }

  /**
   * Build FFmpeg volume expression: piecewise constant with linear ramps at boundaries.
   * Non-overlapping intervals so one condition wins; avoids hard cuts at sentence boundaries.
   */
  private buildSmoothVolumeExpression(
    segments: { start: number; end: number; mult: number }[],
    _totalDuration: number,
    rampSec: number
  ): string {
    const terms: string[] = []; // each: if(between(t,a,b), value, ...)

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const prevMult = i > 0 ? segments[i - 1].mult : seg.mult;
      const nextMult = i < segments.length - 1 ? segments[i + 1].mult : seg.mult;
      const start = seg.start;
      const end = seg.end;

      // Ramp in: [start, start+ramp] from prevMult to seg.mult (only if segment long enough and mult differs)
      const rampInEnd = Math.min(start + rampSec, end - rampSec * 0.5);
      if (rampInEnd > start && prevMult !== seg.mult) {
        const a = start;
        const b = rampInEnd;
        const val = `${prevMult}+(${seg.mult}-${prevMult})*((t-${a})/${rampSec})`;
        terms.push(`if(between(t,${a},${b}),${val},`);
      }

      // Constant: [start+ramp, end-ramp] or [start, end-ramp] if no ramp in
      const midStart = rampInEnd > start ? rampInEnd : start;
      const midEnd = Math.max(midStart, end - rampSec);
      if (midEnd > midStart) {
        terms.push(`if(between(t,${midStart},${midEnd}),${seg.mult},`);
      }

      // Ramp out: [end-ramp, end] from seg.mult to nextMult
      const rampOutStart = Math.max(midEnd, end - rampSec);
      if (end > rampOutStart && seg.mult !== nextMult) {
        const a = rampOutStart;
        const val = `${seg.mult}+(${nextMult}-${seg.mult})*((t-${a})/${rampSec})`;
        terms.push(`if(between(t,${a},${end}),${val},`);
      } else if (end > rampOutStart) {
        terms.push(`if(between(t,${rampOutStart},${end}),${seg.mult},`);
      }
    }

    // Default 1.0 and close all parens
    let expr = '1';
    for (let i = terms.length - 1; i >= 0; i--) {
      expr = terms[i] + expr + ')';
    }
    return expr;
  }

  /**
   * Mix multiple audio layers with professional processing (EQ, volume, compression, fades, loudness).
   */
  async mixMultipleAudioLayers(options: MultiLayerMixOptions): Promise<string> {
    const {
      layers,
      outputPath,
      fadeIn = 0.5,
      fadeOut = 1.0,
      normalize = true,
      targetLoudness = -16,
      compress = true,
    } = options;

    if (layers.length === 0) throw new Error('mixMultipleAudioLayers requires at least one layer');

    const SAMPLE_RATE = 44100;
    const normalizeSync = `aformat=channel_layouts=stereo,aresample=${SAMPLE_RATE}`;

    return new Promise(async (resolve, reject) => {
      try {
        logger.info(`Mixing ${layers.length} audio layers professionally`);

        const command = ffmpeg();
        layers.forEach((layer) => command.input(layer.filePath));

        const duration = await this.getAudioDuration(layers[0].filePath);
        const filterParts: string[] = [];

        layers.forEach((layer, index) => {
          const base = `[${index}:a]${normalizeSync}`;
          const eqAndVol = layer.eq ? `${base},${layer.eq},volume=${layer.volume}` : `${base},volume=${layer.volume}`;
          filterParts.push(`${eqAndVol}[${layer.label}]`);
        });

        const layerLabels = layers.map((l) => `[${l.label}]`).join('');
        filterParts.push(
          `${layerLabels}amix=inputs=${layers.length}:duration=longest:dropout_transition=2[mixed]`
        );

        if (compress) {
          filterParts.push(
            `[mixed]acompressor=threshold=-18dB:ratio=3:attack=10:release=150[compressed]`
          );
          filterParts.push(`[compressed]alimiter=limit=-1dB:release=50[limited]`);
        } else {
          filterParts.push(`[mixed]anull[limited]`);
        }

        const fadeOutStart = Math.max(0, duration - fadeOut);
        filterParts.push(
          `[limited]afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${fadeOutStart}:d=${fadeOut}[faded]`
        );

        if (normalize) {
          const target = Math.max(-60, Math.min(0, targetLoudness));
          filterParts.push(`[faded]loudnorm=I=${target}:TP=-2:LRA=7[out]`);
        } else {
          filterParts.push(`[faded]anull[out]`);
        }

        const filterStr = filterParts.join(';');
        command.outputOptions(['-filter_complex', filterStr, '-map', '[out]']);
        this.setOutputOptions(command, 'mp3');
        command.output(outputPath);

        command
          .on('end', () => {
            logger.info('Multi-layer mixing completed:', outputPath);
            resolve(outputPath);
          })
          .on('error', (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('FFmpeg mixMultipleAudioLayers error:', msg);
            reject(new Error(`Multi-layer mixing failed: ${msg}`));
          });
        command.run();
      } catch (error: any) {
        reject(error);
      }
    });
  }

  /**
   * Apply professional mastering chain (EQ, compression, limiter, loudness).
   */
  async applyMasteringChain(options: MasteringOptions): Promise<string> {
    const {
      inputPath,
      outputPath,
      targetLoudness = -16,
      eq = {},
      compression = {},
      limiter = {},
      stereoWidth,
    } = options;

    return new Promise((resolve, reject) => {
      try {
        logger.info('Applying professional mastering chain');

        const command = ffmpeg(inputPath);
        const filters: string[] = [];

        if (eq.lowCut) {
          filters.push(`highpass=f=${eq.lowCut}`);
        }
        if (eq.highCut) {
          filters.push(`lowpass=f=${eq.highCut}`);
        }
        if (eq.midScoop) {
          const { freq, q, gain } = eq.midScoop;
          filters.push(`equalizer=f=${freq}:width_type=q:width=${q}:g=${gain}`);
        }
        if (compression.threshold != null) {
          const t = compression.threshold;
          const r = compression.ratio ?? 3;
          const a = compression.attack ?? 10;
          const rel = compression.release ?? 150;
          filters.push(`acompressor=threshold=${t}dB:ratio=${r}:attack=${a}:release=${rel}`);
        }
        if (stereoWidth != null && stereoWidth !== 100) {
          const mlev = Math.max(0, Math.min(1, stereoWidth / 100));
          filters.push(`stereotools=mlev=${mlev}`);
        }
        if (limiter.threshold != null) {
          const limit = limiter.threshold;
          const rel = limiter.release ?? 50;
          filters.push(`alimiter=limit=${limit}dB:release=${rel}`);
        }
        const target = Math.max(-60, Math.min(0, targetLoudness));
        filters.push(`loudnorm=I=${target}:TP=-2:LRA=7`);

        if (filters.length > 0) {
          command.audioFilters(filters);
        }
        this.setOutputOptions(command, 'mp3');
        command.output(outputPath);

        command
          .on('end', () => {
            logger.info('Mastering completed:', outputPath);
            resolve(outputPath);
          })
          .on('error', (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('FFmpeg applyMasteringChain error:', msg);
            reject(new Error(`Mastering failed: ${msg}`));
          });
        command.run();
      } catch (error: any) {
        reject(error);
      }
    });
  }

  /**
   * Get audio metadata
   */
  async getAudioMetadata(filePath: string): Promise<any> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(err);
        } else {
          resolve({
            duration: metadata.format.duration,
            bitrate: metadata.format.bit_rate,
            format: metadata.format.format_name,
            codec: metadata.streams[0]?.codec_name,
            channels: metadata.streams[0]?.channels,
            sampleRate: metadata.streams[0]?.sample_rate,
          });
        }
      });
    });
  }

  /**
   * Validate audio file
   */
  async validateAudioFile(filePath: string): Promise<boolean> {
    try {
      await this.getAudioMetadata(filePath);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Clean up temporary files
   */
  async cleanupFile(filePath: string): Promise<void> {
    try {
      if (fs.existsSync(filePath)) {
        await unlinkAsync(filePath);
        logger.info('Cleaned up file:', filePath);
      }
    } catch (error: any) {
      logger.error('Error cleaning up file:', error.message);
    }
  }
}

export default new FFmpegService();
