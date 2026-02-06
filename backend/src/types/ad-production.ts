import { z } from 'zod';

// ---------------------------------------------------------------------------
// Ad Categories (for context.adCategory)
// ---------------------------------------------------------------------------
export const AD_CATEGORIES = [
  'retail',
  'automotive',
  'tech',
  'finance',
  'food',
  'healthcare',
  'entertainment',
  'real_estate',
  'other',
] as const;
export type AdCategory = (typeof AD_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Pace (for context.pace)
// ---------------------------------------------------------------------------
export const PACE_VALUES = ['slow', 'moderate', 'fast'] as const;
export type Pace = (typeof PACE_VALUES)[number];

// ---------------------------------------------------------------------------
// Fade curve (for fades.curve)
// ---------------------------------------------------------------------------
export const FADE_CURVES = ['linear', 'exp', 'qsin'] as const;
export type FadeCurve = (typeof FADE_CURVES)[number];

// ---------------------------------------------------------------------------
// Volume segment type
// ---------------------------------------------------------------------------
export const VOLUME_SEGMENT_TYPES = [
  'voice_up',
  'music_up',
  'voice_down',
  'music_down',
] as const;
export type VolumeSegmentType = (typeof VOLUME_SEGMENT_TYPES)[number];

export const SEGMENT_INTENSITIES = ['subtle', 'moderate', 'strong'] as const;
export type SegmentIntensity = (typeof SEGMENT_INTENSITIES)[number];

// ---------------------------------------------------------------------------
// Mix preset
// ---------------------------------------------------------------------------
export const MIX_PRESETS = [
  'voiceProminent',
  'balanced',
  'musicEmotional',
] as const;
export type MixPreset = (typeof MIX_PRESETS)[number];

// ---------------------------------------------------------------------------
// Voice hints (optional, for context.voiceHints)
// ---------------------------------------------------------------------------
export const GENDER_VALUES = ['male', 'female', 'neutral'] as const;
export type Gender = (typeof GENDER_VALUES)[number];

// ---------------------------------------------------------------------------
// Zod schemas (for parsing and validation)
// ---------------------------------------------------------------------------
const VoiceHintsSchema = z
  .object({
    gender: z
      .preprocess(
        (val) => {
          if (val == null || val === '') return null;
          const s = String(val).toLowerCase().trim();
          return GENDER_VALUES.includes(s as any) ? s : null;
        },
        z.enum(GENDER_VALUES).nullish()
      ),
    ageRange: z.string().nullish(),
    accent: z.string().nullish(),
  })
  .nullish();

const ContextSchema = z.object({
  adCategory: z.enum(AD_CATEGORIES),
  tone: z.string(),
  emotion: z.string(),
  pace: z.enum(PACE_VALUES),
  durationSeconds: z.number(),
  targetWordsPerMinute: z.number().nullish(),
  voiceHints: VoiceHintsSchema,
});

/** One segment of the music "score" – tempo/feel for a section of the script (e.g. product intro). */
const MusicArcSegmentSchema = z.object({
  startSeconds: z.number(),
  endSeconds: z.number(),
  label: z.string(), // e.g. "intro", "product_intro", "cta"
  musicPrompt: z.string(),
  targetBPM: z.number().nullish(),
  /** Energy level 1-10 (1=minimal/ambient, 5=established, 7=peak, 10=maximum). Guides arrangement density. */
  energyLevel: z.number().min(1).max(10).nullish(),
});

/** Instrumentation elements for professional music direction. */
const InstrumentationSchema = z.object({
  drums: z.string(), // e.g. "Tight electronic kick and hi-hat, minimal pattern" or "No drums"
  bass: z.string(), // e.g. "Deep sub bass, sustained notes" or "Minimal synth bass"
  mids: z.string(), // e.g. "Clean piano + soft pads, leaves 1-4kHz clear for voice"
  effects: z.string(), // e.g. "Subtle room reverb, no delay" or "None"
});

/** Button ending specification (professional ad standard: no fade-outs). */
const ButtonEndingSchema = z.object({
  type: z.string(), // e.g. "sustained chord with clean cutoff", "punchy stinger"
  timing: z.string().nullish(), // e.g. "lands 0.5s after final word"
  description: z.string().nullish(), // e.g. "Warm major chord, slight sustain, clean release"
});

/** Structured musical structure for the blueprint (Tier 4). */
const MusicalStructureSchema = z.object({
  /** How the music opens (determines intro arrangement density). */
  introType: z.enum(['ambient_build', 'rhythmic_hook', 'melodic_theme', 'silence_to_entry']),
  /** Number of bars for the intro before voice enters (1-4). */
  introBars: z.number().min(1).max(4),
  /** One-word feel for the main body section. */
  bodyFeel: z.string(),
  /** Where the musical peak should land (e.g. "bar 12", "at brand reveal"). */
  peakMoment: z.string(),
  /** How the music ends. */
  endingType: z.enum(['button', 'sustain', 'stinger', 'decay']),
  /** Number of bars for the outro after last word (1-4). */
  outroBars: z.number().min(1).max(4),
  /** Optional: key signature (e.g. "C major", "A minor"). Helps Suno stay harmonically consistent. */
  keySignature: z.string().nullish(),
  /** Bars per phrase (usually 4 or 8). Sections should snap to this boundary. */
  phraseLength: z.number().min(2).max(8).nullish(),
});

const MusicSchema = z.object({
  prompt: z.string(),
  targetBPM: z.number(),
  genre: z.string().nullish(),
  mood: z.string().nullish(),
  /** Optional: segment-based "score" so music tempo matches each part (intro, product intro, CTA). 2-4 segments. */
  arc: z.array(MusicArcSegmentSchema).max(4).nullish(),
  /** Optional: short paragraph from composer to the text-to-music engine (overall intent, section feel, timing/energy). Max 300 chars. */
  composerDirection: z.string().nullish(),
  /** Optional: explicit instrumentation control (drums, bass, mids, effects). */
  instrumentation: InstrumentationSchema.nullish(),
  /** Optional: button ending specification (no fade-out). */
  buttonEnding: ButtonEndingSchema.nullish(),
  /** Optional: structured musical form for the blueprint (intro type, peak placement, ending type). */
  musicalStructure: MusicalStructureSchema.nullish(),
});

const FadesSchema = z.object({
  fadeInSeconds: z.number(),
  fadeOutSeconds: z.number(),
  curve: z.enum(FADE_CURVES).nullish(),
});

const VolumeSegmentSchema = z.object({
  startSeconds: z.number(),
  endSeconds: z.number(),
  type: z.enum(VOLUME_SEGMENT_TYPES),
  intensity: z.enum(SEGMENT_INTENSITIES).nullish(),
});

const VolumeSchema = z.object({
  voiceVolume: z.number(),
  musicVolume: z.number(),
  segments: z.array(VolumeSegmentSchema).nullish(),
});

/** Per-sentence music/volume cue for sentence-by-sentence composition (index = sentence order). */
const SentenceCueSchema = z.object({
  index: z.number(), // 0 = first sentence
  musicCue: z.string().nullish(), // e.g. "upbeat", "dramatic pause", "swell"
  musicVolumeMultiplier: z.number().nullish(), // 0.7–1.3; e.g. 0.8 = quieter under this sentence
  /** Optional: short composer note for that phrase (e.g. "swell", "staccato", "hold", "hit on downbeat", "quiet under"). */
  musicDirection: z.string().nullish(),
  /** Optional: musical function of this sentence in the overall composition (hook, build, peak, resolve, transition, pause). */
  musicalFunction: z.enum(['hook', 'build', 'peak', 'resolve', 'transition', 'pause']).nullish(),
});

/** Sound design cue for key moments (whoosh, hits, product sounds, transitions). */
const SoundDesignCueSchema = z.object({
  timestamp: z.number(), // seconds
  sound: z.string(), // e.g. "subtle whoosh", "impact hit", "product sound"
  purpose: z.string(), // e.g. "Brand reveal", "Transition to CTA", "Emotional accent"
});

export const AdProductionLLMResponseSchema = z.object({
  version: z.string().nullish(),
  script: z.string(),
  context: ContextSchema,
  music: MusicSchema,
  fades: FadesSchema,
  volume: VolumeSchema,
  mixPreset: z.enum(MIX_PRESETS).nullish(),
  /** Optional: one cue per sentence (by order) so mix supports each sentence. */
  sentenceCues: z.array(SentenceCueSchema).nullish(),
  /** Optional: sound design cues (max 5) for key moments (brand reveal, transitions, accents). */
  soundDesign: z.array(SoundDesignCueSchema).max(5).nullish(),
});

// ---------------------------------------------------------------------------
// TypeScript interfaces (inferred from Zod where possible)
// ---------------------------------------------------------------------------
export type AdProductionContext = z.infer<typeof ContextSchema>;
export type AdProductionMusicArcSegment = z.infer<typeof MusicArcSegmentSchema>;
export type AdProductionMusic = z.infer<typeof MusicSchema>;
export type AdProductionFades = z.infer<typeof FadesSchema>;
export type AdProductionVolumeSegment = z.infer<typeof VolumeSegmentSchema>;
export type AdProductionVolume = z.infer<typeof VolumeSchema>;
export type AdProductionSentenceCue = z.infer<typeof SentenceCueSchema>;
export type AdProductionSoundDesignCue = z.infer<typeof SoundDesignCueSchema>;

export interface AdProductionLLMResponse {
  version?: string;
  script: string;
  context: AdProductionContext;
  music: AdProductionMusic;
  fades: AdProductionFades;
  volume: AdProductionVolume;
  mixPreset?: MixPreset;
  sentenceCues?: AdProductionSentenceCue[];
  soundDesign?: AdProductionSoundDesignCue[];
}

// ---------------------------------------------------------------------------
// Input for generateAdProductionJSON
// ---------------------------------------------------------------------------
export interface AdProductionInput {
  prompt: string;
  durationSeconds?: number;
  tone?: string;
}

// ---------------------------------------------------------------------------
// Example JSON (for LLM few-shot and validation)
// ---------------------------------------------------------------------------

/** Canonical example response matching AdProductionLLMResponse. Use for few-shot in prompts and validation tests. */
export const AD_PRODUCTION_EXAMPLE_JSON: AdProductionLLMResponse = {
  version: '1.0',
  script:
    '[excited] Welcome to TechFlow! [warmly] We make your work easier… [pause] Try free today.',
  context: {
    adCategory: 'tech',
    tone: 'professional',
    emotion: 'confident',
    pace: 'moderate',
    durationSeconds: 30,
    targetWordsPerMinute: 150,
  },
  music: {
    prompt:
      'Clean background bed, upbeat electronic, synths and light drums, 100 BPM, instrumental, no vocals, consistent energy, does not compete with voice',
    targetBPM: 100,
    genre: 'corporate',
    mood: 'innovative',
    composerDirection:
      'Open with a subtle build, 80 BPM, no drums. From 8s bring the main theme, 100 BPM, driving but not loud. CTA: punchy resolve, 95 BPM.',
    arc: [
      { startSeconds: 0, endSeconds: 8, label: 'intro', musicPrompt: 'Subtle build, low energy, minimal instrumentation, 80 BPM', targetBPM: 80, energyLevel: 3 },
      { startSeconds: 8, endSeconds: 25, label: 'product_intro', musicPrompt: 'Upbeat product intro, established energy, full arrangement, 100 BPM', targetBPM: 100, energyLevel: 6 },
      { startSeconds: 25, endSeconds: 30, label: 'cta', musicPrompt: 'Punchy resolve, confident energy, 95 BPM', targetBPM: 95, energyLevel: 5 },
    ],
    instrumentation: {
      drums: 'No drums in intro, electronic kick and hi-hat from 8s, minimal pattern',
      bass: 'Deep sub bass from 8s, sustained notes, supports rhythm',
      mids: 'Clean synth pads and light melodic elements, leaves 1-4kHz clear for voice',
      effects: 'Subtle room reverb on pads, no delay',
    },
    buttonEnding: {
      type: 'sustained chord with clean cutoff',
      timing: '0.5s after final word',
      description: 'Warm major chord resolves cleanly, no fade-out',
    },
    musicalStructure: {
      introType: 'ambient_build',
      introBars: 2,
      bodyFeel: 'driving',
      peakMoment: 'at brand reveal',
      endingType: 'button',
      outroBars: 1,
      keySignature: 'C major',
      phraseLength: 4,
    },
  },
  fades: {
    fadeInSeconds: 0.1,
    fadeOutSeconds: 0.4,
    curve: 'exp',
  },
  volume: {
    voiceVolume: 1.0,
    musicVolume: 0.15,
    segments: [
      {
        startSeconds: 0,
        endSeconds: 2,
        type: 'music_up',
        intensity: 'subtle',
      },
      {
        startSeconds: 25,
        endSeconds: 30,
        type: 'voice_up',
        intensity: 'moderate',
      },
    ],
  },
  mixPreset: 'voiceProminent',
  sentenceCues: [
    { index: 0, musicCue: 'hook', musicVolumeMultiplier: 0.85, musicDirection: 'swell', musicalFunction: 'hook' },
    { index: 1, musicCue: 'warm', musicVolumeMultiplier: 1.0, musicDirection: null, musicalFunction: 'build' },
    { index: 2, musicCue: 'cta', musicVolumeMultiplier: 1.1, musicDirection: 'hit on downbeat', musicalFunction: 'resolve' },
  ],
  soundDesign: [
    { timestamp: 7.5, sound: 'subtle whoosh', purpose: 'Transition to product intro' },
    { timestamp: 18.0, sound: 'soft impact', purpose: 'Emphasize key benefit' },
  ],
};

/** Same as AD_PRODUCTION_EXAMPLE_JSON serialized for use in prompts (single line, no extra whitespace). */
export function getAdProductionExampleJSONString(): string {
  return JSON.stringify(AD_PRODUCTION_EXAMPLE_JSON);
}

// ---------------------------------------------------------------------------
// OpenAI Structured Output JSON Schema (for response_format when supported)
// ---------------------------------------------------------------------------

/** JSON schema for OpenAI response_format.json_schema. Mirrors AdProductionLLMResponse. */
export function getOpenAIAdProductionJsonSchema(): {
  name: string;
  strict: boolean;
  schema: Record<string, unknown>;
} {
  return {
    name: 'ad_production_response',
    strict: true,
    schema: {
      type: 'object',
      description: 'Full ad production payload: script with TTS tags, context, music, fades, volume',
      properties: {
        version: { type: ['string', 'null'], description: 'Schema version e.g. 1.0' },
        script: {
          type: 'string',
          description:
            'Ad script with ElevenLabs v3 audio tags only: [excited], [pause], [whispers], etc. No SSML, no stage directions.',
        },
        context: {
          type: 'object',
          description: 'Context for voice selection and music',
          properties: {
            adCategory: {
              type: 'string',
              enum: AD_CATEGORIES as unknown as string[],
              description: 'Ad category',
            },
            tone: { type: 'string', description: 'e.g. professional, energetic, calm' },
            emotion: { type: 'string', description: 'e.g. excited, trustworthy, warm' },
            pace: { type: 'string', enum: PACE_VALUES as unknown as string[], description: 'slow, moderate, or fast' },
            durationSeconds: { type: 'number', description: 'Target duration in seconds' },
            targetWordsPerMinute: { type: ['number', 'null'], description: 'Optional target words per minute' },
            voiceHints: {
              type: ['object', 'null'],
              description: 'Optional voice traits',
              properties: {
                gender: { type: ['string', 'null'], enum: GENDER_VALUES as unknown as (string | null)[] },
                ageRange: { type: ['string', 'null'] },
                accent: { type: ['string', 'null'] },
              },
              required: ['gender', 'ageRange', 'accent'],
              additionalProperties: false,
            },
          },
          required: ['adCategory', 'tone', 'emotion', 'pace', 'durationSeconds', 'targetWordsPerMinute', 'voiceHints'],
          additionalProperties: false,
        },
        music: {
          type: 'object',
          description: 'Music suggestion; optional arc = segment-based score so tempo matches each part (e.g. product intro)',
          properties: {
            prompt: { type: 'string', description: 'Background bed for voice-over' },
            targetBPM: { type: 'number', description: '70-130, match to pace' },
            genre: { type: ['string', 'null'], description: 'e.g. corporate, upbeat' },
            mood: { type: ['string', 'null'], description: 'e.g. cheerful, calm' },
            composerDirection: {
              type: ['string', 'null'],
              description: 'Short paragraph (2-4 sentences) from composer to the music generator: overall intent, section feel, key timing/energy shifts. Sent verbatim to text-to-music. Max 300 chars.',
            },
            arc: {
              type: ['array', 'null'],
              description: 'Optional 2-4 segments: startSeconds, endSeconds, label, musicPrompt, targetBPM, energyLevel (1-10) so music matches each section',
              items: {
                type: 'object',
                properties: {
                  startSeconds: { type: 'number' },
                  endSeconds: { type: 'number' },
                  label: { type: 'string' },
                  musicPrompt: { type: 'string' },
                  targetBPM: { type: ['number', 'null'] },
                  energyLevel: { type: ['number', 'null'], description: 'Energy 1-10 (1=minimal, 5=established, 7=peak, 10=max). Guides arrangement density.' },
                },
                required: ['startSeconds', 'endSeconds', 'label', 'musicPrompt'],
                additionalProperties: false,
              },
            },
            instrumentation: {
              type: ['object', 'null'],
              description: 'Optional explicit instrumentation control: drums, bass, mids, effects',
              properties: {
                drums: { type: 'string', description: 'Drum/percussion description, e.g. "Tight electronic kick, minimal" or "No drums"' },
                bass: { type: 'string', description: 'Bass description, e.g. "Deep sub bass, sustained" or "Minimal synth bass"' },
                mids: { type: 'string', description: 'Mid-range melody/harmony, e.g. "Clean piano + soft pads, leaves 1-4kHz clear"' },
                effects: { type: 'string', description: 'Spatial/time effects, e.g. "Subtle reverb" or "None"' },
              },
              required: ['drums', 'bass', 'mids', 'effects'],
              additionalProperties: false,
            },
            buttonEnding: {
              type: ['object', 'null'],
              description: 'Optional button ending specification (professional ad standard: no fade-out)',
              properties: {
                type: { type: 'string', description: 'e.g. "sustained chord cutoff", "punchy stinger"' },
                timing: { type: ['string', 'null'], description: 'e.g. "0.5s after final word"' },
                description: { type: ['string', 'null'], description: 'e.g. "Warm major chord, clean release"' },
              },
              required: ['type'],
              additionalProperties: false,
            },
            musicalStructure: {
              type: ['object', 'null'],
              description: 'Optional structured musical form: intro type, peak placement, ending type. Provides precise blueprint input for bar-aware composition.',
              properties: {
                introType: { type: 'string', enum: ['ambient_build', 'rhythmic_hook', 'melodic_theme', 'silence_to_entry'], description: 'How the music opens' },
                introBars: { type: 'number', description: 'Bars for intro before voice enters (1-4)' },
                bodyFeel: { type: 'string', description: 'One-word feel for main body: driving, flowing, pulsing, steady, etc.' },
                peakMoment: { type: 'string', description: 'Where the musical peak should land, e.g. "at brand reveal", "bar 12"' },
                endingType: { type: 'string', enum: ['button', 'sustain', 'stinger', 'decay'], description: 'How the music ends' },
                outroBars: { type: 'number', description: 'Bars for outro after last word (1-4)' },
                keySignature: { type: ['string', 'null'], description: 'Optional key, e.g. "C major", "A minor"' },
                phraseLength: { type: ['number', 'null'], description: 'Bars per phrase (2-8, usually 4)' },
              },
              required: ['introType', 'introBars', 'bodyFeel', 'peakMoment', 'endingType', 'outroBars'],
              additionalProperties: false,
            },
          },
          required: ['prompt', 'targetBPM', 'genre', 'mood'],
          additionalProperties: false,
        },
        fades: {
          type: 'object',
          description: 'Fade in/out in seconds',
          properties: {
            fadeInSeconds: { type: 'number', description: '0.08 to 0.12 - short so first words are clear' },
            fadeOutSeconds: { type: 'number', description: '0.2 to 0.6 - longer fade-out so the end never feels cut off' },
            curve: { type: ['string', 'null'], enum: FADE_CURVES as unknown as (string | null)[] },
          },
          required: ['fadeInSeconds', 'fadeOutSeconds', 'curve'],
          additionalProperties: false,
        },
        volume: {
          type: 'object',
          description: 'Voice and music volume, optional segments',
          properties: {
            voiceVolume: { type: 'number', description: '0.8 to 1.0' },
            musicVolume: { type: 'number', description: '0.1 to 0.25' },
            segments: {
              type: ['array', 'null'],
              items: {
                type: 'object',
                properties: {
                  startSeconds: { type: 'number' },
                  endSeconds: { type: 'number' },
                  type: { type: 'string', enum: VOLUME_SEGMENT_TYPES as unknown as string[] },
                  intensity: { type: ['string', 'null'], enum: SEGMENT_INTENSITIES as unknown as (string | null)[] },
                },
                required: ['startSeconds', 'endSeconds', 'type', 'intensity'],
                additionalProperties: false,
              },
            },
          },
          required: ['voiceVolume', 'musicVolume', 'segments'],
          additionalProperties: false,
        },
        mixPreset: {
          type: ['string', 'null'],
          enum: MIX_PRESETS as unknown as (string | null)[],
          description: 'voiceProminent, balanced, or musicEmotional',
        },
        sentenceCues: {
          type: ['array', 'null'],
          description: 'Optional: one cue per sentence (index 0 = first sentence) for sentence-by-sentence mix',
          items: {
            type: 'object',
            properties: {
              index: { type: 'number', description: 'Sentence index (0-based)' },
              musicCue: { type: ['string', 'null'], description: 'e.g. upbeat, dramatic pause, swell' },
              musicVolumeMultiplier: { type: ['number', 'null'], description: '0.7-1.3 for music level during this sentence' },
              musicDirection: {
                type: ['string', 'null'],
                description: 'Optional short composer note for that phrase: e.g. swell, staccato, hold, hit on downbeat, quiet under',
              },
              musicalFunction: {
                type: ['string', 'null'],
                enum: ['hook', 'build', 'peak', 'resolve', 'transition', 'pause', null],
                description: 'Musical function of this sentence: hook (attention-grab), build (rising energy), peak (climax), resolve (settling), transition (bridging), pause (musical breath)',
              },
            },
            required: ['index'],
            additionalProperties: false,
          },
        },
        soundDesign: {
          type: ['array', 'null'],
          description: 'Optional: up to 5 sound design cues (SFX, stingers, transitions) for specific emotional beats',
          items: {
            type: 'object',
            properties: {
              timestamp: { type: 'number', description: 'Seconds when sound should play' },
              sound: { type: 'string', description: 'Description of sound effect, e.g. "whoosh transition", "subtle impact"' },
              purpose: { type: 'string', description: 'Why this sound, e.g. "emphasize brand reveal", "transition to CTA"' },
            },
            required: ['timestamp', 'sound', 'purpose'],
            additionalProperties: false,
          },
        },
      },
      required: ['script', 'context', 'music', 'fades', 'volume', 'version', 'mixPreset'],
      additionalProperties: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Safe default values (used when LLM omits optional fields)
// ---------------------------------------------------------------------------
const DEFAULT_FADES: AdProductionFades = {
  fadeInSeconds: 0.1,
  fadeOutSeconds: 0.4,
  curve: 'exp',
};

const DEFAULT_VOLUME: AdProductionVolume = {
  voiceVolume: 1.0,
  musicVolume: 0.15,
};

function getDefaultBPM(pace: Pace): number {
  switch (pace) {
    case 'slow':
      return 80;
    case 'fast':
      return 120;
    default:
      return 100;
  }
}

// Clamp numeric fields to safe ranges (production: short fade-in, noticeable fade-out so no abrupt end)
const FADE_IN_MIN = 0.02;
const FADE_IN_MAX = 0.12;
const FADE_OUT_MIN = 0.1;
const FADE_OUT_MAX = 0.6;
const VOLUME_MIN = 0;
const VOLUME_MAX = 2;
const BPM_MIN = 60;
const BPM_MAX = 180;
const MUSIC_PROMPT_MAX_LENGTH = 200;
const COMPOSER_DIRECTION_MAX_LENGTH = 300;

/**
 * Clamp and apply safe defaults to a parsed LLM response.
 * Call this after successful Zod parse so the pipeline always receives valid values.
 */
export function applySafeDefaultsAndClamp(
  parsed: z.infer<typeof AdProductionLLMResponseSchema>
): AdProductionLLMResponse {
  const fades: AdProductionFades = {
    fadeInSeconds: clamp(
      parsed.fades?.fadeInSeconds ?? DEFAULT_FADES.fadeInSeconds,
      FADE_IN_MIN,
      FADE_IN_MAX
    ),
    fadeOutSeconds: clamp(
      parsed.fades?.fadeOutSeconds ?? DEFAULT_FADES.fadeOutSeconds,
      FADE_OUT_MIN,
      FADE_OUT_MAX
    ),
    curve: parsed.fades?.curve ?? DEFAULT_FADES.curve,
  };

  const volume: AdProductionVolume = {
    voiceVolume: clamp(
      parsed.volume?.voiceVolume ?? DEFAULT_VOLUME.voiceVolume,
      VOLUME_MIN,
      VOLUME_MAX
    ),
    musicVolume: clamp(
      parsed.volume?.musicVolume ?? DEFAULT_VOLUME.musicVolume,
      VOLUME_MIN,
      VOLUME_MAX
    ),
    segments: parsed.volume?.segments?.filter(
      (s) =>
        typeof s.startSeconds === 'number' &&
        typeof s.endSeconds === 'number' &&
        s.endSeconds > s.startSeconds
    ),
  };

  const targetBPM =
    parsed.music?.targetBPM != null
      ? clamp(parsed.music.targetBPM, BPM_MIN, BPM_MAX)
      : getDefaultBPM(parsed.context.pace as Pace);

  const musicPrompt =
    parsed.music?.prompt != null
      ? parsed.music.prompt.slice(0, MUSIC_PROMPT_MAX_LENGTH)
      : 'Upbeat background music, instrumental, professional';

  // Optional arc: 2-4 segments with valid start/end (composer-style scoring)
  const arc =
    Array.isArray(parsed.music?.arc) && parsed.music.arc.length >= 2 && parsed.music.arc.length <= 4
      ? parsed.music.arc
          .filter(
            (s) =>
              typeof s.startSeconds === 'number' &&
              typeof s.endSeconds === 'number' &&
              s.endSeconds > s.startSeconds &&
              typeof s.musicPrompt === 'string' &&
              s.musicPrompt.length > 0
          )
          .slice(0, 4)
      : undefined;

  const composerDirection =
    parsed.music?.composerDirection != null && typeof parsed.music.composerDirection === 'string'
      ? parsed.music.composerDirection.slice(0, COMPOSER_DIRECTION_MAX_LENGTH)
      : undefined;

  return {
    version: parsed.version ?? '1.0',
    script: parsed.script ?? '',
    context: parsed.context,
    music: {
      prompt: musicPrompt,
      targetBPM,
      genre: parsed.music?.genre ?? undefined,
      mood: parsed.music?.mood ?? undefined,
      ...(composerDirection ? { composerDirection } : {}),
      ...(arc && arc.length >= 2 ? { arc } : {}),
      ...(parsed.music?.instrumentation ? { instrumentation: parsed.music.instrumentation } : {}),
      ...(parsed.music?.buttonEnding ? { buttonEnding: parsed.music.buttonEnding } : {}),
      ...(parsed.music?.musicalStructure ? { musicalStructure: parsed.music.musicalStructure } : {}),
    },
    fades,
    volume,
    mixPreset: parsed.mixPreset ?? undefined,
    sentenceCues: parsed.sentenceCues ?? undefined,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Create a valid ad-production response without calling the LLM (e.g. when OpenAI quota is exceeded).
 * Builds a script long enough to fill the requested duration (~2.8 words per second).
 */
export function createFallbackAdProductionResponse(
  input: AdProductionInput
): AdProductionLLMResponse {
  const duration = input.durationSeconds ?? 30;
  const tone = input.tone ?? 'professional';
  const pace: Pace = tone === 'calm' ? 'slow' : tone === 'exciting' ? 'fast' : 'moderate';
  const targetWpm = pace === 'slow' ? 120 : pace === 'fast' ? 160 : 150;

  // Target word count so TTS fills the requested duration (e.g. 30s -> ~84 words)
  const targetWords = Math.max(40, Math.round(duration * 2.8));
  const promptWords = input.prompt.trim().split(/\s+/).filter(Boolean);
  const promptText = promptWords.join(' ');

  const lines: string[] = [];
  lines.push(`[excited] ${promptText.slice(0, 200)}${promptText.length > 200 ? '.' : ''}`);

  const filler = [
    '[warmly] This is the perfect choice for you. We are here to help you succeed.',
    'Discover why so many people trust us every day. Quality you can rely on.',
    'Simple, effective, and designed with you in mind. Get started in no time.',
    'Join us and see the difference. Your journey starts here today.',
    'We make it easy. Everything you need in one place.',
  ];
  let wordCount = countWords(lines[0]);
  let fi = 0;
  while (wordCount < targetWords - 15) {
    lines.push(filler[fi % filler.length]);
    wordCount += countWords(filler[fi % filler.length]);
    fi++;
  }
  lines.push('[pause] Try it now. Thank you.');

  const script = lines.join(' ');

  return applySafeDefaultsAndClamp({
    version: '1.0',
    script,
    context: {
      adCategory: 'other',
      tone,
      emotion: tone,
      pace,
      durationSeconds: duration,
      targetWordsPerMinute: targetWpm,
      voiceHints: null,
    },
    music: {
      prompt: `Professional ${tone} background music, instrumental, ${pace} pace, suitable for voice-over, 100 BPM`,
      targetBPM: pace === 'slow' ? 85 : pace === 'fast' ? 115 : 100,
      genre: 'corporate',
      mood: tone,
      arc: undefined,
    },
    fades: { fadeInSeconds: 0.1, fadeOutSeconds: 0.4, curve: 'exp' },
    volume: { voiceVolume: 1.0, musicVolume: 0.15, segments: undefined },
    mixPreset: 'voiceProminent',
    sentenceCues: undefined,
  });
}

/**
 * Extract the first complete JSON object from a string (LLM often appends text after the JSON).
 */
function extractFirstJsonObject(content: string): string {
  const start = content.indexOf('{');
  if (start === -1) return content;
  let depth = 1;
  let i = start + 1;
  const len = content.length;
  while (i < len && depth > 0) {
    const c = content[i];
    if (c === '"') {
      i++;
      while (i < len) {
        const q = content[i];
        if (q === '\\') {
          i++;
          if (content[i] === 'u') i += 5;
          else i++;
          continue;
        }
        if (q === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  return depth === 0 ? content.slice(start, i) : content;
}

/**
 * Parse raw JSON string from LLM, validate with Zod, then apply safe defaults and clamping.
 * Tolerates trailing text or markdown after the JSON. Returns validated AdProductionLLMResponse or throws.
 */
export function parseAndValidateAdProductionResponse(
  rawContent: string
): AdProductionLLMResponse {
  let json: unknown;
  let content = rawContent.trim();

  // Strip markdown code fences if present
  if (content.startsWith('```json')) {
    content = content.replace(/^```json\s*/i, '').replace(/\s*```\s*$/, '');
  } else if (content.startsWith('```')) {
    content = content.replace(/^```\s*/, '').replace(/\s*```\s*$/, '');
  }
  content = content.trim();

  // LLM often returns valid JSON followed by extra text; extract only the first complete object
  const jsonOnly = extractFirstJsonObject(content);

  try {
    json = JSON.parse(jsonOnly);
  } catch (e) {
    throw new Error(
      `Invalid JSON from LLM: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  const result = AdProductionLLMResponseSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`LLM response validation failed: ${issues}`);
  }

  return applySafeDefaultsAndClamp(result.data);
}
