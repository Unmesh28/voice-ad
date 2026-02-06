import elevenLabsMusicService from './elevenlabs-music.service';
import ffmpegService from '../audio/ffmpeg.service';
import { logger } from '../../config/logger';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import type { ProductionMusicOptions } from '../../types/audio.types';

interface MusicLayerInternal {
  filePath: string;
  role: 'melody' | 'atmosphere' | 'rhythm';
  volume: number;
  eq?: string;
}

/**
 * Production-grade music generation: enhanced single-track prompts or multi-layer
 * (melody + atmosphere + rhythm) mixing for longer/dramatic ads. One continuous output.
 */
class ProductionMusicService {
  async generateProductionMusic(options: ProductionMusicOptions): Promise<{
    filePath: string;
    duration: number;
    musicUrl: string;
  }> {
    try {
      logger.info('Starting production-grade music generation', {
        duration: options.duration,
        style: options.style,
        tone: options.tone,
      });

      const useMultiLayer = options.duration >= 20 || options.style === 'dramatic';

      if (useMultiLayer) {
        return await this.generateMultiLayerMusic(options);
      } else {
        return await this.generateEnhancedSingleTrack(options);
      }
    } catch (error: any) {
      logger.error('Error generating production music:', error.message);
      throw error;
    }
  }

  private async generateEnhancedSingleTrack(options: ProductionMusicOptions): Promise<{
    filePath: string;
    duration: number;
    musicUrl: string;
  }> {
    logger.info('Generating enhanced single-track music with professional prompt');

    const enhancedPrompt = this.createProfessionalMusicPrompt(options);
    logger.info('Enhanced music prompt:', { prompt: enhancedPrompt.slice(0, 120) + '...' });

    const filename = `music_production_${uuidv4()}.mp3`;
    const result = await elevenLabsMusicService.generateAndSave(
      {
        text: enhancedPrompt,
        duration_seconds: Math.min(options.duration, 22),
        prompt_influence: 0.5,
      },
      filename
    );

    const processedFile = await this.applyPostProcessing(result.filePath, options.duration);
    const musicUrl = `/uploads/music/${path.basename(processedFile)}`;

    return {
      filePath: processedFile,
      duration: options.duration,
      musicUrl,
    };
  }

  private async generateMultiLayerMusic(options: ProductionMusicOptions): Promise<{
    filePath: string;
    duration: number;
    musicUrl: string;
  }> {
    logger.info('Generating multi-layer music with professional mixing');

    const layers = await this.generateMusicalLayers(options);
    const mixedFile = await this.mixLayersProfessionally(layers, options);
    const masteredFile = await this.applyMastering(mixedFile);

    const musicUrl = `/uploads/music/${path.basename(masteredFile)}`;

    return {
      filePath: masteredFile,
      duration: options.duration,
      musicUrl,
    };
  }

  private createProfessionalMusicPrompt(options: ProductionMusicOptions): string {
    const { tone, duration, style, scriptContent } = options;
    const emotionalKeywords = this.extractEmotionalKeywords(scriptContent);
    const introLength = Math.min(2, duration * 0.15);
    const mainLength = duration - introLength - Math.min(2, duration * 0.15);
    const outroLength = Math.min(2, duration * 0.15);
    const stylePresets = this.getStylePresets(style || 'corporate');

    return `Professional ${duration}-second advertisement background music:

STRUCTURE: ${introLength.toFixed(1)}s gentle fade-in intro, ${mainLength.toFixed(1)}s main theme with ${stylePresets.energy}, ${outroLength.toFixed(1)}s smooth fade-out outro

INSTRUMENTATION: ${stylePresets.instruments}

PRODUCTION QUALITY:
- Studio-grade mixing and mastering
- Target loudness: -16 LUFS (broadcast standard)
- Wide stereo imaging with centered melodic elements
- Professional EQ: warm lows, clear mids, smooth highs
- Frequency space: 1-4kHz kept clear for voice clarity

MUSICAL DETAILS:
- Tempo: ${stylePresets.bpm} BPM, ${stylePresets.timeSignature}
- Key: ${stylePresets.key}
- Mood: ${tone}, ${emotionalKeywords.join(', ')}
- Style: ${stylePresets.genre}, ${stylePresets.reference}

MIX PRIORITIES:
- Music sits as supportive background layer
- Non-intrusive, enhances without competing
- Smooth dynamics, no sudden changes
- Professional fade transitions
- Leaves vocal frequency space completely clear

EMOTIONAL INTENT: ${this.getEmotionalIntent(tone, emotionalKeywords)}`;
  }

  private async generateMusicalLayers(options: ProductionMusicOptions): Promise<MusicLayerInternal[]> {
    const { duration, tone } = options;
    const maxDuration = Math.min(duration, 22);

    logger.info('Generating 3 musical layers');

    const melodyPrompt = `Melodic foundation: ${this.getMelodyInstrument(options.style)} playing simple, memorable melody, ${tone} mood, ${this.getMusicalKey(options.style)} key, professional studio recording, warm and inviting, clean and present`;
    const melodyFilename = `layer_melody_${uuidv4()}.mp3`;
    const melodyResult = await elevenLabsMusicService.generateAndSave(
      { text: melodyPrompt, duration_seconds: maxDuration, prompt_influence: 0.4 },
      melodyFilename
    );

    const atmospherePrompt = `Atmospheric support: soft ${this.getPadInstrument(options.style)} texture, sustained harmonies, ambient background, wide stereo field, supporting role, subtle and smooth, ${tone} atmosphere`;
    const atmosphereFilename = `layer_atmosphere_${uuidv4()}.mp3`;
    const atmosphereResult = await elevenLabsMusicService.generateAndSave(
      { text: atmospherePrompt, duration_seconds: maxDuration, prompt_influence: 0.3 },
      atmosphereFilename
    );

    const rhythmPrompt = `Rhythmic foundation: minimal ${this.getRhythmInstrument(options.style)}, gentle pulse, background rhythm, non-intrusive, professional restraint, subtle groove, ${tone} energy`;
    const rhythmFilename = `layer_rhythm_${uuidv4()}.mp3`;
    const rhythmResult = await elevenLabsMusicService.generateAndSave(
      { text: rhythmPrompt, duration_seconds: maxDuration, prompt_influence: 0.3 },
      rhythmFilename
    );

    const configs: { result: { filePath: string }; role: 'melody' | 'atmosphere' | 'rhythm'; volume: number; eq: string }[] = [
      { result: melodyResult, role: 'melody', volume: 0.6, eq: 'treble=g=3:f=8000,bass=g=-2:f=100' },
      { result: atmosphereResult, role: 'atmosphere', volume: 0.4, eq: 'treble=g=-2:f=10000,bass=g=3:f=80' },
      { result: rhythmResult, role: 'rhythm', volume: 0.3, eq: 'highpass=f=150,lowpass=f=8000' },
    ];

    const layers: MusicLayerInternal[] = [];
    for (const { result, role, volume, eq } of configs) {
      let layerPath = result.filePath;
      if (duration > maxDuration) {
        const extendedFilename = `extended_${path.basename(layerPath)}`;
        const extendedPath = path.join(path.dirname(layerPath), extendedFilename);
        await ffmpegService.extendAudioDuration(layerPath, duration, extendedPath);
        layerPath = extendedPath;
      }
      layers.push({ filePath: layerPath, role, volume, eq });
    }
    return layers;
  }

  private async mixLayersProfessionally(
    layers: MusicLayerInternal[],
    options: ProductionMusicOptions
  ): Promise<string> {
    logger.info('Mixing layers professionally');

    const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
    const musicDir = path.join(uploadDir, 'music');
    if (!fs.existsSync(musicDir)) fs.mkdirSync(musicDir, { recursive: true });

    const outputFilename = `mixed_${uuidv4()}.mp3`;
    const outputPath = path.join(musicDir, outputFilename);

    await ffmpegService.mixMultipleAudioLayers({
      layers: layers.map((layer, index) => ({
        filePath: layer.filePath,
        volume: layer.volume,
        eq: layer.eq,
        label: `layer${index}`,
      })),
      outputPath,
      fadeIn: 0.5,
      fadeOut: 1.0,
      normalize: true,
      targetLoudness: -16,
      compress: true,
    });

    return outputPath;
  }

  private async applyMastering(inputPath: string): Promise<string> {
    logger.info('Applying broadcast-standard mastering');

    const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
    const musicDir = path.join(uploadDir, 'music');
    if (!fs.existsSync(musicDir)) fs.mkdirSync(musicDir, { recursive: true });

    const outputFilename = `mastered_${uuidv4()}.mp3`;
    const outputPath = path.join(musicDir, outputFilename);

    await ffmpegService.applyMasteringChain({
      inputPath,
      outputPath,
      targetLoudness: -16,
      eq: {
        lowCut: 60,
        highCut: 15000,
        midScoop: { freq: 2500, q: 1.5, gain: -3 },
      },
      compression: { threshold: -18, ratio: 3, attack: 10, release: 150 },
      limiter: { threshold: -1, release: 50 },
      stereoWidth: 130,
    });

    return outputPath;
  }

  private async applyPostProcessing(inputPath: string, targetDuration: number): Promise<string> {
    logger.info('Applying professional post-processing');

    const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
    const musicDir = path.join(uploadDir, 'music');
    if (!fs.existsSync(musicDir)) fs.mkdirSync(musicDir, { recursive: true });

    const outputFilename = `processed_${uuidv4()}.mp3`;
    const outputPath = path.join(musicDir, outputFilename);

    let processPath = inputPath;
    const currentDuration = await ffmpegService.getAudioDuration(inputPath);
    if (currentDuration < targetDuration) {
      const extendedFilename = `extended_${path.basename(inputPath)}`;
      const extendedPath = path.join(path.dirname(inputPath), extendedFilename);
      await ffmpegService.extendAudioDuration(inputPath, targetDuration, extendedPath);
      processPath = extendedPath;
    }

    await ffmpegService.applyMasteringChain({
      inputPath: processPath,
      outputPath,
      targetLoudness: -16,
      eq: { lowCut: 60, highCut: 15000, midScoop: { freq: 2500, q: 1.5, gain: -3 } },
      compression: { threshold: -18, ratio: 3, attack: 10, release: 150 },
      limiter: { threshold: -1, release: 50 },
      stereoWidth: 130,
    });

    return outputPath;
  }

  private extractEmotionalKeywords(scriptContent: string): string[] {
    const script = scriptContent.toLowerCase();
    const emotionMap: Record<string, string[]> = {
      exciting: ['exciting', 'amazing', 'incredible', 'revolutionary', 'breakthrough'],
      professional: ['professional', 'expert', 'quality', 'premium', 'advanced'],
      friendly: ['friendly', 'easy', 'simple', 'comfortable', 'welcoming'],
      urgent: ['now', 'today', 'limited', 'hurry', 'exclusive'],
      trustworthy: ['trusted', 'reliable', 'proven', 'guaranteed', 'certified'],
      innovative: ['new', 'innovative', 'cutting-edge', 'modern', 'advanced'],
    };
    const keywords: string[] = [];
    for (const [emotion, words] of Object.entries(emotionMap)) {
      if (words.some((w) => script.includes(w))) keywords.push(emotion);
    }
    return keywords.length > 0 ? keywords : ['professional', 'engaging'];
  }

  private getStylePresets(style: string): Record<string, string | number> {
    const presets: Record<string, Record<string, string | number>> = {
      corporate: {
        instruments: 'Clean acoustic piano (melody), warm string pad (harmony), subtle brush percussion (rhythm), light acoustic guitar touches',
        energy: 'steady, confident progression',
        bpm: 105,
        timeSignature: '4/4',
        key: 'C Major',
        genre: 'Corporate contemporary',
        reference: 'Similar to Apple/Microsoft commercial music',
      },
      energetic: {
        instruments: 'Bright electric piano (melody), synth bass (foundation), upbeat electronic drums (rhythm), energetic guitar riffs',
        energy: 'building, driving momentum',
        bpm: 125,
        timeSignature: '4/4',
        key: 'D Major',
        genre: 'Modern pop instrumental',
        reference: 'Similar to Nike/Adidas commercial energy',
      },
      calm: {
        instruments: 'Soft piano (melody), ambient pad textures (atmosphere), gentle acoustic guitar (harmony), minimal percussion',
        energy: 'peaceful, flowing continuity',
        bpm: 85,
        timeSignature: '4/4',
        key: 'A Minor',
        genre: 'Ambient contemporary',
        reference: 'Similar to meditation/wellness brand music',
      },
      dramatic: {
        instruments: 'Orchestral strings (melody), powerful brass (accents), cinematic percussion (impact), deep bass (foundation)',
        energy: 'building tension and release',
        bpm: 95,
        timeSignature: '4/4',
        key: 'E Minor',
        genre: 'Cinematic orchestral',
        reference: 'Similar to movie trailer/luxury brand music',
      },
      uplifting: {
        instruments: 'Bright piano (melody), uplifting strings (harmony), light percussion (pulse), acoustic guitar (texture)',
        energy: 'rising, optimistic build',
        bpm: 115,
        timeSignature: '4/4',
        key: 'G Major',
        genre: 'Inspirational contemporary',
        reference: 'Similar to charity/social cause campaign music',
      },
    };
    return presets[style] || presets.corporate;
  }

  private getEmotionalIntent(tone: string, keywords: string[]): string {
    const intents: Record<string, string> = {
      professional: 'Conveys competence and reliability without being cold',
      friendly: 'Warm and approachable while maintaining quality feel',
      energetic: 'Exciting and motivating without being overwhelming',
      calm: 'Peaceful and reassuring while maintaining engagement',
      dramatic: 'Powerful and impactful while supporting the message',
      uplifting: 'Inspiring and optimistic while feeling authentic',
    };
    return intents[tone] || `Enhances ${tone} feeling, supports message with ${keywords.join(', ')} emotional undertones`;
  }

  private getMelodyInstrument(style?: string): string {
    const instruments: Record<string, string> = {
      corporate: 'acoustic piano',
      energetic: 'electric piano with modern synth layers',
      calm: 'soft piano with gentle reverb',
      dramatic: 'orchestral strings and piano',
      uplifting: 'bright piano with string harmonies',
    };
    return instruments[style || 'corporate'];
  }

  private getPadInstrument(style?: string): string {
    const instruments: Record<string, string> = {
      corporate: 'warm string ensemble',
      energetic: 'modern synth pad',
      calm: 'ambient atmospheric pad',
      dramatic: 'sustained orchestral strings',
      uplifting: 'lush string section',
    };
    return instruments[style || 'corporate'];
  }

  private getRhythmInstrument(style?: string): string {
    const instruments: Record<string, string> = {
      corporate: 'brush percussion and light hand drums',
      energetic: 'electronic drums and percussion',
      calm: 'soft hand percussion and subtle shakers',
      dramatic: 'orchestral percussion and timpani',
      uplifting: 'acoustic drums and light percussion',
    };
    return instruments[style || 'corporate'];
  }

  private getMusicalKey(style?: string): string {
    const keys: Record<string, string> = {
      corporate: 'C Major',
      energetic: 'D Major',
      calm: 'A Minor',
      dramatic: 'E Minor',
      uplifting: 'G Major',
    };
    return keys[style || 'corporate'];
  }
}

export default new ProductionMusicService();
