export interface AudioLayer {
  filePath: string;
  volume: number;
  eq?: string;
  label: string;
}

export interface MultiLayerMixOptions {
  layers: AudioLayer[];
  outputPath: string;
  fadeIn?: number;
  fadeOut?: number;
  normalize?: boolean;
  targetLoudness?: number;
  compress?: boolean;
}

export interface MasteringOptions {
  inputPath: string;
  outputPath: string;
  targetLoudness?: number;
  eq?: {
    lowCut?: number;
    highCut?: number;
    midScoop?: { freq: number; q: number; gain: number };
  };
  compression?: {
    threshold?: number;
    ratio?: number;
    attack?: number;
    release?: number;
  };
  limiter?: {
    threshold?: number;
    release?: number;
  };
  stereoWidth?: number;
}

export type MusicStyle = 'corporate' | 'energetic' | 'calm' | 'dramatic' | 'uplifting';

export interface ProductionMusicOptions {
  scriptContent: string;
  tone: string;
  duration: number;
  style?: MusicStyle;
}
