import api from './api';
import { Voice } from '../types';

interface VoiceSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
}

interface GenerateTTSData {
  scriptId: string;
  voiceId: string;
  voiceSettings?: VoiceSettings;
}

interface GenerateTTSFromTextData {
  text: string;
  voiceId: string;
  voiceSettings?: VoiceSettings;
}

interface TTSResult {
  audioUrl: string;
  characterCount: number;
  estimatedDuration: number;
  voiceId: string;
}

class TTSService {
  async getVoices(): Promise<Voice[]> {
    return api.get<Voice[]>('/tts/voices');
  }

  async getVoice(id: string): Promise<Voice> {
    return api.get<Voice>(`/tts/voices/${id}`);
  }

  async generateTTS(data: GenerateTTSData): Promise<TTSResult> {
    return api.post<TTSResult>('/tts/generate-sync', data);
  }

  async generateTTSAsync(data: GenerateTTSData): Promise<{ jobId: string }> {
    return api.post<{ jobId: string }>('/tts/generate', data);
  }

  async generateTTSFromText(data: GenerateTTSFromTextData): Promise<TTSResult> {
    return api.post<TTSResult>('/tts/generate-text', data);
  }

  async previewVoice(voiceId: string, text?: string): Promise<Blob> {
    const response = await fetch(
      `${import.meta.env.VITE_API_URL || 'http://localhost:5011/api'}/tts/voices/${voiceId}/preview`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ text }),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to preview voice');
    }

    return response.blob();
  }

  async getSubscriptionInfo(): Promise<any> {
    return api.get<any>('/tts/subscription');
  }

  getDefaultVoiceSettings(): VoiceSettings {
    return {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.0,
      use_speaker_boost: true,
    };
  }
}

export default new TTSService();
