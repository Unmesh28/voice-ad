// ===========================================================================
// SFX Generation Service
//
// Generates short sound effects for ad format segments. Uses ElevenLabs
// sound generation API under the hood, with a curated prompt library
// for consistent, professional-quality results.
//
// Flow:
//   1. Receive SFX description from ad format segment
//   2. Match against the curated library for an optimized prompt
//   3. If no match, use the raw description with safe defaults
//   4. Call ElevenLabs sound generation API
//   5. Save audio file and return result
//
// Supports batch generation for producing all SFX in an ad at once.
// ===========================================================================

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../config/logger';
import elevenlabsMusicService from '../music/elevenlabs-music.service';
import { findBestMatch } from './sfx-library';
import type {
  SfxGenerationInput,
  SfxGenerationResult,
  SfxBatchInput,
  SfxBatchResult,
  SfxCategory,
} from '../../types/sfx.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Max duration for SFX via ElevenLabs (API hard limit is 22s) */
const MAX_SFX_DURATION = 22;
/** Min duration for SFX */
const MIN_SFX_DURATION = 0.3;
/** Default prompt influence for SFX (slightly higher than music for precision) */
const DEFAULT_PROMPT_INFLUENCE = 0.5;
/** Max concurrent SFX generations in a batch */
const MAX_CONCURRENT_GENERATIONS = 3;

// ---------------------------------------------------------------------------
// Category inference
// ---------------------------------------------------------------------------

/** Infer an SFX category from a description when none is provided. */
function inferCategory(description: string): SfxCategory {
  const d = description.toLowerCase();

  if (/whoosh|swoosh|sweep|swipe|transition/.test(d)) return 'transition';
  if (/impact|hit|slam|boom|thud|punch/.test(d)) return 'impact';
  if (/ping|ding|chime|bell|alert|notification/.test(d)) return 'notification';
  if (/rain|wind|thunder|water|bird|nature|ocean/.test(d)) return 'nature';
  if (/click|gear|engine|machine|mechanical/.test(d)) return 'mechanical';
  if (/riser|stinger|drop|musical|orchestral/.test(d)) return 'musical';
  if (/crowd|applause|gasp|laugh|cheer/.test(d)) return 'human';
  if (/cash|money|coin|register|shopping|purchase/.test(d)) return 'commercial';
  if (/button|swipe|tap|ui|interface|digital/.test(d)) return 'ui';
  if (/confetti|firework|party|celebration|festive|horn/.test(d)) return 'celebration';

  return 'transition'; // safe default
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class SfxService {
  /**
   * Generate a single SFX from a description.
   *
   * Steps:
   *   1. Match description against the curated library
   *   2. If matched: use the library's optimized prompt, duration, and influence
   *   3. If not matched: use the raw description with safe defaults
   *   4. Call ElevenLabs sound generation
   *   5. Save to disk and return
   */
  async generate(input: SfxGenerationInput): Promise<SfxGenerationResult> {
    const { description, durationSeconds, segmentIndex, segmentLabel } = input;
    const category = input.category ?? inferCategory(description);

    // 1. Try library match
    const libraryMatch = findBestMatch(description);

    let prompt: string;
    let duration: number;
    let promptInfluence: number;
    let source: SfxGenerationResult['source'];

    if (libraryMatch) {
      prompt = libraryMatch.prompt;
      // Use input duration if provided, otherwise library recommendation
      duration = durationSeconds ?? libraryMatch.recommendedDuration;
      promptInfluence = input.promptInfluence ?? libraryMatch.recommendedInfluence;
      source = 'library_prompt';

      logger.info('SFX library match found', {
        description,
        matchId: libraryMatch.id,
        matchName: libraryMatch.name,
        segmentIndex,
      });
    } else {
      // No library match — use raw description as prompt
      prompt = this.buildPromptFromDescription(description, category);
      duration = durationSeconds ?? 1.0;
      promptInfluence = input.promptInfluence ?? DEFAULT_PROMPT_INFLUENCE;
      source = 'generated';

      logger.info('No SFX library match, using generated prompt', {
        description,
        resolvedPrompt: prompt,
        segmentIndex,
      });
    }

    // 2. Clamp duration
    duration = Math.max(MIN_SFX_DURATION, Math.min(MAX_SFX_DURATION, duration));

    // 3. Validate options via ElevenLabs service
    const validated = elevenlabsMusicService.validateOptions({
      text: prompt,
      duration_seconds: duration,
      prompt_influence: promptInfluence,
    });

    // 4. Generate audio
    const filename = `sfx_${segmentIndex ?? 'x'}_${uuidv4().slice(0, 8)}.mp3`;

    logger.info('Generating SFX', {
      prompt: validated.text.slice(0, 80),
      duration: validated.duration_seconds,
      influence: validated.prompt_influence,
      filename,
      segmentLabel,
    });

    const { filePath, audioBuffer } = await elevenlabsMusicService.generateAndSave(
      validated,
      filename
    );

    logger.info('SFX generated successfully', {
      filePath,
      audioSize: audioBuffer.length,
      duration: validated.duration_seconds,
      source,
      category,
      segmentIndex,
    });

    return {
      filePath,
      audioBuffer,
      duration: validated.duration_seconds!,
      resolvedPrompt: validated.text,
      source,
      category,
    };
  }

  /**
   * Generate multiple SFX in a batch (for all sfx_hit segments in an ad).
   * Runs up to MAX_CONCURRENT_GENERATIONS in parallel to stay within rate limits.
   */
  async generateBatch(input: SfxBatchInput): Promise<SfxBatchResult> {
    const startTime = Date.now();
    const { items, productionId } = input;

    logger.info('Starting SFX batch generation', {
      count: items.length,
      productionId,
    });

    const results: SfxGenerationResult[] = [];
    let succeeded = 0;
    let failed = 0;

    // Process in chunks to respect rate limits
    for (let i = 0; i < items.length; i += MAX_CONCURRENT_GENERATIONS) {
      const chunk = items.slice(i, i + MAX_CONCURRENT_GENERATIONS);
      const chunkResults = await Promise.allSettled(
        chunk.map((item) => this.generate(item))
      );

      for (const result of chunkResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
          succeeded++;
        } else {
          logger.error('SFX generation failed in batch', {
            error: result.reason?.message,
            productionId,
          });
          failed++;
          // Push a placeholder so indices stay aligned
          results.push({
            filePath: '',
            audioBuffer: Buffer.alloc(0),
            duration: 0,
            resolvedPrompt: '',
            source: 'generated',
            category: 'transition',
          });
        }
      }
    }

    const totalTimeMs = Date.now() - startTime;

    logger.info('SFX batch generation complete', {
      succeeded,
      failed,
      totalTimeMs,
      productionId,
    });

    return { results, totalTimeMs, succeeded, failed };
  }

  /**
   * Extract all SFX generation inputs from an ad creative plan's segments.
   * Extracts SFX from ANY segment that has a non-null sfx field with a
   * description — not just sfx_hit segments. This allows SFX overlays on
   * voiceover segments too (e.g. a cash register sound during the CTA).
   *
   * For sfx_hit segments, uses the segment duration as the SFX duration.
   * For other segment types (where SFX is an overlay), caps at 2s.
   */
  extractSfxFromAdFormat(segments: {
    segmentIndex: number;
    type: string;
    label: string;
    duration: number;
    sfx: { description: string; volume?: number | null } | null;
  }[]): SfxGenerationInput[] {
    return segments
      .filter((seg) => seg.sfx?.description)
      .map((seg) => ({
        description: seg.sfx!.description,
        // sfx_hit segments: use the full segment duration for the SFX
        // Other segment types: SFX is an overlay, cap at 2s
        durationSeconds: seg.type === 'sfx_hit' ? seg.duration : Math.min(seg.duration, 2),
        segmentIndex: seg.segmentIndex,
        segmentLabel: seg.label,
      }));
  }

  /**
   * Build a reasonable prompt from a raw description + category.
   * Adds "sound effect" framing so ElevenLabs generates a sound, not music.
   */
  private buildPromptFromDescription(description: string, category: SfxCategory): string {
    // Already has "sound" in it — don't double up
    const descLower = description.toLowerCase();
    if (descLower.includes('sound') || descLower.includes('sfx') || descLower.includes('effect')) {
      return description;
    }

    // Add "sound effect" framing based on category
    const categoryFraming: Record<SfxCategory, string> = {
      transition: 'transition sound effect',
      impact: 'impact sound effect, punchy and clean',
      notification: 'notification sound, digital and clean',
      nature: 'nature ambient sound',
      mechanical: 'mechanical sound effect',
      musical: 'musical sound effect, short and clean',
      human: 'human sound',
      commercial: 'commercial sound effect',
      ui: 'digital UI sound effect, clean and modern',
      celebration: 'celebration sound effect',
    };

    return `${description}, ${categoryFraming[category]}`;
  }
}

export default new SfxService();
