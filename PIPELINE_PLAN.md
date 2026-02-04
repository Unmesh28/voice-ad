# Studio-Grade Automated Ad Production Pipeline - Implementation Plan

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Stage 1: Intelligent Script Generation](#2-stage-1-intelligent-script-generation)
3. [Stage 2: Voice Selection & TTS](#3-stage-2-voice-selection--tts)
4. [Stage 3: Music Generation (Suno via Kie.ai)](#4-stage-3-music-generation-suno-via-kieai)
5. [Stage 4: Studio-Grade Audio Mixing](#5-stage-4-studio-grade-audio-mixing)
6. [Stage 5: Quality Assurance & Loudness Compliance](#6-stage-5-quality-assurance--loudness-compliance)
7. [Orchestrator Redesign](#7-orchestrator-redesign)
8. [File Structure & New Services](#8-file-structure--new-services)
9. [Implementation Order](#9-implementation-order)

---

## 1. Architecture Overview

### Current State (What Exists)

```
Prompt --> OpenAI Script --> ElevenLabs TTS --> ElevenLabs Music (max 22s) --> Basic FFmpeg Mix
```

**Current Gaps:**
- ElevenLabs music capped at 22 seconds, needs looping for longer ads (sounds repetitive)
- Music prompt is a simple text string, no structured genre/BPM/instrument control
- Mixing is basic volume adjustment only, no real sidechain ducking
- No loudness normalization to broadcast standards (LUFS)
- No audio processing chain (EQ, compression, de-essing)
- No voice-music tempo alignment
- Fade in/out is 100ms flat - not context-aware
- No quality validation on the final output

### Target State (What We're Building)

```
Prompt
  |
  v
[Stage 1] Script Engine (OpenAI GPT-4)
  |  - Analyzes prompt for: ad category, target audience, emotion, duration
  |  - Generates script with embedded pacing hints (sentence structure)
  |  - Outputs: script text + script_metadata (category, emotion, tempo_feel, energy_level)
  |
  v
[Stage 2] Voice Selection & TTS (ElevenLabs)
  |  - AI voice casting based on script_metadata + user preferences
  |  - TTS generation with optimized voice settings per category
  |  - Outputs: voice_audio.mp3 + voice_metadata (duration, word_timestamps if available)
  |
  v
[Stage 3] Music Generation (Suno V5 via Kie.ai API)
  |  - AI-generated music prompt from script_metadata
  |  - Custom mode: style, negativeTags, instrumental=true
  |  - Style/genre matched to ad category
  |  - Duration matched to voice length + padding for fades
  |  - Outputs: music_audio.mp3 + music_metadata (duration, tags, BPM estimate)
  |
  v
[Stage 4] Studio-Grade Mixing Engine (FFmpeg)
  |  - Sidechain compression (voice ducks music automatically)
  |  - Context-aware fade curves (exponential, not linear)
  |  - Dynamic volume automation
  |  - Audio processing chain: EQ > Compression > Limiting
  |  - Outputs: mixed_audio.mp3
  |
  v
[Stage 5] Quality Assurance & Loudness
     - LUFS measurement and normalization
     - True peak limiting (-1 dBTP)
     - Duration validation
     - Output in multiple formats/standards
     - Final: production_ready.mp3
```

---

## 2. Stage 1: Intelligent Script Generation

### What Changes From Current

The current `openai.service.ts` generates a script but doesn't produce any metadata about what it generated. The orchestrator has to guess the category, tone, and energy level later. We need the script generation to return structured metadata alongside the script.

### Implementation Plan

#### 2.1 New Interface: `ScriptGenerationResult`

```typescript
// File: backend/src/services/llm/openai.service.ts

interface ScriptMetadata {
  category: string;         // "tech", "food", "fashion", "automotive", "healthcare", "finance", "entertainment", "retail", "travel", "fitness"
  emotion: string;          // "excited", "calm", "urgent", "warm", "authoritative", "playful", "inspirational"
  energyLevel: number;      // 1-10 scale (1=meditation app, 10=monster truck rally)
  tempoFeel: string;        // "slow", "moderate", "fast", "building" (starts slow, gets faster)
  targetMood: string;       // what the listener should FEEL: "trust", "excitement", "curiosity", "urgency", "comfort"
  suggestedBPM: number;     // recommended background music BPM (60-180)
  wordCount: number;        // actual word count of generated script
  estimatedDuration: number; // estimated seconds at natural pace (wordCount / 2.5)
  callToAction: boolean;    // whether script ends with a CTA
  sentenceCount: number;    // for pacing analysis
}

interface ScriptGenerationResult {
  script: string;
  metadata: ScriptMetadata;
}
```

#### 2.2 Updated System Prompt for Script Generation

The current system prompt is good but needs additions:

```
ADDITIONS TO SYSTEM PROMPT:
- After generating the script, also output a JSON metadata block
- Analyze the script you wrote and determine: category, emotion, energy level (1-10),
  tempo feel, target listener mood, recommended BPM for background music
- BPM Guidelines for ad categories:
    * Calm/wellness/meditation: 60-80 BPM
    * Corporate/professional/finance: 80-100 BPM
    * Retail/food/lifestyle: 100-120 BPM
    * Tech/automotive/entertainment: 110-130 BPM
    * Sports/energy drinks/gaming: 120-150 BPM
    * Urgent sale/limited offer: 130-160 BPM
- The script's sentence rhythm should loosely align with the suggested BPM
  (shorter punchy sentences for high BPM, longer flowing sentences for low BPM)
```

#### 2.3 Two-Pass Script Generation

**Pass 1 - Generate Script:**
- Use the existing prompt structure but enhanced with category-awareness
- Return the raw script text

**Pass 2 - Analyze & Extract Metadata:**
- Send the generated script back to GPT-4 with a structured extraction prompt
- Request JSON output of `ScriptMetadata`
- This metadata flows through the entire pipeline

**Why two passes instead of one?**
- Single-pass often produces worse scripts when asked to also output JSON
- Two-pass keeps the creative generation clean
- The analysis pass uses `temperature: 0.1` for consistent metadata extraction
- Total cost: ~$0.01-0.03 per generation (negligible)

#### 2.4 Enhanced Script Prompt by Ad Category

When the prompt mentions or implies a category, inject category-specific copywriting rules:

| Category | Script Rules |
|----------|-------------|
| **Tech** | Lead with the problem, reveal the solution. Use specific numbers. Short sentences. |
| **Food/Beverage** | Sensory language (taste, smell, texture). Warm tone. Appetite appeal. |
| **Fashion/Beauty** | Aspirational language. Identity-focused. Emotional transformation. |
| **Automotive** | Power and precision words. Sound-related descriptions. Freedom imagery. |
| **Healthcare** | Trust-building. Empathy first, solution second. Regulatory-safe language. |
| **Finance** | Authority and credibility. Specific benefits. Security language. |
| **Entertainment** | High energy. FOMO creation. Time-sensitive language. |
| **Retail/Sale** | Urgency. Specific discounts/numbers. Clear CTA. |
| **Travel** | Escape imagery. Sensory detail. Dreaming language. |
| **Fitness** | Motivation and transformation. Challenge language. Community feel. |

#### 2.5 Files to Modify

| File | Change |
|------|--------|
| `backend/src/services/llm/openai.service.ts` | Add `ScriptMetadata` interface, add `generateScriptWithMetadata()` method, add category-specific prompt injection, add metadata extraction pass |
| `backend/src/models/Script.ts` | Add `metadata` field to Mongoose schema (store the ScriptMetadata JSON) |
| `backend/src/jobs/script-generation.worker.ts` | Update worker to call new method and persist metadata |

---

## 3. Stage 2: Voice Selection & TTS

### What Changes From Current

The current `voice-selector.service.ts` is already solid. The main improvements:

1. Use `script_metadata` from Stage 1 to improve voice matching (instead of re-analyzing the script)
2. Optimize TTS voice settings per ad category (not one-size-fits-all)
3. Extract voice duration precisely after TTS generation

### Implementation Plan

#### 3.1 Category-Aware Voice Settings

The current TTS always uses:
```typescript
{ stability: 0.75, similarity_boost: 0.75, style: 0.5, use_speaker_boost: true }
```

These should vary by ad category and energy level:

```typescript
// File: backend/src/services/tts/voice-settings.config.ts (NEW FILE)

interface VoiceSettingsProfile {
  stability: number;        // 0-1 (lower = more expressive/variable)
  similarity_boost: number; // 0-1 (higher = closer to original voice)
  style: number;            // 0-1 (higher = more stylistic/exaggerated)
  use_speaker_boost: boolean;
}

const VOICE_PROFILES: Record<string, VoiceSettingsProfile> = {
  // Calm, trustworthy delivery
  calm: {
    stability: 0.85,          // Very stable, consistent
    similarity_boost: 0.80,
    style: 0.30,              // Subtle style
    use_speaker_boost: true,
  },
  // Standard professional delivery
  professional: {
    stability: 0.75,
    similarity_boost: 0.75,
    style: 0.45,
    use_speaker_boost: true,
  },
  // Energetic, engaging delivery
  energetic: {
    stability: 0.55,          // More variation = more energy
    similarity_boost: 0.70,
    style: 0.70,              // Higher style for expressiveness
    use_speaker_boost: true,
  },
  // Urgent, sale/promo delivery
  urgent: {
    stability: 0.50,          // Most variation
    similarity_boost: 0.65,
    style: 0.80,              // Maximum style
    use_speaker_boost: true,
  },
  // Warm, friendly delivery (food, lifestyle)
  warm: {
    stability: 0.70,
    similarity_boost: 0.80,
    style: 0.55,
    use_speaker_boost: true,
  },
};
```

**Mapping from metadata to profile:**
```
energyLevel 1-3  -> "calm"
energyLevel 4-5  -> "professional"
energyLevel 6-7  -> "warm" or "energetic" (based on emotion)
energyLevel 8-10 -> "urgent" or "energetic" (based on emotion)
```

#### 3.2 Voice Selector Enhancement

Pass `ScriptMetadata` directly to voice selector instead of re-analyzing:

```typescript
// Enhanced method signature
async selectVoiceForScript(
  scriptContent: string,
  userPrompt?: string,
  metadata?: ScriptMetadata  // NEW: pre-analyzed metadata from Stage 1
): Promise<VoiceMatch>
```

The scoring algorithm additions:
- If metadata.category is "healthcare" or "finance" -> prefer mature, authoritative voices (+30 score)
- If metadata.category is "entertainment" or "fitness" -> prefer young, energetic voices (+30 score)
- If metadata.emotion is "warm" or "calm" -> prefer female voices with warm labels (+20 score)
- If metadata.energyLevel > 7 -> prefer voices labeled "dynamic" or "energetic" (+25 score)

#### 3.3 Post-TTS Duration Extraction

After TTS generation, we MUST get the exact audio duration (not estimated) because the music and mixing stages depend on it:

```typescript
// In the orchestrator, after TTS completes:
const voiceDuration = await ffmpegService.getAudioDuration(voiceFilePath);
// This exact duration is passed to Stage 3 for music length calculation
```

#### 3.4 Files to Modify

| File | Change |
|------|--------|
| `backend/src/services/tts/voice-settings.config.ts` | **NEW** - Category-aware voice settings profiles |
| `backend/src/services/voice-selector.service.ts` | Accept optional `ScriptMetadata`, enhance scoring with category/energy awareness |
| `backend/src/services/tts/elevenlabs.service.ts` | Accept dynamic voice settings from profile instead of hardcoded values |
| `backend/src/jobs/tts-generation.worker.ts` | Pass metadata-derived voice settings to ElevenLabs |

---

## 4. Stage 3: Music Generation (Suno via Kie.ai)

### Why Suno Over ElevenLabs for Music

| Factor | ElevenLabs Sound Gen | Suno V5 (via Kie.ai) |
|--------|---------------------|----------------------|
| **Max Duration** | 22 seconds (hard limit) | Up to 8 minutes |
| **Quality** | Sound effects quality | Full production music |
| **Genre Control** | Basic text prompt only | Custom mode: style, tags, negativeTags |
| **Instrumental** | No dedicated mode | `instrumental: true` flag |
| **Voices in Music** | N/A | Can exclude vocals cleanly |
| **Cost** | Included in ElevenLabs plan | ~$0.015-0.04 per generation |
| **Variations** | Single output | Multiple variations per request |

**Decision: Keep ElevenLabs music as fallback, add Suno as primary music provider.**

### Implementation Plan

#### 4.1 New Service: `suno-music.service.ts`

```typescript
// File: backend/src/services/music/suno-music.service.ts

interface SunoGenerationOptions {
  prompt: string;               // Description for simple mode, lyrics for custom mode
  model: 'V5' | 'V4_5PLUS' | 'V4_5' | 'V4';
  customMode: boolean;
  instrumental: boolean;        // ALWAYS true for ad background music
  style?: string;               // Required in custom mode: "Corporate Pop, Uplifting"
  title?: string;               // Required in custom mode
  negativeTags?: string;         // Styles to exclude: "Heavy Metal, Vocals, Singing"
  callBackUrl?: string;         // Webhook URL for async results
  vocalGender?: 'm' | 'f';     // Only if customMode && !instrumental
  styleWeight?: number;         // 0-1, adherence to style
  weirdnessConstraint?: number; // 0-1, creative deviation
  audioWeight?: number;         // 0-1, balance weight
}

interface SunoTrack {
  id: string;
  audioUrl: string;
  streamAudioUrl: string;
  imageUrl: string;
  prompt: string;
  title: string;
  tags: string;
  duration: number;             // seconds
  createTime: string;
}

interface SunoGenerationResult {
  taskId: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED';
  tracks: SunoTrack[];
}
```

#### 4.2 API Integration Details

**Base URL:** `https://api.kie.ai/api/v1`

**Authentication:** `Authorization: Bearer <KIE_API_KEY>`

**Endpoints to implement:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/generate` | POST | Generate new music |
| `/generate/record-info?taskId=` | GET | Poll for completion |
| `/generate/extend` | POST | Extend music if needed |
| `/lyrics` | POST | Generate lyrics (unused for instrumental) |

**Request flow:**

```
1. POST /generate  ->  returns { taskId: "..." }
2. Poll GET /generate/record-info?taskId=xxx  every 5 seconds
3. When status === "SUCCESS", download audioUrl from tracks[0]
4. Save to local filesystem
```

**Alternative: Callback flow (for production):**
```
1. POST /generate with callBackUrl pointing to our webhook endpoint
2. Kie.ai sends POST to our callback with stages: "text" -> "first" -> "complete"
3. On "complete", extract audio_url and download
```

#### 4.3 Intelligent Music Prompt Design

This is the most critical part. The music prompt sent to Suno determines the quality of the background music. We use GPT-4 to generate an optimized Suno prompt based on the script metadata.

**New method in `voice-selector.service.ts` (or new `music-prompt.service.ts`):**

```typescript
async generateSunoMusicPrompt(
  scriptContent: string,
  metadata: ScriptMetadata
): Promise<SunoMusicPromptResult>
```

**The GPT-4 prompt for music prompt generation:**

```
You are an expert music director for advertisements. Based on the following ad script
and its metadata, create the perfect background music configuration for Suno AI.

Script: {scriptContent}

Metadata:
- Category: {metadata.category}
- Emotion: {metadata.emotion}
- Energy Level: {metadata.energyLevel}/10
- Tempo Feel: {metadata.tempoFeel}
- Suggested BPM: {metadata.suggestedBPM}
- Target Mood: {metadata.targetMood}

Respond with JSON:
{
  "style": "Comma-separated genre/style tags for Suno custom mode. Max 120 chars.
            Example: 'Corporate Pop, Uplifting Piano, Soft Synth Pads'",
  "prompt": "A 1-2 sentence description of the music. Be specific about instruments,
             tempo, and feel. Example: 'A warm corporate track with gentle piano
             arpeggios, soft pad synths, and light percussion at 95 BPM.
             Building energy with subtle string swells.'",
  "negativeTags": "Styles to EXCLUDE. Always include: 'Vocals, Singing, Lyrics,
                   Harsh, Distorted'. Add genre-inappropriate tags.",
  "suggestedBPM": number (refined from metadata),
  "styleWeight": number 0-1 (how strictly to follow the style),
  "weirdnessConstraint": number 0-1 (0=safe/predictable, 1=experimental)
}
```

#### 4.4 Category-to-Music Style Mapping

Pre-built mappings as fallback if GPT-4 prompt generation fails:

```typescript
const CATEGORY_MUSIC_MAP: Record<string, SunoMusicConfig> = {
  tech: {
    style: "Electronic, Ambient, Modern, Synth-driven",
    negativeTags: "Vocals, Singing, Country, Jazz, Heavy Metal",
    bpmRange: [100, 130],
    styleWeight: 0.7,
    weirdnessConstraint: 0.3,
  },
  food: {
    style: "Acoustic, Warm, Jazz, Cafe, Feel-good",
    negativeTags: "Vocals, Singing, Electronic, Heavy, Dark",
    bpmRange: [90, 115],
    styleWeight: 0.6,
    weirdnessConstraint: 0.2,
  },
  fashion: {
    style: "Chic, Electronic Pop, Stylish, Modern Beat",
    negativeTags: "Vocals, Singing, Country, Heavy Metal, Classical",
    bpmRange: [105, 125],
    styleWeight: 0.7,
    weirdnessConstraint: 0.4,
  },
  automotive: {
    style: "Cinematic, Powerful, Driving Beat, Epic",
    negativeTags: "Vocals, Singing, Acoustic, Lo-fi, Jazz",
    bpmRange: [110, 140],
    styleWeight: 0.8,
    weirdnessConstraint: 0.2,
  },
  healthcare: {
    style: "Gentle Piano, Warm Strings, Calm, Reassuring",
    negativeTags: "Vocals, Singing, Electronic, Heavy, Fast, Drums",
    bpmRange: [65, 85],
    styleWeight: 0.8,
    weirdnessConstraint: 0.1,
  },
  finance: {
    style: "Corporate, Professional, Piano, Confident",
    negativeTags: "Vocals, Singing, Experimental, Heavy, Distorted",
    bpmRange: [80, 105],
    styleWeight: 0.8,
    weirdnessConstraint: 0.1,
  },
  entertainment: {
    style: "Upbeat, Fun, Pop, Energetic, Bright",
    negativeTags: "Vocals, Singing, Dark, Sad, Classical, Slow",
    bpmRange: [115, 140],
    styleWeight: 0.6,
    weirdnessConstraint: 0.3,
  },
  retail: {
    style: "Upbeat, Happy, Pop, Bright, Shopping",
    negativeTags: "Vocals, Singing, Dark, Slow, Heavy, Sad",
    bpmRange: [110, 135],
    styleWeight: 0.6,
    weirdnessConstraint: 0.2,
  },
  travel: {
    style: "World, Uplifting, Acoustic, Dreamy, Cinematic",
    negativeTags: "Vocals, Singing, Heavy, Electronic, Dark",
    bpmRange: [90, 120],
    styleWeight: 0.6,
    weirdnessConstraint: 0.3,
  },
  fitness: {
    style: "Electronic, High Energy, Driving, Motivational, EDM",
    negativeTags: "Vocals, Singing, Slow, Acoustic, Jazz, Classical",
    bpmRange: [125, 155],
    styleWeight: 0.7,
    weirdnessConstraint: 0.3,
  },
};
```

#### 4.5 Music Duration Strategy

**Problem:** Voice audio might be 30 seconds, but Suno generates variable-length tracks.

**Solution:**

```
targetMusicDuration = voiceDuration + MUSIC_PADDING

where MUSIC_PADDING:
  - fadeInDuration (music starts before voice): 1.5 - 3.0 seconds
  - fadeOutDuration (music continues after voice): 1.5 - 3.0 seconds
  - total padding: ~3.0 - 6.0 seconds depending on ad duration

For a 30-second voice:
  targetMusicDuration = 30 + 3 (fade-in) + 3 (fade-out) = 36 seconds

Suno V5 can generate up to 8 minutes, so this is never a problem.
If somehow music is shorter than needed:
  1. Try Suno's extend-music endpoint to grow it
  2. Fallback: FFmpeg seamless loop with crossfade at loop point
```

#### 4.6 Polling vs Callback Architecture

**For MVP: Use polling** (simpler, no public webhook needed)

```typescript
// Polling implementation
async waitForCompletion(taskId: string, maxWaitMs = 300000): Promise<SunoGenerationResult> {
  const pollInterval = 5000; // 5 seconds
  const maxAttempts = maxWaitMs / pollInterval;
  let attempts = 0;

  while (attempts < maxAttempts) {
    const result = await this.getTaskStatus(taskId);

    if (result.status === 'SUCCESS') {
      return result;
    }

    if (result.status === 'FAILED') {
      throw new Error(`Suno generation failed: ${result.errorMessage}`);
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
    attempts++;
  }

  throw new Error('Suno generation timed out');
}
```

**For Production Scale: Add callback endpoint**

```typescript
// New route: POST /api/webhooks/suno-callback
// Receives Suno completion notifications
// Updates production status in database
// Triggers next pipeline stage
```

#### 4.7 Track Selection Logic

Suno returns multiple tracks per generation. We need to pick the best one:

```typescript
async selectBestTrack(tracks: SunoTrack[], targetDuration: number): Promise<SunoTrack> {
  // Score each track
  const scored = tracks.map(track => {
    let score = 0;

    // Prefer tracks closest to target duration
    const durationDiff = Math.abs(track.duration - targetDuration);
    score -= durationDiff * 2; // Penalty for duration mismatch

    // Prefer tracks that are slightly longer (can trim) over shorter (can't extend easily)
    if (track.duration >= targetDuration) {
      score += 10;
    }

    return { track, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].track;
}
```

#### 4.8 ElevenLabs Fallback

If Suno fails (API down, rate limited, etc.), fall back to ElevenLabs:

```typescript
async generateMusic(options: MusicGenerationOptions): Promise<MusicResult> {
  try {
    // Primary: Suno via Kie.ai
    return await this.sunoService.generate(options);
  } catch (error) {
    logger.warn('Suno music generation failed, falling back to ElevenLabs:', error.message);
    // Fallback: ElevenLabs (existing implementation)
    return await this.elevenLabsMusic.generateAndSave({
      text: options.prompt,
      duration_seconds: Math.min(options.targetDuration, 22),
      prompt_influence: 0.3,
    }, options.filename);
  }
}
```

#### 4.9 Files to Create/Modify

| File | Change |
|------|--------|
| `backend/src/services/music/suno-music.service.ts` | **NEW** - Suno/Kie.ai API integration |
| `backend/src/services/music/music-prompt.service.ts` | **NEW** - GPT-4 powered music prompt generation |
| `backend/src/services/music/music-provider.service.ts` | **NEW** - Provider abstraction with Suno primary, ElevenLabs fallback |
| `backend/src/services/music/elevenlabs-music.service.ts` | Keep as-is (fallback provider) |
| `backend/src/routes/webhook.routes.ts` | **NEW** - Suno callback webhook endpoint (for production) |
| `backend/src/jobs/music-generation.worker.ts` | Update to use new music provider service |
| `.env` | Add `KIE_API_KEY`, `KIE_API_URL`, `SUNO_MODEL`, `SUNO_CALLBACK_URL` |

---

## 5. Stage 4: Studio-Grade Audio Mixing

### What Changes From Current

The current `ffmpeg.service.ts` has critical limitations:

1. **No real sidechain ducking** - It just sets music to 15% volume flat. Real ducking means music volume drops when voice is speaking and comes back up in pauses.
2. **Linear fades only** - Professional ads use exponential/logarithmic fade curves.
3. **No audio processing** - No EQ, compression, de-essing, or limiting on the voice track.
4. **No loudness normalization** - No LUFS targeting for broadcast compliance.
5. **Normalization is `volume=1.5`** - This is a static gain boost, not normalization.

### Implementation Plan

#### 5.1 New Audio Processing Chain

The mixing engine needs to process audio through a professional signal chain:

```
VOICE TRACK:
  Raw TTS Audio
    -> High-Pass Filter (remove rumble below 80Hz)
    -> De-Esser (reduce sibilance 3-8kHz, threshold -3 to -6dB)
    -> Compressor (ratio 3:1, attack 2ms, release 15ms, threshold -18dB)
    -> EQ (presence boost 2-5kHz +2dB, warmth 200-400Hz +1dB)
    -> Limiter (ceiling -1dBTP)
    -> Processed Voice

MUSIC TRACK:
  Raw Suno Audio
    -> EQ (cut 2-5kHz by -3dB to make room for voice frequencies)
    -> Sidechain Compressor (triggered by voice, ratio 4:1, attack 5ms, release 200ms)
    -> Volume envelope (fade in, sustain at configured level, fade out)
    -> Processed Music

FINAL MIX:
  Processed Voice + Processed Music
    -> Stereo Mix
    -> Loudness Normalization (target: -16 LUFS for streaming, or -23 LUFS for broadcast)
    -> True Peak Limiter (-1 dBTP)
    -> Final Output
```

#### 5.2 FFmpeg Filter Complex Implementation

**Voice Processing Chain (FFmpeg filters):**

```
[0:a]
  highpass=f=80,
  bandreject=f=5500:w=2000:g=0.5,     # Simple de-essing
  compand=attacks=0.002:decays=0.015:
    points=-80/-80|-18/-18|-0/-6:
    soft-knee=6:gain=0,                 # 3:1 compression above -18dB
  equalizer=f=3500:t=q:w=2:g=2,        # Presence boost
  equalizer=f=300:t=q:w=1:g=1,         # Warmth
  alimiter=limit=-1dB:attack=0.5:release=50
[voice_processed]
```

**Sidechain Ducking (the key improvement):**

FFmpeg has a `sidechaincompress` filter that does exactly what we need:

```
# Voice is input [0], Music is input [1]
[voice_processed][music_eq]
  sidechaincompress=
    threshold=0.02:         # Trigger when voice is present (low threshold catches speech)
    ratio=6:                # Strong reduction when voice plays
    attack=10:              # 10ms attack - fast enough to catch speech onset
    release=300:            # 300ms release - music comes back smoothly after words
    makeup=1:               # No makeup gain
    knee=4:                 # Soft knee for natural feel
    mix=0.85                # 85% compressed signal (some uncompressed for naturalness)
[music_ducked]
```

**What this achieves:**
- When the voice is speaking -> music drops by ~10-15dB automatically
- In natural speech pauses (between sentences) -> music swells back up
- Attack of 10ms means music drops almost instantly when voice starts
- Release of 300ms means music returns smoothly, not abruptly
- This creates the professional "breathing" effect heard in studio ads

#### 5.3 Context-Aware Fade Design

Instead of flat 100ms fades, fades should vary by ad duration and category:

```typescript
interface FadeProfile {
  musicFadeIn: number;       // seconds - music fades in before voice starts
  musicFadeOut: number;      // seconds - music fades out after voice ends
  voiceFadeIn: number;       // seconds - voice fade in (prevent pops)
  voiceFadeOut: number;      // seconds - voice fade out
  musicPreroll: number;      // seconds - music plays alone before voice enters
  musicPostroll: number;     // seconds - music plays alone after voice ends
  fadeType: 'exponential' | 'logarithmic' | 'linear' | 'scurve';
}

// Duration-based fade profiles
function getFadeProfile(adDuration: number, energyLevel: number): FadeProfile {
  if (adDuration <= 15) {
    // Short ad: quick fades, minimal pre/post roll
    return {
      musicFadeIn: 0.5,
      musicFadeOut: 1.0,
      voiceFadeIn: 0.02,      // 20ms micro-fade (click prevention)
      voiceFadeOut: 0.03,     // 30ms micro-fade
      musicPreroll: 0.5,      // Music starts 0.5s before voice
      musicPostroll: 1.0,     // Music lingers 1s after voice
      fadeType: 'exponential',
    };
  } else if (adDuration <= 30) {
    // Medium ad: standard broadcast fades
    return {
      musicFadeIn: 1.5,
      musicFadeOut: 2.0,
      voiceFadeIn: 0.02,
      voiceFadeOut: 0.03,
      musicPreroll: 1.5,
      musicPostroll: 2.0,
      fadeType: 'exponential',
    };
  } else {
    // Long ad: cinematic fades
    return {
      musicFadeIn: 2.5,
      musicFadeOut: 3.0,
      voiceFadeIn: 0.02,
      voiceFadeOut: 0.03,
      musicPreroll: 2.5,
      musicPostroll: 3.0,
      fadeType: 'logarithmic',
    };
  }
}
```

**FFmpeg fade types:**
- `exponential`: `afade=t=out:curve=exp` - Sounds most natural for music fadeouts
- `logarithmic`: `afade=t=in:curve=log` - Natural for fade-ins (matches human hearing)
- `s-curve`: `afade=t=out:curve=qsin` - Quarter-sine curve, smooth both ends

#### 5.4 Dynamic Volume Automation

Beyond ducking, we need volume automation for the music track:

```
MUSIC VOLUME TIMELINE (example for 30-second ad):

Time 0.0s - 1.5s:   Music fades in from 0% to 60%  (pre-roll, music alone)
Time 1.5s - 3.0s:   Music at 60%, voice enters       (transition)
Time 3.0s - 27.0s:  Music ducked by sidechain        (voice + music, auto-ducked)
                     During voice: music ~20-25%
                     During pauses: music ~50-60%
Time 27.0s - 28.0s: Voice ends, music un-ducks to 60% (transition)
Time 28.0s - 30.0s: Music fades out from 60% to 0%    (post-roll)
```

Implementation using FFmpeg `volume` filter with expression:

```
# Music volume envelope using FFmpeg expression
volume='if(lt(t,1.5),
  t/1.5*0.6,
  if(lt(t,28),
    0.6,
    if(lt(t,30),
      0.6*(30-t)/2,
      0
    )
  )
)':eval=frame
```

But since we're using `sidechaincompress` for the middle section, we only need the envelope for pre-roll and post-roll fades.

#### 5.5 Voice-Music Level Ratio

Professional ad mixing follows these guidelines:

| Scenario | Voice Level | Music Level | Notes |
|----------|-------------|-------------|-------|
| Voice speaking | 0 dB (reference) | -15 to -20 dB below voice | Music should be felt, not heard |
| Speech pause (< 1s) | N/A | -8 to -12 dB below voice peak | Brief swell, not full volume |
| Speech pause (> 1s) | N/A | -6 to -10 dB below voice peak | Noticeable swell |
| Pre-roll (music only) | N/A | -6 dB from peak | Music establishes presence |
| Post-roll (music only) | N/A | -6 dB from peak, fading | Music closes the ad |

The sidechain compressor handles the automatic levels during speech. The static music volume (input to sidechain) should be set to the "speech pause" level.

#### 5.6 Complete FFmpeg Filter Chain

Here's the full filter complex that replaces the current basic mixing:

```bash
ffmpeg -i voice.mp3 -i music.mp3 -filter_complex "

  # === VOICE PROCESSING ===
  [0:a]
    highpass=f=80,
    bandreject=f=5500:width_type=q:w=2:g=-4,
    compand=attacks=0.002:decays=0.015:points=-80/-80|-18/-18|0/-6:soft-knee=6:gain=2,
    equalizer=f=3500:width_type=q:w=2:g=2,
    equalizer=f=300:width_type=q:w=1:g=1,
    afade=t=in:st=0:d=0.02:curve=tri,
    afade=t=out:st=VOICE_END:d=0.03:curve=tri,
    adelay=PREROLL_MS|PREROLL_MS
  [voice_final];

  # === MUSIC PROCESSING ===
  [1:a]
    equalizer=f=3500:width_type=q:w=2:g=-3,
    equalizer=f=250:width_type=q:w=1:g=1,
    atrim=0:TOTAL_DURATION,
    afade=t=in:st=0:d=MUSIC_FADE_IN:curve=log,
    afade=t=out:st=MUSIC_FADE_OUT_START:d=MUSIC_FADE_OUT:curve=exp,
    volume=0.55
  [music_eq];

  # === SIDECHAIN DUCKING ===
  [voice_final]asplit=2[voice_out][voice_sc];
  [music_eq][voice_sc]
    sidechaincompress=
      threshold=0.015:
      ratio=8:
      attack=8:
      release=280:
      makeup=1:
      knee=6:
      mix=0.9
  [music_ducked];

  # === FINAL MIX ===
  [voice_out][music_ducked]
    amix=inputs=2:duration=longest:dropout_transition=3,
    loudnorm=I=-16:TP=-1.5:LRA=11
  [final]

" -map "[final]" -c:a libmp3lame -b:a 192k -ar 44100 -ac 2 output.mp3
```

**Placeholders to calculate at runtime:**
- `VOICE_END`: voice duration - 0.03
- `PREROLL_MS`: musicPreroll * 1000 (delay voice start so music has pre-roll)
- `TOTAL_DURATION`: voice duration + musicPreroll + musicPostroll
- `MUSIC_FADE_IN`: from fade profile
- `MUSIC_FADE_OUT_START`: total duration - musicFadeOut
- `MUSIC_FADE_OUT`: from fade profile

#### 5.7 Files to Create/Modify

| File | Change |
|------|--------|
| `backend/src/services/audio/ffmpeg.service.ts` | Major rewrite of `mixVoiceAndMusic()` with full processing chain |
| `backend/src/services/audio/mixing-profiles.config.ts` | **NEW** - Fade profiles, level ratios, processing chain configs |
| `backend/src/services/audio/audio-analyzer.service.ts` | **NEW** - LUFS measurement, peak detection, duration analysis |

---

## 6. Stage 5: Quality Assurance & Loudness Compliance

### Implementation Plan

#### 6.1 LUFS Loudness Normalization

FFmpeg's `loudnorm` filter handles this automatically:

```
loudnorm=I=-16:TP=-1.5:LRA=11
```

Parameters:
- `I=-16`: Target integrated loudness of -16 LUFS (good for streaming platforms)
- `TP=-1.5`: True peak max at -1.5 dBTP (safety margin above the -1 dBTP standard)
- `LRA=11`: Loudness range target of 11 LU

**For different output targets:**

```typescript
const LOUDNESS_TARGETS = {
  streaming: { I: -16, TP: -1.5, LRA: 11 },   // Spotify, YouTube, web
  broadcast_us: { I: -24, TP: -2, LRA: 7 },    // ATSC A/85 (US TV)
  broadcast_eu: { I: -23, TP: -1, LRA: 7 },    // EBU R128 (European TV)
  podcast: { I: -16, TP: -1, LRA: 11 },         // Podcast platforms
  radio: { I: -16, TP: -1, LRA: 7 },            // Radio broadcast
};
```

#### 6.2 Two-Pass Loudness Normalization

FFmpeg's `loudnorm` works best as a two-pass filter for accurate results:

**Pass 1 (Measurement):**
```bash
ffmpeg -i input.mp3 -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null -
```
This outputs measured loudness values (input_i, input_tp, input_lra, input_thresh, target_offset).

**Pass 2 (Apply):**
```bash
ffmpeg -i input.mp3 -af loudnorm=I=-16:TP=-1.5:LRA=11:
  measured_I={input_i}:measured_TP={input_tp}:measured_LRA={input_lra}:
  measured_thresh={input_thresh}:offset={target_offset}:linear=true
  -c:a libmp3lame -b:a 192k output.mp3
```

#### 6.3 Quality Validation

After the final mix, run automated checks:

```typescript
interface QualityReport {
  passed: boolean;
  integratedLoudness: number;  // LUFS
  truePeak: number;            // dBTP
  loudnessRange: number;       // LU
  duration: number;            // seconds
  durationMatch: boolean;      // within 5% of target
  clipping: boolean;           // any samples at 0 dBFS
  silenceDetected: boolean;    // unexpected silence gaps > 500ms
  format: {
    codec: string;
    bitrate: number;
    sampleRate: number;
    channels: number;
  };
  issues: string[];            // human-readable issues list
}
```

**Validation checks:**
1. Integrated loudness within ±1 LU of target
2. True peak below threshold (-1 dBTP)
3. No clipping detected
4. Duration within ±5% of target
5. No unexpected silence gaps longer than 500ms (indicates a processing error)
6. Output format matches specification (MP3/192kbps/44100Hz/stereo)

#### 6.4 Multi-Format Output

Generate multiple output files for different platforms:

```typescript
async generateOutputVariants(masterPath: string): Promise<OutputVariants> {
  return {
    streaming: await this.normalizeToTarget(masterPath, 'streaming'),  // -16 LUFS, MP3 192k
    broadcast: await this.normalizeToTarget(masterPath, 'broadcast_us'), // -24 LUFS, WAV
    web: await this.normalizeToTarget(masterPath, 'streaming'),         // -16 LUFS, AAC 128k
    preview: await this.generatePreview(masterPath),                     // -16 LUFS, MP3 64k, compressed
  };
}
```

#### 6.5 Files to Create

| File | Change |
|------|--------|
| `backend/src/services/audio/loudness.service.ts` | **NEW** - Two-pass LUFS normalization, measurement |
| `backend/src/services/audio/quality-validator.service.ts` | **NEW** - Post-mix quality checks |

---

## 7. Orchestrator Redesign

### What Changes From Current

The current `production.orchestrator.ts` runs stages sequentially through BullMQ queues. The redesign adds:

1. `ScriptMetadata` flowing through all stages
2. Suno music generation with polling
3. New mixing engine with processing chain
4. Quality validation gate before marking complete
5. Better error recovery (retry individual stages, not entire pipeline)

### New Pipeline Flow

```typescript
async runPipeline(productionId: string, config: PipelineConfig): Promise<void> {

  // ===== STAGE 1: SCRIPT =====
  updateStatus(productionId, 'GENERATING_SCRIPT', 5);

  const { script, metadata } = await scriptService.generateScriptWithMetadata({
    prompt: config.prompt,
    tone: config.tone,
    duration: config.duration,
  });
  // Save script + metadata to DB

  updateStatus(productionId, 'SELECTING_VOICE', 15);

  // ===== STAGE 2: VOICE =====
  const voiceProfile = getVoiceSettingsProfile(metadata);
  const selectedVoice = await voiceSelector.selectVoiceForScript(
    script, config.prompt, metadata
  );

  updateStatus(productionId, 'GENERATING_VOICE', 25);

  const voiceResult = await ttsService.generateSpeech(
    script, selectedVoice.voiceId, voiceProfile
  );
  const voiceDuration = await ffmpegService.getAudioDuration(voiceResult.filePath);

  updateStatus(productionId, 'GENERATING_MUSIC', 40);

  // ===== STAGE 3: MUSIC =====
  const fadeProfile = getFadeProfile(voiceDuration, metadata.energyLevel);
  const targetMusicDuration = voiceDuration + fadeProfile.musicPreroll + fadeProfile.musicPostroll;

  const musicPromptResult = await musicPromptService.generateSunoPrompt(script, metadata);

  const musicResult = await musicProvider.generateMusic({
    style: musicPromptResult.style,
    prompt: musicPromptResult.prompt,
    negativeTags: musicPromptResult.negativeTags,
    instrumental: true,
    targetDuration: targetMusicDuration,
    model: 'V5',
  });

  updateStatus(productionId, 'MIXING', 65);

  // ===== STAGE 4: MIXING =====
  const mixResult = await ffmpegService.studioMix({
    voicePath: voiceResult.filePath,
    musicPath: musicResult.filePath,
    voiceDuration,
    fadeProfile,
    metadata,
    outputPath: generateOutputPath(productionId),
    loudnessTarget: 'streaming',
  });

  updateStatus(productionId, 'VALIDATING', 85);

  // ===== STAGE 5: VALIDATION =====
  const qualityReport = await qualityValidator.validate(mixResult.outputPath, {
    targetDuration: config.duration,
    loudnessTarget: 'streaming',
  });

  if (!qualityReport.passed) {
    logger.warn('Quality validation failed, attempting remediation', qualityReport.issues);
    // Attempt auto-fix (re-normalize, trim silence, etc.)
    await this.attemptRemediation(mixResult.outputPath, qualityReport);
  }

  updateStatus(productionId, 'COMPLETED', 100);
}
```

### Production Status Updates

Rename statuses for clarity:

```
PENDING -> GENERATING_SCRIPT -> SELECTING_VOICE -> GENERATING_VOICE ->
GENERATING_MUSIC -> MIXING -> VALIDATING -> COMPLETED | FAILED
```

### Files to Modify

| File | Change |
|------|--------|
| `backend/src/services/production.orchestrator.ts` | Full rewrite with new pipeline, metadata flow, Suno integration |
| `backend/src/models/Production.ts` | Add new status values, add `metadata` field, add `qualityReport` field |

---

## 8. File Structure & New Services

### New Files to Create

```
backend/src/services/
  audio/
    ffmpeg.service.ts              # REWRITE - Studio mixing engine
    mixing-profiles.config.ts      # NEW - Fade profiles, ducking settings
    audio-analyzer.service.ts      # NEW - Duration, peak, silence detection
    loudness.service.ts            # NEW - LUFS measurement & normalization
    quality-validator.service.ts   # NEW - Post-mix quality checks
  music/
    elevenlabs-music.service.ts    # KEEP - Fallback provider
    suno-music.service.ts          # NEW - Suno/Kie.ai primary provider
    music-prompt.service.ts        # NEW - GPT-4 music prompt generation
    music-provider.service.ts      # NEW - Provider abstraction layer
  tts/
    elevenlabs.service.ts          # MINOR UPDATE - Accept dynamic settings
    voice-settings.config.ts       # NEW - Category-based voice profiles
  llm/
    openai.service.ts              # UPDATE - Add metadata extraction
  voice-selector.service.ts        # UPDATE - Accept metadata, enhanced scoring
  production.orchestrator.ts       # REWRITE - New pipeline flow

backend/src/routes/
  webhook.routes.ts                # NEW - Suno callback endpoint

backend/src/models/
  Script.ts                        # UPDATE - Add metadata field
  Production.ts                    # UPDATE - New statuses, qualityReport
```

### Environment Variables to Add

```env
# Suno/Kie.ai Music Generation
KIE_API_KEY=your-kie-api-key
KIE_API_URL=https://api.kie.ai/api/v1
SUNO_MODEL=V5
SUNO_CALLBACK_URL=https://your-domain.com/api/webhooks/suno
SUNO_POLL_INTERVAL_MS=5000
SUNO_MAX_WAIT_MS=300000

# Audio Processing
LOUDNESS_TARGET=streaming
LOUDNESS_STREAMING_LUFS=-16
LOUDNESS_BROADCAST_US_LUFS=-24
LOUDNESS_BROADCAST_EU_LUFS=-23
TRUE_PEAK_LIMIT=-1.5
```

---

## 9. Implementation Order

### Phase 1: Foundation (Do First)

| Step | Task | Effort | Dependencies |
|------|------|--------|-------------|
| 1.1 | Create `voice-settings.config.ts` with category profiles | Small | None |
| 1.2 | Create `mixing-profiles.config.ts` with fade profiles | Small | None |
| 1.3 | Add `ScriptMetadata` interface to `openai.service.ts` | Small | None |
| 1.4 | Add `metadata` field to Script and Production Mongoose models | Small | None |
| 1.5 | Add new env vars to `.env.example` | Small | None |

### Phase 2: Suno Integration

| Step | Task | Effort | Dependencies |
|------|------|--------|-------------|
| 2.1 | Create `suno-music.service.ts` - API client with generate + poll | Medium | 1.5 |
| 2.2 | Create `music-prompt.service.ts` - GPT-4 prompt generation | Medium | 1.3 |
| 2.3 | Create `music-provider.service.ts` - Suno primary + ElevenLabs fallback | Small | 2.1, 2.2 |
| 2.4 | Update `music-generation.worker.ts` to use new provider | Small | 2.3 |
| 2.5 | Test Suno generation end-to-end (standalone) | Medium | 2.4 |

### Phase 3: Script Enhancement

| Step | Task | Effort | Dependencies |
|------|------|--------|-------------|
| 3.1 | Add `generateScriptWithMetadata()` to `openai.service.ts` | Medium | 1.3 |
| 3.2 | Add category-specific prompt injection | Medium | 3.1 |
| 3.3 | Update `script-generation.worker.ts` to persist metadata | Small | 3.1 |
| 3.4 | Update `voice-selector.service.ts` to accept metadata | Small | 1.1, 3.1 |

### Phase 4: Studio Mixing Engine

| Step | Task | Effort | Dependencies |
|------|------|--------|-------------|
| 4.1 | Create `audio-analyzer.service.ts` | Medium | None |
| 4.2 | Create `loudness.service.ts` - Two-pass LUFS normalization | Medium | 4.1 |
| 4.3 | Rewrite `ffmpeg.service.ts` `mixVoiceAndMusic()` with full chain | Large | 4.1, 4.2 |
| 4.4 | Implement sidechain ducking in FFmpeg filter complex | Large | 4.3 |
| 4.5 | Implement context-aware fades (exponential/log curves) | Medium | 4.3 |
| 4.6 | Create `quality-validator.service.ts` | Medium | 4.1, 4.2 |
| 4.7 | Test mixing with various voice + music combinations | Large | 4.4, 4.5, 4.6 |

### Phase 5: Orchestrator Integration

| Step | Task | Effort | Dependencies |
|------|------|--------|-------------|
| 5.1 | Rewrite `production.orchestrator.ts` with new pipeline | Large | All above |
| 5.2 | Update Production model with new statuses | Small | 5.1 |
| 5.3 | Update frontend progress tracking for new statuses | Small | 5.2 |
| 5.4 | End-to-end pipeline testing | Large | 5.1 |
| 5.5 | Add webhook route for Suno callbacks (production scaling) | Medium | 5.1 |

### Phase 6: Polish & Production

| Step | Task | Effort | Dependencies |
|------|------|--------|-------------|
| 6.1 | Multi-format output generation | Medium | 5.1 |
| 6.2 | Error recovery (retry individual stages) | Medium | 5.1 |
| 6.3 | Performance optimization (parallel where possible) | Medium | 5.1 |
| 6.4 | Frontend updates for new music provider UI | Medium | 5.1 |
| 6.5 | Comprehensive integration tests | Large | All |

---

## Summary: Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Music Provider | Suno V5 (primary) + ElevenLabs (fallback) | Suno: 8-min tracks, real music quality, instrumental mode. ElevenLabs: reliability fallback. |
| Suno API Access | Kie.ai proxy | Direct Suno API not publicly available. Kie.ai provides stable, documented access. |
| Suno Result Handling | Polling (MVP) -> Callbacks (production) | Polling is simpler to implement. Callbacks added later for scale. |
| Audio Ducking | FFmpeg `sidechaincompress` | Native FFmpeg filter, no external dependencies. Professional-grade sidechain compression. |
| Fade Curves | Exponential/Logarithmic via FFmpeg `afade` | Matches human hearing perception. Linear sounds unnatural. |
| Voice Processing | FFmpeg highpass + compand + equalizer + alimiter | Full processing chain in single FFmpeg command. No extra tools needed. |
| Loudness Standard | -16 LUFS (streaming default), configurable per platform | -16 is the universal streaming standard. -24/-23 for TV. |
| Loudness Normalization | FFmpeg `loudnorm` two-pass | Two-pass is more accurate than single-pass. Industry standard approach. |
| Metadata Flow | Script generates metadata, flows through all stages | Eliminates redundant AI analysis calls. Single source of truth. |
| Model for Suno | V5 (latest) | Best quality, fastest generation, up to 8 minutes. |
