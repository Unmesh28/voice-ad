// ===========================================================================
// Cultural Music Templates
//
// Genre-specific musical patterns, instrumentation, rhythm templates, and
// scale/mode information. Used to enrich Suno prompts with deeper cultural
// authenticity instead of generic "Punjabi music" or "Latin music" hints.
//
// Each template captures what a human musician would know instinctively:
//   - Signature instruments and their roles
//   - Rhythmic patterns (taal, clave, groove type)
//   - Scale/mode preferences
//   - Tempo ranges
//   - Production style notes
// ===========================================================================

import { logger } from '../../config/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CulturalTemplate {
  /** Genre identifier (lowercase, matches LLM genre output) */
  id: string;
  /** Display name */
  name: string;
  /** Primary instruments with roles */
  instruments: { name: string; role: string }[];
  /** Characteristic rhythmic pattern description */
  rhythmPattern: string;
  /** Preferred scales/modes */
  scales: string[];
  /** Typical tempo range (BPM) */
  tempoRange: { min: number; max: number };
  /** Default time signature */
  timeSignature: '4/4' | '3/4' | '6/8' | '7/8' | '12/8';
  /** Production style notes for the prompt */
  productionNotes: string;
  /** Keywords that trigger this template */
  keywords: string[];
  /** Prompt fragment: concise musical direction (~100 chars) */
  promptFragment: string;
}

// ---------------------------------------------------------------------------
// Template Database
// ---------------------------------------------------------------------------

const CULTURAL_TEMPLATES: CulturalTemplate[] = [
  // ── South Asian ──────────────────────────────────────────────────────
  {
    id: 'punjabi',
    name: 'Punjabi / Bhangra',
    instruments: [
      { name: 'dhol', role: 'primary rhythm, driving beat' },
      { name: 'tumbi', role: 'melodic hook, single-string plucking' },
      { name: 'algoza', role: 'double flute, ornamental melody' },
      { name: 'chimta', role: 'metallic percussion, tings on off-beats' },
    ],
    rhythmPattern: 'Chaal rhythm (DHA GE NA GE pattern), syncopated tumbi riffs, strong downbeats with chimta accents',
    scales: ['D major pentatonic', 'Mixolydian mode (flat 7th)'],
    tempoRange: { min: 85, max: 170 },
    timeSignature: '4/4',
    productionNotes: 'Heavy bass dhol hits on beats 1 and 3, open tones on 2 and 4. Tumbi riffs in call-and-response patterns. Modern productions add 808 sub-bass under dhol.',
    keywords: ['punjabi', 'bhangra', 'dhol', 'tumbi', 'desi'],
    promptFragment: 'Punjabi bhangra with driving dhol chaal rhythm, tumbi melodic hooks, chimta accents. Mixolydian mode, heavy bass hits.',
  },
  {
    id: 'bollywood',
    name: 'Bollywood / Hindi Film',
    instruments: [
      { name: 'tabla', role: 'rhythmic foundation, intricate patterns' },
      { name: 'sitar', role: 'melodic phrases, ornamental runs' },
      { name: 'harmonium', role: 'chordal drone, sustained pads' },
      { name: 'bansuri', role: 'bamboo flute, lyrical melody' },
      { name: 'strings section', role: 'emotional swells, cinematic texture' },
    ],
    rhythmPattern: 'Tintal (16 beats) or Keherwa (8 beats) taal cycle, tabla-driven with melodic phrases following song structure',
    scales: ['Raag Yaman (Lydian)', 'Raag Bhairav', 'Raag Khamaj'],
    tempoRange: { min: 70, max: 140 },
    timeSignature: '4/4',
    productionNotes: 'Blend of acoustic Indian instruments with orchestral strings. Tabla provides groove, sitar/bansuri carry melody. Modern Bollywood adds electronic beats and synth pads.',
    keywords: ['bollywood', 'hindi', 'indian', 'desi', 'filmi'],
    promptFragment: 'Bollywood cinematic with tabla groove, sitar ornaments, string swells, bansuri melody. Rich harmonic blend of Indian and orchestral.',
  },

  // ── Latin ────────────────────────────────────────────────────────────
  {
    id: 'reggaeton',
    name: 'Reggaeton',
    instruments: [
      { name: 'dembow beat', role: 'signature reggaeton rhythm pattern' },
      { name: '808 bass', role: 'deep sub-bass, rhythmic foundation' },
      { name: 'synth leads', role: 'melodic hooks, catchy riffs' },
      { name: 'hi-hats', role: 'rapid triplet rolls, rhythmic drive' },
    ],
    rhythmPattern: 'Dembow riddim (boom-ch-boom-chick), steady 4-on-the-floor with syncopated kick, rolling hi-hats',
    scales: ['A minor', 'D minor pentatonic'],
    tempoRange: { min: 85, max: 100 },
    timeSignature: '4/4',
    productionNotes: 'The dembow pattern is essential — never omit it. Heavy 808 bass with sidechain ducking. Sparse melodic elements that leave space. Perreo groove feel.',
    keywords: ['reggaeton', 'dembow', 'latin urban', 'perreo'],
    promptFragment: 'Reggaeton with dembow riddim pattern, deep 808 bass, rolling hi-hats, sparse synth hooks. Perreo groove.',
  },
  {
    id: 'salsa',
    name: 'Salsa / Latin Jazz',
    instruments: [
      { name: 'congas', role: 'rhythmic foundation, tumbao pattern' },
      { name: 'timbales', role: 'accents, cascara pattern, cowbell' },
      { name: 'piano', role: 'montuno pattern, rhythmic chords' },
      { name: 'brass section', role: 'punchy horn lines, mambo riffs' },
      { name: 'bass', role: 'tumbao bassline, anticipated bass' },
    ],
    rhythmPattern: 'Son clave (3-2 or 2-3), piano montuno, congas tumbao, cascara on timbales. All instruments locked to clave.',
    scales: ['C major', 'A minor', 'Dorian mode'],
    tempoRange: { min: 140, max: 220 },
    timeSignature: '4/4',
    productionNotes: 'Everything revolves around the clave pattern. Piano montuno provides harmonic rhythm. Bass plays anticipated notes. Horn section plays mambo section riffs.',
    keywords: ['salsa', 'latin jazz', 'mambo', 'son', 'cubano'],
    promptFragment: 'Salsa with son clave groove, piano montuno, congas tumbao, brass mambo riffs. Clave-locked rhythm, bright and danceable.',
  },
  {
    id: 'bossa_nova',
    name: 'Bossa Nova / Brazilian',
    instruments: [
      { name: 'nylon guitar', role: 'syncopated chord patterns, fingerpicking' },
      { name: 'shaker/pandeiro', role: 'subtle percussion, steady rhythm' },
      { name: 'bass', role: 'walking bassline, melodic movement' },
      { name: 'piano', role: 'sparse jazz chords, comping' },
    ],
    rhythmPattern: 'Bossa nova guitar pattern (syncopated bass-chord-chord), subtle shaker groove, relaxed swing feel',
    scales: ['Dorian mode', 'Lydian mode', 'Major 7th harmonies'],
    tempoRange: { min: 110, max: 140 },
    timeSignature: '4/4',
    productionNotes: 'Intimate feel. Guitar pattern is the signature — syncopated thumb bass with chordal strumming. Minimal percussion (no heavy drums). Jazz harmonies with 7th/9th chords.',
    keywords: ['bossa nova', 'brazilian', 'samba', 'mpb'],
    promptFragment: 'Bossa nova with fingerpicked nylon guitar syncopation, pandeiro groove, walking bass, jazz harmonies. Intimate and sophisticated.',
  },

  // ── East Asian ───────────────────────────────────────────────────────
  {
    id: 'japanese',
    name: 'Japanese Traditional / J-Ambient',
    instruments: [
      { name: 'koto', role: 'plucked melody, pentatonic phrases' },
      { name: 'shakuhachi', role: 'bamboo flute, breathy melody' },
      { name: 'taiko', role: 'dramatic percussion accents' },
      { name: 'shamisen', role: 'rhythmic plucking, melodic drive' },
    ],
    rhythmPattern: 'Ma (space/silence) as compositional element, asymmetric phrasing, taiko accents on emotional peaks',
    scales: ['In scale (Japanese minor pentatonic)', 'Yo scale (major pentatonic)'],
    tempoRange: { min: 60, max: 120 },
    timeSignature: '4/4',
    productionNotes: 'Embrace silence (ma) as a compositional tool. Koto and shakuhachi play in spacious call-and-response. Taiko for dramatic moments only, not constant. Modern fusions add ambient synth pads.',
    keywords: ['japanese', 'koto', 'shakuhachi', 'taiko', 'zen', 'j-pop'],
    promptFragment: 'Japanese aesthetic with koto pentatonic phrases, shakuhachi breathy melody, sparse taiko accents. Embrace silence (ma) between phrases.',
  },
  {
    id: 'chinese',
    name: 'Chinese Traditional / C-Pop',
    instruments: [
      { name: 'erhu', role: 'expressive bowed melody, emotional lead' },
      { name: 'pipa', role: 'plucked lute, rapid tremolos' },
      { name: 'guzheng', role: 'zither, sweeping arpeggios' },
      { name: 'dizi', role: 'bamboo flute, bright melody' },
    ],
    rhythmPattern: 'Flowing rubato phrases with clear downbeats, steady pulse in ensemble sections, accelerando for climax',
    scales: ['Chinese pentatonic (gong mode)', 'Shang mode', 'Jue mode'],
    tempoRange: { min: 60, max: 130 },
    timeSignature: '4/4',
    productionNotes: 'Erhu carries the emotional melody. Guzheng provides harmonic backdrop with sweeping glissandi. Pipa adds rhythmic energy in faster sections. Modern C-pop fuses these with electronic production.',
    keywords: ['chinese', 'mandarin', 'erhu', 'guzheng', 'c-pop'],
    promptFragment: 'Chinese aesthetic with erhu expressive melody, guzheng arpeggios, pipa accents, dizi brightness. Pentatonic harmony, flowing phrasing.',
  },

  // ── Middle Eastern / North African ───────────────────────────────────
  {
    id: 'arabic',
    name: 'Arabic / Middle Eastern',
    instruments: [
      { name: 'oud', role: 'melodic lead, ornamental runs (maqam)' },
      { name: 'darbuka', role: 'goblet drum, intricate rhythmic patterns' },
      { name: 'ney', role: 'end-blown flute, soulful melody' },
      { name: 'qanun', role: 'plucked zither, rapid trills' },
      { name: 'riq', role: 'tambourine, crisp accents' },
    ],
    rhythmPattern: 'Maqsoum rhythm (DUM tek tek DUM tek), or Saidi (DUM DUM tek DUM tek), intricate darbuka fills',
    scales: ['Maqam Hijaz', 'Maqam Bayati', 'Maqam Nahawand'],
    tempoRange: { min: 80, max: 140 },
    timeSignature: '4/4',
    productionNotes: 'Maqam (modal) system with quarter-tone inflections. Oud plays taqasim (improvisatory phrases). Darbuka provides the rhythmic foundation. Ornamental trills and slides are essential.',
    keywords: ['arabic', 'middle eastern', 'oud', 'maqam', 'khaleeji', 'egyptian'],
    promptFragment: 'Arabic maqam with oud ornamental melody, darbuka maqsoum rhythm, ney soulful phrases, qanun trills. Quarter-tone inflections.',
  },

  // ── African ──────────────────────────────────────────────────────────
  {
    id: 'afrobeat',
    name: 'Afrobeat / Afrobeats',
    instruments: [
      { name: 'talking drum', role: 'pitched percussion, call-and-response' },
      { name: 'shekere', role: 'gourd shaker, steady groove' },
      { name: 'horn section', role: 'punchy riffs, Fela-style' },
      { name: 'guitar', role: 'highlife picking patterns, rhythmic chords' },
      { name: 'bass', role: 'deep groove, syncopated patterns' },
    ],
    rhythmPattern: 'Polyrhythmic layering: multiple percussion patterns interlocking, 12/8 feel over 4/4, emphasis on groove and cycle',
    scales: ['Major pentatonic', 'Mixolydian mode'],
    tempoRange: { min: 95, max: 135 },
    timeSignature: '4/4',
    productionNotes: 'Polyrhythmic — multiple percussion layers create a composite groove. Guitar plays highlife-style picking patterns. Horn section plays short, punchy riffs. Modern Afrobeats adds electronic production.',
    keywords: ['afrobeat', 'afrobeats', 'african', 'highlife', 'amapiano', 'fela'],
    promptFragment: 'Afrobeat with polyrhythmic percussion layers, highlife guitar picking, horn riffs, deep bass groove. Interlocking rhythmic patterns.',
  },

  // ── Celtic / Irish ───────────────────────────────────────────────────
  {
    id: 'celtic',
    name: 'Celtic / Irish',
    instruments: [
      { name: 'fiddle', role: 'lead melody, reels and jigs' },
      { name: 'tin whistle', role: 'bright melody, ornamentation' },
      { name: 'bodhrán', role: 'frame drum, rhythmic backbone' },
      { name: 'uilleann pipes', role: 'drones and melody, emotional' },
      { name: 'acoustic guitar', role: 'rhythmic strumming, DADGAD tuning' },
    ],
    rhythmPattern: 'Jig (6/8) or reel (4/4) patterns, bodhrán drives the pulse, strong downbeats with ornamental rolls and cuts',
    scales: ['Dorian mode', 'Mixolydian mode', 'Ionian (major)'],
    tempoRange: { min: 100, max: 160 },
    timeSignature: '6/8',
    productionNotes: 'Reels in 4/4, jigs in 6/8. Fiddle and whistle play in unison or harmony on melodic lines. Bodhrán provides steady pulse with dynamic fills. DADGAD guitar tuning for open voicings.',
    keywords: ['celtic', 'irish', 'scottish', 'folk', 'fiddle', 'gaelic'],
    promptFragment: 'Celtic with fiddle reels, tin whistle melody, bodhrán pulse, DADGAD guitar. Dorian mode, ornamental rolls and cuts.',
  },

  // ── Electronic / Modern ──────────────────────────────────────────────
  {
    id: 'lo_fi',
    name: 'Lo-Fi / Chill Hop',
    instruments: [
      { name: 'vinyl crackle', role: 'texture, nostalgic warmth' },
      { name: 'Rhodes/Wurlitzer', role: 'jazzy chord voicings, warm' },
      { name: 'muted drums', role: 'laid-back boom-bap pattern' },
      { name: 'bass', role: 'mellow, round tone, simple patterns' },
      { name: 'tape hiss', role: 'lo-fi texture, analog warmth' },
    ],
    rhythmPattern: 'Laid-back boom-bap with slightly behind-the-beat feel, quantize swing ~60%, muted kicks and snares',
    scales: ['Major 7th chords', 'Minor 9th chords', 'Jazz voicings'],
    tempoRange: { min: 70, max: 90 },
    timeSignature: '4/4',
    productionNotes: 'Lo-fi aesthetic: vinyl crackle, tape saturation, bit-crushed textures. Rhodes chords with chorus/tremolo. Drums deliberately imperfect and softened. Jazz chord voicings (7ths, 9ths, 13ths).',
    keywords: ['lo-fi', 'lofi', 'chill hop', 'study beats', 'chill'],
    promptFragment: 'Lo-fi chill hop with vinyl crackle, Rhodes jazz chords, laid-back boom-bap drums, tape warmth. Deliberately imperfect, behind-the-beat feel.',
  },
  {
    id: 'k_pop',
    name: 'K-Pop / Korean Pop',
    instruments: [
      { name: 'synth bass', role: 'punchy, sidechain-compressed bass' },
      { name: 'layered synths', role: 'bright pads, arpeggiated leads' },
      { name: 'electronic drums', role: 'crisp, processed, dynamic' },
      { name: 'strings stabs', role: 'orchestral accents, dramatic' },
    ],
    rhythmPattern: 'Four-on-the-floor with complex hi-hat patterns, frequent build-drop structures, genre-switching within track',
    scales: ['E minor', 'B minor', 'Major/minor key changes within track'],
    tempoRange: { min: 100, max: 140 },
    timeSignature: '4/4',
    productionNotes: 'Highly polished production. Genre-blending within a single track (verse=R&B, chorus=EDM, bridge=hip-hop). Strong builds into explosive choruses. Vocal chops and processing.',
    keywords: ['k-pop', 'korean', 'kpop'],
    promptFragment: 'K-pop production with punchy synth bass, bright layered synths, crisp electronic drums, orchestral stabs. Polished, dynamic, genre-blending.',
  },
];

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Match a genre/cultural context string to the best cultural template.
 * Returns null if no match found.
 */
export function matchCulturalTemplate(genre: string, culturalContext?: string | null): CulturalTemplate | null {
  const searchText = `${genre} ${culturalContext || ''}`.toLowerCase();

  // Score each template based on keyword matches
  let bestMatch: CulturalTemplate | null = null;
  let bestScore = 0;

  for (const template of CULTURAL_TEMPLATES) {
    let score = 0;
    for (const keyword of template.keywords) {
      if (searchText.includes(keyword.toLowerCase())) {
        score += keyword.length; // Longer keyword matches are more specific
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = template;
    }
  }

  if (bestMatch) {
    logger.debug(`Cultural template matched: ${bestMatch.name} (score: ${bestScore})`);
  }

  return bestMatch;
}

/**
 * Enrich a Suno prompt with cultural musical context.
 * Appends specific instrumentation, rhythm, and scale guidance
 * so the generated music sounds authentically cultural rather than generic.
 */
export function enrichPromptWithCulturalContext(
  prompt: string,
  genre: string,
  culturalContext?: string | null
): string {
  const template = matchCulturalTemplate(genre, culturalContext);
  if (!template) return prompt;

  // Build cultural enrichment text
  const parts: string[] = [];

  // Add the concise prompt fragment
  parts.push(template.promptFragment);

  // Add rhythm pattern
  parts.push(`Rhythm: ${template.rhythmPattern}.`);

  // Add scale hints (first one is most characteristic)
  if (template.scales.length > 0) {
    parts.push(`Scale: ${template.scales[0]}.`);
  }

  const enrichment = parts.join(' ');

  // Append to prompt, respecting length limits
  const combined = `${prompt} Cultural style: ${enrichment}`;
  return combined;
}

/**
 * Get the preferred time signature for a genre.
 * Falls back to 4/4 if no specific template is found.
 */
export function getTimeSignatureForGenre(genre: string, culturalContext?: string | null): '4/4' | '3/4' | '6/8' | '7/8' | '12/8' {
  const template = matchCulturalTemplate(genre, culturalContext);
  return template?.timeSignature ?? '4/4';
}

/**
 * Get the preferred tempo range for a genre.
 * Returns null if no specific template is found.
 */
export function getTempoRangeForGenre(genre: string, culturalContext?: string | null): { min: number; max: number } | null {
  const template = matchCulturalTemplate(genre, culturalContext);
  return template?.tempoRange ?? null;
}

/**
 * Get all available template IDs.
 */
export function getCulturalTemplateIds(): string[] {
  return CULTURAL_TEMPLATES.map((t) => t.id);
}

export default {
  matchCulturalTemplate,
  enrichPromptWithCulturalContext,
  getTimeSignatureForGenre,
  getTempoRangeForGenre,
  getCulturalTemplateIds,
};
