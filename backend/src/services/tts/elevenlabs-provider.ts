import elevenLabsService from './elevenlabs.service';
import { logger } from '../../config/logger';
import type {
  ITTSProvider,
  TTSVoice,
  TTSGenerateOptions,
  TTSGenerateResult,
} from './tts-provider.interface';

// ===========================================================================
// ElevenLabs Provider Adapter
//
// Wraps the existing elevenlabs.service.ts behind the ITTSProvider interface
// so it can be used interchangeably with other providers.
// ===========================================================================

class ElevenLabsProvider implements ITTSProvider {
  readonly provider = 'elevenlabs' as const;

  isConfigured(): boolean {
    return elevenLabsService.isConfigured();
  }

  async getVoices(): Promise<TTSVoice[]> {
    const voices = await elevenLabsService.getVoices();
    return voices.map((v) => ({
      voiceId: v.voice_id,
      provider: this.provider,
      name: v.name,
      description: v.description || undefined,
      previewUrl: v.preview_url || undefined,
      category: v.category || undefined,
      labels: v.labels || undefined,
      gender: v.labels?.gender as 'male' | 'female' | 'neutral' | undefined,
      language: v.labels?.language || undefined,
      features: {
        ssml: false, // ElevenLabs uses its own audio tags, not SSML
        timestamps: true,
        cloning: true,
        speechToSpeech: true,
        styles: ['excited', 'calm', 'whisper', 'warm', 'urgent'],
      },
    }));
  }

  async getVoice(voiceId: string): Promise<TTSVoice | null> {
    try {
      const v = await elevenLabsService.getVoice(voiceId);
      return {
        voiceId: v.voice_id,
        provider: this.provider,
        name: v.name,
        description: v.description || undefined,
        previewUrl: v.preview_url || undefined,
        category: v.category || undefined,
        labels: v.labels || undefined,
      };
    } catch {
      return null;
    }
  }

  async generate(options: TTSGenerateOptions): Promise<TTSGenerateResult> {
    const settings = options.settings || {};
    const audioBuffer = await elevenLabsService.generateSpeech({
      voiceId: options.voiceId,
      text: options.text,
      modelId: (options.model as string) || 'eleven_v3',
      voiceSettings: {
        stability: (settings.stability as number) ?? 0.5,
        similarity_boost: (settings.similarity_boost as number) ?? 0.75,
        style: (settings.style as number) ?? 0.0,
        use_speaker_boost: (settings.use_speaker_boost as boolean) ?? true,
      },
      outputFormat: (options.outputFormat as any) || 'mp3_44100_128',
    });

    return {
      audioBuffer,
      provider: this.provider,
    };
  }

  async generateWithTimestamps(options: TTSGenerateOptions): Promise<TTSGenerateResult> {
    const settings = options.settings || {};
    const result = await elevenLabsService.generateSpeechWithTimestamps({
      voiceId: options.voiceId,
      text: options.text,
      modelId: (options.model as string) || 'eleven_v3',
      voiceSettings: {
        stability: (settings.stability as number) ?? 0.5,
        similarity_boost: (settings.similarity_boost as number) ?? 0.75,
        style: (settings.style as number) ?? 0.0,
        use_speaker_boost: (settings.use_speaker_boost as boolean) ?? true,
      },
      outputFormat: (options.outputFormat as any) || 'mp3_44100_128',
    });

    return {
      audioBuffer: result.audioBuffer,
      alignment: result.alignment ? {
        characters: result.alignment.characters,
        characterStartTimes: result.alignment.character_start_times_seconds,
        characterEndTimes: result.alignment.character_end_times_seconds,
      } : null,
      provider: this.provider,
    };
  }

  estimateDuration(text: string, speed: number = 1.0): number {
    return elevenLabsService.estimateAudioDuration(text) / speed;
  }
}

export default new ElevenLabsProvider();
