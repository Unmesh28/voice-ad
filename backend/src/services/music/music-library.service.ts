import { logger } from '../../config/logger';
import path from 'path';
import fs from 'fs';

export interface MusicCatalogTrack {
  filename: string;
  relative_path: string;
  file_size_mb: number;
  duration_seconds: number;
  tempo_bpm: number;
  estimated_key: string;
  genre?: string;
  mood?: string;
  energy_level?: string;
  instruments_detected?: string[];
  suitable_use_cases?: string[];
  brief_description?: string;
  cultural_context?: string;
  similar_artists_or_styles?: string[];
  production_style?: string;
  tempo_feel?: string;
}

export interface MusicSelectionResult {
  selectedTrack: {
    filename: string;
    reasoning: string;
  };
  mixingParameters: {
    musicVolume: number;
    fadeInSeconds: number;
    fadeOutSeconds: number;
    fadeCurve: string;
    voiceVolume: number;
    audioDucking: boolean;
    duckingAmount: number;
    musicDelay: number;
  };
}

interface RawCatalogEntry {
  filename: string;
  relative_path: string;
  file_size_mb: number;
  technical?: {
    file_info?: {
      duration_seconds?: number;
    };
    rhythm?: {
      tempo_bpm?: number;
    };
    tonal?: {
      estimated_key?: string;
    };
  };
  human_analysis?: {
    parse_error?: string;
    error?: string;
    genre?: string;
    mood?: string;
    energy_level?: string;
    instruments_detected?: string[];
    suitable_use_cases?: string[];
    brief_description?: string;
    cultural_context?: string;
    similar_artists_or_styles?: string[];
    production_style?: string;
    tempo_feel?: string;
  };
}

class MusicLibraryService {
  private catalog: RawCatalogEntry[] = [];
  private catalogLoaded = false;

  constructor() {
    this.loadCatalog();
  }

  private loadCatalog(): void {
    try {
      const catalogPath = path.resolve(__dirname, '../../data/music-catalog.json');

      if (!fs.existsSync(catalogPath)) {
        logger.warn(`Music catalog not found at ${catalogPath}. Music library will be empty.`);
        return;
      }

      const rawData = fs.readFileSync(catalogPath, 'utf-8');
      const parsed = JSON.parse(rawData);

      if (Array.isArray(parsed)) {
        this.catalog = parsed;
      } else if (parsed && typeof parsed === 'object' && parsed.tracks) {
        this.catalog = parsed.tracks;
      } else {
        logger.warn('Music catalog has unexpected format. Expected an array or { tracks: [] }.');
        return;
      }

      this.catalogLoaded = true;
      logger.info(`Music catalog loaded: ${this.catalog.length} tracks`);
    } catch (error: any) {
      logger.warn(`Failed to load music catalog: ${error.message}`);
    }
  }

  /**
   * Returns a compact array of MusicCatalogTrack objects, extracting key fields
   * from both technical and human_analysis sections.
   * Tracks with parse_error or error in human_analysis are still included but
   * only with their technical data.
   */
  getTrackSummaries(): MusicCatalogTrack[] {
    return this.catalog.map((entry) => {
      const technical = entry.technical || {};
      const fileInfo = technical.file_info || {};
      const rhythm = technical.rhythm || {};
      const tonal = technical.tonal || {};

      const track: MusicCatalogTrack = {
        filename: entry.filename,
        relative_path: entry.relative_path,
        file_size_mb: entry.file_size_mb,
        duration_seconds: fileInfo.duration_seconds || 0,
        tempo_bpm: rhythm.tempo_bpm || 0,
        estimated_key: tonal.estimated_key || 'unknown',
      };

      const human = entry.human_analysis;
      if (human && !human.parse_error && !human.error) {
        if (human.genre) track.genre = human.genre;
        if (human.mood) track.mood = human.mood;
        if (human.energy_level) track.energy_level = human.energy_level;
        if (human.instruments_detected) track.instruments_detected = human.instruments_detected;
        if (human.suitable_use_cases) track.suitable_use_cases = human.suitable_use_cases;
        if (human.brief_description) track.brief_description = human.brief_description;
        if (human.cultural_context) track.cultural_context = human.cultural_context;
        if (human.similar_artists_or_styles) track.similar_artists_or_styles = human.similar_artists_or_styles;
        if (human.production_style) track.production_style = human.production_style;
        if (human.tempo_feel) track.tempo_feel = human.tempo_feel;
      }

      return track;
    });
  }

  /**
   * Returns the full raw track object from the catalog by filename.
   */
  getTrackByFilename(filename: string): RawCatalogEntry | undefined {
    return this.catalog.find((entry) => entry.filename === filename);
  }

  /**
   * Returns the absolute path to the music file on disk.
   * Uses MUSIC_LIBRARY_PATH env var, defaulting to process.cwd() + '/uploads/music-library'.
   */
  getTrackFilePath(filename: string): string {
    const libraryPath = process.env.MUSIC_LIBRARY_PATH || path.join(process.cwd(), 'uploads', 'music-library');
    return path.join(libraryPath, filename);
  }

  /**
   * Returns a formatted string summary of all tracks suitable for LLM context.
   * Each track is a compact one-line summary to minimize token usage while
   * providing enough information for the LLM to make a good selection.
   */
  getSummariesForLLM(): string {
    const summaries = this.getTrackSummaries();

    if (summaries.length === 0) {
      return 'No tracks available in the music library.';
    }

    const lines = summaries.map((track, index) => {
      const parts: string[] = [];

      parts.push(`[${index + 1}] "${track.filename}"`);

      if (track.genre) parts.push(`Genre: ${track.genre}`);
      if (track.mood) parts.push(`Mood: ${track.mood}`);
      if (track.energy_level) parts.push(`Energy: ${track.energy_level}`);
      if (track.tempo_bpm) parts.push(`BPM: ${track.tempo_bpm}`);
      if (track.duration_seconds) parts.push(`Duration: ${Math.round(track.duration_seconds)}s`);
      if (track.instruments_detected && track.instruments_detected.length > 0) {
        parts.push(`Instruments: ${track.instruments_detected.join(', ')}`);
      }
      if (track.suitable_use_cases && track.suitable_use_cases.length > 0) {
        parts.push(`Use: ${track.suitable_use_cases.join(', ')}`);
      }
      if (track.brief_description) parts.push(`Brief: "${track.brief_description}"`);

      return parts.join(' | ');
    });

    return lines.join('\n');
  }
}

export default new MusicLibraryService();
