/**
 * Musical Blueprint Service
 *
 * After TTS generates voice with timestamps, this service creates a precise
 * musical plan with bar/beat alignment -- like a human composer spotting
 * music to a voice-over.
 *
 * The blueprint tells us:
 *   - Exact BPM (fine-tuned for bar alignment)
 *   - How many bars, where sections fall
 *   - Sync points (voice landmarks → nearest downbeats)
 *   - A bar-based composition prompt for Suno (not timestamp-based)
 */

import {
  buildBarGrid,
  calculatePrePostRoll,
  optimizeBPMForDuration,
  nearestDownbeat,
  generateDownbeats,
  type TimeSignature,
} from '../../utils/musical-timing';
import { logger } from '../../config/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SentenceTiming {
  text: string;
  startSeconds: number;
  endSeconds: number;
}

export interface EmotionalBeat {
  index: number;
  musicCue?: string | null;
  musicVolumeMultiplier?: number | null;
  musicDirection?: string | null;
}

export interface BlueprintInput {
  /** The ad script text */
  script: string;
  /** Sentence-level timings from TTS alignment */
  sentenceTimings: SentenceTiming[];
  /** Per-sentence music cues from LLM */
  sentenceCues?: EmotionalBeat[] | null;
  /** LLM-suggested BPM */
  targetBPM: number;
  /** Music genre */
  genre: string;
  /** Music mood */
  mood: string;
  /** Total voice audio duration in seconds */
  totalVoiceDuration: number;
  /** LLM composer direction (free-text) */
  composerDirection?: string | null;
  /** LLM instrumentation */
  instrumentation?: {
    drums: string;
    bass: string;
    mids: string;
    effects: string;
  } | null;
  /** LLM arc segments (informational, used to enrich section labels) */
  arc?: {
    startSeconds: number;
    endSeconds: number;
    label: string;
    musicPrompt: string;
    targetBPM?: number | null;
    energyLevel?: number | null;
  }[] | null;
  /** Button ending preference from LLM */
  buttonEnding?: {
    type: string;
    timing?: string | null;
    description?: string | null;
  } | null;
  /** Time signature (almost always 4/4 for ads) */
  timeSignature?: TimeSignature;
}

export interface MusicalSection {
  name: string;
  startBar: number;
  endBar: number;
  startTime: number;
  endTime: number;
  energyLevel: number;
  dynamicDirection: 'building' | 'sustaining' | 'resolving' | 'peak';
  instrumentationNotes: string;
  voiceSentences: number[];
}

export interface MusicalSyncPoint {
  type: 'brand_mention' | 'key_benefit' | 'emotional_peak' | 'cta_start' | 'final_word' | 'sentence_start';
  voiceTimestamp: number;
  nearestDownbeat: number;
  bar: number;
  beat: number;
  offset: number;
  musicAction: string;
}

export interface MixingPlan {
  voiceDelaySeconds: number;
  musicTrimDuration: number;
  suggestedDuckingPoints: { startTime: number; endTime: number }[];
}

export interface MusicalBlueprint {
  finalBPM: number;
  timeSignature: TimeSignature;
  barDuration: number;
  totalBars: number;
  totalDuration: number;

  preRollBars: number;
  preRollDuration: number;
  postRollBars: number;
  postRollDuration: number;
  voiceEntryPoint: number;

  sections: MusicalSection[];
  syncPoints: MusicalSyncPoint[];

  /** Bar-based composition prompt for Suno */
  compositionPrompt: string;

  mixingPlan: MixingPlan;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Classify a sentence's musical function based on its cue and position */
function classifySentenceFunction(
  cue: EmotionalBeat | undefined,
  index: number,
  total: number
): { energy: number; direction: MusicalSection['dynamicDirection']; label: string } {
  const position = total > 1 ? index / (total - 1) : 0.5;

  // Use the cue's musicCue label if available
  const cueName = (cue?.musicCue || '').toLowerCase();

  if (cueName.includes('hook') || cueName.includes('intro')) {
    return { energy: 4, direction: 'building', label: 'hook' };
  }
  if (cueName.includes('peak') || cueName.includes('climax')) {
    return { energy: 8, direction: 'peak', label: 'peak' };
  }
  if (cueName.includes('cta') || cueName.includes('call')) {
    return { energy: 6, direction: 'resolving', label: 'cta' };
  }
  if (cueName.includes('warm') || cueName.includes('resolve')) {
    return { energy: 5, direction: 'resolving', label: 'resolution' };
  }
  if (cueName.includes('build') || cueName.includes('swell')) {
    return { energy: 6, direction: 'building', label: 'build' };
  }

  // Fallback: use position in the script as a proxy for energy arc
  if (position < 0.15) return { energy: 4, direction: 'building', label: 'opening' };
  if (position < 0.5) return { energy: 6, direction: 'building', label: 'body' };
  if (position < 0.75) return { energy: 7, direction: 'peak', label: 'peak' };
  if (position < 0.9) return { energy: 5, direction: 'resolving', label: 'resolution' };
  return { energy: 5, direction: 'resolving', label: 'cta' };
}

/** Find significant pauses between sentences (> threshold) */
function findPauses(
  timings: SentenceTiming[],
  thresholdSeconds: number = 0.4
): { afterSentence: number; duration: number }[] {
  const pauses: { afterSentence: number; duration: number }[] = [];
  for (let i = 0; i < timings.length - 1; i++) {
    const gap = timings[i + 1].startSeconds - timings[i].endSeconds;
    if (gap >= thresholdSeconds) {
      pauses.push({ afterSentence: i, duration: gap });
    }
  }
  return pauses;
}

/** Snap a bar number to the nearest phrase boundary (multiple of phraseLength) */
function snapToPhrase(bar: number, phraseLength: number = 4): number {
  return Math.max(1, Math.round(bar / phraseLength) * phraseLength);
}

/** Detect likely CTA or brand mentions by simple keyword matching */
function detectLandmarks(
  timings: SentenceTiming[]
): { index: number; type: MusicalSyncPoint['type'] }[] {
  const landmarks: { index: number; type: MusicalSyncPoint['type'] }[] = [];
  const ctaKeywords = /\b(try|get|start|order|call|visit|download|sign up|subscribe|buy|shop|join|click|act now|don't miss|hurry)\b/i;
  const brandKeywords = /\b(welcome to|introducing|meet|discover|from)\b/i;

  for (let i = 0; i < timings.length; i++) {
    const text = timings[i].text;
    if (brandKeywords.test(text) && i < timings.length * 0.4) {
      landmarks.push({ index: i, type: 'brand_mention' });
    }
    if (ctaKeywords.test(text) && i >= timings.length * 0.6) {
      landmarks.push({ index: i, type: 'cta_start' });
    }
  }

  // Last sentence is always "final_word"
  if (timings.length > 0) {
    landmarks.push({ index: timings.length - 1, type: 'final_word' });
  }

  return landmarks;
}

// ---------------------------------------------------------------------------
// Main Blueprint Generation
// ---------------------------------------------------------------------------

export function generateMusicalBlueprint(input: BlueprintInput): MusicalBlueprint {
  const {
    sentenceTimings,
    sentenceCues,
    targetBPM,
    genre,
    mood,
    totalVoiceDuration,
    composerDirection,
    instrumentation,
    arc,
    buttonEnding,
  } = input;
  const ts: TimeSignature = input.timeSignature || '4/4';

  // 1. Calculate pre/post roll
  const prePost = calculatePrePostRoll(totalVoiceDuration, targetBPM, {
    genre,
    adDuration: totalVoiceDuration,
    timeSignature: ts,
  });

  // 2. Total target duration = pre-roll + voice + post-roll
  const totalTargetDuration = prePost.totalMusicDuration;

  // 3. Fine-tune BPM for best bar alignment
  const optimized = optimizeBPMForDuration(targetBPM, totalTargetDuration, {
    bpmRange: 5,
    timeSignature: ts,
  });

  const finalBPM = optimized.bpm;
  const grid = buildBarGrid(finalBPM, totalTargetDuration, ts);
  const barDuration = grid.barDuration;

  // Recalculate pre/post roll with the fine-tuned BPM
  const prePostFinal = calculatePrePostRoll(totalVoiceDuration, finalBPM, {
    genre,
    adDuration: totalVoiceDuration,
    timeSignature: ts,
  });

  const totalBars = grid.totalBars;
  const totalDuration = grid.totalDuration;
  const preRollDuration = prePostFinal.preRollDuration;
  const preRollBars = prePostFinal.preRollBars;
  const postRollBars = prePostFinal.postRollBars;
  const postRollDuration = prePostFinal.postRollDuration;
  const voiceEntryPoint = preRollDuration;

  // 4. Map sentences to bar grid
  const cueByIndex = new Map((sentenceCues || []).map((c) => [c.index, c]));
  const sentenceBarMap: {
    index: number;
    startBar: number;
    endBar: number;
    classification: ReturnType<typeof classifySentenceFunction>;
  }[] = [];

  for (let i = 0; i < sentenceTimings.length; i++) {
    const t = sentenceTimings[i];
    const absStart = preRollDuration + t.startSeconds;
    const absEnd = preRollDuration + t.endSeconds;
    const startBar = Math.max(1, Math.floor(absStart / barDuration) + 1);
    const endBar = Math.max(startBar, Math.ceil(absEnd / barDuration));
    const cue = cueByIndex.get(i);
    const classification = classifySentenceFunction(cue, i, sentenceTimings.length);
    sentenceBarMap.push({ index: i, startBar, endBar, classification });
  }

  // 5. Build sections by grouping sentences with similar classification + pause boundaries
  const pauses = findPauses(sentenceTimings, 0.4);
  const pauseAfterSet = new Set(pauses.map((p) => p.afterSentence));

  const sections: MusicalSection[] = [];

  // Pre-roll section (intro)
  const introEnergy = arc?.[0]?.energyLevel ?? 3;
  sections.push({
    name: 'intro',
    startBar: 1,
    endBar: preRollBars,
    startTime: 0,
    endTime: preRollDuration,
    energyLevel: introEnergy,
    dynamicDirection: 'building',
    instrumentationNotes: instrumentation
      ? `${instrumentation.mids}, ${instrumentation.effects}. No drums yet.`
      : 'Soft intro, building anticipation.',
    voiceSentences: [],
  });

  // Voice sections: group by classification label + pause breaks
  let currentGroup: typeof sentenceBarMap = [];
  const groups: (typeof sentenceBarMap)[] = [];

  for (let i = 0; i < sentenceBarMap.length; i++) {
    currentGroup.push(sentenceBarMap[i]);
    // Break group at significant pauses or when classification label changes
    const isLast = i === sentenceBarMap.length - 1;
    const isPauseBreak = pauseAfterSet.has(i);
    const isLabelChange = !isLast &&
      sentenceBarMap[i].classification.label !== sentenceBarMap[i + 1].classification.label;

    if (isLast || isPauseBreak || isLabelChange) {
      groups.push(currentGroup);
      currentGroup = [];
    }
  }

  // Convert groups to sections, snapping to phrase boundaries
  for (const group of groups) {
    if (group.length === 0) continue;
    const first = group[0];
    const last = group[group.length - 1];

    // Use LLM arc data if available for richer section names
    const avgTime = (sentenceTimings[first.index].startSeconds + sentenceTimings[last.index].endSeconds) / 2;
    const matchingArc = arc?.find(
      (a) => avgTime >= a.startSeconds && avgTime <= a.endSeconds
    );

    const sectionName = matchingArc?.label || first.classification.label;
    const energy = matchingArc?.energyLevel ?? first.classification.energy;

    // Snap section bars to 2-bar phrases for musical coherence
    const rawStartBar = first.startBar;
    const rawEndBar = last.endBar;
    const snappedStart = Math.max(preRollBars + 1, snapToPhrase(rawStartBar, 2));
    const snappedEnd = Math.min(totalBars - postRollBars, Math.max(snappedStart + 1, snapToPhrase(rawEndBar, 2)));

    sections.push({
      name: sectionName,
      startBar: snappedStart,
      endBar: snappedEnd,
      startTime: (snappedStart - 1) * barDuration,
      endTime: snappedEnd * barDuration,
      energyLevel: energy,
      dynamicDirection: first.classification.direction,
      instrumentationNotes: matchingArc?.musicPrompt ||
        (instrumentation ? `${instrumentation.drums}, ${instrumentation.bass}, ${instrumentation.mids}` : ''),
      voiceSentences: group.map((g) => g.index),
    });
  }

  // Post-roll section (outro/button ending)
  const outroStartBar = totalBars - postRollBars + 1;
  sections.push({
    name: 'outro',
    startBar: outroStartBar,
    endBar: totalBars,
    startTime: (outroStartBar - 1) * barDuration,
    endTime: totalDuration,
    energyLevel: 4,
    dynamicDirection: 'resolving',
    instrumentationNotes: buttonEnding
      ? `${buttonEnding.type}${buttonEnding.description ? '. ' + buttonEnding.description : ''}`
      : 'Clean button ending, sustained chord, definitive close.',
    voiceSentences: [],
  });

  // 6. Build sync points from detected landmarks
  const landmarks = detectLandmarks(sentenceTimings);
  const syncPoints: MusicalSyncPoint[] = [];

  for (const lm of landmarks) {
    const timing = sentenceTimings[lm.index];
    const voiceTs = preRollDuration + timing.startSeconds;
    const db = nearestDownbeat(voiceTs, finalBPM, ts);
    const cue = cueByIndex.get(lm.index);

    syncPoints.push({
      type: lm.type,
      voiceTimestamp: voiceTs,
      nearestDownbeat: db.time,
      bar: db.bar + 1, // 1-indexed
      beat: 1,
      offset: db.offset,
      musicAction: cue?.musicDirection || getMusicActionForType(lm.type),
    });
  }

  // 7. Build bar-based composition prompt
  const compositionPrompt = buildBarBasedPrompt({
    finalBPM,
    totalBars,
    genre,
    mood,
    sections,
    composerDirection,
    instrumentation,
    buttonEnding,
    ts,
    totalDuration,
  });

  // 8. Build mixing plan
  const suggestedDuckingPoints = sentenceTimings.map((t) => ({
    startTime: preRollDuration + t.startSeconds,
    endTime: preRollDuration + t.endSeconds,
  }));

  const mixingPlan: MixingPlan = {
    voiceDelaySeconds: preRollDuration,
    musicTrimDuration: totalDuration,
    suggestedDuckingPoints,
  };

  logger.info('Musical blueprint generated', {
    finalBPM,
    totalBars,
    totalDuration: totalDuration.toFixed(1),
    preRollBars,
    postRollBars,
    sections: sections.length,
    syncPoints: syncPoints.length,
  });

  return {
    finalBPM,
    timeSignature: ts,
    barDuration,
    totalBars,
    totalDuration,
    preRollBars,
    preRollDuration,
    postRollBars,
    postRollDuration,
    voiceEntryPoint,
    sections,
    syncPoints,
    compositionPrompt,
    mixingPlan,
  };
}

// ---------------------------------------------------------------------------
// Bar-based prompt builder
// ---------------------------------------------------------------------------

function getMusicActionForType(type: MusicalSyncPoint['type']): string {
  switch (type) {
    case 'brand_mention': return 'subtle melodic accent';
    case 'key_benefit': return 'energy lift';
    case 'emotional_peak': return 'full arrangement peak';
    case 'cta_start': return 'confident resolve';
    case 'final_word': return 'begin button ending';
    default: return 'musical accent';
  }
}

interface BarPromptInput {
  finalBPM: number;
  totalBars: number;
  genre: string;
  mood: string;
  sections: MusicalSection[];
  composerDirection?: string | null;
  instrumentation?: BlueprintInput['instrumentation'];
  buttonEnding?: BlueprintInput['buttonEnding'];
  ts: TimeSignature;
  totalDuration: number;
}

function buildBarBasedPrompt(input: BarPromptInput): string {
  const { finalBPM, totalBars, genre, mood, sections, composerDirection, instrumentation, buttonEnding, ts, totalDuration } = input;

  const parts: string[] = [];

  // Header: BPM, time signature, key, total structure
  parts.push(`${finalBPM} BPM, ${ts} time, ${mood} feel, ${totalBars} bars total (~${Math.round(totalDuration)}s).`);

  // Genre/style
  parts.push(`Genre: ${genre}. Instrumental only, no vocals.`);

  // Instrumentation summary
  if (instrumentation) {
    parts.push(`Instrumentation: drums: ${instrumentation.drums}. bass: ${instrumentation.bass}. mids: ${instrumentation.mids}. fx: ${instrumentation.effects}. Leave 1-4kHz clear for voice.`);
  } else {
    parts.push('Leave 1-4kHz frequency range clear for voice-over.');
  }

  // Section-by-section bar directions
  for (const section of sections) {
    const barRange = section.startBar === section.endBar
      ? `Bar ${section.startBar}`
      : `Bars ${section.startBar}-${section.endBar}`;

    const energyDesc = section.energyLevel <= 3 ? 'low energy'
      : section.energyLevel <= 5 ? 'medium energy'
      : section.energyLevel <= 7 ? 'high energy'
      : 'peak energy';

    const directionDesc = section.dynamicDirection === 'building' ? 'building'
      : section.dynamicDirection === 'peak' ? 'fullest arrangement'
      : section.dynamicDirection === 'resolving' ? 'resolving'
      : 'sustaining';

    let sectionDesc = `${barRange}: ${section.name}. ${energyDesc}, ${directionDesc}.`;
    if (section.instrumentationNotes) {
      sectionDesc += ` ${section.instrumentationNotes}`;
    }
    parts.push(sectionDesc);
  }

  // Composer direction (if any)
  if (composerDirection?.trim()) {
    parts.push(`Composer notes: ${composerDirection.trim()}`);
  }

  // Button ending
  if (buttonEnding) {
    parts.push(`Ending: ${buttonEnding.type}. CLEAN ENDING, NO FADE-OUT.`);
  } else {
    parts.push('Clean button ending, definitive close, no fade-out.');
  }

  // Critical instructions
  parts.push('IMPORTANT: Continuous flowing music. Smooth transitions between sections. Professional ad background that supports voice.');

  // Join and cap at Suno's 1000-char style limit
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 1000);
}

export default { generateMusicalBlueprint };
