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

  // ═══════════════════════════════════════════════════════════════════════
  // NEW TEMPLATES — INDIAN AD MUSIC (20 templates)
  // ═══════════════════════════════════════════════════════════════════════

  // ── BOLLYWOOD / HINDI FILM MUSIC ────────────────────────────────────
  {
    id: 'indian_bollywood_pop_01',
    name: 'Bollywood Pop Modern',
    genre: 'Bollywood',
    mood: 'Upbeat',
    energy: 'medium',
    bpm: 120,
    instruments: ['dholak', 'synth pad', 'acoustic guitar', 'bansuri flute', 'claps'],
    bestFor: ['FMCG ads', 'mobile brands', 'lifestyle products', 'Indian consumer brands'],
    tags: ['bollywood', 'pop', 'hindi', 'modern', 'upbeat', 'commercial', 'indian'],
    mainPrompt: 'Modern Bollywood pop instrumental, 120 BPM, D major. Catchy acoustic guitar riff with light dholak groove, bright synth pads, and bansuri flute melody in the background. Contemporary Hindi film music feel — bright, optimistic, radio-friendly. The kind of music behind a happy Indian TV commercial. Must loop seamlessly — ending connects back to start. Consistent energy, no drops or builds. Instrumental only, no vocals.',
    introPrompt: 'Modern Bollywood pop intro, 120 BPM. Acoustic guitar arpeggio with a single bansuri note blooming into the full groove with a dholak fill. Bright, welcoming Indian commercial opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Modern Bollywood pop outro, 120 BPM. Guitar and bansuri resolving together over a final dholak hit and synth pad sustain. Warm, satisfying Bollywood ending. Instrumental only.',
  },
  {
    id: 'indian_bollywood_romantic_01',
    name: 'Bollywood Romantic',
    genre: 'Bollywood',
    mood: 'Romantic',
    energy: 'low',
    bpm: 80,
    instruments: ['piano', 'strings', 'bansuri flute', 'soft tabla', 'celeste'],
    bestFor: ['jewelry brands', 'fashion', 'dating apps', 'beauty products', 'perfume'],
    tags: ['bollywood', 'romantic', 'emotional', 'soft', 'love', 'elegant', 'indian'],
    mainPrompt: 'Romantic Bollywood instrumental, 80 BPM, A minor to major. Gentle piano melody with lush Bollywood-style string arrangement, soft bansuri flute accents, and delicate tabla keeping time. A.R. Rahman inspired — emotionally rich, cinematic romance feel. Tender, elegant, beautiful. Must loop seamlessly. Consistent gentle mood throughout. Instrumental only, no vocals.',
    introPrompt: 'Romantic Bollywood intro, 80 BPM. Solo piano note with strings swelling in gently, a bansuri breath appearing. Emotional, cinematic Indian opening. 5 seconds. Instrumental only.',
    outroPrompt: 'Romantic Bollywood outro, 80 BPM. Strings and piano resolving to a tender final chord with bansuri fading. Beautiful, emotional ending. Instrumental only.',
  },
  {
    id: 'indian_bollywood_dance_01',
    name: 'Bollywood Dance Energy',
    genre: 'Bollywood',
    mood: 'Energetic',
    energy: 'high',
    bpm: 135,
    instruments: ['dhol', 'brass section', 'synth bass', 'electronic drums', 'claps'],
    bestFor: ['e-commerce sales', 'flash deals', 'party events', 'festive promos', 'big billion sales'],
    tags: ['bollywood', 'dance', 'high-energy', 'party', 'festive', 'sale', 'indian'],
    mainPrompt: 'High energy Bollywood dance music, 135 BPM, G major. Driving dhol pattern with punchy brass stabs, thick synth bass, electronic kick drum, and handclaps. Item song energy — explosive, celebratory, makes you want to dance. Think Bollywood party anthem instrumental. Must loop seamlessly. Relentless high energy throughout, no breakdowns. Instrumental only, no vocals.',
    introPrompt: 'Bollywood dance intro, 135 BPM. Dhol roll building rapidly with brass fanfare announcing the beat drop. Explosive, festive opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Bollywood dance outro, 135 BPM. Brass and dhol hitting a massive final stab with synth sustain. Big, impactful Bollywood ending. Instrumental only.',
  },
  {
    id: 'indian_retro_bollywood_01',
    name: 'Retro Bollywood 70s',
    genre: 'Bollywood',
    mood: 'Groovy',
    energy: 'medium',
    bpm: 110,
    instruments: ['funky guitar', 'brass section', 'dholak', 'Hammond organ', 'bongos'],
    bestFor: ['vintage brands', 'retro food products', 'nostalgia campaigns', 'classic Indian brands'],
    tags: ['bollywood', 'retro', '70s', 'funk', 'vintage', 'nostalgia', 'RD Burman', 'indian'],
    mainPrompt: 'Retro 1970s Bollywood funk instrumental, 110 BPM, E minor. Wah-wah guitar riff with groovy brass section, dholak rhythm, Hammond organ chords, and bongo fills. R.D. Burman inspired — funky, stylish, vintage Bollywood cool. Think classic Hindi film detective scene music. Must loop seamlessly. Consistent vintage groove. Instrumental only, no vocals.',
    introPrompt: 'Retro Bollywood 70s intro, 110 BPM. Wah guitar lick leading into the brass and dholak groove. Stylish, vintage opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Retro Bollywood 70s outro, 110 BPM. Brass hitting a final phrase with guitar wah sustaining over a dholak fill. Cool, retro ending. Instrumental only.',
  },

  // ── BHANGRA / PUNJABI ───────────────────────────────────────────────
  {
    id: 'indian_bhangra_party_01',
    name: 'Bhangra Party',
    genre: 'Bhangra',
    mood: 'Celebratory',
    energy: 'high',
    bpm: 130,
    instruments: ['dhol', 'tumbi', 'chimta', 'algoza', 'electronic bass'],
    bestFor: ['food delivery apps', 'festive sales', 'wedding platforms', 'FMCG'],
    tags: ['bhangra', 'punjabi', 'party', 'dhol', 'celebration', 'festive', 'indian'],
    mainPrompt: 'High energy Bhangra party music, 130 BPM. Powerful dhol driving the beat with bright tumbi melody, chimta accents, algoza flourishes, and modern electronic bass underneath. Pure Punjabi celebration energy — wedding baraat meets modern party. Must loop seamlessly. Relentless celebratory energy. Instrumental only, no vocals.',
    introPrompt: 'Bhangra party intro, 130 BPM. Dhol solo building with chimta clicks then tumbi riff drops in. Explosive Punjabi opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Bhangra party outro, 130 BPM. Dhol intensifying into a massive final hit with tumbi and chimta accent. Powerful Punjabi ending. Instrumental only.',
  },
  {
    id: 'indian_punjabi_pop_modern_01',
    name: 'Modern Punjabi Pop',
    genre: 'Punjabi Pop',
    mood: 'Cool',
    energy: 'high',
    bpm: 118,
    instruments: ['dhol', 'synth bass', 'electronic drums', 'tumbi', 'claps'],
    bestFor: ['youth brands', 'sportswear', 'fast food chains', 'entertainment apps'],
    tags: ['punjabi', 'pop', 'modern', 'cool', 'youth', 'swag', 'indian'],
    mainPrompt: 'Modern Punjabi pop instrumental, 118 BPM, A major. Clean dhol pattern with heavy synth bass, crisp electronic drums, tumbi melody, and sharp claps. Contemporary Punjabi radio hit feel — Diljit Dosanjh style production, polished and punchy. Cool, confident swagger. Must loop seamlessly. Consistent groove. Instrumental only, no vocals.',
    introPrompt: 'Modern Punjabi pop intro, 118 BPM. Filtered synth bass with dhol building to the full beat drop with tumbi. Cool, modern opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Modern Punjabi pop outro, 118 BPM. Beat continuing to a final bass and dhol stab. Clean, punchy ending. Instrumental only.',
  },

  // ── INDIAN CORPORATE / TECH ─────────────────────────────────────────
  {
    id: 'indian_corporate_modern_01',
    name: 'Indian Corporate Modern',
    genre: 'Indian Corporate',
    mood: 'Progressive',
    energy: 'medium',
    bpm: 115,
    instruments: ['piano', 'tabla fusion', 'synth pad', 'sitar accent', 'light drums'],
    bestFor: ['Indian tech companies', 'fintech', 'edtech', 'Indian startups', 'banking'],
    tags: ['corporate', 'indian', 'tech', 'modern', 'professional', 'startup', 'innovation'],
    mainPrompt: 'Modern Indian corporate music, 115 BPM, C major. Clean piano melody with subtle tabla fusion rhythm, ambient synth pads, and occasional sitar accent notes. Professional yet distinctly Indian — the sound of modern India, tech-forward and progressive. Perfect for Indian startup or banking ads. Must loop seamlessly. Consistent professional energy. Instrumental only, no vocals.',
    introPrompt: 'Indian corporate intro, 115 BPM. Piano notes with a subtle tabla tap establishing rhythm, sitar accent appearing. Professional, Indian-modern opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Indian corporate outro, 115 BPM. Piano and sitar resolving together over tabla fading out. Clean, professional Indian ending. Instrumental only.',
  },

  // ── INDIAN STREET / URBAN ───────────────────────────────────────────
  {
    id: 'indian_street_funk_01',
    name: 'Mumbai Street Funk',
    genre: 'Indian Fusion',
    mood: 'Funky',
    energy: 'medium',
    bpm: 110,
    instruments: ['dholak', 'funky bass guitar', 'brass', 'shehnai accent', 'tabla'],
    bestFor: ['street food brands', 'delivery apps', 'local businesses', 'youth brands'],
    tags: ['mumbai', 'street', 'funk', 'urban', 'chai', 'desi', 'groovy', 'indian'],
    mainPrompt: 'Mumbai street funk instrumental, 110 BPM, G mixolydian. Groovy dholak pattern with funky slap bass guitar, small brass section playing catchy riffs, and shehnai accents giving it that unmistakable Indian street flavor. Think tapori Mumbai energy — cheeky, fun, full of personality. The music you hear at a bustling Mumbai chowk. Must loop seamlessly. Consistent funky groove. Instrumental only, no vocals.',
    introPrompt: 'Mumbai street funk intro, 110 BPM. Dholak starting a groove with bass guitar sliding in and a cheeky shehnai phrase. Street-smart opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Mumbai street funk outro, 110 BPM. Brass and shehnai hitting a final phrase with dholak fill. Fun, street-smart ending. Instrumental only.',
  },
  {
    id: 'indian_hiphop_desi_01',
    name: 'Desi Hip-Hop',
    genre: 'Indian Hip-Hop',
    mood: 'Intense',
    energy: 'high',
    bpm: 140,
    instruments: ['808 bass', 'trap hi-hats', 'dhol sample', 'Indian vocal chop', 'synth'],
    bestFor: ['youth brands', 'streetwear', 'energy drinks', 'gaming', 'sneakers'],
    tags: ['hiphop', 'desi', 'trap', 'urban', 'gully', 'rap', 'indian'],
    mainPrompt: 'Desi hip-hop trap beat, 140 BPM, D minor. Deep 808 bass with crisp trap hi-hat rolls, dhol sample hits on downbeats, pitch-shifted Indian vocal chops as texture, and dark synth melody. Gully Boy meets modern trap — raw, confident, street. Indian hip-hop that hits hard. Must loop seamlessly. Consistent intensity. Instrumental only, no vocals or rap.',
    introPrompt: 'Desi hip-hop intro, 140 BPM. 808 sub hitting with a dhol sample and filtered synth rising. Hard, street-smart opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Desi hip-hop outro, 140 BPM. 808 and dhol hitting a final stab with synth reverb tail. Hard-hitting ending. Instrumental only.',
  },

  // ── SOUTH INDIAN / CARNATIC ─────────────────────────────────────────
  {
    id: 'indian_carnatic_fusion_01',
    name: 'Carnatic Fusion',
    genre: 'Carnatic Fusion',
    mood: 'Sophisticated',
    energy: 'medium',
    bpm: 100,
    instruments: ['veena', 'mridangam', 'violin', 'ghatam', 'tanpura'],
    bestFor: ['South Indian brands', 'classical arts events', 'premium silk brands', 'tourism'],
    tags: ['carnatic', 'south-indian', 'fusion', 'classical', 'sophisticated', 'veena', 'indian'],
    mainPrompt: 'Carnatic fusion instrumental, 100 BPM, Raga Hamsadhwani (auspicious mood). Veena playing melodic phrases with mridangam providing rhythmic pattern, Carnatic violin adding harmony, and ghatam accents. South Indian classical meeting modern arrangement — sophisticated, culturally rich, intricate yet accessible. Must loop seamlessly. Consistent musical energy. Instrumental only, no vocals.',
    introPrompt: 'Carnatic fusion intro, 100 BPM. Tanpura drone establishing with veena playing an auspicious opening phrase. Elegant South Indian opening. 5 seconds. Instrumental only.',
    outroPrompt: 'Carnatic fusion outro, 100 BPM. Veena and mridangam resolving in a traditional Carnatic ending pattern (korvai). Sophisticated ending. Instrumental only.',
  },
  {
    id: 'indian_cinematic_epic_01',
    name: 'Indian Cinematic Epic',
    genre: 'Indian Cinematic',
    mood: 'Grand',
    energy: 'high',
    bpm: 100,
    instruments: ['orchestral strings', 'nadaswaram', 'chenda drums', 'brass', 'war drums'],
    bestFor: ['movie trailers', 'premium launches', 'grand openings', 'luxury real estate'],
    tags: ['cinematic', 'epic', 'indian', 'grand', 'orchestral', 'premium', 'baahubali'],
    mainPrompt: 'Epic Indian cinematic music, 100 BPM, D minor. Grand orchestral strings with nadaswaram (South Indian temple instrument) soaring over powerful chenda war drums, brass fanfares, and deep timpani. Baahubali/RRR scale grandeur — majestic, powerful, goosebump-inducing. Indian epic cinema at its grandest. Must loop seamlessly. Consistent epic intensity. Instrumental only, no vocals.',
    introPrompt: 'Indian cinematic epic intro, 100 BPM. Deep war drums building with strings rising, nadaswaram announcing the grandeur. Majestic, powerful opening. 5 seconds. Instrumental only.',
    outroPrompt: 'Indian cinematic epic outro, 100 BPM. Full orchestra and nadaswaram hitting a massive final chord with war drum fill. Earth-shaking, grand ending. Instrumental only.',
  },

  // ── RAJASTHANI / FOLK ───────────────────────────────────────────────
  {
    id: 'indian_rajasthani_folk_01',
    name: 'Rajasthani Folk Modern',
    genre: 'Rajasthani Folk',
    mood: 'Vibrant',
    energy: 'medium',
    bpm: 105,
    instruments: ['morchang', 'kamaicha', 'dholak', 'algoza', 'ghungroo'],
    bestFor: ['tourism ads', 'handicraft brands', 'ethnic wear', 'cultural festivals', 'heritage hotels'],
    tags: ['rajasthani', 'folk', 'desert', 'vibrant', 'cultural', 'tourism', 'indian'],
    mainPrompt: 'Rajasthani folk music with modern production, 105 BPM. Morchang (jaw harp) providing the groove with kamaicha (bowed instrument) melody, dholak rhythm, algoza (double flute) ornaments, and ghungroo (ankle bells) accents. The sound of the Thar desert — vibrant, colorful, mystical. Rajasthani folk authenticity with clean modern recording quality. Must loop seamlessly. Consistent groove. Instrumental only, no vocals.',
    introPrompt: 'Rajasthani folk intro, 105 BPM. Morchang beginning alone then kamaicha sliding in with a desert melody. Mystical, vibrant opening. 5 seconds. Instrumental only.',
    outroPrompt: 'Rajasthani folk outro, 105 BPM. Kamaicha and algoza playing a final phrase with dholak fill and ghungroo shimmer. Colorful folk ending. Instrumental only.',
  },

  // ── INDIAN WEDDING ──────────────────────────────────────────────────
  {
    id: 'indian_wedding_baraat_01',
    name: 'Indian Wedding Baraat',
    genre: 'Indian Wedding',
    mood: 'Joyous',
    energy: 'high',
    bpm: 125,
    instruments: ['shehnai', 'dhol', 'nagada', 'brass band', 'dholak'],
    bestFor: ['wedding platforms', 'ethnic wear brands', 'jewelry brands', 'catering', 'venues'],
    tags: ['wedding', 'baraat', 'shehnai', 'celebration', 'joyous', 'shaadi', 'indian'],
    mainPrompt: 'Indian wedding baraat music, 125 BPM. Shehnai playing auspicious wedding melodies with powerful dhol and nagada (large kettle drums) driving the procession, small brass band playing supporting harmonies, and dholak adding rhythmic fills. Pure Indian wedding celebration — joyous, auspicious, the sound of a baraat procession. Must loop seamlessly. Consistent celebratory energy. Instrumental only, no vocals.',
    introPrompt: 'Indian wedding baraat intro, 125 BPM. Shehnai beginning with an auspicious note bending into the wedding melody as dhol rolls in. Joyous, festive opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Indian wedding baraat outro, 125 BPM. Shehnai and brass hitting a triumphant final phrase with dhol and nagada crescendo. Grand, joyous wedding ending. Instrumental only.',
  },

  // ── SUFI / SPIRITUAL ────────────────────────────────────────────────
  {
    id: 'indian_sufi_qawwali_01',
    name: 'Sufi Qawwali Modern',
    genre: 'Sufi',
    mood: 'Soulful',
    energy: 'medium',
    bpm: 90,
    instruments: ['harmonium', 'tabla', 'dholak', 'sarangi', 'claps'],
    bestFor: ['artisan brands', 'heritage campaigns', 'soulful brand stories', 'cultural festivals'],
    tags: ['sufi', 'qawwali', 'soulful', 'spiritual', 'deep', 'harmonium', 'indian'],
    mainPrompt: 'Modern Sufi qawwali instrumental, 90 BPM, Phrygian mode. Harmonium playing soulful chord progressions with tabla and dholak providing the traditional qawwali clapping rhythm, and sarangi adding emotional melodic lines. Deep, spiritual, transcendent — Nusrat Fateh Ali Khan inspired feel without vocals. The ecstasy of Sufi devotional music as pure instrumental. Must loop seamlessly. Consistent spiritual intensity. Instrumental only, no vocals.',
    introPrompt: 'Sufi qawwali intro, 90 BPM. Harmonium drone establishing with sarangi sliding into the melody over soft claps. Deep, soulful opening. 5 seconds. Instrumental only.',
    outroPrompt: 'Sufi qawwali outro, 90 BPM. Sarangi and harmonium resolving together with tabla and dholak hitting a final rhythmic pattern. Spiritually fulfilling ending. Instrumental only.',
  },

  // ── INDIAN LOUNGE / CHILL ───────────────────────────────────────────
  {
    id: 'indian_lounge_modern_01',
    name: 'Indian Lounge Chill',
    genre: 'Indian Lounge',
    mood: 'Sophisticated',
    energy: 'low',
    bpm: 95,
    instruments: ['electric sitar', 'jazz guitar', 'tabla', 'ambient pad', 'upright bass'],
    bestFor: ['premium restaurants', 'luxury hotels', 'premium lifestyle brands', 'lounge bars'],
    tags: ['lounge', 'chill', 'indian', 'sophisticated', 'premium', 'nightlife', 'fusion'],
    mainPrompt: 'Indian lounge chill music, 95 BPM, A minor. Electric sitar playing cool melodic phrases with jazz guitar chords, soft tabla groove, ambient synth pads, and walking upright bass. Mumbai luxury lounge feel — sophisticated, modern Indian fusion. Premium, relaxed, worldly. Must loop seamlessly. Consistent mellow groove. Instrumental only, no vocals.',
    introPrompt: 'Indian lounge intro, 95 BPM. Ambient pad fading in with electric sitar note and jazz guitar chord. Sophisticated, premium opening. 5 seconds. Instrumental only.',
    outroPrompt: 'Indian lounge outro, 95 BPM. Sitar and jazz guitar resolving over a final tabla phrase. Elegant, sophisticated ending. Instrumental only.',
  },

  // ── INDIAN WELLNESS / SPIRITUAL ─────────────────────────────────────
  {
    id: 'indian_wellness_ayurveda_01',
    name: 'Indian Wellness Ayurveda',
    genre: 'Indian Wellness',
    mood: 'Peaceful',
    energy: 'low',
    bpm: 65,
    instruments: ['bansuri flute', 'tanpura', 'singing bowls', 'gentle tabla', 'wind chimes'],
    bestFor: ['ayurveda brands', 'wellness apps', 'yoga studios', 'organic products', 'spa'],
    tags: ['wellness', 'ayurveda', 'yoga', 'peaceful', 'spiritual', 'healing', 'indian'],
    mainPrompt: 'Indian wellness and ayurveda music, 65 BPM. Serene bansuri flute melody floating over tanpura drone, Tibetan singing bowls, gentle tabla keeping minimal time, and soft wind chimes. Deeply peaceful, healing, meditative. The sound of an Indian wellness retreat at dawn. Must loop seamlessly. Very consistent peaceful energy. Instrumental only, no vocals.',
    introPrompt: 'Indian wellness intro, 65 BPM. Singing bowl ring fading in with tanpura drone and a single bansuri note. Serene, healing opening. 5 seconds. Instrumental only.',
    outroPrompt: 'Indian wellness outro, 65 BPM. Bansuri holding a final note fading into tanpura and singing bowl resonance. Peaceful, meditative ending. Instrumental only.',
  },
  {
    id: 'indian_devotional_modern_01',
    name: 'Modern Indian Devotional',
    genre: 'Indian Devotional',
    mood: 'Sacred',
    energy: 'low',
    bpm: 70,
    instruments: ['harmonium', 'tabla', 'manjira', 'temple bell', 'bansuri'],
    bestFor: ['incense brands', 'spiritual apps', 'pilgrimage tourism', 'pooja items'],
    tags: ['devotional', 'spiritual', 'sacred', 'bhajan', 'temple', 'prayer', 'indian'],
    mainPrompt: 'Modern Indian devotional instrumental, 70 BPM, Raga Bhairav (morning raga). Harmonium playing gentle devotional chord patterns with soft tabla, manjira (small cymbals) keeping rhythm, occasional temple bell, and bansuri flute adding melodic grace. Sacred, pure, morning prayer atmosphere. Modern production quality with traditional devotional authenticity. Must loop seamlessly. Consistent peaceful devotional energy. Instrumental only, no vocals.',
    introPrompt: 'Indian devotional intro, 70 BPM. Temple bell ringing with harmonium drone establishing and bansuri entering softly. Sacred, prayerful opening. 5 seconds. Instrumental only.',
    outroPrompt: 'Indian devotional outro, 70 BPM. Harmonium and bansuri resolving with a final manjira shimmer and temple bell. Peaceful, sacred ending. Instrumental only.',
  },

  // ── INDIAN ROCK / FUSION ────────────────────────────────────────────
  {
    id: 'indian_rock_fusion_01',
    name: 'Indian Rock Fusion',
    genre: 'Indian Rock',
    mood: 'Powerful',
    energy: 'high',
    bpm: 125,
    instruments: ['electric guitar', 'tabla', 'dholak', 'bass guitar', 'bansuri'],
    bestFor: ['adventure brands', 'motorcycle brands', 'outdoor gear', 'progressive brands'],
    tags: ['rock', 'fusion', 'indian', 'powerful', 'guitar', 'adventure', 'progressive'],
    mainPrompt: 'Indian rock fusion instrumental, 125 BPM, E minor. Crunchy electric guitar riff fused with powerful tabla and dholak rhythms, driving bass guitar, and bansuri flute weaving through the arrangement. Indian Ocean band style — raw, powerful, fusion of rock energy with Indian soul. Must loop seamlessly. Consistent powerful intensity. Instrumental only, no vocals.',
    introPrompt: 'Indian rock fusion intro, 125 BPM. Guitar feedback building with tabla accelerating into the main riff. Powerful, fusion opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Indian rock fusion outro, 125 BPM. Guitar and tabla building to a massive power chord with bansuri cry. Epic fusion ending. Instrumental only.',
  },

  // ── INDIAN ELECTRONIC ───────────────────────────────────────────────
  {
    id: 'indian_electronic_01',
    name: 'Indian Electronic Future',
    genre: 'Indian Electronic',
    mood: 'Futuristic',
    energy: 'high',
    bpm: 128,
    instruments: ['sitar sample', '808 bass', 'synth arpeggios', 'electronic tabla', 'pad'],
    bestFor: ['tech startups', 'apps', 'gaming', 'electronic brands', 'AI companies'],
    tags: ['electronic', 'indian', 'futuristic', 'tech', 'bass', 'modern', 'digital'],
    mainPrompt: 'Indian electronic future bass, 128 BPM, C minor. Processed sitar samples with heavy 808 bass, bright synth arpeggios, electronic tabla patterns, and atmospheric pads. Nucleya/KSHMR style — Indian elements fused with EDM production. Futuristic India, digital culture meets ancient sounds. Must loop seamlessly. Consistent high energy. Instrumental only, no vocals.',
    introPrompt: 'Indian electronic intro, 128 BPM. Filtered sitar sample with rising synth and 808 sub building. Futuristic Indian opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Indian electronic outro, 128 BPM. Sitar and synth hitting a final massive chord with 808 sustain. Digital meets ancient ending. Instrumental only.',
  },

  // ── INDIAN ACOUSTIC / INDIE ─────────────────────────────────────────
  {
    id: 'indian_acoustic_folk_01',
    name: 'Indian Indie Acoustic',
    genre: 'Indian Indie',
    mood: 'Heartfelt',
    energy: 'low',
    bpm: 95,
    instruments: ['acoustic guitar', 'cajon', 'bansuri', 'harmonium', 'soft percussion'],
    bestFor: ['travel brands', 'organic food', 'handmade products', 'indie brands', 'NGOs'],
    tags: ['indie', 'acoustic', 'folk', 'heartfelt', 'authentic', 'travel', 'indian'],
    mainPrompt: 'Indian indie acoustic folk, 95 BPM, G major. Warm fingerpicked acoustic guitar with cajon providing gentle rhythm, bansuri flute adding Indian melodic touches, and harmonium sustaining soft chords. Prateek Kuhad/Indian indie coffee-house feel — heartfelt, authentic, warm. The sound of honest storytelling. Must loop seamlessly. Consistent gentle groove. Instrumental only, no vocals.',
    introPrompt: 'Indian indie acoustic intro, 95 BPM. Solo acoustic guitar fingerpicking with a bansuri note entering. Warm, heartfelt opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Indian indie acoustic outro, 95 BPM. Guitar and bansuri resolving together with harmonium fading. Heartfelt, warm ending. Instrumental only.',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // NEW TEMPLATES — INTERNATIONAL AD MUSIC (20 templates)
  // ═══════════════════════════════════════════════════════════════════════

  // ── MOTIVATIONAL / INSPIRATIONAL ────────────────────────────────────
  {
    id: 'motivational_inspiring_01',
    name: 'Motivational Inspiring',
    genre: 'Inspirational',
    mood: 'Uplifting',
    energy: 'medium',
    bpm: 100,
    instruments: ['piano', 'strings', 'soft drums', 'electric guitar', 'claps'],
    bestFor: ['motivational campaigns', 'non-profits', 'sports brands', 'education'],
    tags: ['motivational', 'inspiring', 'uplifting', 'hope', 'empowerment', 'nike'],
    mainPrompt: 'Motivational inspirational music, 100 BPM, C major. Warm piano chords with building strings, soft steady drums, clean electric guitar arpeggios, and handclaps. Nike/TED talk commercial feel — hopeful, empowering, makes you believe anything is possible. Must loop seamlessly. Consistent uplifting energy without big crescendos. Instrumental only.',
    introPrompt: 'Motivational intro, 100 BPM. Solo piano chord with strings gently entering. Hopeful, inspiring opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Motivational outro, 100 BPM. Piano and strings resolving to a bright, hopeful final chord. Uplifting ending. Instrumental only.',
  },
  {
    id: 'orchestral_inspiring_01',
    name: 'Orchestral Inspirational',
    genre: 'Orchestral',
    mood: 'Hopeful',
    energy: 'medium',
    bpm: 85,
    instruments: ['strings', 'French horn', 'harp', 'timpani', 'flute'],
    bestFor: ['NGO campaigns', 'charity', 'healthcare', 'life insurance', 'education'],
    tags: ['orchestral', 'inspirational', 'hopeful', 'emotional', 'charity', 'ngo'],
    mainPrompt: 'Orchestral inspirational music, 85 BPM, E-flat major. Warm string section with noble French horn melody, gentle harp arpeggios, soft timpani pulse, and flute countermelody. Emotionally moving, hopeful, dignified. The music behind stories of human triumph. Must loop seamlessly. Consistent emotional warmth. Instrumental only.',
    introPrompt: 'Orchestral inspirational intro, 85 BPM. Harp arpeggio with strings entering warmly. Noble, hopeful opening. 5 seconds. Instrumental only.',
    outroPrompt: 'Orchestral inspirational outro, 85 BPM. French horn and strings resolving to a warm, noble final chord. Emotionally satisfying ending. Instrumental only.',
  },

  // ── FUNK / GROOVE ───────────────────────────────────────────────────
  {
    id: 'funk_groove_01',
    name: 'Funk Groove',
    genre: 'Funk',
    mood: 'Groovy',
    energy: 'medium',
    bpm: 108,
    instruments: ['funk guitar', 'slap bass', 'brass section', 'drums', 'clavinet'],
    bestFor: ['food brands', 'fashion retail', 'nightlife', 'entertainment'],
    tags: ['funk', 'groove', 'bass', 'brass', 'retro', 'dance', 'cool'],
    mainPrompt: 'Funky groove music, 108 BPM, E minor. Tight wah-wah funk guitar riff with slap bass, punchy horn section stabs, solid drums with ghost notes, and clavinet chords. James Brown meets Vulfpeck — tight, groovy, irresistible head-nod music. Must loop seamlessly. Consistent pocket groove. Instrumental only.',
    introPrompt: 'Funk groove intro, 108 BPM. Drums starting a tight groove with the bass sliding in and guitar wah hit. Funky opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Funk groove outro, 108 BPM. Horns and guitar hitting a final stab with bass popping. Tight, funky ending. Instrumental only.',
  },

  // ── TROPICAL / SUMMER ───────────────────────────────────────────────
  {
    id: 'tropical_house_01',
    name: 'Tropical House',
    genre: 'Tropical House',
    mood: 'Sunny',
    energy: 'medium',
    bpm: 110,
    instruments: ['tropical pluck synth', 'steel drums', 'soft kick', 'marimba', 'shaker'],
    bestFor: ['travel agencies', 'summer campaigns', 'resorts', 'beverage brands'],
    tags: ['tropical', 'house', 'summer', 'beach', 'sunny', 'vacation', 'chill'],
    mainPrompt: 'Tropical house music, 110 BPM, F major. Bright plucked synth melody with steel drum accents, soft four-on-the-floor kick, marimba arpeggios, and shaker groove. Kygo-inspired summer vibes — sunny, beachy, feel-good warmth. Perfect for travel or summer drink ads. Must loop seamlessly. Consistent sunny energy. Instrumental only.',
    introPrompt: 'Tropical house intro, 110 BPM. Marimba arpeggio with steel drum note establishing the sunny vibe. Warm, beachy opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Tropical house outro, 110 BPM. Pluck synth and steel drum resolving to a bright final chord with shaker fade. Sunny ending. Instrumental only.',
  },

  // ── R&B / SOUL ──────────────────────────────────────────────────────
  {
    id: 'rnb_smooth_01',
    name: 'R&B Smooth',
    genre: 'R&B',
    mood: 'Sultry',
    energy: 'low',
    bpm: 85,
    instruments: ['Rhodes piano', 'smooth bass', 'R&B drums', 'strings', 'pad'],
    bestFor: ['beauty brands', 'fragrance ads', 'luxury lifestyle', 'fashion'],
    tags: ['rnb', 'smooth', 'sultry', 'luxury', 'beauty', 'elegant', 'sensual'],
    mainPrompt: 'Smooth R&B instrumental, 85 BPM, A-flat major. Warm Rhodes electric piano chords with silky smooth bass, laid-back R&B drum pattern, lush string accents, and atmospheric pads. Sultry, luxurious, effortlessly cool. The sound of premium beauty and fashion ads. Must loop seamlessly. Consistent smooth groove. Instrumental only.',
    introPrompt: 'Smooth R&B intro, 85 BPM. Rhodes chord with strings swelling gently. Luxurious, sultry opening. 5 seconds. Instrumental only.',
    outroPrompt: 'Smooth R&B outro, 85 BPM. Rhodes and bass resolving over a final string sustain. Elegant, smooth ending. Instrumental only.',
  },
  {
    id: 'soul_vintage_01',
    name: 'Soul Vintage Motown',
    genre: 'Soul',
    mood: 'Warm',
    energy: 'medium',
    bpm: 95,
    instruments: ['organ', 'electric guitar', 'bass', 'drums', 'brass', 'tambourine'],
    bestFor: ['heritage brands', 'classic products', 'food brands', 'family'],
    tags: ['soul', 'motown', 'vintage', 'warm', 'retro', 'classic', 'heartfelt'],
    mainPrompt: 'Vintage Motown soul instrumental, 95 BPM, G major. Warm Hammond organ with clean electric guitar licks, thumping Motown bass, tight drums with tambourine, and brass section accents. Classic 1960s soul warmth — Stevie Wonder/Marvin Gaye era feel. Warm, genuine, timeless. Must loop seamlessly. Consistent warm groove. Instrumental only.',
    introPrompt: 'Vintage soul intro, 95 BPM. Organ chord with tambourine and bass walking in. Warm, classic opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Vintage soul outro, 95 BPM. Organ and brass hitting a final Motown-style ending with tambourine. Warm, classic ending. Instrumental only.',
  },

  // ── HIP-HOP ─────────────────────────────────────────────────────────
  {
    id: 'hiphop_modern_clean_01',
    name: 'Hip-Hop Modern Clean',
    genre: 'Hip-Hop',
    mood: 'Confident',
    energy: 'medium',
    bpm: 92,
    instruments: ['808 bass', 'trap hi-hats', 'piano', 'synth bass', 'snare'],
    bestFor: ['urban brands', 'sneaker brands', 'streetwear', 'sports'],
    tags: ['hiphop', 'modern', 'clean', 'urban', 'confident', 'cool', 'street'],
    mainPrompt: 'Modern clean hip-hop beat, 92 BPM, C minor. Deep 808 bass with crisp trap hi-hats, melodic piano chords, tight snare pattern, and atmospheric synth. Clean, polished hip-hop production — confident without being aggressive. Urban cool for brand commercials. Must loop seamlessly. Consistent groove. Instrumental only, no vocals.',
    introPrompt: 'Hip-hop intro, 92 BPM. Piano chord with 808 sub hitting and hi-hats rolling in. Cool, confident opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Hip-hop outro, 92 BPM. Piano and 808 hitting a final stab. Clean, confident ending. Instrumental only.',
  },

  // ── COUNTRY / AMERICANA ─────────────────────────────────────────────
  {
    id: 'country_acoustic_01',
    name: 'Country Acoustic',
    genre: 'Country',
    mood: 'Warm',
    energy: 'medium',
    bpm: 105,
    instruments: ['steel guitar', 'acoustic guitar', 'fiddle', 'bass', 'light drums'],
    bestFor: ['farming brands', 'outdoor lifestyle', 'BBQ products', 'American brands'],
    tags: ['country', 'acoustic', 'americana', 'warm', 'heartland', 'outdoor'],
    mainPrompt: 'Country acoustic music, 105 BPM, G major. Steel guitar melody with bright acoustic guitar strumming, fiddle accents, steady bass, and light brush drums. Warm American heartland feel — honest, down-to-earth, open road. Must loop seamlessly. Consistent warm country groove. Instrumental only.',
    introPrompt: 'Country acoustic intro, 105 BPM. Acoustic guitar strum with steel guitar sliding in. Warm, heartland opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Country acoustic outro, 105 BPM. Steel guitar and fiddle resolving to a final warm chord. Satisfying country ending. Instrumental only.',
  },

  // ── LATIN ───────────────────────────────────────────────────────────
  {
    id: 'reggaeton_light_01',
    name: 'Reggaeton Light',
    genre: 'Reggaeton',
    mood: 'Playful',
    energy: 'medium',
    bpm: 95,
    instruments: ['dembow rhythm', 'synth bass', 'claps', 'brass stabs', 'percussion'],
    bestFor: ['summer products', 'nightlife brands', 'fashion', 'Latin food brands'],
    tags: ['reggaeton', 'latin', 'dembow', 'summer', 'dance', 'playful', 'urban'],
    mainPrompt: 'Light reggaeton instrumental, 95 BPM. Classic dembow rhythm pattern with bouncy synth bass, sharp claps, brass stabs, and Latin percussion accents. Playful, fun, summer party energy without being too intense. Commercial-friendly reggaeton for brand ads. Must loop seamlessly. Consistent groove. Instrumental only.',
    introPrompt: 'Reggaeton intro, 95 BPM. Dembow pattern starting with synth bass sliding in and a brass stab. Fun, Latin opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Reggaeton outro, 95 BPM. Bass and brass hitting a final stab with percussion fill. Punchy Latin ending. Instrumental only.',
  },
  {
    id: 'bossa_nova_01',
    name: 'Bossa Nova Café',
    genre: 'Bossa Nova',
    mood: 'Relaxed',
    energy: 'low',
    bpm: 130,
    instruments: ['nylon guitar', 'soft brushes', 'upright bass', 'flute', 'light percussion'],
    bestFor: ['coffee brands', 'restaurants', 'travel', 'Brazilian brands', 'wine'],
    tags: ['bossa-nova', 'brazilian', 'cafe', 'relaxed', 'elegant', 'jazz', 'warm'],
    mainPrompt: 'Bossa nova café music, 130 BPM, D major. Nylon guitar playing classic bossa nova rhythm pattern with soft brush drums, walking upright bass, gentle flute melody, and light shaker. Antonio Carlos Jobim inspired — elegant, warm, sophisticated. Perfect coffee shop or restaurant ambiance. Must loop seamlessly. Consistent relaxed groove. Instrumental only.',
    introPrompt: 'Bossa nova intro, 130 BPM. Nylon guitar starting the bossa pattern alone with bass joining. Warm, elegant opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Bossa nova outro, 130 BPM. Guitar and flute resolving to a final warm jazz chord. Elegant, relaxed ending. Instrumental only.',
  },

  // ── CLASSICAL / ELEGANT ─────────────────────────────────────────────
  {
    id: 'classical_piano_elegant_01',
    name: 'Classical Piano Elegant',
    genre: 'Classical',
    mood: 'Elegant',
    energy: 'low',
    bpm: 72,
    instruments: ['grand piano', 'soft strings', 'harp'],
    bestFor: ['luxury real estate', 'fine dining', 'premium brands', 'art galleries', 'jewelry'],
    tags: ['classical', 'piano', 'elegant', 'luxury', 'refined', 'premium', 'sophisticated'],
    mainPrompt: 'Elegant classical piano music, 72 BPM, E-flat major. Beautiful grand piano melody with soft supporting strings and occasional harp arpeggios. Refined, luxurious, timeless elegance. The sound of premium luxury and fine taste. Must loop seamlessly. Consistent elegant mood. Instrumental only.',
    introPrompt: 'Classical piano intro, 72 BPM. Grand piano playing a delicate opening phrase with harp note. Refined, elegant opening. 5 seconds. Instrumental only.',
    outroPrompt: 'Classical piano outro, 72 BPM. Piano resolving to a beautiful final chord with strings and harp sustaining. Luxurious ending. Instrumental only.',
  },

  // ── INDIE / FOLK ────────────────────────────────────────────────────
  {
    id: 'indie_folk_adventure_01',
    name: 'Indie Folk Adventure',
    genre: 'Indie Folk',
    mood: 'Adventurous',
    energy: 'medium',
    bpm: 110,
    instruments: ['banjo', 'acoustic guitar', 'stomp box', 'tambourine', 'harmonica'],
    bestFor: ['travel brands', 'outdoor gear', 'craft beer', 'adventure tourism'],
    tags: ['indie', 'folk', 'adventure', 'travel', 'outdoor', 'authentic', 'road-trip'],
    mainPrompt: 'Indie folk adventure music, 110 BPM, G major. Bright banjo picking with driving acoustic guitar strumming, stomp box beat, tambourine accents, and harmonica melody. Mumford & Sons/Of Monsters and Men feel — adventurous, authentic, open-road energy. Must loop seamlessly. Consistent adventurous energy. Instrumental only.',
    introPrompt: 'Indie folk intro, 110 BPM. Banjo picking pattern starting with stomp box joining. Adventurous, authentic opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Indie folk outro, 110 BPM. Banjo and harmonica resolving to a final bright chord with tambourine. Uplifting adventure ending. Instrumental only.',
  },

  // ── GOSPEL / UPLIFTING ──────────────────────────────────────────────
  {
    id: 'gospel_uplifting_01',
    name: 'Gospel Uplifting',
    genre: 'Gospel',
    mood: 'Joyful',
    energy: 'medium',
    bpm: 100,
    instruments: ['gospel organ', 'piano', 'claps', 'choir pad', 'bass', 'drums'],
    bestFor: ['community events', 'charity', 'education', 'faith-based brands'],
    tags: ['gospel', 'uplifting', 'joyful', 'community', 'spiritual', 'praise', 'choir'],
    mainPrompt: 'Gospel uplifting instrumental, 100 BPM, B-flat major. Rich Hammond organ with gospel piano licks, handclaps on 2 and 4, warm choir pad, solid bass, and gospel drums. Joyful, uplifting, community spirit — church celebration feel without being preachy. Must loop seamlessly. Consistent joyful energy. Instrumental only, no vocals.',
    introPrompt: 'Gospel uplifting intro, 100 BPM. Organ chord blooming with piano lick and claps starting. Joyful, uplifting opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Gospel uplifting outro, 100 BPM. Organ and piano building to a joyful final chord with claps. Uplifting, celebratory ending. Instrumental only.',
  },

  // ── AFROBEAT ────────────────────────────────────────────────────────
  {
    id: 'afrobeat_groovy_01',
    name: 'Afrobeat Groovy',
    genre: 'Afrobeat',
    mood: 'Groovy',
    energy: 'medium',
    bpm: 108,
    instruments: ['afrobeat guitar', 'talking drum', 'shaker', 'brass', 'bass', 'keys'],
    bestFor: ['global brands', 'fashion', 'dance events', 'cultural festivals'],
    tags: ['afrobeat', 'african', 'groovy', 'global', 'dance', 'rhythm', 'worldbeat'],
    mainPrompt: 'Afrobeat groovy instrumental, 108 BPM, F major. Clean Afrobeat guitar pattern with talking drum, shaker groove, brass section riffs, deep bass, and electric piano comping. Fela Kuti meets modern Afrobeats — infectious rhythm, global groove, impossible not to move. Must loop seamlessly. Consistent groove. Instrumental only.',
    introPrompt: 'Afrobeat intro, 108 BPM. Shaker and guitar starting the pattern with bass joining. Groovy, rhythmic opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Afrobeat outro, 108 BPM. Brass and guitar hitting a final rhythmic phrase with drum fill. Groovy, energetic ending. Instrumental only.',
  },

  // ── POP / DANCE MODERN ──────────────────────────────────────────────
  {
    id: 'pop_dance_modern_01',
    name: 'Pop Dance Modern',
    genre: 'Pop Dance',
    mood: 'Euphoric',
    energy: 'high',
    bpm: 124,
    instruments: ['synth pop lead', 'four-on-the-floor kick', 'claps', 'bass drop', 'arps'],
    bestFor: ['fast fashion', 'mobile brands', 'social media platforms', 'youth brands'],
    tags: ['pop', 'dance', 'modern', 'radio', 'euphoric', 'club', 'mainstream'],
    mainPrompt: 'Modern pop dance music, 124 BPM, A minor. Catchy synth pop lead melody with four-on-the-floor kick, sharp claps, thick bass, and bright arpeggios. Radio hit energy — euphoric, polished, mainstream appeal. Think Dua Lipa/The Weeknd commercial production. Must loop seamlessly. Consistent high energy. Instrumental only.',
    introPrompt: 'Pop dance intro, 124 BPM. Filtered synth rising with kick starting and lead melody dropping in. Exciting, modern opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Pop dance outro, 124 BPM. Synth and kick hitting a final drop with reverb tail. Big, modern ending. Instrumental only.',
  },

  // ── AMBIENT TECH ────────────────────────────────────────────────────
  {
    id: 'ambient_tech_minimal_01',
    name: 'Ambient Tech Minimal',
    genre: 'Ambient Tech',
    mood: 'Clean',
    energy: 'low',
    bpm: 90,
    instruments: ['granular synth', 'soft pulse', 'glass textures', 'sub bass', 'clicks'],
    bestFor: ['tech products', 'AI companies', 'SaaS', 'design tools', 'Apple-style ads'],
    tags: ['ambient', 'tech', 'minimal', 'clean', 'modern', 'apple', 'futuristic'],
    mainPrompt: 'Ambient tech minimal music, 90 BPM. Granular synth textures with soft rhythmic pulse, glass-like bell tones, deep sub bass, and subtle digital clicks. Ultra-clean, Apple/Google product reveal aesthetic — futuristic, minimal, precision-engineered sound design. Must loop seamlessly. Very consistent minimal energy. Instrumental only.',
    introPrompt: 'Ambient tech intro, 90 BPM. A soft pulse emerging with granular texture and a glass bell tone. Clean, futuristic opening. 5 seconds. Instrumental only.',
    outroPrompt: 'Ambient tech outro, 90 BPM. Textures resolving to a final clean bell tone with sub bass fade. Pristine, minimal ending. Instrumental only.',
  },

  // ── ELECTRONIC CHILL ────────────────────────────────────────────────
  {
    id: 'electronic_downtempo_01',
    name: 'Electronic Downtempo',
    genre: 'Downtempo',
    mood: 'Atmospheric',
    energy: 'low',
    bpm: 88,
    instruments: ['deep bass', 'soft pads', 'crisp hi-hats', 'Rhodes piano', 'atmosphere'],
    bestFor: ['premium lifestyle', 'luxury tech', 'fashion editorial', 'nighttime brands'],
    tags: ['electronic', 'downtempo', 'chill', 'atmospheric', 'premium', 'night', 'lounge'],
    mainPrompt: 'Electronic downtempo music, 88 BPM, D minor. Deep sub bass with lush atmospheric pads, crisp minimal hi-hats, warm Rhodes piano chords, and spacious reverb textures. Bonobo/Tycho inspired — premium, atmospheric, late-night sophistication. Must loop seamlessly. Consistent atmospheric mood. Instrumental only.',
    introPrompt: 'Downtempo intro, 88 BPM. Atmospheric pad fading in with Rhodes chord and soft hi-hat. Premium, atmospheric opening. 5 seconds. Instrumental only.',
    outroPrompt: 'Downtempo outro, 88 BPM. Rhodes and pad resolving with bass fading. Atmospheric, sophisticated ending. Instrumental only.',
  },

  // ── ORCHESTRAL ACTION ───────────────────────────────────────────────
  {
    id: 'orchestral_action_01',
    name: 'Orchestral Action Sports',
    genre: 'Orchestral Action',
    mood: 'Intense',
    energy: 'high',
    bpm: 140,
    instruments: ['aggressive strings', 'brass fanfare', 'war drums', 'timpani', 'cymbals'],
    bestFor: ['sports brands', 'automotive ads', 'energy drinks', 'extreme sports'],
    tags: ['orchestral', 'action', 'sports', 'intense', 'epic', 'powerful', 'adrenaline'],
    mainPrompt: 'Orchestral action sports music, 140 BPM, G minor. Aggressive staccato strings with powerful brass fanfares, driving war drums, timpani hits, and crash cymbals. Adrenaline-pumping, high-octane, sports highlight reel energy. Hans Zimmer meets ESPN. Must loop seamlessly. Relentless intense energy. Instrumental only.',
    introPrompt: 'Orchestral action intro, 140 BPM. Timpani roll building with strings rising into a brass fanfare. Powerful, adrenaline opening. 4 seconds. Instrumental only.',
    outroPrompt: 'Orchestral action outro, 140 BPM. Full orchestra hitting a massive final chord with timpani and cymbal crash. Earth-shaking ending. Instrumental only.',
  },

  // ── ACOUSTIC SINGER-SONGWRITER ──────────────────────────────────────
  {
    id: 'acoustic_heartfelt_01',
    name: 'Acoustic Heartfelt',
    genre: 'Acoustic',
    mood: 'Honest',
    energy: 'low',
    bpm: 90,
    instruments: ['acoustic guitar', 'soft piano', 'light percussion', 'cello', 'pad'],
    bestFor: ['insurance ads', 'personal care', 'family brands', 'authentic storytelling'],
    tags: ['acoustic', 'heartfelt', 'honest', 'warm', 'authentic', 'storytelling', 'gentle'],
    mainPrompt: 'Heartfelt acoustic music, 90 BPM, C major. Warm fingerpicked acoustic guitar with soft piano support, gentle brush percussion, emotional cello melody, and subtle warm pad. Honest, authentic, emotionally resonant. The sound of real stories and genuine connection. Must loop seamlessly. Consistent gentle warmth. Instrumental only.',
    introPrompt: 'Acoustic heartfelt intro, 90 BPM. Solo acoustic guitar with cello note entering gently. Warm, honest opening. 5 seconds. Instrumental only.',
    outroPrompt: 'Acoustic heartfelt outro, 90 BPM. Guitar and cello resolving to a warm, peaceful final chord. Gentle, honest ending. Instrumental only.',
  },

  // ── WORLD PERCUSSION ────────────────────────────────────────────────
  {
    id: 'world_percussion_01',
    name: 'World Percussion Tribal',
    genre: 'World',
    mood: 'Primal',
    energy: 'medium',
    bpm: 110,
    instruments: ['djembe', 'cajon', 'shaker', 'taiko', 'frame drum', 'claves'],
    bestFor: ['adventure brands', 'global campaigns', 'nature brands', 'documentary'],
    tags: ['world', 'percussion', 'tribal', 'global', 'primal', 'rhythm', 'adventure'],
    mainPrompt: 'World percussion tribal music, 110 BPM. Interlocking rhythms with djembe leading, cajon providing the pulse, shaker groove, taiko accents, frame drum texture, and claves keeping time. Global, primal, rhythmic — the universal language of drums. Must loop seamlessly. Consistent rhythmic energy. Instrumental only, percussion only.',
    introPrompt: 'World percussion intro, 110 BPM. Djembe starting alone with shaker joining then full percussion ensemble entering. Primal, rhythmic opening. 4 seconds. Instrumental only.',
    outroPrompt: 'World percussion outro, 110 BPM. All drums building to a massive unified hit. Powerful, tribal ending. Instrumental only.',
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
