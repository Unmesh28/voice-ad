import ffmpeg from 'fluent-ffmpeg';
import { logger } from '../../config/logger';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { AudioLayer, MultiLayerMixOptions, MasteringOptions } from '../../types/audio.types';

const unlinkAsync = promisify(fs.unlink);
const execAsync = promisify(exec);

/** Fade curve: linear (tri), exp, qsin, log – maps to FFmpeg afade curve param */
export type FadeCurveType = 'linear' | 'exp' | 'qsin' | 'log';

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
  /** Maximum output duration in seconds. If mix exceeds this, applies graceful fade-out and trim. */
  maxDuration?: number;
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
      maxDuration,
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
          maxDuration,
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
   * Professional radio-ad mixing: constant music bed under voice.
   *
   * Design principles (broadcast-standard):
   *  1. Music plays at a FIXED low bed level throughout — no sidechain pumping,
   *     no volume ramps. The level is set so music never competes with voice.
   *  2. Voice sits ~12-15 dB above music for clear intelligibility.
   *  3. Separation comes from level difference + EQ carving (done upstream),
   *     NOT from dynamic ducking.
   *  4. After voice ends, music continues for a short tail (1 s) with a smooth
   *     exponential fade-out.
   *  5. Final loudnorm pass brings the mix to broadcast target.
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
    maxDuration?: number;
  }): Promise<string> {
    const {
      voiceInput,
      musicInput,
      outputPath,
      outputFormat,
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

        // Music bed level — the level music sits at UNDER voice.
        // A multiplier of 0.15 ≈ -16.5 dB relative to voice at 1.0.
        const musicBedVol = musicInput.volume !== undefined ? musicInput.volume : 0.15;

        // Intro level — music plays louder before voice enters so it's clearly
        // audible. We cap it at 3× bed (~+10 dB) so it never overpowers.
        const musicIntroVol = Math.min(musicBedVol * 3, 0.45);

        // Voice delay: when blueprint alignment says voice should enter on a
        // downbeat, we pad silence before the voice so it starts at the right
        // musical moment. The delay is in seconds on the voice stream.
        const voiceDelaySec = voiceInput.delay ?? 0;

        // Get durations so we can compute mix length and detect music shortfall.
        const musicDuration = await this.getAudioDuration(musicInput.filePath);
        const voiceTotalDuration = voiceDuration + voiceDelaySec;

        // Warn if music is shorter than voice — music will pad with silence via apad.
        if (musicDuration < voiceTotalDuration) {
          logger.warn(`Music (${musicDuration.toFixed(1)}s) is shorter than voice+delay (${voiceTotalDuration.toFixed(1)}s) — music will be padded to cover full voiceover`);
        }

        // Mix duration: voice plays fully, then 1s music tail for clean ending.
        // If music is shorter than voice, we still keep voice full length + 1s tail.
        let mixDuration = voiceTotalDuration + 1.0;

        // Enforce maxDuration: trim the music tail to fit, but NEVER cut the voice.
        if (opts.maxDuration && opts.maxDuration > 0) {
          if (voiceTotalDuration > opts.maxDuration) {
            logger.warn(`Voice (${voiceTotalDuration.toFixed(1)}s) exceeds target duration (${opts.maxDuration}s) — keeping full voice, trimming music tail`);
            mixDuration = voiceTotalDuration + 1.0;
          } else {
            mixDuration = Math.min(mixDuration, opts.maxDuration);
          }
        }
        const SAMPLE_RATE = 48000;
        const normalizeSync = `aformat=channel_layouts=stereo,aresample=${SAMPLE_RATE}`;

        // ── Voice chain ──────────────────────────────────────────────
        // normalize → set volume → optional delay → gentle compression
        // Compression evens out TTS level variations so voice stays
        // consistently above the music bed.
        const voiceBase = voiceDelaySec > 0
          ? `[0:a]${normalizeSync},volume=${voiceVol},adelay=${Math.round(voiceDelaySec * 1000)}|${Math.round(voiceDelaySec * 1000)}`
          : `[0:a]${normalizeSync},volume=${voiceVol}`;

        const filters: string[] = [
          // No compression at mix stage — raw voice levels are preserved here.
          // Compression is applied AFTER mixing, in applyMasteringChain(),
          // which compresses the combined voice+music together for a cohesive sound.
          `${voiceBase}[vmix]`,
        ];

        // ── Music chain ─────────────────────────────────────────────
        // Music volume strategy:
        //  • Before voice entry: play at musicIntroVol (louder, clearly audible)
        //  • At the EXACT moment voice enters (voiceDelaySec): start a smooth
        //    ramp DOWN to musicBedVol over 0.5s — synchronized with voice entry
        //  • During voice: hold at musicBedVol (constant bed, no pumping)
        //  • The ramp is simultaneous with voice, not before it.
        const musicPad = musicDuration < mixDuration
          ? `,apad=whole_dur=${Math.ceil(mixDuration)}`
          : '';

        // Build volume expression for the intro→bed transition
        let musicVolumeFilter: string;
        const rampDuration = 0.5; // seconds for smooth transition

        if (voiceDelaySec > 0.1) {
          // Voice has an intro delay: ramp from introVol → bedVol starting at voiceDelaySec
          const rampStart = voiceDelaySec.toFixed(3);
          const rampEnd = (voiceDelaySec + rampDuration).toFixed(3);
          const introV = musicIntroVol.toFixed(4);
          const bedV = musicBedVol.toFixed(4);
          // Before rampStart: introVol
          // rampStart → rampEnd: linear interpolation from introVol to bedVol
          // After rampEnd: bedVol
          musicVolumeFilter = `volume='if(lt(t,${rampStart}),${introV},if(lt(t,${rampEnd}),${introV}-(${introV}-${bedV})*(t-${rampStart})/${rampDuration},${bedV}))':eval=frame`;
        } else {
          // No intro delay — voice starts immediately, music goes straight to bed level
          musicVolumeFilter = `volume=${musicBedVol}`;
        }

        filters.push(
          `[1:a]${normalizeSync},${musicVolumeFilter}${musicPad}[mduck]`,
        );

        // ── Mix ─────────────────────────────────────────────────────
        // Combine voice + music. normalize=0 preserves our carefully set levels.
        // dropout_transition=2 avoids clicks if one stream ends slightly early.
        filters.push(
          `[vmix][mduck]amix=inputs=2:duration=longest:dropout_transition=2:normalize=0[mixraw]`,
        );

        filters.push(
          `[mixraw]atrim=0:${mixDuration},asetpts=PTS-STARTPTS[mixed]`,
        );

        // Fades:
        // - Fade-in: tiny anti-click (0.05s).
        // - Fade-out: smooth fade over the music tail after voice ends.
        //   Covers the entire tail so music decays to silence by the end.
        const fadeIn = Math.max(0.02, Math.min(0.15, voiceInput.fadeIn ?? 0.05));
        const actualTail = mixDuration - voiceTotalDuration;
        const curveParam = fadeCurve ? this.fadeCurveToFFmpeg(fadeCurve) : 'exp';
        const fadeOutCurve = 'exp';

        // Fade-out spans the full music tail for a clean ending
        let fadeOut = 0;
        let fadeOutStart = mixDuration;
        if (actualTail > 0.1) {
          fadeOut = actualTail; // fade covers the entire tail
          fadeOutStart = voiceTotalDuration; // starts right when voice ends
        }

        logger.info('Professional mix settings:', {
          voiceVol,
          musicIntroVol: musicIntroVol.toFixed(3),
          musicBedVol: musicBedVol.toFixed(3),
          voiceDelay: `${voiceDelaySec}s`,
          voiceDuration: `${voiceTotalDuration}s`,
          musicDuration: `${musicDuration.toFixed(1)}s`,
          mixDuration: `${mixDuration}s`,
          fadeIn: `${fadeIn}s`,
          fadeOut: fadeOut > 0 ? `${fadeOut}s (exp)` : 'none (no tail)',
          fadeOutStart: `${fadeOutStart}s`,
          actualTail: `${actualTail.toFixed(2)}s`,
          approach: 'constant-bed (no sidechain)',
        });

        const fadeInFilter = `afade=t=in:st=0:d=${fadeIn}:curve=${curveParam}`;
        if (fadeOut > 0) {
          const fadeOutFilter = `afade=t=out:st=${fadeOutStart}:d=${fadeOut}:curve=${fadeOutCurve}`;
          filters.push(`[mixed]${fadeInFilter},${fadeOutFilter}[faded]`);
        } else {
          // No fade-out — just apply fade-in anti-click
          filters.push(`[mixed]${fadeInFilter}[faded]`);
        }

        if (normalizeLoudness) {
          const target = Math.max(-60, Math.min(0, loudnessTargetLUFS));
          const tp = Math.max(-10, Math.min(0, loudnessTruePeak));
          // LRA=7: more permissive than mastering (LRA=3) — lets the natural
          // dynamic range of voice-over-music breathe. The downstream mastering
          // chain tightens it further.
          filters.push(`[faded]loudnorm=I=${target}:TP=${tp}:LRA=7[out]`);
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
          .audioBitrate('320k')
          .audioChannels(2)
          .audioFrequency(48000);
        break;
      case 'wav':
        command
          .audioCodec('pcm_s16le')
          .audioChannels(2)
          .audioFrequency(48000);
        break;
      case 'aac':
        command
          .audioCodec('aac')
          .audioBitrate('320k')
          .audioChannels(2)
          .audioFrequency(48000);
        break;
      default:
        command
          .audioCodec('libmp3lame')
          .audioBitrate('320k');
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

        const SAMPLE_RATE = 48000;
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
          `aloop=loop=${loopCount - 1}:size=48000*${Math.ceil(currentDuration)}`,
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
        const SAMPLE_RATE = 48000;
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

    const SAMPLE_RATE = 48000;
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
        filters.push(`loudnorm=I=${target}:TP=-2:LRA=3`);

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
   * Measure the integrated loudness (LUFS) of an audio file using FFmpeg ebur128.
   * Returns the integrated loudness value in LUFS (e.g. -16.0).
   */
  async measureLoudness(filePath: string): Promise<number> {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    try {
      const { stderr } = await execAsync(
        `ffmpeg -i "${filePath}" -af "ebur128=peak=true" -f null - 2>&1`,
        { maxBuffer: 5 * 1024 * 1024, timeout: 30000 }
      );

      // ebur128 outputs "Summary:" section at the end with "I: -16.0 LUFS"
      const integratedMatch = /I:\s*(-?[\d.]+)\s*LUFS/i.exec(stderr);
      if (integratedMatch) {
        return parseFloat(integratedMatch[1]);
      }

      logger.warn('Could not parse integrated loudness from ebur128 output');
      return -16; // Default fallback
    } catch (error: any) {
      logger.warn(`Loudness measurement failed: ${error.message}`);
      return -16; // Default fallback
    }
  }

  /**
   * Normalize audio to a target loudness using EBU R128 loudnorm (two-pass style).
   * Use before mixing to ensure consistent input levels regardless of source.
   * @param inputPath  Source audio file
   * @param outputPath Normalized output file
   * @param targetLUFS Target integrated loudness (default -18 LUFS for music beds, -16 for voice)
   * @param truePeak   Maximum true peak in dB (default -2)
   * @param lra        Maximum loudness range (default 7 for music, 3 for voice)
   */
  async normalizeAudioLoudness(
    inputPath: string,
    outputPath: string,
    targetLUFS: number = -18,
    truePeak: number = -2,
    lra: number = 7
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        logger.info(`Normalizing audio loudness to ${targetLUFS} LUFS, TP=${truePeak}dB`, { inputPath });

        const command = ffmpeg(inputPath);
        command.audioFilters(`loudnorm=I=${targetLUFS}:TP=${truePeak}:LRA=${lra}`);
        this.setOutputOptions(command, 'mp3');
        command.output(outputPath);

        command
          .on('end', () => {
            logger.info('Audio loudness normalization complete:', outputPath);
            resolve(outputPath);
          })
          .on('error', (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('FFmpeg loudness normalization error:', msg);
            reject(new Error(`Loudness normalization failed: ${msg}`));
          });

        command.run();
      } catch (error: any) {
        reject(error);
      }
    });
  }

  /**
   * Trim leading and trailing silence from an audio file.
   * @param inputPath  Source audio file
   * @param outputPath Trimmed output file
   * @param threshold  Silence threshold in dB (default -40dB)
   * @param minDuration Minimum silence duration to detect in seconds (default 0.1s)
   */
  async trimSilence(
    inputPath: string,
    outputPath: string,
    threshold: number = -40,
    minDuration: number = 0.1
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        logger.info('Trimming silence from audio', { inputPath, threshold, minDuration });

        const command = ffmpeg(inputPath);
        // silenceremove: remove leading silence (start_periods=1), then trailing (stop_periods=1)
        command.audioFilters(
          `silenceremove=start_periods=1:start_threshold=${threshold}dB:start_duration=${minDuration}:stop_periods=1:stop_threshold=${threshold}dB:stop_duration=${minDuration}`
        );
        this.setOutputOptions(command, 'mp3');
        command.output(outputPath);

        command
          .on('end', () => {
            logger.info('Silence trimming complete:', outputPath);
            resolve(outputPath);
          })
          .on('error', (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('FFmpeg silence trimming error:', msg);
            reject(new Error(`Silence trimming failed: ${msg}`));
          });

        command.run();
      } catch (error: any) {
        reject(error);
      }
    });
  }

  /**
   * Enforce a target duration on an audio file by padding with silence or trimming with fade-out.
   * @param inputPath  Source audio file
   * @param outputPath Output file with enforced duration
   * @param targetDuration Target duration in seconds
   * @param fadeOutDuration Fade-out duration when trimming (default 1.5s)
   */
  async enforceDuration(
    inputPath: string,
    outputPath: string,
    targetDuration: number,
    fadeOutDuration: number = 1.5
  ): Promise<string> {
    const currentDuration = await this.getAudioDuration(inputPath);

    if (Math.abs(currentDuration - targetDuration) < 0.1) {
      // Close enough — just copy
      return this.processAudio({ filePath: inputPath }, outputPath, 'mp3');
    }

    return new Promise((resolve, reject) => {
      try {
        const command = ffmpeg(inputPath);

        if (currentDuration > targetDuration) {
          // Trim with fade-out at the end
          const fadeStart = Math.max(0, targetDuration - fadeOutDuration);
          command.audioFilters([
            `atrim=0:${targetDuration}`,
            'asetpts=PTS-STARTPTS',
            `afade=t=out:st=${fadeStart}:d=${fadeOutDuration}:curve=exp`,
          ].join(','));
        } else {
          // Pad with silence to reach target duration
          const padDuration = targetDuration - currentDuration;
          command.audioFilters(`apad=pad_dur=${padDuration}`);
        }

        this.setOutputOptions(command, 'mp3');
        command.output(outputPath);

        command
          .on('end', () => {
            logger.info(`Duration enforced to ${targetDuration}s:`, outputPath);
            resolve(outputPath);
          })
          .on('error', (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('FFmpeg enforceDuration error:', msg);
            reject(new Error(`Duration enforcement failed: ${msg}`));
          });

        command.run();
      } catch (error: any) {
        reject(error);
      }
    });
  }

  /**
   * Apply frequency-aware sidechain ducking to music using voice as key signal.
   *
   * Splits music into 3 frequency bands:
   *   - Low  (<500 Hz):  untouched — keeps bass fullness
   *   - Mid  (500–4000 Hz): compressed when voice is present — clears space for voice
   *   - High (>4000 Hz): untouched — keeps air/shimmer
   *
   * This sounds more natural than flat volume ducking because the bass and
   * treble continue at full level while only voice-competing frequencies duck.
   *
   * Falls back to full-signal sidechain compression if multiband fails.
   */
  async applySidechainDucking(
    musicPath: string,
    voicePath: string,
    outputPath: string,
    opts?: {
      /** Compressor threshold in dB (default -20) */
      threshold?: number;
      /** Compression ratio (default 4) — gentle ducking, not hard-limiting */
      ratio?: number;
      /** Attack in ms (default 150) — slow enough to avoid pumping artifacts */
      attack?: number;
      /** Release in ms (default 800) — long release for smooth, natural recovery */
      release?: number;
      /** Crossover low→mid frequency in Hz (default 400) */
      crossoverLow?: number;
      /** Crossover mid→high frequency in Hz (default 5000) */
      crossoverHigh?: number;
    }
  ): Promise<string> {
    const {
      threshold = -20,
      ratio = 4,
      attack = 150,
      release = 800,
      crossoverLow = 400,
      crossoverHigh = 5000,
    } = opts || {};

    // Try multiband first, fall back to full-signal sidechain
    try {
      return await this.applySidechainDuckingMultiband(
        musicPath, voicePath, outputPath,
        { threshold, ratio, attack, release, crossoverLow, crossoverHigh }
      );
    } catch (multibandErr: any) {
      logger.warn(`Multiband sidechain failed, trying full-signal: ${multibandErr.message}`);
      return await this.applySidechainDuckingFullSignal(
        musicPath, voicePath, outputPath,
        { threshold, ratio, attack, release }
      );
    }
  }

  /**
   * 5-band multiband sidechain: split music into 5 frequency bands,
   * sidechain compress the 3 middle bands (voice range) with different ratios.
   *
   * Band layout:
   *   1. Sub-bass  (<150 Hz)  — untouched, keeps the low-end foundation
   *   2. Low-mid   (150–500 Hz) — light compression, voice chest resonance
   *   3. Mid       (500–2kHz)  — heavy compression, voice fundamental/formants
   *   4. Upper-mid (2k–5kHz)   — heavy compression, voice presence/clarity
   *   5. Air       (>5kHz)     — untouched, keeps shimmer and sparkle
   *
   * This 5-band approach is what professional broadcast engineers use:
   * surgical ducking in the voice range while preserving musical fullness
   * in the bass and treble.
   */
  private applySidechainDuckingMultiband(
    musicPath: string,
    voicePath: string,
    outputPath: string,
    opts: { threshold: number; ratio: number; attack: number; release: number; crossoverLow: number; crossoverHigh: number }
  ): Promise<string> {
    const { threshold, ratio, attack, release, crossoverLow, crossoverHigh } = opts;

    // 5-band crossover points
    const xSub = 150;              // Sub-bass cutoff
    const xLowMid = crossoverLow;  // Low-mid to mid (~400Hz)
    const xMidHigh = 2000;         // Mid to upper-mid
    const xAir = crossoverHigh;    // Upper-mid to air (~5000Hz)

    return new Promise((resolve, reject) => {
      try {
        logger.info('Applying 5-band multiband sidechain ducking', {
          threshold, ratio, attack, release,
          bands: `<${xSub}|${xSub}-${xLowMid}|${xLowMid}-${xMidHigh}|${xMidHigh}-${xAir}|>${xAir}`,
        });

        const command = ffmpeg();
        command.input(musicPath);  // [0:a] = music
        command.input(voicePath);  // [1:a] = voice (sidechain key)

        const SAMPLE_RATE = 48000;
        const norm = `aformat=channel_layouts=stereo,aresample=${SAMPLE_RATE}`;

        // Light compression for low-mid (voice chest resonance — duck gently)
        const lightRatio = Math.max(2, Math.round(ratio * 0.6));
        const lightThreshold = threshold - 4; // slightly less sensitive

        const filters = [
          `[0:a]${norm}[music]`,
          `[1:a]${norm}[voice]`,

          // Split voice for multiple sidechain inputs
          `[voice]asplit=3[vsc1][vsc2][vsc3]`,

          // Split music into 5 bands
          `[music]asplit=5[m1][m2][m3][m4][m5]`,

          // Band 1: Sub-bass (<150Hz) — untouched
          `[m1]lowpass=f=${xSub}:poles=2,volume=5.0[sub]`,

          // Band 2: Low-mid (150–400Hz) — light sidechain compression
          `[m2]highpass=f=${xSub}:poles=2,lowpass=f=${xLowMid}:poles=2[lm_raw]`,
          `[lm_raw][vsc1]sidechaincompress=threshold=${lightThreshold}dB:ratio=${lightRatio}:attack=${attack + 30}:release=${release + 100}:level_sc=1:mix=0.35,volume=5.0[lowmid]`,

          // Band 3: Mid (400–2kHz) — moderate sidechain compression (voice fundamental)
          `[m3]highpass=f=${xLowMid}:poles=2,lowpass=f=${xMidHigh}:poles=2[mid_raw]`,
          `[mid_raw][vsc2]sidechaincompress=threshold=${threshold}dB:ratio=${ratio}:attack=${attack}:release=${release}:level_sc=1:mix=0.6,volume=5.0[mid]`,

          // Band 4: Upper-mid (2k–5kHz) — moderate sidechain compression (voice presence)
          `[m4]highpass=f=${xMidHigh}:poles=2,lowpass=f=${xAir}:poles=2[um_raw]`,
          `[um_raw][vsc3]sidechaincompress=threshold=${threshold}dB:ratio=${ratio}:attack=${attack}:release=${release + 200}:level_sc=1:mix=0.55,volume=5.0[upmid]`,

          // Band 5: Air (>5kHz) — untouched
          `[m5]highpass=f=${xAir}:poles=2,volume=5.0[air]`,

          // Recombine all 5 bands (amix divides by 5, so the 5x volume above compensates)
          `[sub][lowmid][mid][upmid][air]amix=inputs=5:duration=longest:dropout_transition=0[out]`,
        ];

        const filterStr = filters.join(';');
        command.outputOptions(['-filter_complex', filterStr, '-map', '[out]']);
        this.setOutputOptions(command, 'mp3');
        command.output(outputPath);

        command
          .on('start', (commandLine: string) => {
            logger.debug('5-band sidechain FFmpeg:', commandLine.slice(0, 500));
          })
          .on('end', () => {
            logger.info('5-band sidechain ducking applied:', outputPath);
            resolve(outputPath);
          })
          .on('error', (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('5-band sidechain FFmpeg error:', msg);
            reject(new Error(`5-band sidechain ducking failed: ${msg}`));
          });

        command.run();
      } catch (error: any) {
        reject(error);
      }
    });
  }

  /**
   * Full-signal sidechain: compress the entire music signal (fallback).
   */
  private applySidechainDuckingFullSignal(
    musicPath: string,
    voicePath: string,
    outputPath: string,
    opts: { threshold: number; ratio: number; attack: number; release: number }
  ): Promise<string> {
    const { threshold, ratio, attack, release } = opts;

    return new Promise((resolve, reject) => {
      try {
        logger.info('Applying full-signal sidechain ducking (fallback)');

        const command = ffmpeg();
        command.input(musicPath);
        command.input(voicePath);

        const SAMPLE_RATE = 48000;
        const norm = `aformat=channel_layouts=stereo,aresample=${SAMPLE_RATE}`;

        const filters = [
          `[0:a]${norm}[music]`,
          `[1:a]${norm}[voice]`,
          `[music][voice]sidechaincompress=threshold=${threshold}dB:ratio=${ratio}:attack=${attack}:release=${release}:level_sc=1:mix=0.5[out]`,
        ];

        const filterStr = filters.join(';');
        command.outputOptions(['-filter_complex', filterStr, '-map', '[out]']);
        this.setOutputOptions(command, 'mp3');
        command.output(outputPath);

        command
          .on('end', () => {
            logger.info('Full-signal sidechain ducking applied:', outputPath);
            resolve(outputPath);
          })
          .on('error', (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('Full-signal sidechain FFmpeg error:', msg);
            reject(new Error(`Full-signal sidechain ducking failed: ${msg}`));
          });

        command.run();
      } catch (error: any) {
        reject(error);
      }
    });
  }

  /**
   * Create a combined voice reference track from multiple positioned voice entries.
   * Used as the sidechain key signal for dynamic music ducking.
   */
  async createVoiceReference(
    entries: { filePath: string; startTime: number; volume: number }[],
    totalDuration: number,
    outputPath: string
  ): Promise<string> {
    if (entries.length === 0) {
      throw new Error('createVoiceReference requires at least one voice entry');
    }

    return new Promise((resolve, reject) => {
      try {
        const command = ffmpeg();
        const SAMPLE_RATE = 48000;
        const norm = `aformat=channel_layouts=stereo,aresample=${SAMPLE_RATE}`;

        for (const entry of entries) {
          command.input(entry.filePath);
        }

        const filters: string[] = [];
        const labels: string[] = [];

        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          const label = `v${i}`;
          const delayMs = Math.round(entry.startTime * 1000);

          if (delayMs > 0) {
            filters.push(`[${i}:a]${norm},volume=${entry.volume},adelay=${delayMs}|${delayMs}[${label}]`);
          } else {
            filters.push(`[${i}:a]${norm},volume=${entry.volume}[${label}]`);
          }
          labels.push(`[${label}]`);
        }

        // Mix all voice entries together
        if (entries.length === 1) {
          // Single voice — just trim to duration
          filters.push(`${labels[0]}atrim=0:${totalDuration},asetpts=PTS-STARTPTS[out]`);
        } else {
          filters.push(
            `${labels.join('')}amix=inputs=${entries.length}:duration=longest:dropout_transition=2[mixed]`
          );
          filters.push(`[mixed]atrim=0:${totalDuration},asetpts=PTS-STARTPTS[out]`);
        }

        const filterStr = filters.join(';');
        command.outputOptions(['-filter_complex', filterStr, '-map', '[out]']);
        this.setOutputOptions(command, 'mp3');
        command.output(outputPath);

        command
          .on('end', () => {
            logger.info('Voice reference track created:', outputPath);
            resolve(outputPath);
          })
          .on('error', (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('Voice reference FFmpeg error:', msg);
            reject(new Error(`Failed to create voice reference: ${msg}`));
          });

        command.run();
      } catch (error: any) {
        reject(error);
      }
    });
  }

  /**
   * Apply voice-supportive EQ to a music track.
   * Multi-band surgical carving for professional voice-over intelligibility:
   *
   *   1. High-pass at 80Hz — remove sub-bass that competes with voice chest tones
   *   2. Low-mid cut at 250Hz (-2.5dB, Q=0.8) — reduce muddiness in voice fundamental range
   *   3. Lower presence cut at 800Hz (-2dB, Q=0.7) — thin out low voice formant overlap
   *   4. Voice clarity carve at 1.5kHz (-3dB, Q=0.8) — carve F2 formant region
   *   5. Deep presence carve at 3kHz (-5dB, Q=0.7) — deep cut in voice presence band (F3)
   *   6. Upper presence taper at 5kHz (-2dB, Q=1.0) — smooth rolloff above voice
   *   7. Air shelf boost at 8kHz (+2.5dB) — add shimmer/sparkle above voice range
   *   8. Ultra-high sparkle at 12kHz (+1.5dB) — breathiness and space
   *
   * This mimics what a professional mix engineer does: carve a wide "valley"
   * in the 200Hz–5kHz range (where voice lives) while boosting frequencies
   * above and below that range to maintain perceived fullness.
   */
  async applyVoiceSupportEQ(
    inputPath: string,
    outputPath: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        logger.info('Applying voice-support EQ to music track (multi-band surgical)');
        const command = ffmpeg(inputPath);

        const eqFilter = [
          'highpass=f=80:poles=2',
          'equalizer=f=250:t=q:w=0.8:g=-2.5',
          'equalizer=f=800:t=q:w=0.7:g=-2',
          'equalizer=f=1500:t=q:w=0.8:g=-3',
          'equalizer=f=3000:t=q:w=0.7:g=-5',
          'equalizer=f=5000:t=q:w=1.0:g=-2',
          'equalizer=f=8000:t=h:g=2.5',
          'equalizer=f=12000:t=h:g=1.5',
        ].join(',');

        command
          .audioFilters(eqFilter)
          .audioCodec('libmp3lame')
          .audioBitrate('320k')
          .audioChannels(2)
          .audioFrequency(48000)
          .output(outputPath);

        command
          .on('end', () => {
            logger.info('Voice-support EQ applied (multi-band):', outputPath);
            resolve(outputPath);
          })
          .on('error', (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('FFmpeg voice-support EQ error:', msg);
            reject(new Error(`Failed to apply voice-support EQ: ${msg}`));
          });

        command.run();
      } catch (error: any) {
        reject(error);
      }
    });
  }

  /**
   * Apply presence EQ to voice track for enhanced clarity in the mix.
   * Boosts voice intelligibility frequencies and removes problematic ranges:
   *
   *   1. High-pass at 80Hz — remove proximity effect / room rumble
   *   2. Low-mid cut at 150Hz (-2dB) — reduce boominess from close-mic recording
   *   3. Presence boost at 2.5kHz (+2dB) — enhance articulation and clarity
   *   4. Air boost at 7kHz (+1.5dB) — add breathiness and "open" quality
   *   5. De-ess region at 6kHz (-1dB) — gently tame sibilance
   */
  async applyVoicePresenceEQ(
    inputPath: string,
    outputPath: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        logger.info('Applying voice presence EQ');
        const command = ffmpeg(inputPath);

        const eqFilter = [
          'highpass=f=80:poles=2',
          'equalizer=f=150:t=q:w=1.0:g=-2',
          'equalizer=f=2500:t=q:w=0.8:g=2',
          'equalizer=f=6000:t=q:w=1.2:g=-1',
          'equalizer=f=7000:t=h:g=1.5',
        ].join(',');

        command
          .audioFilters(eqFilter)
          .audioCodec('libmp3lame')
          .audioBitrate('320k')
          .audioChannels(2)
          .audioFrequency(48000)
          .output(outputPath);

        command
          .on('end', () => {
            logger.info('Voice presence EQ applied:', outputPath);
            resolve(outputPath);
          })
          .on('error', (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error('FFmpeg voice presence EQ error:', msg);
            reject(new Error(`Failed to apply voice presence EQ: ${msg}`));
          });

        command.run();
      } catch (error: any) {
        reject(error);
      }
    });
  }

  /**
   * Find candidate loop points in an audio file by analyzing energy levels.
   * Returns timestamps where the audio energy is similar to the start,
   * making them good candidates for seamless looping.
   *
   * When barDuration is provided, loop points are snapped to bar boundaries.
   */
  async findLoopPoints(
    musicPath: string,
    opts?: {
      /** Duration of one bar in seconds (for bar-aligned loop points) */
      barDuration?: number;
      /** Minimum loop length in seconds (default 4) */
      minLoopLength?: number;
      /** Maximum number of candidates to return (default 5) */
      maxCandidates?: number;
    }
  ): Promise<{ timestamp: number; energyDiff: number }[]> {
    const { barDuration, minLoopLength = 4, maxCandidates = 5 } = opts || {};

    try {
      const duration = await this.getAudioDuration(musicPath);
      if (duration < minLoopLength * 2) {
        return [{ timestamp: duration / 2, energyDiff: 0 }];
      }

      // Measure RMS energy in small windows across the track
      const { stderr } = await execAsync(
        `ffmpeg -i "${musicPath}" -af "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-" -f null - 2>&1`,
        { maxBuffer: 10 * 1024 * 1024, timeout: 30000 }
      );

      // Parse per-frame RMS levels
      const rmsValues: number[] = [];
      const rmsMatches = stderr.matchAll(/RMS_level=(-?[\d.]+)/g);
      for (const m of rmsMatches) {
        const val = parseFloat(m[1]);
        if (isFinite(val) && val > -100) rmsValues.push(val);
      }

      if (rmsValues.length < 10) {
        // Fallback: use midpoint or bar boundaries
        if (barDuration && barDuration > 0) {
          const midBar = Math.floor(duration / 2 / barDuration) * barDuration;
          return [{ timestamp: Math.max(minLoopLength, midBar), energyDiff: 0 }];
        }
        return [{ timestamp: duration / 2, energyDiff: 0 }];
      }

      // Time per RMS sample
      const timePerSample = duration / rmsValues.length;

      // Get the energy of the start region (first ~2s)
      const startSamples = Math.min(20, Math.ceil(2.0 / timePerSample));
      const startEnergy = rmsValues.slice(0, startSamples).reduce((a, b) => a + b, 0) / startSamples;

      // Find points where energy is similar to start (good loop points)
      const candidates: { timestamp: number; energyDiff: number }[] = [];
      const minSampleIdx = Math.ceil(minLoopLength / timePerSample);

      for (let i = minSampleIdx; i < rmsValues.length - startSamples; i++) {
        // Average energy in a window around this point
        const windowSize = Math.min(startSamples, rmsValues.length - i);
        const windowEnergy = rmsValues.slice(i, i + windowSize).reduce((a, b) => a + b, 0) / windowSize;
        const energyDiff = Math.abs(windowEnergy - startEnergy);

        let timestamp = i * timePerSample;

        // Snap to bar boundary if barDuration is provided
        if (barDuration && barDuration > 0) {
          timestamp = Math.round(timestamp / barDuration) * barDuration;
          // Skip if snapped to same point as previous candidate
          if (candidates.length > 0 && Math.abs(candidates[candidates.length - 1].timestamp - timestamp) < barDuration * 0.5) {
            continue;
          }
        }

        // Ensure minimum loop length after snapping
        if (timestamp < minLoopLength) continue;

        candidates.push({ timestamp, energyDiff });
      }

      // Sort by energy similarity (lower diff = better loop point)
      candidates.sort((a, b) => a.energyDiff - b.energyDiff);

      const result = candidates.slice(0, maxCandidates);
      logger.info(`Found ${result.length} loop point candidates`, {
        best: result[0]?.timestamp.toFixed(2),
        energyDiff: result[0]?.energyDiff.toFixed(2),
      });

      return result.length > 0 ? result : [{ timestamp: duration / 2, energyDiff: 0 }];
    } catch (err: any) {
      logger.warn(`Loop-point detection failed: ${err.message}`);
      return [{ timestamp: minLoopLength, energyDiff: 0 }];
    }
  }

  /**
   * Extend audio with beat-aware crossfaded looping.
   * Instead of a hard loop boundary, finds the best loop point
   * and applies a crossfade for seamless looping.
   */
  async extendAudioWithCrossfade(
    inputPath: string,
    targetDuration: number,
    outputPath: string,
    opts?: {
      /** Bar duration for bar-aligned loop points */
      barDuration?: number;
      /** Crossfade duration at loop point (default 0.5s) */
      crossfadeDuration?: number;
    }
  ): Promise<string> {
    const { barDuration, crossfadeDuration = 0.5 } = opts || {};

    const currentDuration = await this.getAudioDuration(inputPath);
    if (currentDuration >= targetDuration) {
      return this.trimAudio(inputPath, targetDuration, outputPath);
    }

    try {
      // Find best loop point
      const loopPoints = await this.findLoopPoints(inputPath, {
        barDuration,
        minLoopLength: Math.max(4, currentDuration * 0.3),
      });
      const loopPoint = loopPoints[0]?.timestamp ?? currentDuration / 2;

      logger.info(`Beat-aware extend: loop at ${loopPoint.toFixed(2)}s, crossfade ${crossfadeDuration}s`);

      // Strategy: use the segment from start to loopPoint as the loop body.
      // Each repetition crossfades with the previous iteration at the loop boundary.
      const loopBodyDuration = loopPoint;
      const loopsNeeded = Math.ceil((targetDuration - currentDuration) / loopBodyDuration) + 1;

      return new Promise((resolve, reject) => {
        try {
          const command = ffmpeg();
          const SAMPLE_RATE = 48000;
          const norm = `aformat=channel_layouts=stereo,aresample=${SAMPLE_RATE}`;

          // Input 0: full original track
          command.input(inputPath);

          // Input 1..N: copies for looping (each uses the loop body segment)
          for (let i = 0; i < loopsNeeded; i++) {
            command.input(inputPath);
          }

          const filters: string[] = [];
          const concatLabels: string[] = [];

          // First: play the full original track
          filters.push(`[0:a]${norm}[orig]`);
          concatLabels.push('[orig]');

          // For each additional loop iteration: extract the loop body with crossfade tails
          for (let i = 0; i < loopsNeeded; i++) {
            const inputIdx = i + 1;
            const label = `loop${i}`;
            const xfade = Math.min(crossfadeDuration, loopBodyDuration * 0.2);

            // Extract loop body: from 0 to loopPoint, with fade-in at the start
            filters.push(
              `[${inputIdx}:a]${norm},atrim=0:${loopPoint},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${xfade}:curve=tri,afade=t=out:st=${loopPoint - xfade}:d=${xfade}:curve=tri[${label}]`
            );
            concatLabels.push(`[${label}]`);
          }

          // Concatenate all segments
          filters.push(`${concatLabels.join('')}concat=n=${concatLabels.length}:v=0:a=1[joined]`);

          // Trim to exact target duration
          filters.push(`[joined]atrim=0:${targetDuration},asetpts=PTS-STARTPTS[out]`);

          const filterStr = filters.join(';');
          command.outputOptions(['-filter_complex', filterStr, '-map', '[out]']);
          this.setOutputOptions(command, 'mp3');
          command.output(outputPath);

          command
            .on('end', () => {
              logger.info(`Beat-aware extend completed: ${targetDuration}s`, { outputPath });
              resolve(outputPath);
            })
            .on('error', (err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              logger.warn(`Beat-aware extend failed, falling back to simple loop: ${msg}`);
              // Fallback to simple loop
              this.extendAudioDuration(inputPath, targetDuration, outputPath)
                .then(resolve)
                .catch(reject);
            });

          command.run();
        } catch (error: any) {
          // Fallback to simple loop
          this.extendAudioDuration(inputPath, targetDuration, outputPath)
            .then(resolve)
            .catch(reject);
        }
      });
    } catch (err: any) {
      logger.warn(`Beat-aware extend setup failed, falling back to simple loop: ${err.message}`);
      return this.extendAudioDuration(inputPath, targetDuration, outputPath);
    }
  }

  /**
   * Measure the spectral centroid and frequency balance of an audio file.
   * Used by quality scoring to assess whether music has appropriate
   * frequency distribution (not too bass-heavy, not too thin).
   *
   * Returns:
   *   - spectralCentroid: weighted average frequency (Hz). Good music: 1000–4000 Hz.
   *   - lowEnergyRatio: fraction of energy below 300Hz (bass heaviness)
   *   - highEnergyRatio: fraction of energy above 8kHz (brightness)
   */
  async measureSpectralBalance(filePath: string): Promise<{
    spectralCentroid: number;
    lowEnergyRatio: number;
    highEnergyRatio: number;
  }> {
    try {
      // Use FFmpeg's astats with per-channel RMS to approximate spectral balance
      // We measure RMS of filtered bands: low (<300Hz), mid (300–8kHz), high (>8kHz)
      const [lowResult, midResult, highResult] = await Promise.all([
        execAsync(
          `ffmpeg -i "${filePath}" -af "lowpass=f=300,astats=metadata=1:reset=0" -f null - 2>&1`,
          { maxBuffer: 5 * 1024 * 1024, timeout: 20000 }
        ),
        execAsync(
          `ffmpeg -i "${filePath}" -af "highpass=f=300,lowpass=f=8000,astats=metadata=1:reset=0" -f null - 2>&1`,
          { maxBuffer: 5 * 1024 * 1024, timeout: 20000 }
        ),
        execAsync(
          `ffmpeg -i "${filePath}" -af "highpass=f=8000,astats=metadata=1:reset=0" -f null - 2>&1`,
          { maxBuffer: 5 * 1024 * 1024, timeout: 20000 }
        ),
      ]);

      const parseRMS = (stderr: string): number => {
        const match = /RMS level dB:\s*(-?[\d.]+)/i.exec(stderr);
        return match ? parseFloat(match[1]) : -60;
      };

      const lowRMS = parseRMS(lowResult.stderr);
      const midRMS = parseRMS(midResult.stderr);
      const highRMS = parseRMS(highResult.stderr);

      // Convert dB to linear power for ratio calculation
      const toLinear = (db: number) => Math.pow(10, db / 10);
      const lowPower = toLinear(lowRMS);
      const midPower = toLinear(midRMS);
      const highPower = toLinear(highRMS);
      const totalPower = lowPower + midPower + highPower;

      const lowEnergyRatio = totalPower > 0 ? lowPower / totalPower : 0.33;
      const highEnergyRatio = totalPower > 0 ? highPower / totalPower : 0.33;

      // Approximate spectral centroid from band energies
      const spectralCentroid = totalPower > 0
        ? (lowPower * 150 + midPower * 2000 + highPower * 12000) / totalPower
        : 2000;

      logger.info('Spectral balance measured', {
        spectralCentroid: Math.round(spectralCentroid),
        lowEnergyRatio: Math.round(lowEnergyRatio * 100) / 100,
        highEnergyRatio: Math.round(highEnergyRatio * 100) / 100,
      });

      return { spectralCentroid, lowEnergyRatio, highEnergyRatio };
    } catch (err: any) {
      logger.warn(`Spectral balance measurement failed: ${err.message}`);
      return { spectralCentroid: 2000, lowEnergyRatio: 0.3, highEnergyRatio: 0.1 };
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
