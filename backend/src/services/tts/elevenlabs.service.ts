import axios from 'axios';
import { logger } from '../../config/logger';
import fs from 'fs';
import path from 'path';

interface Voice {
  voice_id: string;
  name: string;
  category?: string;
  description?: string;
  preview_url?: string;
  labels?: Record<string, string>;
}

interface VoiceSettings {
  stability?: number; // 0-1
  similarity_boost?: number; // 0-1
  style?: number; // 0-1
  use_speaker_boost?: boolean;
}

interface TTSOptions {
  voiceId: string;
  text: string;
  modelId?: string;
  voiceSettings?: VoiceSettings;
  outputFormat?: 'mp3_44100_128' | 'mp3_44100_192' | 'pcm_16000' | 'pcm_22050' | 'pcm_24000' | 'pcm_44100';
}

class ElevenLabsService {
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
   * Get all available voices
   */
  async getVoices(): Promise<Voice[]> {
    try {
      logger.info('Fetching available voices from ElevenLabs');

      const response = await axios.get(`${this.apiUrl}/voices`, {
        headers: {
          'xi-api-key': this.apiKey,
        },
        timeout: 10000,
      });

      const voices = response.data.voices || [];
      logger.info(`Retrieved ${voices.length} voices from ElevenLabs`);

      return voices;
    } catch (error: any) {
      logger.error('Error fetching voices from ElevenLabs:', {
        message: error.message,
        response: error.response?.data,
      });

      if (error.response?.status === 401) {
        throw new Error('Invalid ElevenLabs API key');
      }

      throw new Error(`Failed to fetch voices: ${error.message}`);
    }
  }

  /**
   * Get a specific voice by ID
   */
  async getVoice(voiceId: string): Promise<Voice> {
    try {
      logger.info(`Fetching voice details for ${voiceId}`);

      const response = await axios.get(`${this.apiUrl}/voices/${voiceId}`, {
        headers: {
          'xi-api-key': this.apiKey,
        },
        timeout: 10000,
      });

      return response.data;
    } catch (error: any) {
      logger.error(`Error fetching voice ${voiceId}:`, error.message);
      throw new Error(`Failed to fetch voice: ${error.message}`);
    }
  }

  /**
   * Generate speech from text using ElevenLabs TTS
   */
  async generateSpeech(options: TTSOptions): Promise<Buffer> {
    const {
      voiceId,
      text,
      modelId = 'eleven_multilingual_v2',
      voiceSettings = {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
      outputFormat = 'mp3_44100_128',
    } = options;

    try {
      logger.info('Generating speech with ElevenLabs', {
        voiceId,
        textLength: text.length,
        modelId,
      });

      const response = await axios.post(
        `${this.apiUrl}/text-to-speech/${voiceId}`,
        {
          text,
          model_id: modelId,
          voice_settings: voiceSettings,
        },
        {
          headers: {
            'xi-api-key': this.apiKey,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          params: {
            output_format: outputFormat,
          },
          responseType: 'arraybuffer',
          timeout: 120000, // 2 minutes timeout for long texts
        }
      );

      const audioBuffer = Buffer.from(response.data);
      logger.info('Speech generated successfully', {
        audioSize: audioBuffer.length,
        characters: text.length,
      });

      return audioBuffer;
    } catch (error: any) {
      logger.error('Error generating speech with ElevenLabs:', {
        message: error.message,
        response: error.response?.data?.toString(),
        voiceId,
      });

      if (error.response?.status === 401) {
        throw new Error('Invalid ElevenLabs API key');
      } else if (error.response?.status === 400) {
        throw new Error('Invalid request parameters');
      } else if (error.response?.status === 429) {
        throw new Error('ElevenLabs rate limit exceeded. Please try again later.');
      } else if (error.response?.status === 500) {
        throw new Error('ElevenLabs service error. Please try again later.');
      }

      throw new Error(`Failed to generate speech: ${error.message}`);
    }
  }

  /**
   * Save audio buffer to file
   */
  async saveAudioToFile(audioBuffer: Buffer, filename: string): Promise<string> {
    try {
      const uploadDir = process.env.UPLOAD_DIR || './uploads';
      const audioDir = path.join(uploadDir, 'audio');

      // Create directory if it doesn't exist
      if (!fs.existsSync(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true });
      }

      const filePath = path.join(audioDir, filename);
      fs.writeFileSync(filePath, audioBuffer);

      logger.info(`Audio saved to file: ${filePath}`);

      return filePath;
    } catch (error: any) {
      logger.error('Error saving audio to file:', error.message);
      throw new Error(`Failed to save audio: ${error.message}`);
    }
  }

  /**
   * Generate speech and save to file
   */
  async generateAndSave(
    options: TTSOptions,
    filename: string
  ): Promise<{ filePath: string; audioBuffer: Buffer }> {
    const audioBuffer = await this.generateSpeech(options);
    const filePath = await this.saveAudioToFile(audioBuffer, filename);

    return {
      filePath,
      audioBuffer,
    };
  }

  /**
   * Get user subscription info (quota, character count, etc.)
   */
  async getSubscriptionInfo(): Promise<any> {
    try {
      const response = await axios.get(`${this.apiUrl}/user/subscription`, {
        headers: {
          'xi-api-key': this.apiKey,
        },
        timeout: 10000,
      });

      return response.data;
    } catch (error: any) {
      logger.error('Error fetching subscription info:', error.message);
      throw new Error(`Failed to fetch subscription info: ${error.message}`);
    }
  }

  /**
   * Get character count for text (for quota tracking)
   */
  getCharacterCount(text: string): number {
    // Remove extra whitespace and count
    return text.trim().replace(/\s+/g, ' ').length;
  }

  /**
   * Estimate audio duration (rough estimate)
   * Average speaking rate: ~150 words per minute
   */
  estimateAudioDuration(text: string): number {
    const words = text.trim().split(/\s+/).length;
    const minutes = words / 150;
    const seconds = Math.ceil(minutes * 60);
    return seconds;
  }

  /**
   * Validate voice settings
   */
  validateVoiceSettings(settings: VoiceSettings): VoiceSettings {
    return {
      stability: Math.max(0, Math.min(1, settings.stability || 0.5)),
      similarity_boost: Math.max(0, Math.min(1, settings.similarity_boost || 0.75)),
      style: Math.max(0, Math.min(1, settings.style || 0.0)),
      use_speaker_boost: settings.use_speaker_boost !== false,
    };
  }

  /**
   * Get default voice settings
   */
  getDefaultVoiceSettings(): VoiceSettings {
    return {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.0,
      use_speaker_boost: true,
    };
  }

  /**
   * Check if API key is configured
   */
  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }
}

export default new ElevenLabsService();
