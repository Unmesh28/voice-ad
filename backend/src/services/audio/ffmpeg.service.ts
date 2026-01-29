import ffmpeg from 'fluent-ffmpeg';
import { logger } from '../../config/logger';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const unlinkAsync = promisify(fs.unlink);

interface AudioInput {
  filePath: string;
  volume?: number; // 0-1
  delay?: number; // seconds
  fadeIn?: number; // seconds
  fadeOut?: number; // seconds
}

interface MixOptions {
  voiceInput?: AudioInput;
  musicInput?: AudioInput;
  outputPath: string;
  outputFormat?: 'mp3' | 'wav' | 'aac';
  audioDucking?: boolean; // Lower music volume when voice plays
  duckingAmount?: number; // How much to lower music (0-1)
  normalize?: boolean;
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
      duckingAmount = 0.3,
      normalize = true,
    } = options;

    try {
      logger.info('Starting audio mixing with FFmpeg', {
        hasVoice: !!voiceInput,
        hasMusic: !!musicInput,
        outputFormat,
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
        return await this.mixVoiceAndMusic(
          voiceInput,
          musicInput,
          outputPath,
          outputFormat,
          audioDucking,
          duckingAmount,
          normalize
        );
      }

      throw new Error('No audio inputs provided');
    } catch (error: any) {
      logger.error('Error mixing audio:', error.message);
      throw error;
    }
  }

  /**
   * Mix voice and music with optional ducking
   */
  private async mixVoiceAndMusic(
    voiceInput: AudioInput,
    musicInput: AudioInput,
    outputPath: string,
    outputFormat: string,
    audioDucking: boolean,
    duckingAmount: number,
    normalize: boolean
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const command = ffmpeg();

      // Add voice input
      command.input(voiceInput.filePath);

      // Add music input
      command.input(musicInput.filePath);

      // Build filter complex
      const filters: string[] = [];
      let voiceChain = '[0:a]';
      let musicChain = '[1:a]';

      // Apply volume to voice
      if (voiceInput.volume !== undefined && voiceInput.volume !== 1) {
        filters.push(`${voiceChain}volume=${voiceInput.volume}[voice_vol]`);
        voiceChain = '[voice_vol]';
      }

      // Apply fade in/out to voice
      if (voiceInput.fadeIn || voiceInput.fadeOut) {
        const fadeFilters: string[] = [];
        if (voiceInput.fadeIn) {
          fadeFilters.push(`afade=t=in:st=0:d=${voiceInput.fadeIn}`);
        }
        if (voiceInput.fadeOut) {
          fadeFilters.push(`afade=t=out:st=${voiceInput.fadeOut}:d=1`);
        }
        filters.push(`${voiceChain}${fadeFilters.join(',')}[voice_fade]`);
        voiceChain = '[voice_fade]';
      }

      // Apply volume to music
      let musicVolume = musicInput.volume !== undefined ? musicInput.volume : 0.3;
      filters.push(`${musicChain}volume=${musicVolume}[music_vol]`);
      musicChain = '[music_vol]';

      // Apply fade in/out to music
      if (musicInput.fadeIn || musicInput.fadeOut) {
        const fadeFilters: string[] = [];
        if (musicInput.fadeIn) {
          fadeFilters.push(`afade=t=in:st=0:d=${musicInput.fadeIn}`);
        }
        if (musicInput.fadeOut) {
          fadeFilters.push(`afade=t=out:st=${musicInput.fadeOut}:d=1`);
        }
        filters.push(`${musicChain}${fadeFilters.join(',')}[music_fade]`);
        musicChain = '[music_fade]';
      }

      // Apply audio ducking if enabled
      if (audioDucking) {
        // Use sidechain compression to duck music when voice is present
        filters.push(
          `${musicChain}${voiceChain}sidechaincompress=threshold=0.1:ratio=4:attack=200:release=1000:makeup=${1 - duckingAmount}[music_ducked]`
        );
        musicChain = '[music_ducked]';
      }

      // Mix the two streams
      filters.push(`${voiceChain}${musicChain}amix=inputs=2:duration=longest[mixed]`);

      // Apply normalization if enabled
      if (normalize) {
        filters.push('[mixed]loudnorm[out]');
      } else {
        filters.push('[mixed]anull[out]');
      }

      // Set filter complex
      command.complexFilter(filters.join(';'), 'out');

      // Set output options
      this.setOutputOptions(command, outputFormat);

      // Set output path
      command.output(outputPath);

      // Handle events
      command
        .on('start', (commandLine) => {
          logger.info('FFmpeg command:', commandLine);
        })
        .on('progress', (progress) => {
          logger.debug('FFmpeg progress:', progress.percent);
        })
        .on('end', () => {
          logger.info('Audio mixing completed:', outputPath);
          resolve(outputPath);
        })
        .on('error', (err) => {
          logger.error('FFmpeg error:', err.message);
          reject(new Error(`FFmpeg processing failed: ${err.message}`));
        });

      // Run the command
      command.run();
    });
  }

  /**
   * Process single audio file (convert, apply effects)
   */
  private async processAudio(
    input: AudioInput,
    outputPath: string,
    outputFormat: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const command = ffmpeg(input.filePath);

      // Build filter
      const filters: string[] = [];

      // Apply volume
      if (input.volume !== undefined && input.volume !== 1) {
        filters.push(`volume=${input.volume}`);
      }

      // Apply fade in/out
      if (input.fadeIn) {
        filters.push(`afade=t=in:st=0:d=${input.fadeIn}`);
      }
      if (input.fadeOut) {
        filters.push(`afade=t=out:st=${input.fadeOut}:d=1`);
      }

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
        .on('error', (err) => {
          logger.error('FFmpeg error:', err.message);
          reject(new Error(`FFmpeg processing failed: ${err.message}`));
        });

      // Run
      command.run();
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
