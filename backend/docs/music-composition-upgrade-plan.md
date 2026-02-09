# Background Music Composition Upgrade Plan

## The Vision

Make background music work **like a human composer scores an ad**: the composer reads the script, internalizes the emotional arc, plans musical sections aligned to script beats, and composes with specific sync points in mind. The music should match bars, beats, and sentences -- not be a generic bed stretched to fit.

---

## Part 1: Current Architecture Gaps (Root Cause Analysis)

### Gap 1: Script and Music Live in Separate Worlds

**What happens now:** The LLM (`openai.service.ts:114`) generates a single JSON containing both the script text AND music metadata (prompt, arc, BPM, sentenceCues) in one call. This metadata is descriptive text -- it tells Suno "what kind of music to make" but has zero awareness of *when the voice actually speaks*.

**The problem:** A human composer reads the script aloud, feels the rhythm, and composes music that breathes with the words. Our LLM writes music instructions *before TTS even runs*. It guesses timings based on word count (2.8 words/sec), but actual TTS output varies significantly per voice, per emotion tag, per pause.

**Impact:** The music arc segment boundaries (e.g. "intro 0-5s, features 5-15s") are based on *estimated* timings, not real speech timings. By the time we have actual sentence timings from ElevenLabs, the music is already generated.

### Gap 2: No Bar/Beat Grid

**What happens now:** Music is generated as an opaque audio blob. There is no knowledge of where musical bar boundaries fall. The mixing worker (`audioMixing.worker.ts:119-141`) then stretches or loops the music to match voice duration using FFmpeg `atempo`.

**The problem:** Stretching a 45s track to 30s with `atempo` changes the tempo, which shifts all bar/beat positions. A phrase that landed on a downbeat during generation now falls on an upbeat. Musical structure is destroyed. Looping creates an audible repeat point.

**Impact:** The music feels "off" -- it doesn't resolve when the CTA lands, the energy peak doesn't align with the key benefit, the button ending is in the wrong place.

### Gap 3: Suno Cannot Hit Exact Timestamps

**What happens now:** The suno-prompt-builder (`suno-prompt-builder.ts:117-128`) embeds timestamps in the text prompt: `[0-5s] intro: Subtle build...`. The music director service creates timing maps with specific second markers.

**The problem:** Suno (and all current TTM models) are generative -- they interpret text prompts creatively but cannot guarantee that "the drums enter at exactly 5.2 seconds" or "the chord resolves at 28.1s". The timestamps in the prompt are suggestions that Suno largely ignores. This is a fundamental limitation of current AI music generation.

**Impact:** Sync points specified in the prompt don't materialize in the generated audio. The "peak energy at 15s" might actually happen at 12s or 18s in the output.

### Gap 4: Music Direction Happens Twice (Redundantly)

**What happens now:** Two separate systems create music direction:
1. The LLM system prompt (`openai.service.ts:196-284`) instructs GPT-4 to act as "AD MUSIC COMPOSER" and output `music.arc`, `music.composerDirection`, `sentenceCues`, etc.
2. The Music Director Service (`music-director.service.ts`) independently re-analyzes the script and generates its own timing map, segments, sync points, and full_track_prompt.

The orchestrator (`production.orchestrator.ts:243-250`) uses Music Director's `full_track_prompt` when available, overriding the LLM's music.prompt. But then it also passes the LLM's arc/composerDirection/sentenceCues through the suno-prompt-builder.

**Impact:** Conflicting direction. Two different systems with different analyses are both feeding into the final prompt. The Music Director service is entirely rule-based (hardcoded timing percentages, energy curves by category), while the LLM's music direction is context-aware but not grounded in actual timing data.

### Gap 5: Continuity Plan vs. Segment Mode Conflict

**What happens now:** The `music-continuity-plan.md` says "always generate one track, ignore arc for generation." But the orchestrator (`production.orchestrator.ts:344-346`) still enables segment mode: `const enableSegmentMode = Array.isArray(musicArc) && musicArc.length >= 2`. So whenever the LLM returns 2+ arc segments (which it's explicitly prompted to do), the system generates separate clips and crossfades them.

**Impact:** The continuity plan was written but never enforced in code. Users still get segmented music with seams.

### Gap 6: Per-Sentence Volume Automation is Crude

**What happens now:** The mixing worker (`audioMixing.worker.ts:146-181`) reads sentenceCues and applies volume multipliers via `ffmpegService.applyVolumeCurve()`. This is an abrupt per-sentence volume change -- it doesn't follow musical phrasing.

**The problem:** Volume automation should align to musical beats, not sentence boundaries. When a sentence ends mid-bar, the volume jump creates an audible artifact. Human engineers automate volume on beat boundaries.

### Gap 7: No Feedback Loop Between TTS and Music

**What happens now:** The pipeline is strictly sequential: Script -> TTS -> Music -> Mix. TTS runs, produces sentence timings, then music generates. But the music prompt was already decided during script generation (before TTS). The sentence timings are only used in the suno-prompt-builder to add timestamp labels, but Suno can't use them reliably (Gap 3).

**The real issue:** We get exact timing data from TTS, but we can't make Suno hit those timings. The only place we can apply timing-aware adjustments is in the mixing stage.

---

## Part 2: How Human Composers Actually Work

Understanding the human workflow is essential before designing the solution:

### Step 1: Read and Internalize the Script
The composer reads the script, marks emotional beats, identifies the hook, the turn, the CTA. They note where natural pauses fall, where the energy should peak.

### Step 2: Choose Musical Structure Based on Script Structure
They decide: "This is a 30s spot. The script has 4 sentences. I'll use an 8-bar intro (4 bars music-only pre-roll, 4 bars under the hook), 16 bars for the body, 8 bars for the CTA/outro." At 100 BPM in 4/4 time, each bar = 2.4 seconds, so 32 bars = 76.8 seconds of music for a 30s voice.

### Step 3: Compose to a Click Track
They set a tempo (BPM), compose in bars and beats. The music has structural integrity -- phrases are 4 or 8 bars, chord changes happen on downbeats, energy builds follow musical logic.

### Step 4: Spot to Picture (or Voice)
They listen to the voice recording and adjust: "The brand name hits at 12.3s -- I'll put a subtle accent on the nearest downbeat (bar 6, beat 1 at 12.0s)." They don't move the voice -- they align music landmarks to nearby beats.

### Step 5: Mix with Intentional Dynamics
Volume automation follows musical phrasing -- a swell starts at a bar boundary, ducks happen on musical transitions, not arbitrary timestamp cuts.

---

## Part 3: The Practical Solution (What We Can Actually Build)

Given that Suno cannot hit exact timestamps, and we can't change that fundamental limitation, the strategy is:

> **Compose music with the right structure and energy arc, then use intelligent post-production to align music landmarks to voice landmarks.**

### Architecture: "Compose, Analyze, Align, Mix"

```
[STAGE 1] Script Generation (existing)
    LLM produces: script + emotional arc + music direction
    |
[STAGE 2] TTS Generation (existing)
    ElevenLabs produces: voice audio + character-level alignment
    We compute: sentence timings, pause locations, emotional beats
    |
[STAGE 3] Musical Blueprint (NEW)
    Input: script, sentence timings, emotional arc, target duration
    Output: musical blueprint with:
      - Exact BPM calibrated to voice duration
      - Bar count and phrase structure
      - Section map: intro(bars 1-4), body(bars 5-20), cta(bars 21-24), outro(bars 25-28)
      - Target sync points: "peak energy near bar 13 (~15.6s, aligns with benefit sentence at 15.2s)"
      - Optimized Suno prompt with correct musical structure
    |
[STAGE 4] Music Generation (enhanced)
    Suno generates ONE continuous track using the blueprint-informed prompt
    |
[STAGE 5] Music Analysis (NEW)
    Input: generated music audio
    Output: detected features:
      - Beat grid (onset detection / beat tracking via FFmpeg or aubio)
      - Downbeat positions
      - Energy curve over time
      - Spectral centroid changes (brightness/energy shifts)
      - Section boundaries (detected via energy/spectral changes)
    |
[STAGE 6] Intelligent Alignment (NEW)
    Input: voice timings + music analysis
    Algorithm:
      1. Find the nearest musical downbeat to each voice landmark
      2. Calculate micro time-shifts needed
      3. Apply tempo-preserving adjustments (trim intro, adjust pre-roll)
      4. Align music energy peaks with voice emotional peaks
    Output: aligned music track + mixing instructions
    |
[STAGE 7] Professional Mix (enhanced)
    Input: voice audio + aligned music + mixing instructions
    Improvements:
      - Beat-aware ducking (duck on beat boundaries, not mid-bar)
      - Musical phrase-aligned volume automation
      - Sidechain with musical timing awareness
      - Clean button ending aligned to nearest bar after final word
```

---

## Part 4: Detailed Implementation Plan

### Phase 1: Fix Foundational Issues (Quick Wins)

#### 1.1 Enforce Single-Track Music Generation

**Problem:** Orchestrator still enables segment mode despite continuity plan.

**Change in `production.orchestrator.ts`:**
- Remove the segment-mode enablement logic (lines 344-346)
- Always pass `segmentBasedGeneration: false` to music job
- Keep arc data in the prompt for Suno's compositional awareness but generate ONE track

**Files:** `backend/src/services/production.orchestrator.ts`

#### 1.2 BPM-Calibrated Duration (Stop Stretching Music)

**Problem:** Music is generated at an arbitrary duration then stretched with `atempo`. This destroys bar alignment.

**Solution:** Calculate the exact duration that gives whole bars at the target BPM, then request music of that duration.

```
voiceDuration = 28.5s (from TTS)
preRoll = 1.5s (music before voice)
postRoll = 2.0s (music after voice, for button ending)
totalTargetDuration = 28.5 + 1.5 + 2.0 = 32.0s

targetBPM = 100 (from LLM)
barDuration = (60 / targetBPM) * 4 = 2.4s (4/4 time)
barsNeeded = ceil(totalTargetDuration / barDuration) = ceil(32.0 / 2.4) = 14 bars
actualMusicDuration = 14 * 2.4 = 33.6s

// Adjust BPM slightly to hit exact duration if needed
adjustedBPM = (14 * 4 * 60) / totalTargetDuration = 105 BPM
// Or accept 33.6s and trim the tail cleanly on bar 14
```

Instead of stretching, we either:
- a) Request music at the calculated duration and trim on bar boundaries
- b) Slightly adjust the requested BPM so bars fit the target duration perfectly
- c) Adjust the pre-roll / post-roll to absorb the difference

**Files:** New utility `backend/src/utils/musical-timing.ts`, changes in `audioMixing.worker.ts`

#### 1.3 Eliminate Redundant Music Direction

**Problem:** Two overlapping systems (LLM + MusicDirector) produce conflicting direction.

**Solution:** Consolidate into one path:
- The LLM remains the **creative director** (it understands the script content)
- Remove the separate Music Director Service call from the orchestrator
- Instead, enhance the LLM prompt to output the *specific data* we need (see Phase 2)
- Keep `music-director.service.ts` as a fallback/validation layer, not a primary source

**Files:** `backend/src/services/production.orchestrator.ts`, potentially deprecate `music-director.service.ts`

---

### Phase 2: Musical Blueprint System (The Core Innovation)

This is the key new component. After TTS generates voice with timestamps, we create a precise musical blueprint.

#### 2.1 New Service: `musical-blueprint.service.ts`

**Purpose:** Takes voice timing data + LLM music direction and produces a precise musical plan with bar/beat alignment.

**Input:**
```typescript
interface BlueprintInput {
  script: string;
  sentenceTimings: SentenceTiming[];     // From TTS alignment
  pauseLocations: PauseLocation[];        // Gaps > 300ms between sentences
  emotionalArc: EmotionalBeat[];          // From LLM sentenceCues
  targetBPM: number;                       // From LLM music metadata
  genre: string;
  mood: string;
  totalVoiceDuration: number;
  composerDirection: string;               // From LLM
  instrumentation: Instrumentation;        // From LLM
}
```

**Output:**
```typescript
interface MusicalBlueprint {
  // Tempo & structure
  finalBPM: number;              // Adjusted BPM for perfect bar alignment
  timeSignature: '4/4' | '3/4'; // Almost always 4/4 for ads
  barDuration: number;           // seconds per bar at finalBPM
  totalBars: number;             // Total bars in the track
  totalDuration: number;         // Exact duration in seconds

  // Pre/post roll
  preRollBars: number;           // Bars of music before voice enters
  preRollDuration: number;       // seconds
  postRollBars: number;          // Bars of music after voice ends
  postRollDuration: number;      // seconds
  voiceEntryPoint: number;       // seconds -- when voice starts in the music

  // Section map (in bars, not seconds)
  sections: MusicalSection[];

  // Sync points (musical landmarks aligned to voice)
  syncPoints: MusicalSyncPoint[];

  // Enhanced prompt for Suno
  compositionPrompt: string;     // Full prompt with musical structure baked in

  // Mixing instructions derived from blueprint
  mixingPlan: MixingPlan;
}

interface MusicalSection {
  name: string;              // 'intro', 'hook_underscore', 'body', 'peak', 'cta', 'outro'
  startBar: number;
  endBar: number;
  startTime: number;         // seconds
  endTime: number;
  energyLevel: number;       // 1-10
  dynamicDirection: 'building' | 'sustaining' | 'resolving' | 'peak';
  instrumentationNotes: string;
  // Which voice sentences fall in this section
  voiceSentences: number[];  // indices into sentenceTimings
}

interface MusicalSyncPoint {
  type: 'brand_mention' | 'key_benefit' | 'emotional_peak' | 'cta_start' | 'final_word';
  voiceTimestamp: number;    // When it happens in voice (seconds)
  nearestDownbeat: number;   // Nearest musical downbeat (seconds)
  bar: number;               // Which bar
  beat: number;              // Which beat in that bar
  offset: number;            // Difference (voice - downbeat), should be small
  musicAction: string;       // What music should do: "subtle lift", "energy peak", etc.
}
```

**Algorithm:**

```
1. Calculate bar grid
   barDuration = (60 / targetBPM) * beatsPerBar  // e.g. (60/100)*4 = 2.4s

2. Determine pre-roll
   preRollBars = genre == 'cinematic' ? 4 : 2  // 2-4 bars of music-only intro

3. Map voice sentences to bar grid
   For each sentence:
     sentenceStartBar = floor((preRollDuration + sentence.startSeconds) / barDuration)
     sentenceEndBar = ceil((preRollDuration + sentence.endSeconds) / barDuration)

4. Identify natural section boundaries
   Find the largest pauses between sentences
   Snap section boundaries to bar boundaries (nearest 4-bar phrase)

5. Align emotional landmarks to downbeats
   For each landmark (brand mention, key benefit, CTA):
     voiceTime = landmark timestamp + preRollDuration
     nearestBar = round(voiceTime / barDuration)
     nearestDownbeat = nearestBar * barDuration
     offset = voiceTime - nearestDownbeat
     if abs(offset) < barDuration/2: // Within half a bar -- good alignment
       record sync point
     else: // Adjust pre-roll by a fraction of a beat to improve alignment

6. Calculate post-roll
   postRollBars = ceil(remaining time to complete phrase after last word)
   At least 1 bar for button ending

7. Fine-tune BPM
   Try BPMs in range [targetBPM-5, targetBPM+5]
   Score each by:
     - Total sync point alignment error (lower = better)
     - Section boundaries landing on 4-bar phrases (bonus)
     - Total duration close to target (penalty for too far off)
   Pick the best BPM
```

#### 2.2 Enhanced Suno Prompt from Blueprint

Instead of dumping timestamps into a text prompt (which Suno ignores), describe the **musical structure** in terms Suno understands:

**Bad (current):**
```
[0-5s] intro: Subtle build, low energy. [5-15s] features: Medium energy, driving...
```

**Good (new):**
```
100 BPM, 4/4 time, major key, 28 bars total.
Bars 1-4: Gentle intro, soft piano and ambient pads, building anticipation.
Bars 5-12: Main theme enters, add light drums and bass, confident groove, medium energy.
Bars 13-16: Peak energy, fullest arrangement, melodic hook, triumphant feel.
Bars 17-24: Warm resolution, maintain groove but simplify, trustworthy and inviting.
Bars 25-28: Clean button ending, sustained major chord, definitive close, no fade.
Instrumental, no vocals. Professional ad background, 2-4kHz carved for voice space.
```

This works because:
- Suno understands musical structure (bars, chord progressions, arrangement density)
- Bar-based directions align with how music is actually composed
- No pretense of timestamp precision -- we specify structure, not exact moments
- The actual alignment to voice happens in post-production (Phase 3)

**Files:** New `backend/src/services/music/musical-blueprint.service.ts`

---

### Phase 3: Music Analysis Engine

After Suno generates the track, we analyze it to understand what we actually got.

#### 3.1 Beat Detection

Use FFmpeg's `ebur128` or shell out to a lightweight beat-tracking tool.

**Option A: FFmpeg onset detection**
```bash
ffmpeg -i music.mp3 -af "silencedetect=noise=-30dB:d=0.1" -f null -
```
This detects silence/onset boundaries but isn't true beat detection.

**Option B: Energy-based beat grid estimation**
Since we know the target BPM (from the blueprint), we can:
1. Extract the audio waveform envelope
2. Use FFmpeg `astats` to get energy at regular intervals
3. Look for periodic energy peaks at the expected beat interval (60/BPM seconds)
4. Phase-align the beat grid to the strongest onset in the first 2 seconds

```bash
# Extract energy every 10ms
ffmpeg -i music.mp3 -af "astats=metadata=1:reset=441" -f null - 2>&1 | grep RMS
```

**Option C: Use a dedicated library (recommended)**
If Node.js environment, use `meyda` (audio feature extraction) or call Python `librosa.beat.beat_track()` via a subprocess. This gives highly accurate beat positions.

**Output:**
```typescript
interface MusicAnalysis {
  detectedBPM: number;          // Actual BPM of generated music
  beatPositions: number[];      // Timestamp of each beat
  downbeatPositions: number[];  // Timestamp of each downbeat (bar start)
  energyCurve: { time: number; energy: number }[];
  totalDuration: number;

  // Section detection (via energy changes)
  detectedSections: {
    startTime: number;
    endTime: number;
    avgEnergy: number;
    label: 'low' | 'building' | 'peak' | 'resolving';
  }[];
}
```

**Files:** New `backend/src/services/audio/music-analyzer.service.ts`

#### 3.2 Validation Against Blueprint

Compare what we requested vs. what we got:
- Is the detected BPM within 5% of the requested BPM?
- Does the energy curve roughly match the requested arc?
- Is the total duration within acceptable range?

If validation fails badly, regenerate with adjusted prompt. This is a quality gate.

---

### Phase 4: Intelligent Alignment Engine

This is where we make the music "fit" the voice like a human composer would.

#### 4.1 Pre-Roll Alignment

**Problem:** We need the voice to enter on a musically meaningful moment (a downbeat or beat 3).

**Solution:**
1. From music analysis, we know where downbeats are
2. We want the voice to start on or just after a downbeat
3. Calculate: `preRollTrim = nearestDownbeatBeforeVoiceEntry - desiredPreRollStart`
4. Trim the music intro to start the voice on the right beat

```typescript
function alignVoiceEntry(
  musicAnalysis: MusicAnalysis,
  desiredPreRollDuration: number,  // e.g. 2.4s (1 bar at 100 BPM)
): { musicStartOffset: number; voiceDelay: number } {
  // Find the downbeat closest to desiredPreRollDuration
  const targetTime = desiredPreRollDuration;
  const nearestDownbeat = musicAnalysis.downbeatPositions
    .reduce((best, db) => Math.abs(db - targetTime) < Math.abs(best - targetTime) ? db : best);

  return {
    musicStartOffset: 0,  // Start music from beginning
    voiceDelay: nearestDownbeat,  // Voice enters on this downbeat
  };
}
```

#### 4.2 Beat-Aware Ducking

**Current:** Sidechain compressor reacts to voice presence with attack/release times.

**Improvement:** Instead of purely reactive sidechain, pre-program volume automation that:
- Starts ducking on the beat boundary *before* each sentence starts
- Returns to full volume on the beat boundary *after* each sentence ends
- Uses musical timing (beat grid) rather than arbitrary milliseconds

```typescript
function buildBeatAwareDuckingCurve(
  sentenceTimings: SentenceTiming[],
  beatPositions: number[],
  voiceDelay: number,  // How much voice is offset in the mix
): DuckingSegment[] {
  return sentenceTimings.map(sentence => {
    const absStart = sentence.startSeconds + voiceDelay;
    const absEnd = sentence.endSeconds + voiceDelay;

    // Find beat just before sentence starts
    const duckStart = beatPositions
      .filter(b => b <= absStart)
      .pop() || absStart;

    // Find beat just after sentence ends
    const duckEnd = beatPositions
      .find(b => b >= absEnd) || absEnd;

    return {
      startTime: duckStart,
      endTime: duckEnd,
      duckLevel: 0.25,  // -12dB under voice
      rampInBeats: 1,    // 1 beat ramp down
      rampOutBeats: 1,   // 1 beat ramp up
    };
  });
}
```

#### 4.3 Button Ending Alignment

**Problem:** The voice finishes at an arbitrary moment, but the music should end on a bar boundary with a clean resolution.

**Solution:**
1. Find the last word's end time
2. Find the nearest downbeat after the last word
3. From that downbeat, allow 1-2 bars for the button ending (sustained chord + release)
4. Trim or fade music exactly on the final bar boundary

```typescript
function alignButtonEnding(
  lastWordEnd: number,           // When the last word ends (in mix timeline)
  downbeats: number[],
  barDuration: number,
): { buttonStart: number; cutoffTime: number } {
  // Find first downbeat after last word
  const buttonStartBeat = downbeats.find(db => db >= lastWordEnd);
  if (!buttonStartBeat) {
    return { buttonStart: lastWordEnd + 0.3, cutoffTime: lastWordEnd + barDuration + 0.8 };
  }

  // Button ending: chord on this downbeat, sustain for 1 bar, then silence
  return {
    buttonStart: buttonStartBeat,
    cutoffTime: buttonStartBeat + barDuration + 0.5,  // 1 bar + 500ms tail
  };
}
```

**Files:** New `backend/src/services/audio/music-aligner.service.ts`

---

### Phase 5: Enhanced Mixing Engine

#### 5.1 Musical Phrase-Aware Volume Automation

Instead of per-sentence volume multipliers applied as hard cuts, smooth the automation:

```
Current:  |---0.8---|---1.2---|---0.7---|  (hard steps at sentence boundaries)
Improved: |--0.8--~~1.2~~--~~0.7~~--|  (smooth ramps on beat boundaries)
```

The ramp duration should be exactly 1 beat (e.g. 0.6s at 100 BPM), and ramps should start/end on beat positions from the music analysis.

#### 5.2 Energy-Matched Ducking Depth

The ducking amount should vary based on the energy of both the voice and the music at each moment:

- **High-energy voice (excited, fast) + High-energy music:** Deep duck (-18dB)
- **Calm voice + Low-energy music:** Light duck (-8dB)
- **Pause (no voice) + Any music:** No duck (music breathes)

The LLM's `sentenceCues.musicVolumeMultiplier` already provides per-sentence intent. Combine this with the music analysis energy curve for nuanced automation.

#### 5.3 Two-Pass Mixing

**Pass 1: Rough mix with analysis**
- Mix voice + music with basic settings
- Analyze the result for loudness, spectral balance, voice clarity
- Score: "Is the voice always intelligible? Is the music adding to the emotion?"

**Pass 2: Refined mix**
- Adjust ducking depth based on Pass 1 analysis
- Apply beat-aware timing corrections
- Final loudness normalization

**Files:** Changes in `backend/src/services/audio/ffmpeg.service.ts`, `backend/src/jobs/audioMixing.worker.ts`

---

### Phase 6: LLM Prompt Refinement

#### 6.1 Updated Script Generation Prompt

The LLM should think about **musical phrasing** while writing the script:

Add to system prompt:
```
MUSICAL PHRASING AWARENESS (when writing the script):
- Write sentences that naturally group into 2-bar or 4-bar musical phrases
- Place the most important words (brand name, key benefit) at positions
  that would naturally fall on musical downbeats
- Create natural pauses of 1-2 seconds between major sections
  (these become musical "breathing points" where music swells)
- The CTA should be preceded by a pause of at least 0.5s
  (allowing music to set up the resolution)
- Short punchy sentences for high-energy sections
- Longer flowing sentences for emotional/building sections

SENTENCE CUES (enhanced):
For each sentence, output:
- musicCue: descriptive label (hook, build, peak, resolve, cta)
- musicVolumeMultiplier: 0.7-1.3
- musicDirection: brief composer note
- NEW: musicalFunction: what this sentence represents musically:
    "verse" = steady groove, voice prominent
    "lift" = energy increase, music swells slightly
    "peak" = maximum energy, fullest arrangement
    "breakdown" = stripped back, intimate
    "resolve" = tension release, warm resolution
```

#### 6.2 Structured Music Output

Replace the free-text `composerDirection` with structured data the blueprint can use:

```typescript
// Enhanced music output from LLM
interface EnhancedMusicDirection {
  prompt: string;              // Overall description
  targetBPM: number;           // 70-130
  genre: string;
  mood: string;
  musicalStructure: {
    introType: 'minimal' | 'atmospheric' | 'rhythmic';  // How the track starts
    introBars: number;         // 2 or 4 (before voice)
    bodyFeel: string;          // 'driving groove' | 'gentle pulse' | 'ambient swell'
    peakMoment: string;        // Description of the peak (e.g. "full arrangement with melodic hook")
    endingType: 'button' | 'stinger' | 'sustained_chord' | 'ring_out';
    outroBars: number;         // 1-4 (after voice)
  };
  energyArc: number[];         // One value per section, e.g. [3, 5, 7, 5, 3]
  instrumentProgression: {     // What plays in each section
    intro: string[];           // e.g. ["soft pads", "ambient texture"]
    body: string[];            // e.g. ["piano", "light drums", "bass"]
    peak: string[];            // e.g. ["full drums", "bass", "piano", "strings", "melodic hook"]
    outro: string[];           // e.g. ["piano", "sustained pad"]
  };
}
```

**Files:** `backend/src/types/ad-production.ts`, `backend/src/services/llm/openai.service.ts`

---

## Part 5: Implementation Order & Priority

### Tier 1: Immediate Impact (Fix What's Broken)

| # | Task | Impact | Effort | Files |
|---|------|--------|--------|-------|
| 1 | Enforce single-track generation (disable segment mode in orchestrator) | Eliminates music seams | Small | `production.orchestrator.ts` |
| 2 | Stop stretching music -- calculate bar-aligned duration, trim on bar boundaries instead | Preserves musical structure | Medium | New `musical-timing.ts`, `audioMixing.worker.ts` |
| 3 | Consolidate music direction (remove dual LLM + MusicDirector conflict) | Cleaner, consistent prompts | Medium | `production.orchestrator.ts` |

### Tier 2: Core Innovation (Musical Blueprint)

| # | Task | Impact | Effort | Files |
|---|------|--------|--------|-------|
| 4 | Build Musical Blueprint Service | Enables bar-aware composition | Large | New `musical-blueprint.service.ts` |
| 5 | Bar-based Suno prompt generation | Better musical structure in output | Medium | `suno-prompt-builder.ts` |
| 6 | Integrate blueprint into pipeline (after TTS, before music gen) | Full pipeline upgrade | Medium | `production.orchestrator.ts` |

### Tier 3: Post-Production Intelligence (Analysis & Alignment)

| # | Task | Impact | Effort | Files |
|---|------|--------|--------|-------|
| 7 | Music Analysis Engine (beat detection, energy curve) | Foundation for alignment | Large | New `music-analyzer.service.ts` |
| 8 | Voice-Music Alignment Engine | Music fits voice perfectly | Large | New `music-aligner.service.ts` |
| 9 | Beat-aware ducking and volume automation | Professional mixing quality | Medium | `ffmpeg.service.ts`, `audioMixing.worker.ts` |
| 10 | Button ending alignment to bar boundary | Clean professional endings | Small | `music-aligner.service.ts` |

### Tier 4: Polish & Refinement

| # | Task | Impact | Effort | Files |
|---|------|--------|--------|-------|
| 11 | Enhanced LLM prompt for musical phrasing awareness | Better scripts for music | Small | `openai.service.ts` |
| 12 | Two-pass mixing with analysis feedback | Optimized output quality | Medium | `audioMixing.worker.ts` |
| 13 | Music quality gate (regenerate if bad match) | Consistent quality | Medium | `production.orchestrator.ts` |
| 14 | Structured music direction from LLM (musicalStructure) | Richer blueprint input | Medium | `ad-production.ts`, `openai.service.ts` |

---

## Part 6: Data Flow (New Pipeline)

```
User Prompt
    |
    v
[1] SCRIPT GENERATION (existing, enhanced prompt)
    Output: script + sentenceCues + music metadata + musicalStructure
    |
    v
[2] TTS GENERATION (existing)
    Output: voice audio + sentence timings + pause locations
    |
    v
[3] MUSICAL BLUEPRINT (NEW)
    Input: sentence timings + music metadata + musicalStructure
    Calculates: optimal BPM, bar grid, section map, sync points
    Output: MusicalBlueprint with bar-based Suno prompt
    |
    v
[4] MUSIC GENERATION (enhanced)
    Input: blueprint.compositionPrompt (bar-based, not timestamp-based)
    Always single-track mode
    Output: one continuous music track
    |
    v
[5] MUSIC ANALYSIS (NEW)
    Input: generated music audio
    Detects: beats, downbeats, energy curve, sections
    Output: MusicAnalysis
    |
    v
[6] ALIGNMENT (NEW)
    Input: blueprint + music analysis + voice timings
    Calculates: voice entry point, ducking curve, button ending
    Output: AlignmentResult (offsets, ducking segments, trim points)
    |
    v
[7] PROFESSIONAL MIX (enhanced)
    Input: voice + music + alignment result
    Applies: beat-aware ducking, aligned pre/post roll, button ending
    Normalizes: LUFS targeting
    Output: final production audio
```

---

## Part 7: Success Criteria

When this is done, an ad should sound like:

1. **Music enters cleanly** -- a purposeful 1-2 bar intro that establishes mood
2. **Voice enters on a musical beat** -- not on an arbitrary moment
3. **Music breathes with the voice** -- ducks smoothly during speech, swells in pauses, all on beat boundaries
4. **Energy builds musically** -- the peak energy in the music coincides with the key benefit/emotional moment in the script
5. **The ending is definitive** -- a clean button ending (resolved chord) lands on a bar boundary after the last word, not a random fade-out
6. **No seams or stretching artifacts** -- one continuous track, no audible loops, no tempo-shifted artifacts
7. **The music has musical integrity** -- phrases are 4 or 8 bars, chord changes happen on downbeats, the arrangement follows musical logic

---

## Part 8: Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Suno still generates unpredictable output regardless of prompt | Music Analysis + Alignment compensates post-hoc. Quality gate can trigger regeneration. |
| Beat detection inaccuracy | Use target BPM as prior. If detected BPM is within 3% of target, use target BPM and phase-align the grid. |
| Added pipeline latency (analysis + alignment steps) | Both steps are CPU-only on local audio (<1s each). No API calls added. Net pipeline time increase: ~2-3s. |
| BPM fine-tuning produces odd tempos (e.g. 103.7 BPM) | Round to nearest integer BPM. Ads are short enough that fractional BPM drift is inaudible. |
| LLM doesn't produce useful musicalStructure | Fallback: blueprint service has sensible defaults based on duration and genre alone. |
| Over-engineering the alignment | Start with pre-roll alignment + button ending alignment only. Beat-aware ducking is enhancement, not requirement. |
