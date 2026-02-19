// ===========================================================================
// Multi-Provider TTS Abstraction Layer
//
// Like AudioStack's unified voice API across 12+ providers, this provides
// a single interface for TTS generation regardless of the underlying
// provider (ElevenLabs, Azure, OpenAI, Google, Amazon).
//
// Benefits:
//   - Swap providers without changing code
//   - Use different providers for different voices
//   - Mix voices from multiple providers in one ad
//   - Unified SSML handling across providers
// ===========================================================================

import type { TTSProvider } from '../../types/adform';

/** A voice available from a TTS provider. */
export interface TTSVoice {
  /** Provider-specific voice ID */
  voiceId: string;
  /** Provider this voice belongs to */
  provider: TTSProvider;
  /** Human-readable voice name */
  name: string;
  /** Language code (e.g. "en-US", "hi-IN") */
  language?: string;
  /** Gender */
  gender?: 'male' | 'female' | 'neutral';
  /** Description of the voice */
  description?: string;
  /** Preview audio URL */
  previewUrl?: string;
  /** Voice category (e.g. "professional", "narrative", "conversational") */
  category?: string;
  /** Additional labels/tags */
  labels?: Record<string, string>;
  /** Supported features */
  features?: {
    ssml?: boolean;
    timestamps?: boolean;
    cloning?: boolean;
    speechToSpeech?: boolean;
    styles?: string[];
  };
}

/** Character-level or word-level alignment from TTS. */
export interface TTSAlignment {
  characters?: string[];
  characterStartTimes?: number[];
  characterEndTimes?: number[];
  words?: { word: string; start: number; end: number }[];
}

/** TTS generation options. */
export interface TTSGenerateOptions {
  /** Voice ID (provider-specific) */
  voiceId: string;
  /** Text to synthesize */
  text: string;
  /** TTS model to use (provider-specific) */
  model?: string;
  /** Speed multiplier (1.0 = normal) */
  speed?: number;
  /** Provider-specific voice settings */
  settings?: Record<string, unknown>;
  /** Output format */
  outputFormat?: string;
  /** Whether to include alignment/timestamp data */
  withTimestamps?: boolean;
}

/** Result of TTS generation. */
export interface TTSGenerateResult {
  /** Generated audio buffer */
  audioBuffer: Buffer;
  /** Alignment data (if requested and supported) */
  alignment?: TTSAlignment | null;
  /** Audio duration in seconds (if available) */
  duration?: number;
  /** Provider that generated this */
  provider: TTSProvider;
}

/**
 * Interface that every TTS provider must implement.
 */
export interface ITTSProvider {
  /** Provider identifier */
  readonly provider: TTSProvider;

  /** Whether this provider is configured and ready */
  isConfigured(): boolean;

  /** Get all available voices from this provider */
  getVoices(): Promise<TTSVoice[]>;

  /** Get a specific voice by ID */
  getVoice(voiceId: string): Promise<TTSVoice | null>;

  /** Generate speech from text */
  generate(options: TTSGenerateOptions): Promise<TTSGenerateResult>;

  /** Generate speech with alignment timestamps */
  generateWithTimestamps(options: TTSGenerateOptions): Promise<TTSGenerateResult>;

  /** Estimate audio duration for given text */
  estimateDuration(text: string, speed?: number): number;
}
