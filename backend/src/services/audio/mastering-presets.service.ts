import ffmpegService from './ffmpeg.service';
import { logger } from '../../config/logger';
import type { MasteringPreset, LoudnessPreset, AudioFormatPreset } from '../../types/adform';
import { getLoudnessValues } from '../../types/adform';

// ===========================================================================
// Mastering Presets Service
//
// Like AudioStack's mastering presets (balanced, voiceenhanced, musicenhanced),
// this provides pre-configured mixing and mastering profiles that apply
// professional audio processing chains automatically.
// ===========================================================================

/** Full mastering configuration derived from a preset. */
export interface MasteringConfig {
  /** Voice volume multiplier */
  voiceVolume: number;
  /** Music volume multiplier */
  musicVolume: number;
  /** Ducking amount (how much music ducks under voice) */
  duckingAmount: number;
  /** Whether to use frequency-aware sidechain ducking */
  sidechainDucking: boolean;
  /** Whether to apply voice presence EQ */
  voicePresenceEQ: boolean;
  /** Whether to apply music voice-support EQ (carve 3kHz) */
  musicSupportEQ: boolean;
  /** Compression settings for mastering */
  compression: {
    threshold: number;
    ratio: number;
    attack: number;
    release: number;
  };
  /** Limiter settings */
  limiter: {
    threshold: number;
    release: number;
  };
  /** EQ settings for final output */
  eq: {
    lowCut: number;
    highCut?: number;
  };
}

/** Get mastering configuration for a preset. */
export function getMasteringConfig(preset: MasteringPreset): MasteringConfig {
  const configs: Record<MasteringPreset, MasteringConfig> = {
    balanced: {
      voiceVolume: 1.0,
      musicVolume: 0.18,
      duckingAmount: 0.30,
      sidechainDucking: true,
      voicePresenceEQ: false,
      musicSupportEQ: true,
      compression: { threshold: -18, ratio: 3, attack: 15, release: 200 },
      limiter: { threshold: -1, release: 80 },
      eq: { lowCut: 80 },
    },
    voiceenhanced: {
      voiceVolume: 1.1,
      musicVolume: 0.15,
      duckingAmount: 0.35,
      sidechainDucking: true,
      voicePresenceEQ: true,
      musicSupportEQ: true,
      compression: { threshold: -16, ratio: 3.5, attack: 12, release: 160 },
      limiter: { threshold: -1, release: 60 },
      eq: { lowCut: 80 },
    },
    musicenhanced: {
      voiceVolume: 0.95,
      musicVolume: 0.25,
      duckingAmount: 0.18,
      sidechainDucking: true,
      voicePresenceEQ: false,
      musicSupportEQ: false,
      compression: { threshold: -20, ratio: 2.5, attack: 20, release: 250 },
      limiter: { threshold: -1.5, release: 80 },
      eq: { lowCut: 60 },
    },
  };

  return configs[preset] || configs.balanced;
}

/** Get FFmpeg output options for a format preset. */
export function getFormatOptions(format: AudioFormatPreset): {
  codec: string;
  bitrate?: string;
  channels: number;
  sampleRate: number;
  extension: string;
} {
  const formats: Record<string, {
    codec: string;
    bitrate?: string;
    channels: number;
    sampleRate: number;
    extension: string;
  }> = {
    mp3:        { codec: 'libmp3lame', bitrate: '320k', channels: 2, sampleRate: 48000, extension: 'mp3' },
    mp3_low:    { codec: 'libmp3lame', bitrate: '128k', channels: 2, sampleRate: 48000, extension: 'mp3' },
    mp3_medium: { codec: 'libmp3lame', bitrate: '320k', channels: 2, sampleRate: 48000, extension: 'mp3' },
    mp3_high:   { codec: 'libmp3lame', bitrate: '320k', channels: 2, sampleRate: 48000, extension: 'mp3' },
    wav:        { codec: 'pcm_s16le', channels: 2, sampleRate: 48000, extension: 'wav' },
    wav_44100:  { codec: 'pcm_s16le', channels: 2, sampleRate: 44100, extension: 'wav' },
    ogg:        { codec: 'libvorbis', bitrate: '320k', channels: 2, sampleRate: 48000, extension: 'ogg' },
    flac:       { codec: 'flac', channels: 2, sampleRate: 48000, extension: 'flac' },
    aac:        { codec: 'aac', bitrate: '256k', channels: 2, sampleRate: 48000, extension: 'm4a' },
    aac_low:    { codec: 'aac', bitrate: '128k', channels: 2, sampleRate: 48000, extension: 'm4a' },
  };

  return formats[format] || formats.mp3_medium;
}

class MasteringPresetsService {
  /**
   * Apply mastering chain with a preset to a mixed audio file.
   */
  async applyPreset(
    inputPath: string,
    outputPath: string,
    masteringPreset: MasteringPreset = 'balanced',
    loudnessPreset: LoudnessPreset = 'crossPlatform'
  ): Promise<string> {
    const config = getMasteringConfig(masteringPreset);
    const loudness = getLoudnessValues(loudnessPreset);

    logger.info(`Applying mastering preset "${masteringPreset}" with loudness "${loudnessPreset}" (${loudness.lufs} LUFS, ${loudness.truePeak} dB TP)`);

    return ffmpegService.applyMasteringChain({
      inputPath,
      outputPath,
      targetLoudness: loudness.lufs,
      eq: {
        lowCut: config.eq.lowCut,
        highCut: config.eq.highCut,
      },
      compression: config.compression,
      limiter: config.limiter,
    });
  }

  /**
   * Encode audio to a specific format.
   */
  async encode(
    inputPath: string,
    outputPath: string,
    format: AudioFormatPreset = 'mp3_medium'
  ): Promise<string> {
    const opts = getFormatOptions(format);
    const ffmpeg = require('fluent-ffmpeg');

    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .audioCodec(opts.codec)
        .audioChannels(opts.channels)
        .audioFrequency(opts.sampleRate);

      if (opts.bitrate) {
        command.audioBitrate(opts.bitrate);
      }

      command
        .output(outputPath)
        .on('end', () => {
          logger.info(`Encoded to ${format}: ${outputPath}`);
          resolve(outputPath);
        })
        .on('error', (err: Error) => {
          logger.error(`Encoding failed: ${err.message}`);
          reject(err);
        })
        .run();
    });
  }

  /**
   * Encode audio to multiple formats in parallel.
   */
  async encodeMultiple(
    inputPath: string,
    outputDir: string,
    baseName: string,
    formats: AudioFormatPreset[]
  ): Promise<{ format: AudioFormatPreset; path: string }[]> {
    const results = await Promise.all(
      formats.map(async (format) => {
        const ext = getFormatOptions(format).extension;
        const outputPath = `${outputDir}/${baseName}.${ext}`;
        await this.encode(inputPath, outputPath, format);
        return { format, path: outputPath };
      })
    );
    return results;
  }
}

export default new MasteringPresetsService();
