import type {
  AdProductionMusic,
  AdProductionMusicArcSegment,
  AdProductionFades,
  AdProductionVolume,
  AdProductionSentenceCue,
  MixPreset,
} from '../../types/ad-production';
import { enrichPromptWithCulturalContext } from './cultural-templates';

/**
 * Single TTM (text-to-music) prompt builder for Suno and ElevenLabs.
 * Both providers receive the same composition; ElevenLabs gets it truncated to ELEVENLABS_MUSIC_PROMPT_MAX.
 * Order is chosen so genre, BPM, mood, and composer direction come first and are never dropped when truncated.
 */

const SUNO_TITLE_MAX = 80;
const SUNO_STYLE_MAX = 1000; // V5 custom mode
const SUNO_PROMPT_NON_CUSTOM_MAX = 500;

/** Max prompt length for ElevenLabs Music API; use when passing same composition as Suno. */
export const ELEVENLABS_MUSIC_PROMPT_MAX = 450;

export interface SunoPromptResult {
  /** Use Suno custom mode with style + title (full composition brief). */
  customMode: boolean;
  /** Required when customMode: true. Max 80 chars. */
  title: string;
  /** Full composition prompt (same for Suno and ElevenLabs). Suno: up to SUNO_STYLE_MAX; ElevenLabs: truncate to ELEVENLABS_MUSIC_PROMPT_MAX. */
  style: string;
  /** For non-custom mode: single prompt, max 500 chars. */
  prompt: string;
}

/** Ad context (from LLM) passed to TTM for full composer data. */
export interface AdContextForMusic {
  adCategory: string;
  tone: string;
  emotion: string;
  pace: string;
}

// ---------------------------------------------------------------------------
// Harmonic defaults — genre-appropriate keys and chord progressions
// ---------------------------------------------------------------------------

/** Infer a time signature for a genre. Most ad music is 4/4,
 *  but some cultural genres use compound meters (6/8, 3/4). */
export function inferTimeSignature(genre: string): '4/4' | '3/4' | '6/8' | '7/8' | '12/8' {
  const g = genre.toLowerCase();
  if (/waltz|viennese/i.test(g)) return '3/4';
  if (/celtic|irish|jig|scottish/i.test(g)) return '6/8';
  if (/afrobeat|shuffle|blues.*shuffle|swing/i.test(g)) return '12/8';
  if (/balkan|klezmer/i.test(g)) return '7/8';
  return '4/4';
}

/** Infer a default key when the LLM doesn't provide one. */
export function inferKeyForGenre(genre: string, mood: string): string {
  const g = genre.toLowerCase();
  const m = mood.toLowerCase();

  // Minor keys for darker/emotional moods
  if (/sad|melanchol|dark|dramatic|tense|suspense/i.test(m)) {
    if (/cinematic|epic|film/i.test(g)) return 'D minor';
    return 'A minor';
  }

  // Genre-specific defaults
  if (/jazz|soul|r&b/i.test(g)) return 'Bb major';
  if (/rock|punk|metal/i.test(g)) return 'E major';
  if (/edm|electronic|dance|techno/i.test(g)) return 'F minor';
  if (/folk|acoustic|country/i.test(g)) return 'G major';
  if (/hip.?hop|trap|rap/i.test(g)) return 'C minor';
  if (/latin|reggaeton|salsa/i.test(g)) return 'A minor';
  if (/indian|punjabi|bollywood|bhangra/i.test(g)) return 'D major';
  if (/cinematic|orchestral|epic/i.test(g)) return 'D major';

  // Bright/upbeat = major, else major default
  return 'C major';
}

/** Infer a chord progression hint based on genre. */
export function inferChordProgression(genre: string, mood: string): string {
  const g = genre.toLowerCase();
  const m = mood.toLowerCase();

  if (/sad|melanchol|emotional/i.test(m)) return 'i-III-VII-VI progression';
  if (/jazz|soul/i.test(g)) return 'ii-V-I progression';
  if (/rock|punk/i.test(g)) return 'I-IV-V power progression';
  if (/edm|dance|electronic/i.test(g)) return 'i-VI-III-VII progression';
  if (/pop|corporate|upbeat|bright/i.test(`${g} ${m}`)) return 'I-V-vi-IV progression';
  if (/cinematic|epic/i.test(g)) return 'I-IV-vi-V progression';
  if (/hip.?hop|trap/i.test(g)) return 'i-iv-VI-V progression';

  return 'I-IV-V-I progression'; // Classic resolution, universally safe
}

/** TTS-derived timing per sentence (from alignment-to-sentences). */
export interface SentenceTiming {
  text: string;
  startSeconds: number;
  endSeconds: number;
}

/** Full script-analysis context used to build the Suno composition prompt. */
export interface ScriptAnalysisForMusic {
  music: AdProductionMusic;
  durationSeconds: number;
  context?: AdContextForMusic | null;
  fades?: AdProductionFades | null;
  volume?: AdProductionVolume | null;
  mixPreset?: MixPreset | null;
  sentenceCues?: AdProductionSentenceCue[] | null;
  /** When present with sentenceCues, build timestamped Sentences block (aligned by index). */
  sentenceTimings?: SentenceTiming[] | null;
}

/**
 * Build prompt text with priority-based truncation.
 * Sections are ordered by priority (index 0 = highest priority).
 * When the total exceeds maxLen, drop sections from the END first
 * (lowest priority). The closing instruction (last section) is always
 * kept if possible since it contains critical "instrumental, no vocals".
 */
function buildWithPriorityTruncation(sections: string[], maxLen: number): string {
  const full = sections.join(' ').replace(/\s+/g, ' ').trim();
  if (full.length <= maxLen) return full;

  // Always keep the first 3 sections (genre/BPM/key, instrumentation, direction)
  // and the last section (closing instructions). Drop from middle-end.
  const mustKeepHead = sections.slice(0, 3);
  const mustKeepTail = sections.slice(-1);
  const droppable = sections.slice(3, -1); // ordered low→high priority for dropping

  let result = [...mustKeepHead, ...mustKeepTail].join(' ').replace(/\s+/g, ' ').trim();

  // Add droppable sections in order (highest priority first = lowest index)
  for (const section of droppable) {
    const candidate = [...mustKeepHead, section, ...mustKeepTail].join(' ').replace(/\s+/g, ' ').trim();
    if (candidate.length <= maxLen) {
      // Insert before the tail
      mustKeepHead.push(section);
      result = candidate;
    } else {
      // This section doesn't fit — stop adding more (they'd be even lower priority)
      break;
    }
  }

  return result.slice(0, maxLen);
}

/**
 * Build one composition prompt for all TTM providers (Suno and ElevenLabs).
 * Sections are ordered by priority: genre/BPM/key (P1) → instrumentation (P2) →
 * direction (P3) → context/prompt/arc (P4) → fades/volume/cues (P5) → closing (P6).
 * When over SUNO_STYLE_MAX, lowest-priority sections are dropped first.
 */
export function buildSunoPromptFromScriptAnalysis(
  input: ScriptAnalysisForMusic
): SunoPromptResult {
  const { music, durationSeconds, context, fades, volume, mixPreset, sentenceCues, sentenceTimings } = input;
  const genre = music.genre || 'corporate';
  const mood = music.mood || 'professional';
  const baseBPM = music.targetBPM ?? 100;

  const arc = music.arc?.filter(
    (s): s is AdProductionMusicArcSegment =>
      typeof s.startSeconds === 'number' &&
      typeof s.endSeconds === 'number' &&
      s.endSeconds > s.startSeconds &&
      typeof s.musicPrompt === 'string' &&
      s.musicPrompt.length > 0
  );
  const hasArc = Array.isArray(arc) && arc.length >= 2;

  const sections: string[] = [];

  // 1) Genre, BPM, mood, key, chords, time signature first (critical — never truncated)
  const key = (music as any).musicalStructure?.keySignature || inferKeyForGenre(genre, mood);
  const chords = inferChordProgression(genre, mood);
  const timeSig = inferTimeSignature(genre);
  const timeSigNote = timeSig !== '4/4' ? ` Time signature: ${timeSig}.` : '';
  sections.push(`genre: ${genre}. targetBPM: ${baseBPM}. mood: ${mood}. Key: ${key}. ${chords}.${timeSigNote} Maintain consistent melodic motif throughout.`);

  // 2) Instrumentation (drums, bass, mids, effects) - leave 1-4kHz clear for voice
  if (music.instrumentation) {
    const inst = music.instrumentation;
    sections.push(
      `Instrumentation (voice-supportive, leaves 1-4kHz clear): drums: ${inst.drums}. bass: ${inst.bass}. mids: ${inst.mids}. effects: ${inst.effects}.`
    );
  }

  // 3) Composer direction (narrative to music generator - emphasizes flow and pacing)
  if (music.composerDirection && music.composerDirection.trim()) {
    sections.push(`Direction: ${music.composerDirection.trim()}`);
  }

  // 4) Ad context (category, tone, emotion, pace)
  if (context) {
    sections.push(
      `Ad context: ${context.adCategory}, ${context.tone}, ${context.emotion}, pace ${context.pace}. Duration ${durationSeconds}s.`
    );
  }

  // 5) Music prompt (overall description, enriched with cultural context)
  const rawMusicPrompt = (music.prompt || '').trim() || 'Instrumental ad background.';
  const culturalContext = (music as any).culturalStyle || (context as any)?.culturalContext || null;
  const enrichedMusicPrompt = enrichPromptWithCulturalContext(rawMusicPrompt, genre, culturalContext);
  sections.push(`Music prompt: ${enrichedMusicPrompt}`);

  // 6) Arc: every segment with startSeconds, endSeconds, label, musicPrompt, targetBPM, energyLevel
  // CRITICAL: Emphasize smooth transitions and continuous flow between sections
  if (hasArc && arc) {
    const arcLines = arc.map((seg, idx) => {
      const start = Math.max(0, seg.startSeconds);
      const end = Math.min(durationSeconds, seg.endSeconds);
      const bpm = seg.targetBPM ?? baseBPM;
      const energy = seg.energyLevel ?? 5;
      const desc = seg.musicPrompt.trim();
      const transitionNote = idx < arc.length - 1 ? 'smooth transition to next section' : 'clean ending';
      return `[${start}-${end}s] ${seg.label}: ${desc}. ${bpm} BPM, energy ${energy}/10. ${transitionNote}`;
    });
    sections.push(`Musical arc (continuous flow, no abrupt changes): ${arcLines.join(' → ')}`);
  }

  // 7) Fades
  if (fades) {
    const fi = fades.fadeInSeconds ?? 0.1;
    const fo = fades.fadeOutSeconds ?? 0.4;
    const curve = fades.curve || 'exp';
    sections.push(`Fades: fadeInSeconds: ${fi}, fadeOutSeconds: ${fo}, curve: ${curve}.`);
  }

  // 8) Volume
  if (volume) {
    const volParts: string[] = [];
    volParts.push(`voiceVolume: ${volume.voiceVolume}, musicVolume: ${volume.musicVolume}`);
    if (volume.segments?.length) {
      const segStr = volume.segments
        .map(
          (s) =>
            `[${s.startSeconds}-${s.endSeconds}s] type: ${s.type}${s.intensity ? `, intensity: ${s.intensity}` : ''}`
        )
        .join('; ');
      volParts.push(`segments: ${segStr}`);
    }
    sections.push(`Volume: ${volParts.join('. ')}`);
  }

  // 9) Mix preset
  if (mixPreset) {
    sections.push(
      `mixPreset: ${mixPreset}${mixPreset === 'voiceProminent' ? ' (voice prominent, music under)' : mixPreset === 'musicEmotional' ? ' (music more present)' : ' (balanced)'}.`
    );
  }

  // 10) Sentence cues: timestamped when sentenceTimings available, else index-based
  const hasTimings =
    Array.isArray(sentenceTimings) &&
    sentenceTimings.length > 0 &&
    Array.isArray(sentenceCues) &&
    sentenceCues.length > 0;
  if (hasTimings && sentenceTimings && sentenceCues) {
    const sentenceParts: string[] = [];
    const cueByIndex = new Map(sentenceCues.map((c) => [c.index, c]));
    for (let i = 0; i < sentenceTimings.length; i++) {
      const t = sentenceTimings[i];
      const cue = cueByIndex.get(i);
      const start = Math.max(0, t.startSeconds);
      const end = Math.min(durationSeconds, t.endSeconds);
      const label = cue?.musicCue ?? `s${i}`;
      const vol =
        cue?.musicVolumeMultiplier != null ? ` vol ${cue.musicVolumeMultiplier}` : '';
      const dir =
        cue?.musicDirection && cue.musicDirection.trim()
          ? ` ${cue.musicDirection.trim()}`
          : '';
      sentenceParts.push(`[${start}-${end}s] ${label}${vol}${dir}`);
    }
    if (sentenceParts.length > 0) {
      sections.push(`Sentences: ${sentenceParts.join('; ')}`);
    }
  } else if (Array.isArray(sentenceCues) && sentenceCues.length > 0) {
    const cueParts = sentenceCues.map((c) => {
      const mult = c.musicVolumeMultiplier != null ? ` volMult:${c.musicVolumeMultiplier}` : '';
      return c.musicCue ? `s${c.index}:${c.musicCue}${mult}` : `s${c.index}${mult}`;
    });
    sections.push(`SentenceCues: ${cueParts.join(', ')}`);
  }

  // 11) Button ending specification (professional ad standard: no fade-outs)
  if (music.buttonEnding) {
    const timing = music.buttonEnding.timing ? ` timing: ${music.buttonEnding.timing}` : '';
    const desc = music.buttonEnding.description ? ` - ${music.buttonEnding.description}` : '';
    sections.push(`ButtonEnding: ${music.buttonEnding.type}${timing}${desc}. CLEAN ENDING, NO FADE-OUT.`);
  }

  // Critical instructions for continuity and flow
  sections.push('IMPORTANT: Continuous flowing music, no abrupt breaks or stops. Music must adapt to speech pacing and natural pauses. Smooth tempo transitions between sections. Instrumental only, no vocals. Professional ad background that supports voice without competing.');

  // Priority-based truncation: sections are ordered by priority (index 0 = highest).
  // When total exceeds SUNO_STYLE_MAX, drop from the end (lowest priority first).
  // This ensures genre/BPM/key/instrumentation/direction are never lost, while
  // sentence cues and volume metadata are dropped first.
  const fullStyle = buildWithPriorityTruncation(sections, SUNO_STYLE_MAX);
  const title = `Ad ${durationSeconds}s ${genre}`.slice(0, SUNO_TITLE_MAX);

  const hasMusicAnalysis =
    (music.prompt && music.prompt.trim()) ||
    hasArc ||
    (music.composerDirection && music.composerDirection.trim());

  if (hasMusicAnalysis) {
    return {
      customMode: true,
      title,
      style: fullStyle,
      prompt: '',
    };
  }

  const prompt = [
    music.prompt,
    `targetBPM ${baseBPM}`,
    genre,
    mood,
    'instrumental',
    'no vocals',
    'ad background',
  ]
    .filter(Boolean)
    .join(', ');
  return {
    customMode: false,
    title: '',
    style: '',
    prompt: prompt.slice(0, SUNO_PROMPT_NON_CUSTOM_MAX),
  };
}

/**
 * Build a Suno payload from a MusicalBlueprint.
 *
 * When a blueprint is available (Tier 2), use this instead of
 * buildSunoPromptFromScriptAnalysis. The blueprint's compositionPrompt
 * is already bar-based (not timestamp-based), which produces better
 * musical structure from Suno.
 */
export function buildSunoPromptFromBlueprint(
  blueprint: { compositionPrompt: string; finalBPM: number; totalBars: number; totalDuration: number },
  genre: string,
  durationSeconds: number
): SunoPromptResult {
  const title = `Ad ${Math.round(durationSeconds)}s ${genre}`.slice(0, SUNO_TITLE_MAX);
  const style = blueprint.compositionPrompt.slice(0, SUNO_STYLE_MAX);

  return {
    customMode: true,
    title,
    style,
    prompt: '',
  };
}

/**
 * @deprecated Use buildSunoPromptFromScriptAnalysis for full script analysis.
 * Kept for backward compatibility.
 */
export function buildSunoPromptFromArc(
  music: AdProductionMusic,
  durationSeconds: number
): SunoPromptResult {
  return buildSunoPromptFromScriptAnalysis({
    music,
    durationSeconds,
  });
}
