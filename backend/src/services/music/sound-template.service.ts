import path from 'path';
import fs from 'fs';
import { logger } from '../../config/logger';
import ffmpegService from '../audio/ffmpeg.service';
import type { SoundTemplateSegment, AdFormSoundTemplate } from '../../types/adform';

// ===========================================================================
// Elastic Sound Template Service
//
// Like AudioStack's sound templates, each template has 3 segments:
//   - intro: Opening music (plays once)
//   - main:  Core backing track (LOOPS to match speech duration)
//   - outro: Closing music (plays once)
//
// The "elastic" part: the main segment auto-loops so the music bed
// always matches the speech duration, regardless of length.
// ===========================================================================

/** Metadata for a sound template in the library. */
export interface SoundTemplateMetadata {
  id: string;
  name: string;
  genre?: string;
  mood?: string;
  energy?: 'low' | 'medium' | 'high';
  bpm?: number;
  instruments?: string[];
  tags?: string[];
  /** Duration of each segment in seconds */
  introDuration?: number;
  mainDuration?: number;
  outroDuration?: number;
  /** Best for these ad categories */
  bestFor?: string[];
}

/** Result of assembling an elastic template. */
export interface ElasticAssemblyResult {
  /** Path to the assembled audio file */
  filePath: string;
  /** Total duration of the assembled file */
  duration: number;
  /** How many times the main segment was looped */
  mainLoops: number;
}

class SoundTemplateService {
  private templatesDir: string;
  private catalog: SoundTemplateMetadata[] = [];

  constructor() {
    this.templatesDir = process.env.SOUND_TEMPLATES_PATH
      || path.resolve(process.cwd(), 'uploads', 'sound-templates');
    this.loadCatalog();
  }

  /**
   * Load the sound template catalog from disk.
   * Each template is a directory with intro.mp3, main.mp3, outro.mp3 and a metadata.json.
   */
  private loadCatalog(): void {
    try {
      if (!fs.existsSync(this.templatesDir)) {
        fs.mkdirSync(this.templatesDir, { recursive: true });
        logger.info(`Sound templates directory created: ${this.templatesDir}`);
        return;
      }

      const catalogPath = path.join(this.templatesDir, 'catalog.json');
      if (fs.existsSync(catalogPath)) {
        const raw = fs.readFileSync(catalogPath, 'utf-8');
        const parsed = JSON.parse(raw);
        this.catalog = Array.isArray(parsed) ? parsed : parsed.templates || [];
        logger.info(`Sound template catalog loaded: ${this.catalog.length} templates`);
        return;
      }

      // Auto-discover templates from directory structure
      const entries = fs.readdirSync(this.templatesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const templateDir = path.join(this.templatesDir, entry.name);
        const metadataPath = path.join(templateDir, 'metadata.json');
        const mainPath = path.join(templateDir, 'main.mp3');

        // At minimum, a template needs a main.mp3
        if (!fs.existsSync(mainPath)) continue;

        let metadata: SoundTemplateMetadata = { id: entry.name, name: entry.name };
        if (fs.existsSync(metadataPath)) {
          try {
            metadata = { ...metadata, ...JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) };
          } catch {
            // Use defaults
          }
        }

        this.catalog.push(metadata);
      }

      logger.info(`Sound templates auto-discovered: ${this.catalog.length} templates`);
    } catch (err: any) {
      logger.warn(`Failed to load sound template catalog: ${err.message}`);
    }
  }

  /** Get all templates. */
  getTemplates(): SoundTemplateMetadata[] {
    return this.catalog;
  }

  /** Search templates by genre, mood, or tags. */
  searchTemplates(query: {
    genre?: string;
    mood?: string;
    energy?: string;
    tags?: string[];
    category?: string;
  }): SoundTemplateMetadata[] {
    return this.catalog.filter((t) => {
      if (query.genre && t.genre && !t.genre.toLowerCase().includes(query.genre.toLowerCase())) return false;
      if (query.mood && t.mood && !t.mood.toLowerCase().includes(query.mood.toLowerCase())) return false;
      if (query.energy && t.energy && t.energy !== query.energy) return false;
      if (query.category && t.bestFor && !t.bestFor.some((b) => b.toLowerCase().includes(query.category!.toLowerCase()))) return false;
      if (query.tags && query.tags.length > 0 && t.tags) {
        const templateTags = t.tags.map((tag) => tag.toLowerCase());
        if (!query.tags.some((qt) => templateTags.includes(qt.toLowerCase()))) return false;
      }
      return true;
    });
  }

  /** Get template by ID. */
  getTemplate(id: string): SoundTemplateMetadata | undefined {
    return this.catalog.find((t) => t.id === id);
  }

  /**
   * Get the file paths for a template's segments.
   */
  getSegmentPaths(templateId: string): { intro?: string; main: string; outro?: string } {
    const templateDir = path.join(this.templatesDir, templateId);

    const mainPath = path.join(templateDir, 'main.mp3');
    if (!fs.existsSync(mainPath)) {
      throw new Error(`Template "${templateId}" main segment not found at: ${mainPath}`);
    }

    const introPath = path.join(templateDir, 'intro.mp3');
    const outroPath = path.join(templateDir, 'outro.mp3');

    return {
      intro: fs.existsSync(introPath) ? introPath : undefined,
      main: mainPath,
      outro: fs.existsSync(outroPath) ? outroPath : undefined,
    };
  }

  /**
   * Assemble an elastic sound template to match a target speech duration.
   *
   * Pipeline:
   *   1. Play intro (once)
   *   2. Loop main segment until speech is covered
   *   3. Play outro (once)
   *   4. Trim to exact target duration
   *   5. Apply crossfades between segments
   *
   * @param templateId - Template ID from the catalog
   * @param targetDuration - Total target duration in seconds
   * @param outputPath - Where to save the assembled file
   */
  async assembleElastic(
    templateId: string,
    targetDuration: number,
    outputPath: string
  ): Promise<ElasticAssemblyResult> {
    const segments = this.getSegmentPaths(templateId);

    // Get durations of each segment
    const mainDuration = await ffmpegService.getAudioDuration(segments.main);
    const introDuration = segments.intro ? await ffmpegService.getAudioDuration(segments.intro) : 0;
    const outroDuration = segments.outro ? await ffmpegService.getAudioDuration(segments.outro) : 0;

    // Calculate how much time the main segment needs to fill
    const mainTargetDuration = targetDuration - introDuration - outroDuration;

    if (mainTargetDuration <= 0) {
      // Target is shorter than intro + outro; just use intro trimmed
      logger.warn(`Target duration ${targetDuration}s shorter than intro+outro (${introDuration + outroDuration}s), trimming`);
      if (segments.intro) {
        await ffmpegService.trimAudio(segments.intro, targetDuration, outputPath);
      } else {
        await ffmpegService.trimAudio(segments.main, targetDuration, outputPath);
      }
      return { filePath: outputPath, duration: targetDuration, mainLoops: 0 };
    }

    // Calculate how many times to loop the main segment
    const mainLoops = Math.ceil(mainTargetDuration / mainDuration);

    logger.info(`Elastic assembly: intro=${introDuration.toFixed(1)}s, main=${mainDuration.toFixed(1)}s x${mainLoops}, outro=${outroDuration.toFixed(1)}s → target=${targetDuration}s`);

    // Build segment list for crossfade assembly
    const crossfadeSegments: { filePath: string; duration?: number; crossfadeDuration?: number }[] = [];

    // Add intro
    if (segments.intro) {
      crossfadeSegments.push({
        filePath: segments.intro,
        duration: introDuration,
        crossfadeDuration: 0.3, // Short crossfade into main
      });
    }

    // Add main loops
    for (let i = 0; i < mainLoops; i++) {
      crossfadeSegments.push({
        filePath: segments.main,
        duration: mainDuration,
        crossfadeDuration: 0.2, // Seamless loop crossfade
      });
    }

    // Add outro
    if (segments.outro) {
      crossfadeSegments.push({
        filePath: segments.outro,
        duration: outroDuration,
        crossfadeDuration: 0.3,
      });
    }

    if (crossfadeSegments.length === 1) {
      // Only main segment, extend it
      await ffmpegService.extendAudioWithCrossfade(
        segments.main,
        targetDuration,
        outputPath
      );
    } else {
      // Crossfade all segments together
      const rawOutputPath = outputPath.replace(/\.mp3$/, '_raw.mp3');
      await ffmpegService.crossfadeAudioSegments(
        crossfadeSegments,
        0.3,
        rawOutputPath
      );

      // Trim to exact target duration
      await ffmpegService.trimAudio(rawOutputPath, targetDuration, outputPath);

      // Clean up raw file
      try { fs.unlinkSync(rawOutputPath); } catch { /* ignore */ }
    }

    const actualDuration = await ffmpegService.getAudioDuration(outputPath);
    logger.info(`Elastic assembly complete: ${actualDuration.toFixed(1)}s (target: ${targetDuration}s)`);

    return {
      filePath: outputPath,
      duration: actualDuration,
      mainLoops,
    };
  }

  /**
   * Assemble from an AdFormSoundTemplate definition (with explicit segment paths).
   */
  async assembleFromDefinition(
    template: AdFormSoundTemplate,
    targetDuration: number,
    outputPath: string
  ): Promise<ElasticAssemblyResult> {
    // If template has segments defined, use them directly
    if (template.segments && template.segments.length > 0) {
      return this.assembleFromSegments(template.segments, targetDuration, outputPath);
    }

    // If template has a single file path, loop it
    if (template.filePath) {
      await ffmpegService.extendAudioWithCrossfade(
        template.filePath,
        targetDuration,
        outputPath
      );
      const duration = await ffmpegService.getAudioDuration(outputPath);
      return { filePath: outputPath, duration, mainLoops: 1 };
    }

    // If template has an ID, look it up in the catalog
    return this.assembleElastic(template.id, targetDuration, outputPath);
  }

  /**
   * Assemble from explicit segment definitions.
   */
  private async assembleFromSegments(
    segments: SoundTemplateSegment[],
    targetDuration: number,
    outputPath: string
  ): Promise<ElasticAssemblyResult> {
    const intro = segments.find((s) => s.type === 'intro');
    const main = segments.find((s) => s.type === 'main');
    const outro = segments.find((s) => s.type === 'outro');

    if (!main) {
      throw new Error('Sound template must have a "main" segment');
    }

    const introDuration = intro ? await ffmpegService.getAudioDuration(intro.filePath) : 0;
    const mainDuration = await ffmpegService.getAudioDuration(main.filePath);
    const outroDuration = outro ? await ffmpegService.getAudioDuration(outro.filePath) : 0;

    const mainTargetDuration = targetDuration - introDuration - outroDuration;
    const mainLoops = Math.max(1, Math.ceil(mainTargetDuration / mainDuration));

    const crossfadeSegments: { filePath: string; crossfadeDuration?: number }[] = [];

    if (intro) {
      crossfadeSegments.push({ filePath: intro.filePath, crossfadeDuration: 0.3 });
    }

    for (let i = 0; i < mainLoops; i++) {
      crossfadeSegments.push({ filePath: main.filePath, crossfadeDuration: 0.2 });
    }

    if (outro) {
      crossfadeSegments.push({ filePath: outro.filePath, crossfadeDuration: 0.3 });
    }

    if (crossfadeSegments.length === 1) {
      await ffmpegService.extendAudioWithCrossfade(main.filePath, targetDuration, outputPath);
    } else {
      const rawOutputPath = outputPath.replace(/\.mp3$/, '_raw.mp3');
      await ffmpegService.crossfadeAudioSegments(crossfadeSegments, 0.3, rawOutputPath);
      await ffmpegService.trimAudio(rawOutputPath, targetDuration, outputPath);
      try { fs.unlinkSync(rawOutputPath); } catch { /* ignore */ }
    }

    const duration = await ffmpegService.getAudioDuration(outputPath);
    return { filePath: outputPath, duration, mainLoops };
  }

  /**
   * Create a new template from an existing single-file track by splitting it
   * into intro/main/outro segments automatically.
   *
   * Heuristic:
   *   - First 10% → intro (min 2s, max 8s)
   *   - Middle 80% → main (loopable body)
   *   - Last 10% → outro (min 2s, max 8s)
   */
  async createTemplateFromTrack(
    trackPath: string,
    templateId: string,
    metadata?: Partial<SoundTemplateMetadata>
  ): Promise<SoundTemplateMetadata> {
    const templateDir = path.join(this.templatesDir, templateId);
    if (!fs.existsSync(templateDir)) {
      fs.mkdirSync(templateDir, { recursive: true });
    }

    const totalDuration = await ffmpegService.getAudioDuration(trackPath);

    // Calculate segment boundaries
    const introDuration = Math.max(2, Math.min(8, totalDuration * 0.1));
    const outroDuration = Math.max(2, Math.min(8, totalDuration * 0.1));
    const mainStart = introDuration;
    const mainEnd = totalDuration - outroDuration;
    const mainDuration = mainEnd - mainStart;

    const introPath = path.join(templateDir, 'intro.mp3');
    const mainPath = path.join(templateDir, 'main.mp3');
    const outroPath = path.join(templateDir, 'outro.mp3');

    // Split the track
    await ffmpegService.trimAudio(trackPath, introDuration, introPath);

    // Extract main segment using ffmpeg with start offset
    await this.extractSegment(trackPath, mainStart, mainDuration, mainPath);

    // Extract outro
    await this.extractSegment(trackPath, mainEnd, outroDuration, outroPath);

    // Save metadata
    const templateMeta: SoundTemplateMetadata = {
      id: templateId,
      name: metadata?.name || templateId,
      genre: metadata?.genre,
      mood: metadata?.mood,
      energy: metadata?.energy,
      bpm: metadata?.bpm,
      instruments: metadata?.instruments,
      tags: metadata?.tags,
      bestFor: metadata?.bestFor,
      introDuration,
      mainDuration,
      outroDuration,
    };

    fs.writeFileSync(
      path.join(templateDir, 'metadata.json'),
      JSON.stringify(templateMeta, null, 2)
    );

    // Add to catalog
    this.catalog.push(templateMeta);
    logger.info(`Created sound template "${templateId}" from track: intro=${introDuration.toFixed(1)}s, main=${mainDuration.toFixed(1)}s, outro=${outroDuration.toFixed(1)}s`);

    return templateMeta;
  }

  /**
   * Extract a segment from an audio file (start offset + duration).
   */
  private extractSegment(
    inputPath: string,
    startSeconds: number,
    duration: number,
    outputPath: string
  ): Promise<string> {
    const ffmpeg = require('fluent-ffmpeg');
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .setStartTime(startSeconds)
        .setDuration(duration)
        .audioCodec('libmp3lame')
        .audioBitrate('192k')
        .audioChannels(2)
        .audioFrequency(44100)
        .output(outputPath)
        .on('end', () => resolve(outputPath))
        .on('error', (err: Error) => reject(err))
        .run();
    });
  }

  /**
   * Get a compact summary of all templates for LLM selection.
   */
  getSummariesForLLM(): string {
    if (this.catalog.length === 0) {
      return 'No sound templates available. Upload templates or use single-track mode.';
    }

    return this.catalog.map((t, i) => {
      const parts = [`[${i + 1}] "${t.id}"`];
      if (t.genre) parts.push(`Genre: ${t.genre}`);
      if (t.mood) parts.push(`Mood: ${t.mood}`);
      if (t.energy) parts.push(`Energy: ${t.energy}`);
      if (t.bpm) parts.push(`BPM: ${t.bpm}`);
      if (t.instruments?.length) parts.push(`Instruments: ${t.instruments.join(', ')}`);
      if (t.bestFor?.length) parts.push(`Best for: ${t.bestFor.join(', ')}`);
      return parts.join(' | ');
    }).join('\n');
  }
}

export default new SoundTemplateService();
