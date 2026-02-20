import { z } from 'zod';

// ===========================================================================
// AdForm — Our AudioStack-like JSON format for describing complete audio ads.
//
// Like AudioStack's "Audioform", an AdForm is a single JSON document that
// fully describes how to build an audio ad: content, speech, production,
// and delivery — all in one declarative format.
//
// Pipeline: Content → Speech → Production → Delivery
// ===========================================================================

// ---------------------------------------------------------------------------
// 1. CONTENT LAYER — Script with sections, placeholders, and SFX markers
// ---------------------------------------------------------------------------

/** A placeholder variable in the script (for DCO personalization). */
export interface AdFormPlaceholder {
  /** Variable ID used in script text, e.g. "brand_name" */
  id: string;
  /** Default value if no audience-specific value is provided */
  defaultValue: string;
  /** Human-readable description */
  description?: string;
}

/** An inline SFX marker in the script. */
export interface AdFormSfxMarker {
  /** Unique ID for this SFX instance */
  id: string;
  /** Description of the sound effect */
  description: string;
  /** Volume 0-1 */
  volume?: number;
}

/** A section of the script mapped to a sound template segment. */
export interface AdFormSection {
  /** Section name, e.g. "intro", "main", "outro" */
  name: string;
  /** Which sound template segment this maps to */
  soundSegment: 'intro' | 'main' | 'outro' | string;
  /** Script text for this section (may contain {{placeholders}} and SFX markers) */
  text: string;
  /** Voice override for this section (if different from default) */
  voice?: string;
  /** Voice style hint for this section */
  voiceStyle?: string;
}

/** The content layer of an AdForm. */
export interface AdFormContent {
  /** Raw script text (flat, for simple ads without sections) */
  scriptText?: string;
  /** Structured sections (for template-based ads) */
  sections?: AdFormSection[];
  /** Placeholder variables for personalization */
  placeholders?: AdFormPlaceholder[];
  /** Inline SFX markers */
  sfxMarkers?: AdFormSfxMarker[];
}

// ---------------------------------------------------------------------------
// 2. SPEECH LAYER — Voice selection and TTS configuration
// ---------------------------------------------------------------------------

/** TTS provider identifier. */
export const TTS_PROVIDERS = [
  'elevenlabs',
  'azure',
  'openai',
  'google',
  'amazon',
] as const;
export type TTSProvider = (typeof TTS_PROVIDERS)[number];

/** Voice configuration for the speech layer. */
export interface AdFormVoice {
  /** Provider to use */
  provider: TTSProvider;
  /** Voice ID (provider-specific) */
  voiceId: string;
  /** Human-readable voice name */
  name?: string;
  /** Speed multiplier (0.5 = half speed, 2.0 = double speed) */
  speed?: number;
  /** Provider-specific settings (stability, style, etc.) */
  settings?: Record<string, unknown>;
}

/** The speech layer of an AdForm. */
export interface AdFormSpeech {
  /** Default voice for the entire ad */
  voice: AdFormVoice;
  /** Override voices for specific sections (key = section name) */
  sectionVoices?: Record<string, AdFormVoice>;
  /** Audience-specific placeholder values (for DCO) */
  audience?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// 3. PRODUCTION LAYER — Sound templates, mixing, mastering
// ---------------------------------------------------------------------------

/** Sound template segment definition. */
export interface SoundTemplateSegment {
  /** Segment type */
  type: 'intro' | 'main' | 'outro';
  /** Path to the audio file for this segment */
  filePath: string;
  /** Duration in seconds */
  duration: number;
  /** Whether this segment should loop (typically the 'main' segment) */
  loop?: boolean;
}

/** A sound template (background music bed with elastic segments). */
export interface AdFormSoundTemplate {
  /** Template ID or name */
  id: string;
  /** Human-readable name */
  name?: string;
  /** Genre tag */
  genre?: string;
  /** Mood tag */
  mood?: string;
  /** BPM of the template */
  bpm?: number;
  /** Segments: intro, main (loops), outro */
  segments?: SoundTemplateSegment[];
  /** If no segments, use a single file path (will auto-loop) */
  filePath?: string;
}

/** Mastering preset names. */
export const MASTERING_PRESETS = [
  'balanced',
  'voiceenhanced',
  'musicenhanced',
] as const;
export type MasteringPreset = (typeof MASTERING_PRESETS)[number];

/** Loudness standard presets. */
export const LOUDNESS_PRESETS = [
  'spotify',       // -16 LUFS, -2 dB TP
  'youtube',       // -14 LUFS, -1 dB TP
  'podcast',       // -16 LUFS, -3 dB TP
  'applePodcast',  // -16 LUFS, -1 dB TP
  'radio',         // -24 LUFS, -2 dB TP (EBU R128)
  'radioBroadcast',// -24 LUFS, -2 dB TP (ATSC A/85)
  'crossPlatform', // -16 LUFS, -2 dB TP (safe for most platforms)
] as const;
export type LoudnessPreset = (typeof LOUDNESS_PRESETS)[number];

/** Per-section timing and alignment control. */
export interface AdFormSectionProperties {
  /** Start time in seconds (override auto-layout) */
  startAt?: number;
  /** End time in seconds (forces section to end at this point) */
  endAt?: number;
  /** Alignment within the time window */
  alignment?: 'left' | 'centre' | 'right';
  /** Fade in duration in seconds */
  fadeIn?: number;
  /** Fade out duration in seconds */
  fadeOut?: number;
  /** Silence padding before this section in seconds */
  startPadding?: number;
  /** Silence padding after this section in seconds */
  endPadding?: number;
}

/** Global timeline properties. */
export interface AdFormTimelineProperties {
  /** Global fade in duration */
  fadeIn?: number;
  /** Global fade out duration */
  fadeOut?: number;
  /** Fade curve type */
  fadeCurve?: 'linear' | 'exp' | 'qsin';
  /** Force total output length (seconds) */
  forceLength?: number;
  /** Music tail after speech ends (seconds) */
  soundTail?: number;
}

/** The production layer of an AdForm. */
export interface AdFormProduction {
  /** Sound template to use as background music */
  soundTemplate: AdFormSoundTemplate | string;
  /** Mastering preset */
  masteringPreset?: MasteringPreset;
  /** Loudness standard preset */
  loudnessPreset?: LoudnessPreset;
  /** Per-section timing control (key = section name) */
  sectionProperties?: Record<string, AdFormSectionProperties>;
  /** Global timeline properties */
  timelineProperties?: AdFormTimelineProperties;
  /** Sound effects library items to include */
  soundEffects?: AdFormSfxMarker[];
}

// ---------------------------------------------------------------------------
// 4. DELIVERY LAYER — Output format, encoding, distribution
// ---------------------------------------------------------------------------

/** Audio format presets. */
export const AUDIO_FORMAT_PRESETS = [
  'mp3',           // 320 kbps CBR
  'mp3_low',       // ~128 kbps VBR
  'mp3_medium',    // ~192 kbps VBR
  'mp3_high',      // ~256 kbps VBR
  'wav',           // 48kHz, 16-bit PCM
  'wav_44100',     // 44.1kHz, 16-bit PCM
  'ogg',           // 320 kbps OGG Vorbis
  'flac',          // 48kHz, 16-bit FLAC
  'aac',           // 256 kbps AAC
  'aac_low',       // 128 kbps AAC
] as const;
export type AudioFormatPreset = (typeof AUDIO_FORMAT_PRESETS)[number];

/** The delivery layer of an AdForm. */
export interface AdFormDelivery {
  /** Output format preset */
  format?: AudioFormatPreset;
  /** Whether to generate a public URL */
  public?: boolean;
  /** Multiple format outputs (for cross-platform delivery) */
  formats?: AudioFormatPreset[];
  /** VAST tag generation settings */
  vast?: {
    /** Enable VAST tag output */
    enabled: boolean;
    /** Click-through URL */
    clickThrough?: string;
    /** Tracking URLs */
    impressionTracking?: string[];
  };
}

// ---------------------------------------------------------------------------
// 5. THE ADFORM — Complete document
// ---------------------------------------------------------------------------

/** Version of the AdForm format. */
export const ADFORM_VERSION = 'v1' as const;

/** The complete AdForm document. */
export interface AdForm {
  /** Format version */
  version: typeof ADFORM_VERSION;
  /** Content layer: script, sections, placeholders */
  content: AdFormContent;
  /** Speech layer: voice selection, TTS config */
  speech: AdFormSpeech;
  /** Production layer: sound template, mixing, mastering */
  production: AdFormProduction;
  /** Delivery layer: output format, encoding */
  delivery: AdFormDelivery;
  /** Optional metadata */
  metadata?: {
    /** Ad title */
    title?: string;
    /** Brand name */
    brand?: string;
    /** Campaign name */
    campaign?: string;
    /** Target duration in seconds */
    targetDuration?: number;
    /** Ad category */
    category?: string;
    /** Tags */
    tags?: string[];
  };
}

// ---------------------------------------------------------------------------
// 6. ADFORM RESULTS — What comes back after building
// ---------------------------------------------------------------------------

/** Result of building an AdForm. */
export interface AdFormBuildResult {
  /** Unique ID for this build */
  buildId: string;
  /** Build status */
  status: 'pending' | 'processing' | 'completed' | 'failed';
  /** Progress 0-100 */
  progress: number;
  /** Stage description */
  stage?: string;
  /** Output file URLs (one per format) */
  outputs?: {
    format: AudioFormatPreset;
    url: string;
    fileSize?: number;
    duration?: number;
  }[];
  /** VAST tag URL (if requested) */
  vastUrl?: string;
  /** Error message (if failed) */
  error?: string;
  /** Timing breakdown */
  timing?: {
    contentMs?: number;
    speechMs?: number;
    productionMs?: number;
    deliveryMs?: number;
    totalMs?: number;
  };
}

/** Batch AdForm request (multiple AdForms processed in parallel). */
export interface AdFormBatchRequest {
  /** Array of AdForms to build (max 100) */
  adforms: AdForm[];
  /** Shared delivery settings (override per-adform delivery) */
  delivery?: AdFormDelivery;
}

/** Batch AdForm result. */
export interface AdFormBatchResult {
  /** Batch ID */
  batchId: string;
  /** Overall status */
  status: 'pending' | 'processing' | 'completed' | 'partial' | 'failed';
  /** Total AdForms in batch */
  total: number;
  /** Completed count */
  completed: number;
  /** Failed count */
  failed: number;
  /** Individual results */
  results: AdFormBuildResult[];
}

// ---------------------------------------------------------------------------
// 7. ZOD SCHEMAS — Validation for API input
// ---------------------------------------------------------------------------

const AdFormPlaceholderSchema = z.object({
  id: z.string().min(1),
  defaultValue: z.string(),
  description: z.string().optional(),
});

const AdFormSfxMarkerSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  volume: z.number().min(0).max(1).optional(),
});

const AdFormSectionSchema = z.object({
  name: z.string().min(1),
  soundSegment: z.string().min(1),
  text: z.string().min(1),
  voice: z.string().optional(),
  voiceStyle: z.string().optional(),
});

const AdFormContentSchema = z.object({
  scriptText: z.string().optional(),
  sections: z.array(AdFormSectionSchema).optional(),
  placeholders: z.array(AdFormPlaceholderSchema).optional(),
  sfxMarkers: z.array(AdFormSfxMarkerSchema).optional(),
}).refine(
  (data) => data.scriptText || (data.sections && data.sections.length > 0),
  { message: 'Either scriptText or sections must be provided' }
);

const AdFormVoiceSchema = z.object({
  provider: z.enum(TTS_PROVIDERS),
  voiceId: z.string().min(1),
  name: z.string().optional(),
  speed: z.number().min(0.25).max(4.0).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

const AdFormSpeechSchema = z.object({
  voice: AdFormVoiceSchema,
  sectionVoices: z.record(z.string(), AdFormVoiceSchema).optional(),
  audience: z.record(z.string(), z.string()).optional(),
});

const AdFormSoundTemplateSchema = z.union([
  z.string(), // Template ID reference
  z.object({
    id: z.string().min(1),
    name: z.string().optional(),
    genre: z.string().optional(),
    mood: z.string().optional(),
    bpm: z.number().optional(),
    filePath: z.string().optional(),
    segments: z.array(z.object({
      type: z.enum(['intro', 'main', 'outro']),
      filePath: z.string(),
      duration: z.number(),
      loop: z.boolean().optional(),
    })).optional(),
  }),
]);

const AdFormSectionPropertiesSchema = z.object({
  startAt: z.number().optional(),
  endAt: z.number().optional(),
  alignment: z.enum(['left', 'centre', 'right']).optional(),
  fadeIn: z.number().optional(),
  fadeOut: z.number().optional(),
  startPadding: z.number().optional(),
  endPadding: z.number().optional(),
});

const AdFormTimelinePropertiesSchema = z.object({
  fadeIn: z.number().optional(),
  fadeOut: z.number().optional(),
  fadeCurve: z.enum(['linear', 'exp', 'qsin']).optional(),
  forceLength: z.number().optional(),
  soundTail: z.number().optional(),
});

const AdFormProductionSchema = z.object({
  soundTemplate: AdFormSoundTemplateSchema,
  masteringPreset: z.enum(MASTERING_PRESETS).optional(),
  loudnessPreset: z.enum(LOUDNESS_PRESETS).optional(),
  sectionProperties: z.record(z.string(), AdFormSectionPropertiesSchema).optional(),
  timelineProperties: AdFormTimelinePropertiesSchema.optional(),
  soundEffects: z.array(AdFormSfxMarkerSchema).optional(),
});

const AdFormDeliverySchema = z.object({
  format: z.enum(AUDIO_FORMAT_PRESETS).optional(),
  public: z.boolean().optional(),
  formats: z.array(z.enum(AUDIO_FORMAT_PRESETS)).optional(),
  vast: z.object({
    enabled: z.boolean(),
    clickThrough: z.string().optional(),
    impressionTracking: z.array(z.string()).optional(),
  }).optional(),
});

export const AdFormSchema = z.object({
  version: z.literal(ADFORM_VERSION),
  content: AdFormContentSchema,
  speech: AdFormSpeechSchema,
  production: AdFormProductionSchema,
  delivery: AdFormDeliverySchema,
  metadata: z.object({
    title: z.string().optional(),
    brand: z.string().optional(),
    campaign: z.string().optional(),
    targetDuration: z.number().optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }).optional(),
});

// ---------------------------------------------------------------------------
// 8. HELPERS
// ---------------------------------------------------------------------------

/** Get loudness values for a preset. */
export function getLoudnessValues(preset: LoudnessPreset): { lufs: number; truePeak: number } {
  const presets: Record<LoudnessPreset, { lufs: number; truePeak: number }> = {
    spotify:        { lufs: -16, truePeak: -2 },
    youtube:        { lufs: -14, truePeak: -1 },
    podcast:        { lufs: -16, truePeak: -3 },
    applePodcast:   { lufs: -16, truePeak: -1 },
    radio:          { lufs: -24, truePeak: -2 },
    radioBroadcast: { lufs: -24, truePeak: -2 },
    crossPlatform:  { lufs: -16, truePeak: -2 },
  };
  return presets[preset] || presets.crossPlatform;
}

/** Resolve placeholders in script text. */
export function resolvePlaceholders(
  text: string,
  placeholders: AdFormPlaceholder[],
  audience?: Record<string, string>
): string {
  let resolved = text;
  for (const ph of placeholders) {
    const value = audience?.[ph.id] ?? ph.defaultValue;
    // Replace {{placeholder_id}} with the value
    resolved = resolved.replace(new RegExp(`\\{\\{${ph.id}\\}\\}`, 'g'), value);
  }
  return resolved;
}

/** Validate an AdForm JSON document. */
export function validateAdForm(input: unknown): { valid: boolean; errors: string[]; adform?: AdForm } {
  const result = AdFormSchema.safeParse(input);
  if (result.success) {
    return { valid: true, errors: [], adform: result.data as AdForm };
  }
  const errors = result.error.issues.map(
    (i) => `${i.path.join('.')}: ${i.message}`
  );
  return { valid: false, errors };
}
