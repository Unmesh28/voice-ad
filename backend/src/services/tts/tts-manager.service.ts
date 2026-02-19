import { logger } from '../../config/logger';
import type { TTSProvider } from '../../types/adform';
import type {
  ITTSProvider,
  TTSVoice,
  TTSGenerateOptions,
  TTSGenerateResult,
} from './tts-provider.interface';
import elevenLabsProvider from './elevenlabs-provider';

// ===========================================================================
// TTS Manager — Multi-Provider Orchestrator
//
// Like AudioStack's unified voice API, this manager routes TTS requests
// to the correct provider based on the voice/provider config.
//
// Usage:
//   const result = await ttsManager.generate({
//     provider: 'elevenlabs',
//     voiceId: 'EXAVITQu...',
//     text: 'Hello world',
//   });
//
// Adding a new provider:
//   1. Create a new file implementing ITTSProvider
//   2. Register it in registerProviders() below
// ===========================================================================

class TTSManagerService {
  private providers: Map<TTSProvider, ITTSProvider> = new Map();

  constructor() {
    this.registerProviders();
  }

  /**
   * Register all available TTS providers.
   * New providers are added here.
   */
  private registerProviders(): void {
    // ElevenLabs (primary)
    this.providers.set('elevenlabs', elevenLabsProvider);

    // Future providers:
    // this.providers.set('azure', azureProvider);
    // this.providers.set('openai', openaiProvider);
    // this.providers.set('google', googleProvider);
    // this.providers.set('amazon', amazonProvider);

    const configured = Array.from(this.providers.entries())
      .filter(([, p]) => p.isConfigured())
      .map(([name]) => name);

    logger.info(`TTS Manager initialized: ${configured.length} providers configured [${configured.join(', ')}]`);
  }

  /**
   * Get a provider by name.
   */
  getProvider(provider: TTSProvider): ITTSProvider {
    const p = this.providers.get(provider);
    if (!p) {
      throw new Error(`TTS provider "${provider}" is not registered. Available: ${Array.from(this.providers.keys()).join(', ')}`);
    }
    if (!p.isConfigured()) {
      throw new Error(`TTS provider "${provider}" is not configured. Check API key.`);
    }
    return p;
  }

  /**
   * List all registered providers and their status.
   */
  listProviders(): { provider: TTSProvider; configured: boolean }[] {
    return Array.from(this.providers.entries()).map(([name, p]) => ({
      provider: name,
      configured: p.isConfigured(),
    }));
  }

  /**
   * Get all voices from all configured providers.
   */
  async getAllVoices(): Promise<TTSVoice[]> {
    const allVoices: TTSVoice[] = [];

    for (const [name, provider] of this.providers) {
      if (!provider.isConfigured()) continue;

      try {
        const voices = await provider.getVoices();
        allVoices.push(...voices);
      } catch (err: any) {
        logger.warn(`Failed to fetch voices from ${name}: ${err.message}`);
      }
    }

    return allVoices;
  }

  /**
   * Get voices from a specific provider.
   */
  async getVoices(provider: TTSProvider): Promise<TTSVoice[]> {
    return this.getProvider(provider).getVoices();
  }

  /**
   * Generate speech using a specific provider.
   */
  async generate(
    provider: TTSProvider,
    options: TTSGenerateOptions
  ): Promise<TTSGenerateResult> {
    const p = this.getProvider(provider);
    logger.info(`TTS generate via ${provider}: voice=${options.voiceId}, text=${options.text.length} chars`);

    if (options.withTimestamps) {
      return p.generateWithTimestamps(options);
    }
    return p.generate(options);
  }

  /**
   * Generate speech with automatic provider detection.
   * Tries to determine the provider from the voiceId format.
   */
  async generateAuto(options: TTSGenerateOptions & { provider?: TTSProvider }): Promise<TTSGenerateResult> {
    const provider = options.provider || this.detectProvider(options.voiceId);
    return this.generate(provider, options);
  }

  /**
   * Try to detect the provider from a voice ID format.
   * Falls back to 'elevenlabs' as the default.
   */
  private detectProvider(voiceId: string): TTSProvider {
    // ElevenLabs voice IDs are 20-char alphanumeric strings
    if (/^[a-zA-Z0-9]{20,}$/.test(voiceId)) return 'elevenlabs';

    // Azure voices are like "en-US-JennyNeural"
    if (/^[a-z]{2}-[A-Z]{2}-\w+Neural$/.test(voiceId)) return 'azure';

    // OpenAI voices are short names like "alloy", "echo", "nova"
    if (['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].includes(voiceId)) return 'openai';

    // Default
    return 'elevenlabs';
  }

  /**
   * Estimate audio duration for text across any provider.
   */
  estimateDuration(provider: TTSProvider, text: string, speed?: number): number {
    return this.getProvider(provider).estimateDuration(text, speed);
  }
}

export default new TTSManagerService();
