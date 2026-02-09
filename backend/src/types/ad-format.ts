import { z } from 'zod';

// ===========================================================================
// Ad Format Templates — Segment-Based Ad Composition
//
// Instead of the flat "music + voiceover" format, ads are composed of
// ordered segments where each segment controls what audio layers are active
// and how they behave. This enables creative structures like:
//
//   [Punjabi dhol hook] → [SFX whoosh] → [Voice over music] →
//   [Music break] → [Voice + building music] → [SFX] → [CTA] → [Music outro]
//
// Two levels:
//   1. AdFormatTemplate  — Predefined skeleton (segment structure + constraints)
//   2. AdCreativePlan    — LLM fills a template with actual content per-ad
// ===========================================================================

// ---------------------------------------------------------------------------
// Segment Types
// ---------------------------------------------------------------------------

/** The kind of audio activity happening in a segment. */
export const AD_SEGMENT_TYPES = [
  'music_solo',           // Music at full volume, no voice (hooks, interludes, outros)
  'voiceover_with_music', // Voice over background music (the standard format)
  'voiceover_only',       // Voice only, no music (for dramatic emphasis)
  'sfx_hit',              // Short SFX moment (whoosh, ding, impact) — typically < 1.5s
  'silence',              // Intentional pause/silence for dramatic effect
] as const;
export type AdSegmentType = (typeof AD_SEGMENT_TYPES)[number];

/** How music behaves within a segment. */
export const MUSIC_BEHAVIORS = [
  'full',       // Full volume — music is the star (no voice competing)
  'ducked',     // Reduced volume under voice
  'building',   // Energy/volume increasing through the segment
  'resolving',  // Energy/volume decreasing, settling down
  'accent',     // Brief musical hit/accent then back to level
  'none',       // No music in this segment
] as const;
export type MusicBehavior = (typeof MUSIC_BEHAVIORS)[number];

/** How one segment transitions to the next. */
export const SEGMENT_TRANSITIONS = [
  'crossfade',       // Smooth overlap between segments
  'hard_cut',        // Immediate switch (good after SFX hits)
  'duck_transition', // Current audio ducks, next comes in over it
  'natural',         // Natural musical phrasing handles the transition
] as const;
export type SegmentTransition = (typeof SEGMENT_TRANSITIONS)[number];

// ---------------------------------------------------------------------------
// Template Segment Definition (skeleton — defines constraints, not content)
// ---------------------------------------------------------------------------

export interface AdFormatSegmentDef {
  /** What kind of audio activity */
  type: AdSegmentType;
  /** Human-readable label for the slot, e.g. "Cultural Music Hook" */
  label: string;
  /** What should happen in this segment */
  description: string;
  /** Duration constraints in seconds */
  durationRange: { min: number; max: number };
  /** How music behaves in this segment */
  musicBehavior: MusicBehavior;
  /** Can this segment be skipped by the LLM? */
  required: boolean;
  /** How this transitions to the next segment */
  transition: SegmentTransition;
}

// ---------------------------------------------------------------------------
// Ad Format Template (predefined, reusable patterns)
// ---------------------------------------------------------------------------

export interface AdFormatTemplate {
  /** Unique ID, e.g. "classic_radio", "cultural_hook" */
  id: string;
  /** Human-readable name */
  name: string;
  /** When to use this template */
  description: string;
  /** Ordered list of segment definitions (the skeleton) */
  segments: AdFormatSegmentDef[];
  /** Supported total ad duration range */
  totalDurationRange: { min: number; max: number };
  /** Scenarios/categories this template works well for */
  bestFor: string[];
  /** Brief example of what an ad using this template sounds like */
  example?: string;
}

// ---------------------------------------------------------------------------
// Creative Segment (LLM-generated, per-ad — fills in a template)
// ---------------------------------------------------------------------------

export interface AdCreativeSegmentVoiceover {
  /** Script text for this segment */
  text: string;
  /** ElevenLabs voice style hint, e.g. "excited", "whisper", "warm" */
  voiceStyle?: string | null;
}

export interface AdCreativeSegmentMusic {
  /** What the music should sound like in this segment */
  description: string;
  /** How the music behaves */
  behavior: MusicBehavior;
  /** Relative volume 0.0-1.0 */
  volume: number;
  /** Cultural style hint, e.g. "Punjabi folk", "Latin jazz" */
  culturalStyle?: string | null;
  /** Key instruments for this segment, e.g. ["dhol", "tumbi"] */
  instruments?: string[] | null;
}

export interface AdCreativeSegmentSfx {
  /** What the SFX should sound like, e.g. "whoosh transition", "cash register ding" */
  description: string;
  /** Relative volume 0.0-1.0 */
  volume?: number | null;
}

export interface AdCreativeSegment {
  /** Position in the ad (0-based) */
  segmentIndex: number;
  /** What kind of audio activity */
  type: AdSegmentType;
  /** Human-readable label, e.g. "Punjabi dhol hook", "Product reveal" */
  label: string;
  /** Exact duration in seconds (decided by LLM within template constraints) */
  duration: number;
  /** Voiceover for this segment (null if no voice) */
  voiceover: AdCreativeSegmentVoiceover | null;
  /** Music for this segment (null if no music) */
  music: AdCreativeSegmentMusic | null;
  /** SFX for this segment (null if no SFX) */
  sfx: AdCreativeSegmentSfx | null;
  /** How this transitions to the next segment */
  transition: SegmentTransition;
  /** Duration of the transition in seconds (for crossfade/duck) */
  transitionDuration?: number | null;
}

// ---------------------------------------------------------------------------
// Ad Creative Plan (full LLM output — a filled template)
// ---------------------------------------------------------------------------

export interface AdCreativePlan {
  /** Which template was used, e.g. "cultural_hook" or "custom" */
  templateId: string;
  /** Human-readable template name */
  templateName: string;
  /** Total ad duration (sum of segment durations) */
  totalDuration: number;
  /** Ordered list of filled segments */
  segments: AdCreativeSegment[];
  /** Overall music direction for generating the backing track(s) */
  overallMusicDirection: string;
  /** Cultural context hint, e.g. "Punjabi folk music with dhol and tumbi" */
  culturalContext?: string | null;
}

// ---------------------------------------------------------------------------
// Zod Schemas (for LLM response validation)
// ---------------------------------------------------------------------------

const AdCreativeSegmentVoiceoverSchema = z.object({
  text: z.string(),
  voiceStyle: z.string().nullish(),
});

const AdCreativeSegmentMusicSchema = z.object({
  description: z.string(),
  behavior: z.enum(MUSIC_BEHAVIORS),
  volume: z.number().min(0).max(1),
  culturalStyle: z.string().nullish(),
  instruments: z.array(z.string()).nullish(),
});

const AdCreativeSegmentSfxSchema = z.object({
  description: z.string(),
  volume: z.number().min(0).max(1).nullish(),
});

export const AdCreativeSegmentSchema = z.object({
  segmentIndex: z.number().int().min(0),
  type: z.enum(AD_SEGMENT_TYPES),
  label: z.string(),
  duration: z.number().min(0.1).max(120),
  voiceover: AdCreativeSegmentVoiceoverSchema.nullable(),
  music: AdCreativeSegmentMusicSchema.nullable(),
  sfx: AdCreativeSegmentSfxSchema.nullable(),
  transition: z.enum(SEGMENT_TRANSITIONS),
  transitionDuration: z.number().min(0).max(5).nullish(),
});

export const AdCreativePlanSchema = z.object({
  templateId: z.string(),
  templateName: z.string(),
  totalDuration: z.number().min(5).max(300),
  segments: z.array(AdCreativeSegmentSchema).min(1).max(20),
  overallMusicDirection: z.string(),
  culturalContext: z.string().nullish(),
});

// ---------------------------------------------------------------------------
// Built-in Templates
// ---------------------------------------------------------------------------

export const BUILTIN_TEMPLATES: AdFormatTemplate[] = [
  // ── 1. Classic Radio ────────────────────────────────────────────────
  {
    id: 'classic_radio',
    name: 'Classic Radio',
    description:
      'The standard radio ad format: music intro, voice over ducked music, music outro. Simple, proven, professional.',
    segments: [
      {
        type: 'music_solo',
        label: 'Music Intro',
        description: 'Background music plays at full volume to set the mood and grab attention.',
        durationRange: { min: 1.5, max: 4 },
        musicBehavior: 'full',
        required: true,
        transition: 'duck_transition',
      },
      {
        type: 'voiceover_with_music',
        label: 'Main Voiceover',
        description: 'Voiceover delivers the full message while music plays underneath at reduced volume.',
        durationRange: { min: 10, max: 55 },
        musicBehavior: 'ducked',
        required: true,
        transition: 'duck_transition',
      },
      {
        type: 'music_solo',
        label: 'Music Outro',
        description: 'Music comes back to full volume for a clean button ending.',
        durationRange: { min: 1, max: 3 },
        musicBehavior: 'full',
        required: true,
        transition: 'natural',
      },
    ],
    totalDurationRange: { min: 15, max: 60 },
    bestFor: ['corporate', 'professional services', 'any general-purpose ad'],
    example:
      '[Corporate synth music plays] → [Music ducks] "Welcome to TechFlow, the all-in-one solution..." → [Music swells back] [Button ending]',
  },

  // ── 2. Cultural Hook ────────────────────────────────────────────────
  {
    id: 'cultural_hook',
    name: 'Cultural Hook',
    description:
      'Opens with a culturally distinctive music hook (e.g. Punjabi dhol, Latin guitar, Japanese koto) to immediately signal the cultural context. Includes music breaks between voice sections for cultural authenticity.',
    segments: [
      {
        type: 'music_solo',
        label: 'Cultural Music Hook',
        description:
          'A short, attention-grabbing musical riff rooted in the cultural style of the product/audience. Sets the cultural tone immediately.',
        durationRange: { min: 2, max: 5 },
        musicBehavior: 'full',
        required: true,
        transition: 'hard_cut',
      },
      {
        type: 'sfx_hit',
        label: 'Transition SFX',
        description: 'A whoosh, reveal, or impact sound that transitions from hook to voiceover.',
        durationRange: { min: 0.3, max: 1 },
        musicBehavior: 'none',
        required: false,
        transition: 'hard_cut',
      },
      {
        type: 'voiceover_with_music',
        label: 'Product Introduction',
        description: 'Voice introduces the product/brand while cultural music plays softly underneath.',
        durationRange: { min: 5, max: 15 },
        musicBehavior: 'ducked',
        required: true,
        transition: 'duck_transition',
      },
      {
        type: 'music_solo',
        label: 'Cultural Music Break',
        description:
          'A short instrumental break where the cultural music comes back up — a melodic phrase, rhythm pattern, or musical hook. Gives the ad breathing room and reinforces the cultural vibe.',
        durationRange: { min: 1.5, max: 3 },
        musicBehavior: 'full',
        required: true,
        transition: 'duck_transition',
      },
      {
        type: 'voiceover_with_music',
        label: 'Features / Benefits',
        description: 'Voice continues with product details, features, or benefits over music.',
        durationRange: { min: 5, max: 15 },
        musicBehavior: 'ducked',
        required: true,
        transition: 'natural',
      },
      {
        type: 'sfx_hit',
        label: 'Deal / Action SFX',
        description: 'A sound effect that punctuates the offer or deal moment (e.g. cash register, sparkle, celebration sound).',
        durationRange: { min: 0.3, max: 1 },
        musicBehavior: 'none',
        required: false,
        transition: 'hard_cut',
      },
      {
        type: 'voiceover_with_music',
        label: 'Call to Action',
        description: 'Voice delivers the CTA with music building energy underneath.',
        durationRange: { min: 3, max: 8 },
        musicBehavior: 'building',
        required: true,
        transition: 'duck_transition',
      },
      {
        type: 'music_solo',
        label: 'Cultural Music Outro',
        description: 'Cultural music returns at full volume for a distinctive, memorable ending.',
        durationRange: { min: 1.5, max: 3 },
        musicBehavior: 'full',
        required: true,
        transition: 'natural',
      },
    ],
    totalDurationRange: { min: 20, max: 60 },
    bestFor: [
      'culturally-targeted products',
      'regional brands',
      'food and beverage with cultural identity',
      'festival and event promotions',
      'ethnic fashion and lifestyle',
    ],
    example:
      '[Dhol riff] → [Whoosh] → "Introducing..." [music ducks] → [Tumbi melody break] → "Now available..." → [Cash register SFX] → "Order today!" [music builds] → [Dhol outro]',
  },

  // ── 3. SFX-Driven ──────────────────────────────────────────────────
  {
    id: 'sfx_driven',
    name: 'SFX-Driven',
    description:
      'Uses sound effects as primary transitions and attention-grabbers. Music is minimal or ambient. Great for tech products, apps, and modern brands where sound design matters more than music.',
    segments: [
      {
        type: 'sfx_hit',
        label: 'Opening SFX',
        description: 'An attention-grabbing sound effect to open the ad (notification ping, futuristic swoosh, etc.).',
        durationRange: { min: 0.5, max: 1.5 },
        musicBehavior: 'none',
        required: true,
        transition: 'hard_cut',
      },
      {
        type: 'voiceover_with_music',
        label: 'Problem / Hook',
        description: 'Voice presents the problem or hook with subtle ambient music.',
        durationRange: { min: 4, max: 10 },
        musicBehavior: 'ducked',
        required: true,
        transition: 'hard_cut',
      },
      {
        type: 'sfx_hit',
        label: 'Transition SFX',
        description: 'A transition sound effect between problem and solution (whoosh, transform, click).',
        durationRange: { min: 0.3, max: 1 },
        musicBehavior: 'none',
        required: true,
        transition: 'hard_cut',
      },
      {
        type: 'voiceover_with_music',
        label: 'Solution / Product',
        description: 'Voice presents the solution/product with music slightly more present.',
        durationRange: { min: 5, max: 15 },
        musicBehavior: 'ducked',
        required: true,
        transition: 'natural',
      },
      {
        type: 'sfx_hit',
        label: 'Action SFX',
        description: 'A sound effect that reinforces the call to action (success chime, button click).',
        durationRange: { min: 0.3, max: 1 },
        musicBehavior: 'none',
        required: false,
        transition: 'hard_cut',
      },
      {
        type: 'voiceover_with_music',
        label: 'Call to Action',
        description: 'Voice delivers the CTA, music builds slightly.',
        durationRange: { min: 3, max: 8 },
        musicBehavior: 'building',
        required: true,
        transition: 'natural',
      },
    ],
    totalDurationRange: { min: 15, max: 45 },
    bestFor: [
      'tech products',
      'mobile apps',
      'SaaS',
      'modern/startup brands',
      'gaming',
    ],
    example:
      '[Notification ping] → "Tired of slow workflows?" → [Whoosh] → "Meet FlowApp..." → [Success chime] → "Download free today!"',
  },

  // ── 4. Storytelling ─────────────────────────────────────────────────
  {
    id: 'storytelling',
    name: 'Storytelling',
    description:
      'A narrative arc format: starts soft and atmospheric, builds emotion through the middle, reaches a climax, then resolves with a warm CTA. Great for emotional brands, healthcare, insurance, and premium products.',
    segments: [
      {
        type: 'voiceover_with_music',
        label: 'Scene Setting',
        description:
          'Voice sets the scene softly, with ambient/atmospheric music underneath. Draws the listener in.',
        durationRange: { min: 4, max: 12 },
        musicBehavior: 'ducked',
        required: true,
        transition: 'natural',
      },
      {
        type: 'voiceover_with_music',
        label: 'Rising Action',
        description: 'Voice builds the story/problem, music gradually increases in energy.',
        durationRange: { min: 5, max: 15 },
        musicBehavior: 'building',
        required: true,
        transition: 'natural',
      },
      {
        type: 'music_solo',
        label: 'Emotional Peak',
        description: 'A brief moment where music swells to its peak — the emotional climax before the resolution.',
        durationRange: { min: 1, max: 3 },
        musicBehavior: 'full',
        required: false,
        transition: 'duck_transition',
      },
      {
        type: 'voiceover_with_music',
        label: 'Resolution / CTA',
        description: 'Voice delivers the resolution and CTA warmly. Music resolves underneath.',
        durationRange: { min: 4, max: 10 },
        musicBehavior: 'resolving',
        required: true,
        transition: 'natural',
      },
      {
        type: 'music_solo',
        label: 'Warm Outro',
        description: 'Music fades to a gentle, warm ending.',
        durationRange: { min: 1, max: 3 },
        musicBehavior: 'resolving',
        required: true,
        transition: 'natural',
      },
    ],
    totalDurationRange: { min: 20, max: 60 },
    bestFor: [
      'healthcare',
      'insurance',
      'premium/luxury brands',
      'charity/non-profit',
      'emotional storytelling',
    ],
    example:
      '"Imagine waking up without worry..." [soft piano] → "Every day, thousands struggle..." [strings build] → [Music swells] → "That\'s why we created SafeGuard..." [music resolves] → [Gentle piano ending]',
  },

  // ── 5. High Energy Sale ─────────────────────────────────────────────
  {
    id: 'high_energy_sale',
    name: 'High Energy Sale',
    description:
      'Fast-paced, high-energy format for sales, promotions, and events. Quick cuts, SFX hits, music stays energetic throughout. Creates urgency.',
    segments: [
      {
        type: 'music_solo',
        label: 'Energy Burst Intro',
        description: 'High-energy music hook that immediately creates excitement.',
        durationRange: { min: 1.5, max: 3 },
        musicBehavior: 'full',
        required: true,
        transition: 'hard_cut',
      },
      {
        type: 'sfx_hit',
        label: 'Attention SFX',
        description: 'An urgent sound effect (alarm, horn, record scratch) to demand attention.',
        durationRange: { min: 0.3, max: 1 },
        musicBehavior: 'none',
        required: false,
        transition: 'hard_cut',
      },
      {
        type: 'voiceover_with_music',
        label: 'Headline / Offer',
        description: 'Voice announces the main offer/headline. Fast pace, high energy music underneath.',
        durationRange: { min: 3, max: 10 },
        musicBehavior: 'ducked',
        required: true,
        transition: 'hard_cut',
      },
      {
        type: 'sfx_hit',
        label: 'Deal SFX',
        description: 'SFX punctuating the deal/discount (cash register, explosion, whoosh).',
        durationRange: { min: 0.3, max: 0.8 },
        musicBehavior: 'none',
        required: true,
        transition: 'hard_cut',
      },
      {
        type: 'voiceover_with_music',
        label: 'Details / Urgency',
        description: 'Voice delivers deal details with urgency. Music stays high energy.',
        durationRange: { min: 4, max: 12 },
        musicBehavior: 'ducked',
        required: true,
        transition: 'natural',
      },
      {
        type: 'voiceover_with_music',
        label: 'Urgent CTA',
        description: 'Voice delivers urgent CTA. Music builds to peak.',
        durationRange: { min: 2, max: 6 },
        musicBehavior: 'building',
        required: true,
        transition: 'hard_cut',
      },
      {
        type: 'music_solo',
        label: 'Punchy Ending',
        description: 'Short, punchy music stinger to close with energy.',
        durationRange: { min: 0.5, max: 2 },
        musicBehavior: 'full',
        required: true,
        transition: 'natural',
      },
    ],
    totalDurationRange: { min: 15, max: 45 },
    bestFor: [
      'sales and promotions',
      'limited-time offers',
      'event announcements',
      'retail clearance',
      'festival sales',
    ],
    example:
      '[EDM drop] → [Air horn] → "MEGA SALE! 50% off everything!" → [Cash register] → "This weekend only..." → "Shop now at..." [music peaks] → [Stinger hit]',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Look up a built-in template by ID. Returns undefined if not found. */
export function getTemplateById(id: string): AdFormatTemplate | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id);
}

/** Get all template IDs. */
export function getTemplateIds(): string[] {
  return BUILTIN_TEMPLATES.map((t) => t.id);
}

/**
 * Build a compact summary of all available templates for the LLM prompt.
 * Keeps it concise so it doesn't blow up the token budget.
 */
export function getTemplateSummaryForPrompt(): string {
  return BUILTIN_TEMPLATES.map((t) => {
    const segmentSummary = t.segments
      .map((s) => `${s.label} (${s.type}, ${s.durationRange.min}-${s.durationRange.max}s)`)
      .join(' → ');
    return [
      `ID: "${t.id}" — ${t.name}`,
      `  Use for: ${t.bestFor.join(', ')}`,
      `  Flow: ${segmentSummary}`,
      t.example ? `  Example: ${t.example}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }).join('\n\n');
}

/**
 * Validate that a creative plan's segments are internally consistent:
 * - Duration sums to totalDuration (within tolerance)
 * - Each segment has the right layers for its type
 * - At least one voiceover segment exists
 */
export function validateCreativePlan(plan: AdCreativePlan): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check segment index ordering
  for (let i = 0; i < plan.segments.length; i++) {
    if (plan.segments[i].segmentIndex !== i) {
      errors.push(`Segment ${i} has segmentIndex=${plan.segments[i].segmentIndex}, expected ${i}`);
    }
  }

  // Check duration sum
  const durationSum = plan.segments.reduce((sum, s) => sum + s.duration, 0);
  const tolerance = 1.0; // 1 second tolerance for rounding
  if (Math.abs(durationSum - plan.totalDuration) > tolerance) {
    errors.push(
      `Segment durations sum to ${durationSum.toFixed(1)}s but totalDuration is ${plan.totalDuration}s`
    );
  }

  // Check that segment types have appropriate layers
  for (const seg of plan.segments) {
    switch (seg.type) {
      case 'music_solo':
        if (!seg.music) errors.push(`Segment "${seg.label}" is music_solo but has no music`);
        if (seg.voiceover) errors.push(`Segment "${seg.label}" is music_solo but has voiceover`);
        break;
      case 'voiceover_with_music':
        if (!seg.voiceover) errors.push(`Segment "${seg.label}" is voiceover_with_music but has no voiceover`);
        if (!seg.music) errors.push(`Segment "${seg.label}" is voiceover_with_music but has no music`);
        break;
      case 'voiceover_only':
        if (!seg.voiceover) errors.push(`Segment "${seg.label}" is voiceover_only but has no voiceover`);
        break;
      case 'sfx_hit':
        if (!seg.sfx) errors.push(`Segment "${seg.label}" is sfx_hit but has no sfx`);
        break;
      // silence: no layers required
    }
  }

  // Must have at least one voiceover segment
  const hasVoiceover = plan.segments.some(
    (s) => s.type === 'voiceover_with_music' || s.type === 'voiceover_only'
  );
  if (!hasVoiceover) {
    errors.push('Ad must have at least one voiceover segment');
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// OpenAI JSON Schema fragment (for structured output)
// ---------------------------------------------------------------------------

/** JSON schema for the adFormat field in the LLM response. */
export function getAdFormatJsonSchema(): Record<string, unknown> {
  return {
    type: ['object', 'null'],
    description:
      'Segment-based creative plan for the ad. Pick a template or use "custom". ' +
      'Each segment defines what audio layers are active (voice, music, SFX) and how they behave.',
    properties: {
      templateId: {
        type: 'string',
        description: `Template ID. One of: ${getTemplateIds().map((id) => `"${id}"`).join(', ')}, or "custom" for a freeform structure.`,
      },
      templateName: {
        type: 'string',
        description: 'Human-readable name of the chosen template or custom name.',
      },
      totalDuration: {
        type: 'number',
        description: 'Total ad duration in seconds. Must equal the sum of all segment durations.',
      },
      segments: {
        type: 'array',
        description: 'Ordered list of ad segments. Each segment specifies audio layers and their behavior.',
        items: {
          type: 'object',
          properties: {
            segmentIndex: { type: 'number', description: '0-based position in the ad' },
            type: {
              type: 'string',
              enum: AD_SEGMENT_TYPES as unknown as string[],
              description:
                'music_solo = music at full volume (no voice); voiceover_with_music = voice over background music; voiceover_only = voice only; sfx_hit = short sound effect; silence = intentional pause',
            },
            label: { type: 'string', description: 'Short descriptive label, e.g. "Punjabi dhol hook"' },
            duration: { type: 'number', description: 'Duration in seconds' },
            voiceover: {
              type: ['object', 'null'],
              description: 'Voice content for this segment. null if no voice.',
              properties: {
                text: { type: 'string', description: 'Script text with ElevenLabs audio tags' },
                voiceStyle: {
                  type: ['string', 'null'],
                  description: 'Voice delivery style: excited, warm, whisper, urgent, calm, etc.',
                },
              },
              required: ['text'],
              additionalProperties: false,
            },
            music: {
              type: ['object', 'null'],
              description: 'Music for this segment. null if no music.',
              properties: {
                description: { type: 'string', description: 'What the music should sound like' },
                behavior: {
                  type: 'string',
                  enum: MUSIC_BEHAVIORS as unknown as string[],
                  description: 'full = full volume; ducked = under voice; building = increasing; resolving = decreasing; accent = brief hit; none = silent',
                },
                volume: { type: 'number', description: 'Relative volume 0.0-1.0' },
                culturalStyle: {
                  type: ['string', 'null'],
                  description: 'Cultural music style hint, e.g. "Punjabi folk", "Latin jazz"',
                },
                instruments: {
                  type: ['array', 'null'],
                  description: 'Key instruments for this segment',
                  items: { type: 'string' },
                },
              },
              required: ['description', 'behavior', 'volume'],
              additionalProperties: false,
            },
            sfx: {
              type: ['object', 'null'],
              description: 'Sound effect for this segment. null if no SFX.',
              properties: {
                description: { type: 'string', description: 'What the SFX sounds like' },
                volume: { type: ['number', 'null'], description: 'Relative volume 0.0-1.0' },
              },
              required: ['description'],
              additionalProperties: false,
            },
            transition: {
              type: 'string',
              enum: SEGMENT_TRANSITIONS as unknown as string[],
              description: 'How this segment transitions to the next: crossfade, hard_cut, duck_transition, natural',
            },
            transitionDuration: {
              type: ['number', 'null'],
              description: 'Transition duration in seconds (for crossfade/duck)',
            },
          },
          required: ['segmentIndex', 'type', 'label', 'duration', 'voiceover', 'music', 'sfx', 'transition'],
          additionalProperties: false,
        },
      },
      overallMusicDirection: {
        type: 'string',
        description:
          'Overall music direction for the whole ad (genre, mood, BPM, cultural style). Used to generate the music track(s).',
      },
      culturalContext: {
        type: ['string', 'null'],
        description: 'Cultural context hint, e.g. "Punjabi folk with dhol and tumbi", "Brazilian samba"',
      },
    },
    required: ['templateId', 'templateName', 'totalDuration', 'segments', 'overallMusicDirection'],
    additionalProperties: false,
  };
}
