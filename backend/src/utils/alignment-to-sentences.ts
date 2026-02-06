/**
 * Derive sentence-level (and optional word-level) timings from ElevenLabs
 * character-level alignment so we can compose the ad sentence by sentence.
 */

import type { AlignmentPayload, AlignmentWord, AlignmentSection } from '../types/alignment.types';

export interface CharacterAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export interface SentenceTiming {
  text: string;
  startSeconds: number;
  endSeconds: number;
}

/** Word-level timing for hit points and precise sync (from character alignment). */
export interface WordTiming {
  text: string;
  startSeconds: number;
  endSeconds: number;
}

/**
 * Split script into sentences by common sentence-ending punctuation.
 * Keeps punctuation attached to the sentence. Handles tags like [excited] as part of text.
 */
export function splitIntoSentences(script: string): string[] {
  const trimmed = script.trim();
  if (!trimmed) return [];

  // Split on . ! ? when followed by space or end of string; keep the delimiter with the sentence
  const parts = trimmed.split(/(?<=[.!?])\s+/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * Map each sentence to its character range [startChar, endChar) in the original script.
 * Uses the exact script string so indices match ElevenLabs character alignment.
 */
function getSentenceRanges(script: string): { text: string; startChar: number; endChar: number }[] {
  const sentences = splitIntoSentences(script);
  const result: { text: string; startChar: number; endChar: number }[] = [];
  let pos = 0;

  for (const sent of sentences) {
    const idx = script.indexOf(sent, pos);
    if (idx === -1) {
      result.push({
        text: sent,
        startChar: pos,
        endChar: Math.min(pos + sent.length, script.length),
      });
      pos = Math.min(pos + sent.length, script.length);
    } else {
      result.push({
        text: sent,
        startChar: idx,
        endChar: idx + sent.length,
      });
      pos = idx + sent.length;
    }
  }
  return result;
}

/**
 * Convert ElevenLabs character alignment to sentence-level timings.
 * Uses alignment for the same text that was sent to TTS (script content).
 */
export function alignmentToSentenceTimings(
  script: string,
  alignment: CharacterAlignment | null | undefined
): SentenceTiming[] {
  if (!alignment?.characters?.length || !alignment.character_start_times_seconds?.length) {
    return [];
  }

  const chars = alignment.characters;
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;
  const len = Math.min(chars.length, starts.length, ends.length);
  if (len === 0) return [];

  const ranges = getSentenceRanges(script);
  const timings: SentenceTiming[] = [];

  for (const range of ranges) {
    const charStart = Math.max(0, Math.min(range.startChar, len - 1));
    const charEnd = Math.max(charStart, Math.min(range.endChar, len));
    if (charEnd <= charStart) {
      timings.push({
        text: range.text,
        startSeconds: starts[0] ?? 0,
        endSeconds: ends[0] ?? 0,
      });
      continue;
    }
    const startSeconds = starts[charStart] ?? 0;
    const endSeconds = ends[charEnd - 1] ?? startSeconds;
    timings.push({
      text: range.text,
      startSeconds,
      endSeconds,
    });
  }

  return timings;
}

/**
 * Convert ElevenLabs character alignment to word-level timings.
 * Splits script by whitespace and maps each word to start/end times from character alignment.
 */
export function alignmentToWordTimings(
  script: string,
  alignment: CharacterAlignment | null | undefined
): WordTiming[] {
  if (!alignment?.characters?.length || !alignment.character_start_times_seconds?.length) {
    return [];
  }

  const chars = alignment.characters;
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;
  const len = Math.min(chars.length, starts.length, ends.length);
  if (len === 0) return [];

  const words: WordTiming[] = [];
  let wordStartChar = -1;

  for (let i = 0; i <= len; i++) {
    const isSpace = i < len && /\s/.test(chars[i]);
    const atEnd = i === len;

    if (wordStartChar >= 0 && (isSpace || atEnd)) {
      const startSeconds = starts[wordStartChar] ?? 0;
      const endChar = atEnd ? len : i;
      const endSeconds = endChar > 0 ? (ends[endChar - 1] ?? startSeconds) : startSeconds;
      const text = chars
        .slice(wordStartChar, endChar)
        .join('')
        .trim();
      if (text.length > 0) {
        words.push({ text, startSeconds, endSeconds });
      }
      wordStartChar = -1;
    } else if (!isSpace && wordStartChar < 0) {
      wordStartChar = i;
    }
  }

  return words;
}

/**
 * Build canonical alignment payload for TTM builder and mix worker.
 * Uses word timings, optional arc for sections, and total duration.
 */
export function buildAlignmentPayload(
  wordTimings: WordTiming[],
  arc: { startSeconds: number; endSeconds: number; label: string; musicPrompt?: string }[] | null | undefined,
  totalDurationSeconds: number
): AlignmentPayload {
  const words: AlignmentWord[] = wordTimings.map((w) => ({
    text: w.text,
    start: w.startSeconds,
    end: w.endSeconds,
  }));

  let sections: AlignmentSection[] = [];
  if (Array.isArray(arc) && arc.length > 0) {
    sections = arc.map((seg) => ({
      type: seg.label,
      start: seg.startSeconds,
      end: seg.endSeconds,
      mood: seg.musicPrompt ? undefined : undefined,
    }));
  }

  const duration =
    totalDurationSeconds > 0
      ? totalDurationSeconds
      : words.length > 0
        ? words[words.length - 1].end
        : sections.length > 0
          ? sections[sections.length - 1].end
          : 0;

  return {
    total_duration_seconds: duration,
    words,
    sections,
  };
}
