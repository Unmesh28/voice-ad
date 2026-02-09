// ===========================================================================
// Curated SFX Prompt Library
//
// Pre-tuned prompts for the ElevenLabs sound generation API. Each entry has:
//   - Keywords for matching against LLM-generated SFX descriptions
//   - An optimized prompt that produces consistently good results
//   - Recommended duration and prompt_influence settings
//
// Why a library?
//   - LLM descriptions ("transition sound") are often vague — we map them to
//     specific, tested prompts that sound professional
//   - ElevenLabs sound gen responds differently to prompt wording; these
//     prompts are tuned for the best output quality
//   - Consistent results across ads (same "whoosh" every time, not random)
// ===========================================================================

import type { SfxLibraryEntry, SfxCategory } from '../../types/sfx.types';

/** The full curated SFX library. */
export const SFX_LIBRARY: SfxLibraryEntry[] = [
  // ── TRANSITIONS ─────────────────────────────────────────────────────
  {
    id: 'whoosh_smooth',
    name: 'Smooth Whoosh',
    category: 'transition',
    keywords: ['whoosh', 'swoosh', 'swipe', 'sweep', 'fly by', 'pass by'],
    prompt: 'Fast smooth whoosh sound effect, clean air sweep from left to right, cinematic transition',
    recommendedDuration: 0.8,
    recommendedInfluence: 0.5,
  },
  {
    id: 'whoosh_heavy',
    name: 'Heavy Whoosh',
    category: 'transition',
    keywords: ['heavy whoosh', 'big swoosh', 'dramatic sweep', 'power whoosh'],
    prompt: 'Heavy dramatic whoosh with bass impact, powerful air sweep transition, cinematic',
    recommendedDuration: 1.0,
    recommendedInfluence: 0.5,
  },
  {
    id: 'reveal_shimmer',
    name: 'Shimmer Reveal',
    category: 'transition',
    keywords: ['reveal', 'shimmer', 'sparkle transition', 'magical reveal', 'unveil'],
    prompt: 'Bright shimmering reveal sound, sparkle and glisten, magical unveiling transition',
    recommendedDuration: 1.2,
    recommendedInfluence: 0.5,
  },
  {
    id: 'tape_rewind',
    name: 'Tape Rewind',
    category: 'transition',
    keywords: ['rewind', 'tape', 'record scratch', 'vinyl scratch', 'scratch'],
    prompt: 'Quick vinyl record scratch rewind sound effect, DJ turntable scratch',
    recommendedDuration: 0.8,
    recommendedInfluence: 0.6,
  },

  // ── IMPACTS ─────────────────────────────────────────────────────────
  {
    id: 'impact_deep',
    name: 'Deep Impact',
    category: 'impact',
    keywords: ['impact', 'hit', 'thud', 'boom', 'slam', 'punch', 'drop'],
    prompt: 'Deep cinematic impact hit with sub bass, powerful boom sound effect, clean and punchy',
    recommendedDuration: 1.0,
    recommendedInfluence: 0.5,
  },
  {
    id: 'impact_soft',
    name: 'Soft Impact',
    category: 'impact',
    keywords: ['soft impact', 'gentle hit', 'subtle thud', 'soft boom'],
    prompt: 'Soft subtle impact sound with gentle bass, understated hit, elegant transition punch',
    recommendedDuration: 0.8,
    recommendedInfluence: 0.4,
  },

  // ── NOTIFICATIONS ───────────────────────────────────────────────────
  {
    id: 'ping_bright',
    name: 'Bright Ping',
    category: 'notification',
    keywords: ['ping', 'notification', 'alert', 'message', 'app notification'],
    prompt: 'Bright clean notification ping sound, short digital alert tone, friendly and modern',
    recommendedDuration: 0.5,
    recommendedInfluence: 0.6,
  },
  {
    id: 'chime_gentle',
    name: 'Gentle Chime',
    category: 'notification',
    keywords: ['chime', 'bell', 'ding', 'tone', 'gentle alert'],
    prompt: 'Gentle bell chime sound, soft and warm ding, clean single tone notification',
    recommendedDuration: 0.8,
    recommendedInfluence: 0.5,
  },
  {
    id: 'success_chime',
    name: 'Success Chime',
    category: 'notification',
    keywords: ['success', 'complete', 'achievement', 'level up', 'done', 'correct'],
    prompt: 'Bright ascending success chime, two-tone positive completion sound, cheerful and clean',
    recommendedDuration: 0.8,
    recommendedInfluence: 0.6,
  },

  // ── COMMERCIAL ──────────────────────────────────────────────────────
  {
    id: 'cash_register',
    name: 'Cash Register',
    category: 'commercial',
    keywords: ['cash register', 'ka-ching', 'money', 'purchase', 'sale', 'buy', 'checkout', 'cha-ching'],
    prompt: 'Classic cash register ka-ching sound effect, metallic ring of a sale, bright and satisfying',
    recommendedDuration: 0.8,
    recommendedInfluence: 0.7,
  },
  {
    id: 'coin_drop',
    name: 'Coin Drop',
    category: 'commercial',
    keywords: ['coin', 'coins', 'dropping coins', 'savings', 'discount'],
    prompt: 'Coins dropping and clinking sound, metallic coin scatter on surface, satisfying money sound',
    recommendedDuration: 1.0,
    recommendedInfluence: 0.5,
  },
  {
    id: 'package_open',
    name: 'Package Opening',
    category: 'commercial',
    keywords: ['unbox', 'unwrap', 'package', 'open box', 'unboxing', 'packaging'],
    prompt: 'Satisfying package opening sound, cardboard box unboxing with tape pull, crisp and tactile',
    recommendedDuration: 1.5,
    recommendedInfluence: 0.5,
  },

  // ── MUSICAL ─────────────────────────────────────────────────────────
  {
    id: 'riser_cinematic',
    name: 'Cinematic Riser',
    category: 'musical',
    keywords: ['riser', 'build up', 'rising', 'tension', 'anticipation', 'build'],
    prompt: 'Cinematic tension riser sound, ascending pitch sweep building anticipation, dramatic',
    recommendedDuration: 2.0,
    recommendedInfluence: 0.5,
  },
  {
    id: 'stinger_hit',
    name: 'Stinger Hit',
    category: 'musical',
    keywords: ['stinger', 'music hit', 'accent', 'musical hit', 'orchestral hit', 'brass hit'],
    prompt: 'Short punchy orchestral stinger hit, powerful brass and percussion accent, dramatic',
    recommendedDuration: 1.0,
    recommendedInfluence: 0.5,
  },
  {
    id: 'sparkle_magic',
    name: 'Magic Sparkle',
    category: 'musical',
    keywords: ['sparkle', 'magic', 'twinkle', 'fairy', 'star', 'glitter', 'shimmer', 'shine'],
    prompt: 'Magical sparkle and twinkle sound effect, bright glittering fairy dust, enchanting and light',
    recommendedDuration: 1.0,
    recommendedInfluence: 0.5,
  },

  // ── CELEBRATION ─────────────────────────────────────────────────────
  {
    id: 'celebration_confetti',
    name: 'Confetti Pop',
    category: 'celebration',
    keywords: ['confetti', 'party', 'celebration', 'festive', 'pop', 'party popper'],
    prompt: 'Confetti party popper burst sound with light celebration, festive pop with streamer scatter',
    recommendedDuration: 1.0,
    recommendedInfluence: 0.5,
  },
  {
    id: 'firework_burst',
    name: 'Firework Burst',
    category: 'celebration',
    keywords: ['firework', 'fireworks', 'explosion', 'burst', 'bang'],
    prompt: 'Single firework launch and burst, rocket trail then sparkle explosion in the sky',
    recommendedDuration: 2.0,
    recommendedInfluence: 0.5,
  },
  {
    id: 'crowd_cheer',
    name: 'Crowd Cheer',
    category: 'human',
    keywords: ['crowd', 'cheer', 'applause', 'clap', 'audience', 'ovation'],
    prompt: 'Enthusiastic crowd cheer and applause, short burst of audience clapping and cheering',
    recommendedDuration: 2.0,
    recommendedInfluence: 0.5,
  },
  {
    id: 'horn_air',
    name: 'Air Horn',
    category: 'celebration',
    keywords: ['air horn', 'horn', 'airhorn', 'horn blast', 'alarm horn'],
    prompt: 'Loud air horn blast sound, single short stadium air horn, bold and attention-grabbing',
    recommendedDuration: 0.8,
    recommendedInfluence: 0.7,
  },

  // ── UI / DIGITAL ────────────────────────────────────────────────────
  {
    id: 'button_click',
    name: 'Button Click',
    category: 'ui',
    keywords: ['click', 'button', 'tap', 'press', 'touch', 'select'],
    prompt: 'Clean digital button click sound, crisp UI tap, modern app interface click',
    recommendedDuration: 0.3,
    recommendedInfluence: 0.6,
  },
  {
    id: 'swipe_digital',
    name: 'Digital Swipe',
    category: 'ui',
    keywords: ['swipe', 'slide', 'scroll', 'card swipe', 'phone swipe'],
    prompt: 'Smooth digital swipe gesture sound, clean sliding interface transition, modern UI',
    recommendedDuration: 0.5,
    recommendedInfluence: 0.5,
  },

  // ── MECHANICAL ──────────────────────────────────────────────────────
  {
    id: 'engine_rev',
    name: 'Engine Rev',
    category: 'mechanical',
    keywords: ['engine', 'rev', 'car', 'motor', 'vroom', 'accelerate', 'automotive'],
    prompt: 'Powerful car engine revving sound, sports car acceleration, deep throaty engine roar',
    recommendedDuration: 2.0,
    recommendedInfluence: 0.5,
  },
  {
    id: 'camera_shutter',
    name: 'Camera Shutter',
    category: 'mechanical',
    keywords: ['camera', 'shutter', 'photo', 'snapshot', 'picture', 'click camera'],
    prompt: 'Clean camera shutter click sound, DSLR photo capture, crisp mechanical click',
    recommendedDuration: 0.5,
    recommendedInfluence: 0.6,
  },

  // ── NATURE / AMBIENT ────────────────────────────────────────────────
  {
    id: 'thunder_rumble',
    name: 'Thunder Rumble',
    category: 'nature',
    keywords: ['thunder', 'storm', 'lightning', 'rumble'],
    prompt: 'Distant rolling thunder rumble, dramatic storm thunder sound, deep and powerful',
    recommendedDuration: 2.5,
    recommendedInfluence: 0.4,
  },
  {
    id: 'water_splash',
    name: 'Water Splash',
    category: 'nature',
    keywords: ['splash', 'water', 'drop', 'drip', 'liquid', 'pour'],
    prompt: 'Clean water splash sound, refreshing liquid splash, crisp and clear',
    recommendedDuration: 1.0,
    recommendedInfluence: 0.5,
  },
];

// ---------------------------------------------------------------------------
// Library helpers
// ---------------------------------------------------------------------------

/**
 * Find the best matching library entry for a given SFX description.
 * Uses keyword matching with scoring — more keyword matches = higher score.
 * Returns the best match or undefined if no keywords match.
 */
export function findBestMatch(description: string): SfxLibraryEntry | undefined {
  const descLower = description.toLowerCase();
  const descWords = descLower.split(/\s+/);

  let bestEntry: SfxLibraryEntry | undefined;
  let bestScore = 0;

  for (const entry of SFX_LIBRARY) {
    let score = 0;
    for (const keyword of entry.keywords) {
      const kwLower = keyword.toLowerCase();
      // Exact phrase match in the description (higher weight)
      if (descLower.includes(kwLower)) {
        score += 3;
      }
      // Individual word match (lower weight)
      else if (descWords.some((w) => kwLower.includes(w) || w.includes(kwLower))) {
        score += 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  // Require at least a score of 2 to avoid weak matches
  return bestScore >= 2 ? bestEntry : undefined;
}

/**
 * Get all entries in a category.
 */
export function getEntriesByCategory(category: SfxCategory): SfxLibraryEntry[] {
  return SFX_LIBRARY.filter((e) => e.category === category);
}

/**
 * Get all unique categories that have at least one entry.
 */
export function getAvailableCategories(): SfxCategory[] {
  return [...new Set(SFX_LIBRARY.map((e) => e.category))];
}
