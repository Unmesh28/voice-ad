// ===========================================================================
// SFX (Sound Effects) Types
//
// Type definitions for the SFX generation system. SFX are short audio clips
// (typically 0.3-5 seconds) used in ad format segments for transitions,
// emphasis, and attention-grabbing moments.
// ===========================================================================

/** An SFX category for library organization and prompt optimization. */
export const SFX_CATEGORIES = [
  'transition',   // Whooshes, swooshes, sweeps — bridging between sections
  'impact',       // Hits, thuds, slams — punctuating key moments
  'notification', // Pings, dings, chimes — attention signals
  'nature',       // Rain, wind, birds — atmospheric/ambient
  'mechanical',   // Clicks, gears, machines — tech/product sounds
  'musical',      // Stingers, risers, drops — musical SFX
  'human',        // Crowd, applause, gasp — people sounds
  'commercial',   // Cash register, shopping, packaging — commerce sounds
  'ui',           // Button clicks, swipes, taps — digital interface sounds
  'celebration',  // Fireworks, confetti, party horn — festive sounds
] as const;
export type SfxCategory = (typeof SFX_CATEGORIES)[number];

/** Input for generating a single SFX. */
export interface SfxGenerationInput {
  /** Natural language description of the desired sound, e.g. "whoosh transition" */
  description: string;
  /** Target duration in seconds (0.3-5.0 for SFX, up to 22 for longer ambient sounds) */
  durationSeconds: number;
  /** How closely the generation should follow the prompt (0.0-1.0). Higher = more literal. */
  promptInfluence?: number;
  /** Optional category for prompt optimization */
  category?: SfxCategory;
  /** Optional: which ad segment this SFX belongs to (for logging/tracking) */
  segmentIndex?: number;
  /** Optional: label from the ad format segment */
  segmentLabel?: string;
}

/** Result from generating a single SFX. */
export interface SfxGenerationResult {
  /** Path to the generated audio file on disk */
  filePath: string;
  /** Audio data as a Buffer */
  audioBuffer: Buffer;
  /** Actual duration of the generated audio in seconds */
  duration: number;
  /** The prompt that was actually sent to the generation API */
  resolvedPrompt: string;
  /** Whether this came from a library match or was generated fresh */
  source: 'library_prompt' | 'generated';
  /** Category (resolved from description if not provided) */
  category: SfxCategory;
}

/** A curated SFX prompt entry in the library. */
export interface SfxLibraryEntry {
  /** Unique ID for this entry */
  id: string;
  /** Human-readable name */
  name: string;
  /** Category */
  category: SfxCategory;
  /** Keywords that trigger this entry when matching against a description */
  keywords: string[];
  /** Optimized prompt for ElevenLabs sound generation */
  prompt: string;
  /** Recommended duration in seconds */
  recommendedDuration: number;
  /** Recommended prompt_influence (0.0-1.0) */
  recommendedInfluence: number;
}

/** Batch SFX generation request — for generating all SFX in an ad at once. */
export interface SfxBatchInput {
  /** List of SFX to generate */
  items: SfxGenerationInput[];
  /** Production ID for tracking */
  productionId?: string;
}

/** Batch SFX generation result. */
export interface SfxBatchResult {
  /** Results in the same order as input items */
  results: SfxGenerationResult[];
  /** Total generation time in ms */
  totalTimeMs: number;
  /** How many were generated vs failed */
  succeeded: number;
  failed: number;
}
