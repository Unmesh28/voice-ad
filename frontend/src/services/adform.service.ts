import api from './api';

// ============================================================================
// AdForm Service — Frontend client for the elastic template ad pipeline
// ============================================================================

/** Sound template from the backend catalog */
export interface SoundTemplate {
  id: string;
  name: string;
  genre?: string;
  mood?: string;
  energy?: string;
  bpm?: number;
  tags?: string[];
  bestFor?: string[];
  segments?: { type: string; filePath: string; duration: number }[];
}

/** Voice from any TTS provider */
export interface AdFormVoice {
  voiceId: string;
  provider: string;
  name: string;
  gender?: string;
  language?: string;
  category?: string;
  description?: string;
  previewUrl?: string;
  labels?: Record<string, string>;
}

/** AdForm build result */
export interface AdFormBuildResult {
  buildId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  stage?: string;
  outputs?: {
    format: string;
    url: string;
    fileSize?: number;
    duration?: number;
  }[];
  error?: string;
  timing?: {
    contentMs?: number;
    speechMs?: number;
    productionMs?: number;
    deliveryMs?: number;
    totalMs?: number;
  };
}

/** Presets available from the backend */
export interface AdFormPresets {
  mastering: string[];
  loudness: Record<string, { lufs: number; truePeak: number }>;
  formats: string[];
}

/** Section of the ad script */
export interface AdFormSection {
  name: string;
  soundSegment: 'intro' | 'main' | 'outro';
  text: string;
}

/** Full AdForm document sent to the backend */
export interface AdFormDocument {
  version: 'v1';
  content: {
    scriptText?: string;
    sections?: AdFormSection[];
  };
  speech: {
    voice: {
      provider: string;
      voiceId: string;
      speed?: number;
      settings?: Record<string, unknown>;
    };
  };
  production: {
    soundTemplate: string;
    masteringPreset?: string;
    loudnessPreset?: string;
    timelineProperties?: {
      fadeIn?: number;
      fadeOut?: number;
      fadeCurve?: string;
      soundTail?: number;
    };
  };
  delivery: {
    format?: string;
    public?: boolean;
  };
  metadata?: {
    title?: string;
    brand?: string;
  };
}

class AdFormService {
  /** Build a complete audio ad from an AdForm document */
  async build(adform: AdFormDocument): Promise<AdFormBuildResult> {
    return api.post<AdFormBuildResult>('/adform/build', adform);
  }

  /** Validate an AdForm without building */
  async validate(adform: AdFormDocument): Promise<{ valid: boolean; errors: string[] }> {
    return api.post<{ valid: boolean; errors: string[] }>('/adform/validate', adform);
  }

  /** Get available presets (mastering, loudness, formats) */
  async getPresets(): Promise<AdFormPresets> {
    return api.get<AdFormPresets>('/adform/presets');
  }

  /** Get all voices across providers */
  async getVoices(): Promise<{ totalVoices: number; voices: AdFormVoice[] }> {
    return api.get<{ totalVoices: number; voices: AdFormVoice[] }>('/adform/voices');
  }

  /** Get voices for a specific provider */
  async getVoicesByProvider(provider: string): Promise<{ totalVoices: number; voices: AdFormVoice[] }> {
    return api.get<{ totalVoices: number; voices: AdFormVoice[] }>(`/adform/voices/${provider}`);
  }

  /** Get all sound templates */
  async getTemplates(): Promise<{ total: number; templates: SoundTemplate[] }> {
    return api.get<{ total: number; templates: SoundTemplate[] }>('/adform/templates');
  }

  /** Search sound templates */
  async searchTemplates(params: {
    genre?: string;
    mood?: string;
    energy?: string;
    tags?: string;
  }): Promise<{ total: number; templates: SoundTemplate[] }> {
    return api.get<{ total: number; templates: SoundTemplate[] }>('/adform/templates/search', params);
  }
}

export default new AdFormService();
