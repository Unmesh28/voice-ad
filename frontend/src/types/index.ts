// User types
export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: 'ADMIN' | 'USER' | 'API_USER';
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  success: boolean;
  data: {
    user: User;
    token: string;
    refreshToken: string;
  };
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

// Project types
export interface Project {
  id: string;
  userId: string;
  name: string;
  description?: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'DELETED';
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectData {
  name: string;
  description?: string;
}

// Script types
export interface Script {
  id: string;
  projectId: string;
  title: string;
  content: string;
  metadata?: Record<string, any>;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface GenerateScriptData {
  projectId: string;
  prompt: string;
  tone?: string;
  length?: 'short' | 'medium' | 'long';
  targetAudience?: string;
}

// Production types
export interface Production {
  id: string;
  projectId: string;
  scriptId?: string;
  voiceId?: string;
  musicId?: string;
  status: 'PENDING' | 'GENERATING_VOICE' | 'GENERATING_MUSIC' | 'MIXING' | 'COMPLETED' | 'FAILED';
  settings?: ProductionSettings;
  outputUrl?: string;
  duration?: number;
  errorMessage?: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductionSettings {
  voiceSpeed?: number;
  voicePitch?: number;
  musicVolume?: number;
  voiceVolume?: number;
  fadeIn?: number;
  fadeOut?: number;
  audioDucking?: boolean;
  outputFormat?: 'mp3' | 'wav' | 'aac';
}

export interface CreateProductionData {
  projectId: string;
  scriptId?: string;
  voiceId?: string;
  musicId?: string;
  settings?: ProductionSettings;
}

// Music types
export interface MusicTrack {
  id: string;
  name: string;
  description?: string;
  genre?: string;
  mood?: string;
  duration: number;
  fileUrl: string;
  isGenerated: boolean;
  createdAt: string;
}

export interface GenerateMusicData {
  description: string;
  genre?: string;
  mood?: string;
  duration?: number;
}

// Voice types
export interface Voice {
  voice_id: string;
  name: string;
  category?: string;
  description?: string;
  preview_url?: string;
  labels?: Record<string, string>;
}

// Job types
export interface Job {
  id: string;
  type: 'SCRIPT_GENERATION' | 'TTS_GENERATION' | 'MUSIC_GENERATION' | 'AUDIO_MIXING';
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  progress: number;
  result?: any;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Usage types
export interface UsageRecord {
  id: string;
  userId: string;
  resourceType: 'TTS_CHARACTERS' | 'MUSIC_GENERATION' | 'SCRIPT_GENERATION' | 'AUDIO_MIXING';
  quantity: number;
  cost?: number;
  createdAt: string;
}

export interface UsageStats {
  ttsCharacters: number;
  musicGenerations: number;
  scriptGenerations: number;
  audioMixings: number;
  totalCost?: number;
}
