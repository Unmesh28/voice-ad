import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../config/logger';
import kieSunoMusicService from './kie-suno-music.service';
import ffmpegService from '../audio/ffmpeg.service';
import type { SoundTemplateMetadata } from './sound-template.service';

// ===========================================================================
// Sound Template Generator
//
// Uses Suno API to generate categorized, loop-ready elastic sound templates.
//
// For each genre/mood category, generates:
//   1. A loopable MAIN segment (8-15s, designed to loop seamlessly)
//   2. An INTRO segment (musical opening, 3-5s)
//   3. An OUTRO segment (musical ending/resolution, 3-5s)
//
// Then organizes everything into the sound-templates folder structure:
//   uploads/sound-templates/
//     ├── catalog.json
//     ├── corporate_upbeat_01/
//     │   ├── metadata.json
//     │   ├── intro.mp3
//     │   ├── main.mp3
//     │   └── outro.mp3
//     └── ...
// ===========================================================================

/** Definition of a template to generate. */
export interface TemplateGenerationDef {
  /** Unique ID for this template */
  id: string;
  /** Human-readable name */
  name: string;
  /** Genre tag */
  genre: string;
  /** Mood tag */
  mood: string;
  /** Energy level */
  energy: 'low' | 'medium' | 'high';
  /** Target BPM */
  bpm: number;
  /** Key instruments */
  instruments: string[];
  /** Best use cases */
  bestFor: string[];
  /** Tags for search */
  tags: string[];
  /** Suno prompt for the MAIN (loopable) segment */
  mainPrompt: string;
  /** Suno prompt for the INTRO segment */
  introPrompt: string;
  /** Suno prompt for the OUTRO segment */
  outroPrompt: string;
}

/** Progress callback. */
export type GenerationProgressCallback = (progress: {
  total: number;
  completed: number;
  current: string;
  status: 'generating' | 'splitting' | 'done' | 'error';
  error?: string;
}) => void;

/** Result of generating a single template. */
export interface TemplateGenerationResult {
  id: string;
  success: boolean;
  metadata?: SoundTemplateMetadata;
  error?: string;
}

// ---------------------------------------------------------------------------
// Pre-defined genre categories with multiple variations
// ---------------------------------------------------------------------------

export const TEMPLATE_DEFINITIONS: TemplateGenerationDef[] = [
  // ── CORPORATE / PROFESSIONAL ──────────────────────────────────────────
  {
    id: 'corporate_upbeat_01',
    name: 'Corporate Upbeat 1',
    genre: 'Corporate',
    mood: 'Upbeat',
    energy: 'medium',
    bpm: 120,
    instruments: ['piano', 'light drums', 'synth pad', 'acoustic guitar'],
    bestFor: ['business ads', 'SaaS products', 'professional services', 'B2B'],
    tags: ['corporate', 'upbeat', 'professional', 'clean'],
    mainPrompt: 'Upbeat corporate background music, 120 BPM, major key. Clean piano melody with light drums and synth pads. Professional, optimistic, modern business feel. Must loop seamlessly — the ending connects smoothly back to the beginning. No build-ups or breakdowns, maintain consistent energy throughout. Instrumental only.',
    introPrompt: 'Corporate music intro, 120 BPM, major key. Gentle piano notes building into the main groove. Professional opening feel, starts soft and establishes the rhythm within 4 seconds. Instrumental only.',
    outroPrompt: 'Corporate music outro, 120 BPM, major key. Piano and synth resolving to a clean, satisfying ending. Gentle fade with a final chord. Professional closing feel. Instrumental only.',
  },
  {
    id: 'corporate_confident_02',
    name: 'Corporate Confident 2',
    genre: 'Corporate',
    mood: 'Confident',
    energy: 'medium',
    bpm: 110,
    instruments: ['electric piano', 'bass guitar', 'brushed drums', 'strings'],
    bestFor: ['finance', 'consulting', 'leadership', 'enterprise'],
    tags: ['corporate', 'confident', 'steady', 'authoritative'],
    mainPrompt: 'Confident corporate music, 110 BPM, C major. Electric piano with subtle bass guitar, brushed drums, and light string accents. Steady, authoritative, trustworthy. Must loop seamlessly from end back to start. Maintain consistent groove throughout. Instrumental only.',
    introPrompt: 'Confident corporate music intro, 110 BPM. Strings and electric piano establishing a trustworthy, professional opening. Builds gently into the groove within 4 seconds. Instrumental only.',
    outroPrompt: 'Confident corporate music outro, 110 BPM. Strings resolving over a final piano chord. Satisfying, professional ending. Instrumental only.',
  },
  {
    id: 'corporate_minimal_03',
    name: 'Corporate Minimal 3',
    genre: 'Corporate',
    mood: 'Minimal',
    energy: 'low',
    bpm: 100,
    instruments: ['soft piano', 'ambient pad', 'subtle clicks'],
    bestFor: ['tech products', 'apps', 'startup', 'innovation'],
    tags: ['corporate', 'minimal', 'tech', 'modern', 'clean'],
    mainPrompt: 'Minimal corporate background music, 100 BPM. Soft piano notes with ambient synth pad and subtle rhythmic clicks. Clean, modern, tech-forward. Very unobtrusive background for voiceover. Must loop seamlessly. Instrumental only.',
    introPrompt: 'Minimal tech intro, 100 BPM. A single piano note blooming into the ambient pad. Clean, modern opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Minimal tech outro, 100 BPM. Piano notes fading into silence with a soft ambient tail. Clean ending. Instrumental only.',
  },

  // ── ENERGETIC / HIGH ENERGY ───────────────────────────────────────────
  {
    id: 'energetic_pop_01',
    name: 'Energetic Pop 1',
    genre: 'Pop',
    mood: 'Energetic',
    energy: 'high',
    bpm: 128,
    instruments: ['synth lead', 'electronic drums', 'bass synth', 'claps'],
    bestFor: ['sales events', 'product launches', 'fitness', 'youth brands'],
    tags: ['energetic', 'pop', 'upbeat', 'fun', 'bright'],
    mainPrompt: 'Energetic pop music, 128 BPM, G major. Bright synth leads with punchy electronic drums, driving bass synth, and handclaps. Fun, youthful, exciting. Must loop seamlessly — end connects perfectly back to start. Consistent high energy throughout. Instrumental only.',
    introPrompt: 'Energetic pop intro, 128 BPM. Synth riser building into a clap and the main beat drops. Exciting opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Energetic pop outro, 128 BPM. Beat continues then hits a final stab/stinger chord. Punchy ending. Instrumental only.',
  },
  {
    id: 'energetic_edm_02',
    name: 'Energetic EDM 2',
    genre: 'EDM',
    mood: 'Hype',
    energy: 'high',
    bpm: 130,
    instruments: ['supersaw synth', 'four-on-the-floor kick', 'hi-hats', 'sub bass'],
    bestFor: ['flash sales', 'gaming', 'nightlife', 'events'],
    tags: ['edm', 'hype', 'electronic', 'dance', 'festival'],
    mainPrompt: 'High energy EDM music, 130 BPM. Supersaw synth chords with four-on-the-floor kick, crisp hi-hats, and deep sub bass. Festival energy, driving and relentless. Must loop seamlessly. No drops or breakdowns — consistent peak energy. Instrumental only.',
    introPrompt: 'EDM intro, 130 BPM. Filtered synth rising with a kick pattern building to the full beat. Exciting build-up opening. 4 seconds. Instrumental only.',
    outroPrompt: 'EDM outro, 130 BPM. Synths hit a final big chord with a reverb tail. Impactful ending. Instrumental only.',
  },
  {
    id: 'energetic_rock_03',
    name: 'Energetic Rock 3',
    genre: 'Rock',
    mood: 'Driving',
    energy: 'high',
    bpm: 135,
    instruments: ['electric guitar', 'power drums', 'bass guitar', 'crash cymbals'],
    bestFor: ['automotive', 'sports', 'action', 'outdoor brands'],
    tags: ['rock', 'driving', 'powerful', 'guitar', 'action'],
    mainPrompt: 'Driving rock music, 135 BPM. Distorted electric guitar riff with powerful drums, solid bass guitar, and crash cymbals. Raw energy, aggressive but musical. Must loop seamlessly. Consistent intensity. Instrumental only.',
    introPrompt: 'Rock intro, 135 BPM. Guitar feedback building into the main riff hitting hard. Powerful opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Rock outro, 135 BPM. Guitar and drums building to a final power chord with cymbal crash. Strong ending. Instrumental only.',
  },

  // ── CALM / RELAXING ───────────────────────────────────────────────────
  {
    id: 'calm_ambient_01',
    name: 'Calm Ambient 1',
    genre: 'Ambient',
    mood: 'Calm',
    energy: 'low',
    bpm: 70,
    instruments: ['ambient pad', 'soft piano', 'nature textures', 'gentle bells'],
    bestFor: ['healthcare', 'wellness', 'meditation apps', 'insurance'],
    tags: ['calm', 'ambient', 'peaceful', 'soft', 'gentle'],
    mainPrompt: 'Calm ambient background music, 70 BPM. Soft evolving synth pads with gentle piano notes and subtle bell textures. Peaceful, warm, soothing. Perfect background for healthcare or wellness voiceover. Must loop seamlessly. Very consistent calm energy. Instrumental only.',
    introPrompt: 'Calm ambient intro, 70 BPM. A warm pad fading in with a single soft piano note. Gentle, inviting opening. 5 seconds. Instrumental only.',
    outroPrompt: 'Calm ambient outro, 70 BPM. Piano notes and pad gently fading to silence. Peaceful, resolved ending. Instrumental only.',
  },
  {
    id: 'calm_acoustic_02',
    name: 'Calm Acoustic 2',
    genre: 'Acoustic',
    mood: 'Warm',
    energy: 'low',
    bpm: 85,
    instruments: ['acoustic guitar', 'soft strings', 'light percussion', 'flute'],
    bestFor: ['food & beverage', 'family brands', 'organic products', 'charity'],
    tags: ['acoustic', 'warm', 'organic', 'natural', 'gentle'],
    mainPrompt: 'Warm acoustic background music, 85 BPM. Fingerpicked acoustic guitar with soft strings and light shaker percussion. Organic, natural, heartwarming. Must loop seamlessly. Gentle and consistent. Instrumental only.',
    introPrompt: 'Warm acoustic intro, 85 BPM. Solo acoustic guitar fingerpicking pattern establishing the warmth. 4 seconds. Instrumental only.',
    outroPrompt: 'Warm acoustic outro, 85 BPM. Guitar slowing to a final resolved strum with strings fading. Warm ending. Instrumental only.',
  },
  {
    id: 'calm_lofi_03',
    name: 'Calm Lo-Fi 3',
    genre: 'Lo-Fi',
    mood: 'Chill',
    energy: 'low',
    bpm: 80,
    instruments: ['lo-fi piano', 'vinyl crackle', 'muted drums', 'warm bass'],
    bestFor: ['coffee brands', 'lifestyle', 'creative tools', 'study apps'],
    tags: ['lofi', 'chill', 'relaxed', 'cozy', 'nostalgic'],
    mainPrompt: 'Lo-fi chill hop background music, 80 BPM. Warm detuned piano chords with vinyl crackle, muted boom-bap drums, and round bass. Cozy, nostalgic, relaxed. Must loop seamlessly. Consistent mellow groove. Instrumental only.',
    introPrompt: 'Lo-fi chill intro, 80 BPM. Vinyl crackle fading in with a piano chord landing on the beat. Cozy opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Lo-fi chill outro, 80 BPM. Piano chord sustaining and fading into vinyl crackle silence. Mellow ending. Instrumental only.',
  },

  // ── DRAMATIC / CINEMATIC ──────────────────────────────────────────────
  {
    id: 'dramatic_cinematic_01',
    name: 'Dramatic Cinematic 1',
    genre: 'Cinematic',
    mood: 'Dramatic',
    energy: 'medium',
    bpm: 95,
    instruments: ['orchestral strings', 'brass hits', 'timpani', 'choir pad'],
    bestFor: ['movie trailers', 'luxury brands', 'premium products', 'awards'],
    tags: ['cinematic', 'dramatic', 'epic', 'orchestral', 'premium'],
    mainPrompt: 'Dramatic cinematic music, 95 BPM, D minor. Sweeping orchestral strings with subtle brass, timpani pulse, and ethereal choir pad. Epic, premium, cinematic. Must loop seamlessly. Consistent dramatic intensity without crescendos. Instrumental only.',
    introPrompt: 'Cinematic intro, 95 BPM, D minor. Low strings and timpani building into the full orchestral texture. Grand opening. 5 seconds. Instrumental only.',
    outroPrompt: 'Cinematic outro, 95 BPM, D minor. Orchestra resolving to a final dramatic chord with timpani roll. Epic ending. Instrumental only.',
  },
  {
    id: 'dramatic_tension_02',
    name: 'Dramatic Tension 2',
    genre: 'Cinematic',
    mood: 'Suspenseful',
    energy: 'medium',
    bpm: 90,
    instruments: ['dark strings', 'sub bass pulse', 'metallic textures', 'reverse cymbal'],
    bestFor: ['thriller content', 'cybersecurity', 'investigative', 'true crime'],
    tags: ['suspense', 'tension', 'dark', 'mysterious', 'thriller'],
    mainPrompt: 'Suspenseful cinematic music, 90 BPM, minor key. Dark tremolo strings with deep sub bass pulses and metallic textural hits. Tense, mysterious, gripping. Must loop seamlessly. Consistent suspense without resolution. Instrumental only.',
    introPrompt: 'Suspenseful intro, 90 BPM. A low drone growing with metallic textures emerging. Unsettling opening. 5 seconds. Instrumental only.',
    outroPrompt: 'Suspenseful outro, 90 BPM. Tension building to a final dissonant chord that cuts to silence. Sharp ending. Instrumental only.',
  },

  // ── CULTURAL / WORLD MUSIC ────────────────────────────────────────────
  {
    id: 'cultural_indian_01',
    name: 'Cultural Indian 1',
    genre: 'Indian',
    mood: 'Festive',
    energy: 'high',
    bpm: 115,
    instruments: ['dhol', 'tumbi', 'sitar accents', 'tabla'],
    bestFor: ['Indian brands', 'Diwali campaigns', 'Bollywood', 'cultural events'],
    tags: ['indian', 'punjabi', 'dhol', 'festive', 'bollywood', 'cultural'],
    mainPrompt: 'Festive Punjabi music, 115 BPM. Energetic dhol drum pattern with tumbi melody, sitar accents, and tabla fills. Celebratory, vibrant, culturally authentic. Must loop seamlessly. Consistent festive energy. Instrumental only.',
    introPrompt: 'Punjabi music intro, 115 BPM. Dhol roll building into the main groove with a tumbi hit. Festive, exciting opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Punjabi music outro, 115 BPM. Dhol pattern intensifying to a final hit with tumbi flourish. Strong cultural ending. Instrumental only.',
  },
  {
    id: 'cultural_indian_02',
    name: 'Cultural Indian Classical 2',
    genre: 'Indian Classical',
    mood: 'Elegant',
    energy: 'low',
    bpm: 75,
    instruments: ['sitar', 'tabla', 'tanpura drone', 'bansuri flute'],
    bestFor: ['luxury Indian brands', 'spiritual products', 'yoga', 'traditional'],
    tags: ['indian', 'classical', 'sitar', 'elegant', 'spiritual', 'traditional'],
    mainPrompt: 'Elegant Indian classical music, 75 BPM. Gentle sitar melody with soft tabla taal, tanpura drone, and occasional bansuri flute. Meditative, refined, culturally rich. Must loop seamlessly. Consistent peaceful groove. Instrumental only.',
    introPrompt: 'Indian classical intro, 75 BPM. Tanpura drone fading in with sitar alap (free-form opening). Spiritual opening. 5 seconds. Instrumental only.',
    outroPrompt: 'Indian classical outro, 75 BPM. Sitar and tabla resolving to a final note over the tanpura drone. Peaceful ending. Instrumental only.',
  },
  {
    id: 'cultural_latin_03',
    name: 'Cultural Latin 3',
    genre: 'Latin',
    mood: 'Groovy',
    energy: 'medium',
    bpm: 105,
    instruments: ['congas', 'timbales', 'brass section', 'piano montuno'],
    bestFor: ['Latin food brands', 'festivals', 'travel', 'dance events'],
    tags: ['latin', 'salsa', 'tropical', 'groovy', 'brass'],
    mainPrompt: 'Latin salsa music, 105 BPM. Piano montuno pattern with congas, timbales, and bright brass section hits. Groovy, warm, infectious rhythm. Must loop seamlessly. Consistent dance energy. Instrumental only.',
    introPrompt: 'Latin salsa intro, 105 BPM. Conga pattern starting alone, then piano and brass joining. Warm, inviting opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Latin salsa outro, 105 BPM. Brass hitting a final tutti with conga fill. Celebratory ending. Instrumental only.',
  },
  {
    id: 'cultural_arabic_04',
    name: 'Cultural Arabic 4',
    genre: 'Arabic',
    mood: 'Majestic',
    energy: 'medium',
    bpm: 95,
    instruments: ['oud', 'darbuka', 'strings', 'ney flute'],
    bestFor: ['Middle Eastern brands', 'luxury', 'Ramadan campaigns', 'hospitality'],
    tags: ['arabic', 'middle-eastern', 'oud', 'majestic', 'cultural'],
    mainPrompt: 'Majestic Arabic music, 95 BPM. Oud melody with darbuka rhythm pattern, lush strings, and ney flute accents. Elegant, rich, culturally authentic. Must loop seamlessly. Consistent noble groove. Instrumental only.',
    introPrompt: 'Arabic music intro, 95 BPM. Solo oud taqsim (improvised phrase) establishing the maqam scale. Majestic opening. 5 seconds. Instrumental only.',
    outroPrompt: 'Arabic music outro, 95 BPM. Oud and strings resolving over a final darbuka fill. Grand ending. Instrumental only.',
  },

  // ── JAZZ / SOPHISTICATED ──────────────────────────────────────────────
  {
    id: 'jazz_smooth_01',
    name: 'Jazz Smooth 1',
    genre: 'Jazz',
    mood: 'Smooth',
    energy: 'low',
    bpm: 90,
    instruments: ['jazz guitar', 'upright bass', 'brushed drums', 'saxophone'],
    bestFor: ['restaurants', 'wine brands', 'evening events', 'luxury lifestyle'],
    tags: ['jazz', 'smooth', 'sophisticated', 'lounge', 'elegant'],
    mainPrompt: 'Smooth jazz music, 90 BPM. Warm jazz guitar chords with walking upright bass, brushed drums, and soft saxophone melody. Sophisticated, relaxed, lounge feel. Must loop seamlessly. Consistent smooth groove. Instrumental only.',
    introPrompt: 'Smooth jazz intro, 90 BPM. Upright bass walking in with guitar chord. Sophisticated opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Smooth jazz outro, 90 BPM. Saxophone holding a final note over a resolved guitar chord. Elegant ending. Instrumental only.',
  },

  // ── RETRO / NOSTALGIC ─────────────────────────────────────────────────
  {
    id: 'retro_80s_synth_01',
    name: 'Retro 80s Synth 1',
    genre: 'Synthwave',
    mood: 'Nostalgic',
    energy: 'medium',
    bpm: 118,
    instruments: ['analog synth', 'arpeggiated bass', 'gated reverb drums', 'pad'],
    bestFor: ['retro brands', 'gaming', 'tech nostalgia', 'neon aesthetics'],
    tags: ['synthwave', '80s', 'retro', 'neon', 'nostalgic', 'electronic'],
    mainPrompt: 'Synthwave retro 80s music, 118 BPM. Analog synth melodies with arpeggiated bass lines, gated reverb snare drums, and warm pads. Nostalgic, neon, driving. Must loop seamlessly. Consistent retro energy. Instrumental only.',
    introPrompt: 'Synthwave intro, 118 BPM. Analog synth arpeggio fading in with a gated reverb snare hit. Retro opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Synthwave outro, 118 BPM. Synth holding a chord with the arpeggio slowing down. Retro fade ending. Instrumental only.',
  },

  // ── HAPPY / PLAYFUL ───────────────────────────────────────────────────
  {
    id: 'happy_ukulele_01',
    name: 'Happy Ukulele 1',
    genre: 'Acoustic Pop',
    mood: 'Happy',
    energy: 'medium',
    bpm: 115,
    instruments: ['ukulele', 'glockenspiel', 'claps', 'whistling'],
    bestFor: ['kids products', 'family brands', 'feel-good campaigns', 'summer'],
    tags: ['happy', 'ukulele', 'playful', 'cheerful', 'bright', 'fun'],
    mainPrompt: 'Happy ukulele music, 115 BPM, C major. Bright ukulele strumming with glockenspiel melody, handclaps, and whistling. Cheerful, playful, feel-good. Must loop seamlessly. Consistent happy energy. Instrumental only.',
    introPrompt: 'Happy ukulele intro, 115 BPM. Solo ukulele strum leading into the full arrangement with a glockenspiel hit. Cheerful opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Happy ukulele outro, 115 BPM. Ukulele and glockenspiel landing on a bright final chord with a whistle flourish. Happy ending. Instrumental only.',
  },
];

class SoundTemplateGenerator {
  private outputDir: string;

  constructor() {
    this.outputDir = process.env.SOUND_TEMPLATES_PATH
      || path.resolve(process.cwd(), 'uploads', 'sound-templates');
  }

  /**
   * Generate all predefined templates.
   * Each template generates 3 Suno requests: intro, main, outro.
   *
   * @param onProgress - Progress callback
   * @param concurrency - How many templates to generate in parallel (default 2 to respect rate limits)
   */
  async generateAll(
    onProgress?: GenerationProgressCallback,
    concurrency: number = 2
  ): Promise<TemplateGenerationResult[]> {
    return this.generateTemplates(TEMPLATE_DEFINITIONS, onProgress, concurrency);
  }

  /**
   * Generate specific templates by IDs.
   */
  async generateByIds(
    ids: string[],
    onProgress?: GenerationProgressCallback,
    concurrency: number = 2
  ): Promise<TemplateGenerationResult[]> {
    const defs = TEMPLATE_DEFINITIONS.filter((d) => ids.includes(d.id));
    if (defs.length === 0) {
      throw new Error(`No template definitions found for IDs: ${ids.join(', ')}`);
    }
    return this.generateTemplates(defs, onProgress, concurrency);
  }

  /**
   * Generate templates for a specific genre.
   */
  async generateByGenre(
    genre: string,
    onProgress?: GenerationProgressCallback,
    concurrency: number = 2
  ): Promise<TemplateGenerationResult[]> {
    const defs = TEMPLATE_DEFINITIONS.filter(
      (d) => d.genre.toLowerCase() === genre.toLowerCase()
    );
    if (defs.length === 0) {
      throw new Error(`No templates defined for genre: ${genre}. Available: ${[...new Set(TEMPLATE_DEFINITIONS.map((d) => d.genre))].join(', ')}`);
    }
    return this.generateTemplates(defs, onProgress, concurrency);
  }

  /**
   * Core generation loop. Processes templates with concurrency control.
   */
  private async generateTemplates(
    defs: TemplateGenerationDef[],
    onProgress?: GenerationProgressCallback,
    concurrency: number = 2
  ): Promise<TemplateGenerationResult[]> {
    if (!kieSunoMusicService.isConfigured()) {
      throw new Error('Suno API is not configured. Set SUNO_API_KEY or KIE_API_KEY environment variable.');
    }

    // Ensure output directory exists
    fs.mkdirSync(this.outputDir, { recursive: true });

    const results: TemplateGenerationResult[] = [];
    let completed = 0;

    // Process in batches to respect rate limits
    for (let i = 0; i < defs.length; i += concurrency) {
      const batch = defs.slice(i, i + concurrency);

      const batchResults = await Promise.allSettled(
        batch.map(async (def) => {
          onProgress?.({
            total: defs.length,
            completed,
            current: `Generating "${def.name}" (${def.genre} / ${def.mood})`,
            status: 'generating',
          });

          return this.generateSingleTemplate(def);
        })
      );

      for (const result of batchResults) {
        completed++;
        if (result.status === 'fulfilled') {
          results.push(result.value);
          logger.info(`Template generated: ${result.value.id} (${result.value.success ? 'OK' : 'FAILED'})`);
        } else {
          results.push({
            id: batch[batchResults.indexOf(result)]?.id || 'unknown',
            success: false,
            error: result.reason?.message || 'Unknown error',
          });
        }

        onProgress?.({
          total: defs.length,
          completed,
          current: results[results.length - 1].id,
          status: results[results.length - 1].success ? 'done' : 'error',
          error: results[results.length - 1].error,
        });
      }

      // Rate limit pause between batches (Suno allows ~5 per 60s)
      if (i + concurrency < defs.length) {
        logger.info(`Rate limit pause: waiting 15s before next batch...`);
        await this.sleep(15000);
      }
    }

    // Write catalog.json
    this.writeCatalog(results.filter((r) => r.success && r.metadata).map((r) => r.metadata!));

    logger.info(`Template generation complete: ${results.filter((r) => r.success).length}/${defs.length} succeeded`);
    return results;
  }

  /**
   * Generate a single template (3 Suno API calls: main, intro, outro).
   */
  private async generateSingleTemplate(def: TemplateGenerationDef): Promise<TemplateGenerationResult> {
    const templateDir = path.join(this.outputDir, def.id);
    fs.mkdirSync(templateDir, { recursive: true });

    try {
      // Generate all 3 segments. Main first (most important), then intro+outro in parallel.
      logger.info(`[${def.id}] Generating MAIN segment...`);
      const mainResult = await kieSunoMusicService.generateAndSave(
        {
          customMode: true,
          title: `${def.name} - Main Loop`,
          style: def.mainPrompt,
          prompt: def.mainPrompt,
          instrumental: true,
          model: 'V5',
        },
        `template_${def.id}_main_${uuidv4().slice(0, 8)}.mp3`
      );

      // Small delay between Suno calls to avoid rate limiting
      await this.sleep(5000);

      logger.info(`[${def.id}] Generating INTRO and OUTRO segments...`);
      const [introResult, outroResult] = await Promise.allSettled([
        kieSunoMusicService.generateAndSave(
          {
            customMode: true,
            title: `${def.name} - Intro`,
            style: def.introPrompt,
            prompt: def.introPrompt,
            instrumental: true,
            model: 'V5',
          },
          `template_${def.id}_intro_${uuidv4().slice(0, 8)}.mp3`
        ),
        // Stagger the outro request by 3s to avoid hitting rate limits
        this.sleep(3000).then(() =>
          kieSunoMusicService.generateAndSave(
            {
              customMode: true,
              title: `${def.name} - Outro`,
              style: def.outroPrompt,
              prompt: def.outroPrompt,
              instrumental: true,
              model: 'V5',
            },
            `template_${def.id}_outro_${uuidv4().slice(0, 8)}.mp3`
          )
        ),
      ]);

      // Copy/trim segments to template directory
      // Main: trim to ~12s for a clean loop segment
      const mainDuration = await ffmpegService.getAudioDuration(mainResult.filePath);
      const mainTargetDuration = Math.min(mainDuration, 15);
      const mainOutPath = path.join(templateDir, 'main.mp3');
      await ffmpegService.trimAudio(mainResult.filePath, mainTargetDuration, mainOutPath);

      // Intro: trim to ~4s
      let introDuration = 0;
      if (introResult.status === 'fulfilled') {
        const introFullDuration = await ffmpegService.getAudioDuration(introResult.value.filePath);
        introDuration = Math.min(introFullDuration, 5);
        const introOutPath = path.join(templateDir, 'intro.mp3');
        await ffmpegService.trimAudio(introResult.value.filePath, introDuration, introOutPath);
      } else {
        logger.warn(`[${def.id}] Intro generation failed, skipping: ${introResult.reason?.message}`);
      }

      // Outro: trim to ~4s
      let outroDuration = 0;
      if (outroResult.status === 'fulfilled') {
        const outroFullDuration = await ffmpegService.getAudioDuration(outroResult.value.filePath);
        outroDuration = Math.min(outroFullDuration, 5);
        const outroOutPath = path.join(templateDir, 'outro.mp3');
        await ffmpegService.trimAudio(outroResult.value.filePath, outroDuration, outroOutPath);
      } else {
        logger.warn(`[${def.id}] Outro generation failed, skipping: ${outroResult.reason?.message}`);
      }

      // Write metadata
      const metadata: SoundTemplateMetadata = {
        id: def.id,
        name: def.name,
        genre: def.genre,
        mood: def.mood,
        energy: def.energy,
        bpm: def.bpm,
        instruments: def.instruments,
        tags: def.tags,
        bestFor: def.bestFor,
        introDuration: introDuration || undefined,
        mainDuration: mainTargetDuration,
        outroDuration: outroDuration || undefined,
      };

      fs.writeFileSync(
        path.join(templateDir, 'metadata.json'),
        JSON.stringify(metadata, null, 2)
      );

      // Clean up original generated files (they're in uploads/music/)
      this.cleanupFile(mainResult.filePath);
      if (introResult.status === 'fulfilled') this.cleanupFile(introResult.value.filePath);
      if (outroResult.status === 'fulfilled') this.cleanupFile(outroResult.value.filePath);

      logger.info(`[${def.id}] Template complete: intro=${introDuration.toFixed(1)}s, main=${mainTargetDuration.toFixed(1)}s, outro=${outroDuration.toFixed(1)}s`);

      return { id: def.id, success: true, metadata };
    } catch (err: any) {
      logger.error(`[${def.id}] Template generation failed: ${err.message}`);
      return { id: def.id, success: false, error: err.message };
    }
  }

  /**
   * Write the master catalog.json for the sound-template service to discover.
   */
  private writeCatalog(templates: SoundTemplateMetadata[]): void {
    // Read existing catalog if present
    const catalogPath = path.join(this.outputDir, 'catalog.json');
    let existing: SoundTemplateMetadata[] = [];
    if (fs.existsSync(catalogPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
        existing = Array.isArray(raw) ? raw : raw.templates || [];
      } catch { /* fresh catalog */ }
    }

    // Merge: update existing entries, add new ones
    const merged = new Map<string, SoundTemplateMetadata>();
    for (const t of existing) merged.set(t.id, t);
    for (const t of templates) merged.set(t.id, t);

    const catalog = Array.from(merged.values());
    fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
    logger.info(`Sound template catalog written: ${catalog.length} templates at ${catalogPath}`);
  }

  /**
   * List all available template definitions (what CAN be generated).
   */
  listDefinitions(): { id: string; name: string; genre: string; mood: string; energy: string }[] {
    return TEMPLATE_DEFINITIONS.map((d) => ({
      id: d.id,
      name: d.name,
      genre: d.genre,
      mood: d.mood,
      energy: d.energy,
    }));
  }

  /**
   * List unique genres available.
   */
  listGenres(): string[] {
    return [...new Set(TEMPLATE_DEFINITIONS.map((d) => d.genre))];
  }

  private cleanupFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { /* ignore */ }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default new SoundTemplateGenerator();
