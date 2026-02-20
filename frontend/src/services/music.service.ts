import api from './api';

interface GenerateMusicData {
  text: string;
  duration_seconds?: number;
  prompt_influence?: number;
  name?: string;
  genre?: string;
  mood?: string;
}

interface MusicTrack {
  id: string;
  name: string;
  description?: string;
  genre?: string;
  mood?: string;
  duration: number;
  fileUrl: string;
  isGenerated: boolean;
  metadata?: any;
  createdAt: string;
}

interface GenrePreset {
  description: string;
  prompt: string;
  duration: number;
}

class MusicService {
  async generateMusic(data: GenerateMusicData): Promise<MusicTrack> {
    return api.post<MusicTrack>('/music/generate-sync', data);
  }

  async generateMusicAsync(data: GenerateMusicData): Promise<{ jobId: string }> {
    return api.post<{ jobId: string }>('/music/generate', data);
  }

  async getMusicLibrary(filters?: {
    genre?: string;
    mood?: string;
    isGenerated?: boolean;
  }): Promise<MusicTrack[]> {
    return api.get<MusicTrack[]>('/music/library', filters);
  }

  async getMusicTrack(id: string): Promise<MusicTrack> {
    return api.get<MusicTrack>(`/music/library/${id}`);
  }

  async deleteMusicTrack(id: string): Promise<void> {
    return api.delete<void>(`/music/library/${id}`);
  }

  async uploadMusicTrack(
    file: File,
    data: { name: string; description?: string; genre?: string; mood?: string }
  ): Promise<MusicTrack> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', data.name);
    if (data.description) formData.append('description', data.description);
    if (data.genre) formData.append('genre', data.genre);
    if (data.mood) formData.append('mood', data.mood);

    const response = await fetch(
      `${import.meta.env.VITE_API_URL || 'http://localhost:5000/api'}/music/upload`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: formData,
      }
    );

    if (!response.ok) {
      throw new Error('Failed to upload music');
    }

    const result = await response.json();
    return result.data;
  }

  async getGenrePresets(): Promise<Record<string, GenrePreset>> {
    return api.get<Record<string, GenrePreset>>('/music/presets/genres');
  }

  async getMoodPresets(): Promise<Record<string, string>> {
    return api.get<Record<string, string>>('/music/presets/moods');
  }

  async getExamplePrompts(): Promise<string[]> {
    return api.get<string[]>('/music/examples');
  }

  async generatePrompt(data: {
    genre?: string;
    mood?: string;
    tempo?: string;
    instruments?: string;
  }): Promise<{ prompt: string }> {
    return api.post<{ prompt: string }>('/music/generate-prompt', data);
  }

  getDefaultSettings(): GenerateMusicData {
    return {
      text: '',
      duration_seconds: 10,
      prompt_influence: 0.3,
    };
  }
}

export default new MusicService();
