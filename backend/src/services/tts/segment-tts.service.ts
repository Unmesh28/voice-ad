// ===========================================================================
// Per-Segment TTS Service
//
// When an ad uses the segment-based format (adFormat), this service generates
// TTS independently for each voiceover segment. This enables:
//
//   - Gaps between voice segments (for music breaks, SFX moments)
//   - Different voice styles per segment (whisper for intro, energetic for CTA)
//   - Per-segment sentence timings for precise music alignment
//
// The existing single-pass TTS flow remains untouched — this is a parallel
// capability the orchestrator can choose when adFormat is present.
// ===========================================================================

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../config/logger';
import elevenLabsService from './elevenlabs.service';
import type { ElevenLabsAlignment } from './elevenlabs.service';
import { alignmentToSentenceTimings, alignmentToWordTimings } from '../../utils/alignment-to-sentences';
import type { AdCreativeSegment } from '../../types/ad-format';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Voice style hints from adFormat segments, mapped to ElevenLabs settings. */
export interface VoiceStyleSettings {
  stability: number;
  similarity_boost: number;
  style: number;
  use_speaker_boost: boolean;
}

/** Input for generating TTS for all voiceover segments in an ad. */
export interface SegmentTTSInput {
  /** The adFormat segments (all of them — service filters to voiceover segments) */
  segments: AdCreativeSegment[];
  /** ElevenLabs voice ID to use */
  voiceId: string;
  /** Base voice settings (can be overridden per segment by voiceStyle) */
  baseVoiceSettings?: Partial<VoiceStyleSettings>;
}

/** Sentence timing within a single segment (offsets relative to segment start). */
export interface SegmentSentenceTiming {
  text: string;
  /** Offset from the start of THIS segment's audio (not the whole ad) */
  startSeconds: number;
  /** Offset from the start of THIS segment's audio */
  endSeconds: number;
}

/** Result for a single voiceover segment. */
export interface SegmentTTSResult {
  /** Index from the adFormat segment */
  segmentIndex: number;
  /** Label from the adFormat segment */
  segmentLabel: string;
  /** The voiceover text that was spoken */
  text: string;
  /** Voice style that was used */
  voiceStyle: string | null;
  /** Path to the audio file on disk */
  filePath: string;
  /** Audio data */
  audioBuffer: Buffer;
  /** Actual audio duration in seconds */
  duration: number;
  /** Sentence timings within this segment */
  sentenceTimings: SegmentSentenceTiming[];
  /** Word timings within this segment */
  wordTimings: { text: string; startSeconds: number; endSeconds: number }[];
}

/** Full result from generating TTS for all voiceover segments. */
export interface SegmentTTSBatchResult {
  /** Per-segment results, in segment order */
  segmentResults: SegmentTTSResult[];
  /** The full concatenated script text (all voiceover segments joined) */
  fullScriptText: string;
  /** Total voiceover duration (sum of all segment audio durations) */
  totalVoiceDuration: number;
  /** Total generation time in ms */
  totalTimeMs: number;
}

// ---------------------------------------------------------------------------
// Voice style mapping
//
// Maps the voiceStyle hints from adFormat segments to ElevenLabs settings.
// These are the same stability values that ElevenLabs v3 supports:
//   0.0 = Creative (most expressive, varied)
//   0.5 = Natural (balanced)
//   1.0 = Robust (most consistent, stable)
// ---------------------------------------------------------------------------

const VOICE_STYLE_PRESETS: Record<string, Partial<VoiceStyleSettings>> = {
  // High energy / expressive styles
  excited: { stability: 0.0, style: 0.8 },
  energetic: { stability: 0.0, style: 0.7 },
  urgent: { stability: 0.0, style: 0.6 },
  enthusiastic: { stability: 0.0, style: 0.7 },
  passionate: { stability: 0.0, style: 0.8 },

  // Balanced / natural styles
  warm: { stability: 0.5, style: 0.4 },
  friendly: { stability: 0.5, style: 0.5 },
  conversational: { stability: 0.5, style: 0.3 },
  confident: { stability: 0.5, style: 0.4 },
  professional: { stability: 0.5, style: 0.2 },
  natural: { stability: 0.5, style: 0.3 },

  // Calm / controlled styles
  calm: { stability: 1.0, style: 0.2 },
  soothing: { stability: 1.0, style: 0.3 },
  gentle: { stability: 1.0, style: 0.2 },
  whisper: { stability: 1.0, style: 0.1 },
  soft: { stability: 1.0, style: 0.2 },
  serious: { stability: 1.0, style: 0.1 },
  authoritative: { stability: 1.0, style: 0.2 },
};

/** Resolve a voiceStyle hint to ElevenLabs settings, merging with base settings. */
function resolveVoiceSettings(
  baseSettings: Partial<VoiceStyleSettings> | undefined,
  voiceStyle: string | null | undefined
): VoiceStyleSettings {
  const defaults: VoiceStyleSettings = {
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0.0,
    use_speaker_boost: true,
  };

  // Start with defaults, overlay base settings
  const resolved = { ...defaults, ...baseSettings };

  // If a voiceStyle hint is provided, overlay the preset
  if (voiceStyle) {
    const preset = VOICE_STYLE_PRESETS[voiceStyle.toLowerCase().trim()];
    if (preset) {
      Object.assign(resolved, preset);
    } else {
      logger.debug(`Unknown voiceStyle "${voiceStyle}", using base settings`);
    }
  }

  // Validate for ElevenLabs v3 — validateVoiceSettings returns optional fields,
  // but we know they'll always be filled, so re-apply our defaults as fallback
  const validated = elevenLabsService.validateVoiceSettings(resolved);
  return {
    stability: validated.stability ?? defaults.stability,
    similarity_boost: validated.similarity_boost ?? defaults.similarity_boost,
    style: validated.style ?? defaults.style,
    use_speaker_boost: validated.use_speaker_boost ?? defaults.use_speaker_boost,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class SegmentTTSService {
  /**
   * Generate TTS for all voiceover segments in an ad.
   *
   * Processes segments sequentially to:
   *   - Maintain consistent voice characteristics across segments
   *   - Avoid ElevenLabs rate limiting
   *   - Ensure predictable ordering of results
   */
  async generateForSegments(input: SegmentTTSInput): Promise<SegmentTTSBatchResult> {
    const startTime = Date.now();
    const { segments, voiceId, baseVoiceSettings } = input;

    // Filter to only voiceover segments
    const voiceoverSegments = segments.filter(
      (seg) =>
        (seg.type === 'voiceover_with_music' || seg.type === 'voiceover_only') &&
        seg.voiceover?.text
    );

    if (voiceoverSegments.length === 0) {
      logger.warn('No voiceover segments found in adFormat');
      return {
        segmentResults: [],
        fullScriptText: '',
        totalVoiceDuration: 0,
        totalTimeMs: 0,
      };
    }

    logger.info('Starting per-segment TTS generation', {
      totalSegments: segments.length,
      voiceoverSegments: voiceoverSegments.length,
      voiceId,
    });

    const segmentResults: SegmentTTSResult[] = [];
    let totalVoiceDuration = 0;

    // Generate TTS for each voiceover segment sequentially
    for (const segment of voiceoverSegments) {
      const voiceText = segment.voiceover!.text;
      const voiceStyle = segment.voiceover!.voiceStyle ?? null;

      // Resolve voice settings for this segment
      const settings = resolveVoiceSettings(baseVoiceSettings, voiceStyle);

      logger.info(`Generating TTS for segment ${segment.segmentIndex}: "${segment.label}"`, {
        textLength: voiceText.length,
        voiceStyle,
        stability: settings.stability,
      });

      const filename = `tts_seg${segment.segmentIndex}_${uuidv4().slice(0, 8)}.mp3`;

      let filePath: string;
      let audioBuffer: Buffer;
      let sentenceTimings: SegmentSentenceTiming[] = [];
      let wordTimings: { text: string; startSeconds: number; endSeconds: number }[] = [];
      let duration = 0;

      try {
        // Try with-timestamps first for alignment data
        const result = await elevenLabsService.generateSpeechWithTimestamps({
          voiceId,
          text: voiceText,
          voiceSettings: settings,
        });

        audioBuffer = result.audioBuffer;
        filePath = await elevenLabsService.saveAudioToFile(audioBuffer, filename);

        if (result.alignment) {
          sentenceTimings = alignmentToSentenceTimings(voiceText, result.alignment);
          wordTimings = alignmentToWordTimings(voiceText, result.alignment);
        }

        // Compute duration from alignment or estimate
        if (sentenceTimings.length > 0) {
          duration = sentenceTimings[sentenceTimings.length - 1].endSeconds;
        } else if (wordTimings.length > 0) {
          duration = wordTimings[wordTimings.length - 1].endSeconds;
        } else {
          duration = elevenLabsService.estimateAudioDuration(voiceText);
        }
      } catch (err: any) {
        // Fallback: standard TTS without timestamps
        logger.warn(
          `TTS with-timestamps failed for segment ${segment.segmentIndex}, falling back: ${err.message}`
        );
        const fallback = await elevenLabsService.generateAndSave(
          { voiceId, text: voiceText, voiceSettings: settings },
          filename
        );
        filePath = fallback.filePath;
        audioBuffer = fallback.audioBuffer;
        duration = elevenLabsService.estimateAudioDuration(voiceText);
      }

      totalVoiceDuration += duration;

      segmentResults.push({
        segmentIndex: segment.segmentIndex,
        segmentLabel: segment.label,
        text: voiceText,
        voiceStyle,
        filePath,
        audioBuffer,
        duration,
        sentenceTimings,
        wordTimings,
      });

      logger.info(
        `Segment ${segment.segmentIndex} TTS complete: ${duration.toFixed(1)}s, ` +
        `${sentenceTimings.length} sentences, style="${voiceStyle ?? 'default'}"`,
      );
    }

    const totalTimeMs = Date.now() - startTime;
    const fullScriptText = voiceoverSegments
      .map((seg) => seg.voiceover!.text)
      .join(' ');

    logger.info('Per-segment TTS generation complete', {
      segments: segmentResults.length,
      totalVoiceDuration: totalVoiceDuration.toFixed(1),
      totalTimeMs,
    });

    return {
      segmentResults,
      fullScriptText,
      totalVoiceDuration,
      totalTimeMs,
    };
  }

  /**
   * Compute the absolute timeline positions for each segment's voiceover,
   * given the full ad format segments and their durations.
   *
   * This maps per-segment-relative timings to absolute ad timeline positions
   * by accounting for non-voice segments (music breaks, SFX) in between.
   *
   * Returns an array of { segmentIndex, absoluteStart, absoluteEnd, sentenceTimings }
   * where sentenceTimings have absolute timestamps.
   */
  computeAbsoluteTimeline(
    allSegments: AdCreativeSegment[],
    segmentResults: SegmentTTSResult[]
  ): {
    segmentIndex: number;
    absoluteStart: number;
    absoluteEnd: number;
    sentenceTimings: { text: string; startSeconds: number; endSeconds: number }[];
  }[] {
    // Build a map of segment results by index
    const resultMap = new Map(segmentResults.map((r) => [r.segmentIndex, r]));

    // Walk through ALL segments to compute cumulative timeline
    let cursor = 0;
    const timeline: {
      segmentIndex: number;
      absoluteStart: number;
      absoluteEnd: number;
      sentenceTimings: { text: string; startSeconds: number; endSeconds: number }[];
    }[] = [];

    for (const seg of allSegments) {
      const result = resultMap.get(seg.segmentIndex);

      if (result) {
        // This is a voiceover segment — use actual audio duration
        const absoluteStart = cursor;
        const absoluteEnd = cursor + result.duration;

        // Convert segment-relative sentence timings to absolute
        const absoluteSentenceTimings = result.sentenceTimings.map((st) => ({
          text: st.text,
          startSeconds: absoluteStart + st.startSeconds,
          endSeconds: absoluteStart + st.endSeconds,
        }));

        timeline.push({
          segmentIndex: seg.segmentIndex,
          absoluteStart,
          absoluteEnd,
          sentenceTimings: absoluteSentenceTimings,
        });

        cursor = absoluteEnd;
      } else {
        // Non-voice segment (music break, SFX, silence) — advance by its planned duration
        cursor += seg.duration;
      }
    }

    return timeline;
  }
}

export default new SegmentTTSService();
