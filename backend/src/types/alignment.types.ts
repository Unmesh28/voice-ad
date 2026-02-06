/**
 * Canonical alignment format for TTM prompt builder, mix worker, and future consumers.
 * Populated after TTS from sentenceTimings, wordTimings, and music arc.
 */

export interface AlignmentWord {
  text: string;
  start: number;
  end: number;
  emphasis?: boolean;
}

export interface AlignmentSection {
  type: string;
  start: number;
  end: number;
  mood?: string;
}

export interface AlignmentPayload {
  total_duration_seconds: number;
  words: AlignmentWord[];
  sections: AlignmentSection[];
}
