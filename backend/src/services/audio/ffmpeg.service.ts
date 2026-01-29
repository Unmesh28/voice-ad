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

      // Simplified filter approach to avoid "Result too large" error
      const filters: string[] = [];

      // Apply volume to music (make it quieter as background for clarity)
      const musicVolume = musicInput.volume !== undefined ? musicInput.volume : 0.15;

      // Simple approach: just adjust volumes and mix
      // Voice at full volume (or specified), music at lower volume
      const voiceVol = voiceInput.volume !== undefined ? voiceInput.volume : 1.0;

      filters.push(`[0:a]volume=${voiceVol}[v]`);
      filters.push(`[1:a]volume=${musicVolume}[m]`);

      // Mix the streams
      filters.push(`[v][m]amix=inputs=2:duration=longest:dropout_transition=2[mixed]`);

      // Simple volume normalization instead of loudnorm to avoid complexity
      if (normalize) {
        filters.push('[mixed]volume=1.5[out]');
      } else {
        filters.push('[mixed]acopy[out]');
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
          logger.info('FFmpeg command started');
          logger.debug('FFmpeg command details:', commandLine.substring(0, 200));
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            logger.debug('FFmpeg progress:', Math.round(progress.percent) + '%');
          }
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
