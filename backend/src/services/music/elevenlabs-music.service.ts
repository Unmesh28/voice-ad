import axios from 'axios';
import { logger } from '../../config/logger';
import fs from 'fs';
import path from 'path';

interface SoundGenerationOptions {
  text: string;
  duration_seconds?: number; // 0.5 to 22 seconds
  prompt_influence?: number; // 0-1, how closely to follow the prompt
}

interface MusicGenerationResult {
  audioBuffer: Buffer;
  duration: number;
}

class ElevenLabsMusicService {
  private apiKey: string;
  private apiUrl: string;

  constructor() {
    this.apiKey = process.env.ELEVENLABS_API_KEY || '';
    this.apiUrl = process.env.ELEVENLABS_API_URL || 'https://api.elevenlabs.io/v1';

    if (!this.apiKey) {
      logger.warn('ElevenLabs API key not configured');
    }
  }

  /**
   * Generate sound/music from text description using ElevenLabs Sound Generation API
   */
  async generateSound(options: SoundGenerationOptions): Promise<MusicGenerationResult> {
    const {
      text,
      duration_seconds = 10,
      prompt_influence = 0.3,
    } = options;

    try {
      logger.info('Generating sound/music with ElevenLabs', {
        textLength: text.length,
        duration: duration_seconds,
      });

      const response = await axios.post(
        `${this.apiUrl}/sound-generation`,
        {
          text,
          duration_seconds,
          prompt_influence,
        },
        {
          headers: {
            'xi-api-key': this.apiKey,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          responseType: 'arraybuffer',
          timeout: 120000, // 2 minutes timeout
        }
      );

      const audioBuffer = Buffer.from(response.data);
      logger.info('Sound generated successfully', {
        audioSize: audioBuffer.length,
        duration: duration_seconds,
      });

      return {
        audioBuffer,
        duration: duration_seconds,
      };
    } catch (error: any) {
      logger.error('Error generating sound with ElevenLabs:', {
        message: error.message,
        response: error.response?.data?.toString(),
      });

      if (error.response?.status === 401) {
        throw new Error('Invalid ElevenLabs API key');
      } else if (error.response?.status === 400) {
        throw new Error('Invalid request parameters for sound generation');
      } else if (error.response?.status === 429) {
        throw new Error('ElevenLabs rate limit exceeded. Please try again later.');
      } else if (error.response?.status === 500) {
        throw new Error('ElevenLabs service error. Please try again later.');
      }

      throw new Error(`Failed to generate sound: ${error.message}`);
    }
  }

  /**
   * Save audio buffer to file
   */
  async saveAudioToFile(audioBuffer: Buffer, filename: string): Promise<string> {
    try {
      const uploadDir = process.env.UPLOAD_DIR || './uploads';
      const musicDir = path.join(uploadDir, 'music');

      // Create directory if it doesn't exist
      if (!fs.existsSync(musicDir)) {
        fs.mkdirSync(musicDir, { recursive: true });
      }

      const filePath = path.join(musicDir, filename);
      fs.writeFileSync(filePath, audioBuffer);

      logger.info(`Music saved to file: ${filePath}`);

      return filePath;
    } catch (error: any) {
      logger.error('Error saving music to file:', error.message);
      throw new Error(`Failed to save music: ${error.message}`);
    }
  }

  /**
   * Generate sound and save to file
   */
  async generateAndSave(
    options: SoundGenerationOptions,
    filename: string
  ): Promise<{ filePath: string; audioBuffer: Buffer; duration: number }> {
    const result = await this.generateSound(options);
    const filePath = await this.saveAudioToFile(result.audioBuffer, filename);

    return {
      filePath,
      audioBuffer: result.audioBuffer,
      duration: result.duration,
    };
  }

  /**
   * Get default sound generation settings
   */
  getDefaultSettings(): SoundGenerationOptions {
    return {
      text: '',
      duration_seconds: 10,
      prompt_influence: 0.3,
    };
  }

  /**
   * Validate sound generation options
   */
  validateOptions(options: SoundGenerationOptions): SoundGenerationOptions {
    return {
      text: options.text,
      duration_seconds: Math.max(0.5, Math.min(22, options.duration_seconds || 10)),
      prompt_influence: Math.max(0, Math.min(1, options.prompt_influence || 0.3)),
    };
  }

  /**
   * Generate music prompt suggestions based on genre/mood
   */
  generateMusicPrompt(genre?: string, mood?: string, tempo?: string, instruments?: string): string {
    const parts: string[] = [];

    if (mood) {
      parts.push(mood);
    }

    if (genre) {
      parts.push(genre);
    }

    parts.push('music');

    if (tempo) {
      parts.push(`with ${tempo} tempo`);
    }

    if (instruments) {
      parts.push(`featuring ${instruments}`);
    }

    return parts.join(' ');
  }

  /**
   * Check if API key is configured
   */
  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }

  /**
   * Get example prompts for music generation
   */
  getExamplePrompts(): string[] {
    return [
      'Upbeat electronic music with synthesizers and drums',
      'Calm piano melody with soft strings',
      'Energetic rock guitar riff with heavy drums',
      'Smooth jazz with saxophone and bass',
      'Ambient background music with gentle synth pads',
      'Epic orchestral music with strings and brass',
      'Funky bass groove with rhythmic percussion',
      'Acoustic guitar with light percussion',
      'Cinematic trailer music with dramatic strings',
      'Lo-fi hip hop beat with mellow vibes',
    ];
  }

  /**
   * Music genre presets with suggested prompts
   */
  getGenrePresets(): Record<string, { description: string; prompt: string; duration: number }> {
    return {
      corporate: {
        description: 'Professional background music for business content',
        prompt: 'Corporate uplifting music with piano and soft strings, motivational and positive',
        duration: 15,
      },
      upbeat: {
        description: 'Energetic and happy music',
        prompt: 'Upbeat happy music with acoustic guitar and light percussion, cheerful and bouncy',
        duration: 15,
      },
      ambient: {
        description: 'Calm atmospheric background music',
        prompt: 'Ambient atmospheric music with gentle synth pads and soft textures, peaceful and ethereal',
        duration: 20,
      },
      dramatic: {
        description: 'Epic cinematic music',
        prompt: 'Dramatic cinematic music with orchestral strings and powerful brass, epic and intense',
        duration: 15,
      },
      electronic: {
        description: 'Modern electronic beats',
        prompt: 'Electronic dance music with synthesizers and driving beat, modern and energetic',
        duration: 15,
      },
      jazz: {
        description: 'Smooth jazz vibes',
        prompt: 'Smooth jazz music with saxophone and piano, sophisticated and relaxed',
        duration: 15,
      },
      acoustic: {
        description: 'Natural acoustic sounds',
        prompt: 'Acoustic folk music with guitar and gentle vocals, warm and organic',
        duration: 15,
      },
      lofi: {
        description: 'Lo-fi hip hop beats',
        prompt: 'Lo-fi hip hop music with mellow beats and jazz samples, chill and relaxed',
        duration: 20,
      },
    };
  }

  /**
   * Mood presets for music generation
   */
  getMoodPresets(): Record<string, string> {
    return {
      happy: 'Happy and cheerful',
      calm: 'Calm and peaceful',
      energetic: 'Energetic and exciting',
      sad: 'Melancholic and emotional',
      dramatic: 'Dramatic and intense',
      mysterious: 'Mysterious and suspenseful',
      romantic: 'Romantic and tender',
      uplifting: 'Uplifting and motivational',
    };
  }
}

export default new ElevenLabsMusicService();
