import type {
  AdProductionMusic,
  AdProductionMusicArcSegment,
  AdProductionFades,
  AdProductionVolume,
  AdProductionSentenceCue,
  MixPreset,
} from '../../types/ad-production';

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
 * Build one composition prompt for all TTM providers (Suno and ElevenLabs).
 * Order: genre/BPM/mood first (never dropped when truncating for ElevenLabs), then composer direction, context, music prompt, arc, fades, volume, mixPreset, sentenceCues, closing.
 * Total capped at SUNO_STYLE_MAX (trim from end if over).
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

  // 1) Genre, BPM, mood first (critical for ElevenLabs truncation)
  sections.push(`genre: ${genre}. targetBPM: ${baseBPM}. mood: ${mood}.`);

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

  // 5) Music prompt (overall description)
  sections.push(
    `Music prompt: ${(music.prompt || '').trim() || 'Instrumental ad background.'}`
  );

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

  const fullStyle = sections.join(' ').replace(/\s+/g, ' ').trim().slice(0, SUNO_STYLE_MAX);
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
