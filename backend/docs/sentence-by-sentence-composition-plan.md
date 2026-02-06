# Sentence-by-Sentence Ad Composition – Plan

## Goal

Compose the ad **sentence by sentence**: music and mix (volume, emphasis) align to each sentence’s content and timing, like a human composer scoring the ad at a fine-grained level.

## Current State

- **Script**: Single `script` string from LLM; script metadata includes `adProductionJson` (context, music, fades, volume, optional `music.arc`).
- **Music**: Either one track or segment-based **arc** (2–4 segments: intro, product_intro, CTA) with per-segment prompts; segments are generated and concatenated.
- **TTS**: ElevenLabs standard endpoint; no timestamps. Voice audio is mixed with a single music volume (and optional ducking).
- **Volume**: LLM can output `volume.segments` (start/end seconds, type, intensity), but the mixer does **not** yet apply them; they are only stored in production settings.

## Research: Timestamps

- **ElevenLabs**: `POST /v1/text-to-speech/:voice_id/with-timestamps` returns JSON with `audio_base64` and `alignment`:
  - `alignment.characters`, `alignment.character_start_times_seconds`, `alignment.character_end_times_seconds` (character-level).
- **Word/sentence boundaries**: Not provided by the API. We derive them from the **same text** we send for TTS:
  - **Words**: Split on spaces; map each word to character index range; use first character’s start and last character’s end for that word’s time range.
  - **Sentences**: Split script on sentence boundaries (`. ! ?` plus newlines); map each sentence to character index range; use character alignment to get `startSeconds` / `endSeconds` per sentence.

Script may contain ElevenLabs tags (e.g. `[excited]`, `[pause]`). Alignment is for the **exact text** sent to the API; we send `script.content` as-is, so character indices and lengths match.

## Architecture (Sentence-by-Sentence)

1. **Timing source of truth**: TTS **with-timestamps** gives character-level alignment; we compute sentence (and optionally word) timings and store them in script metadata.
2. **LLM sentence-level cues**: Extend the LLM response so the script is structured **per sentence** (or we split the flat script into sentences and ask the LLM for one cue per sentence). Each sentence has:
   - `text` (or we match by index)
   - Optional `musicCue` (e.g. "upbeat", "dramatic pause", "swell")
   - Optional `musicVolumeMultiplier` (e.g. 0.8 for quieter under this sentence, 1.2 for emphasis)
3. **Mixing**: One background music track (or the existing arc-composed track). Apply **sentence-level volume automation** to the music (and optionally to voice) using the stored sentence timings and LLM cues, via FFmpeg `volume` with `enable` expressions or a series of `volume` + `atrim`/`concat` for each segment.

## Implementation Phases

### Phase 1: TTS with timestamps and sentence alignment

- **1.1** In `elevenlabs.service.ts`:
  - Add `generateSpeechWithTimestamps(options)` that calls `POST .../with-timestamps`, returns `{ audioBuffer, alignment }` (alignment: `characters`, `character_start_times_seconds`, `character_end_times_seconds`).
- **1.2** Add a small util (e.g. `alignmentToSentenceTimings(script, alignment)`) that:
  - Splits script into sentences (regex or simple split on `. ! ?`).
  - For each sentence, finds its character range in the original script.
  - Uses alignment arrays to get `startSeconds` and `endSeconds` for that range.
  - Returns `Array<{ text, startSeconds, endSeconds }>`.
- **1.3** In `ttsGeneration.worker.ts`:
  - For **pipeline** runs (e.g. when script has `metadata.adProductionJson`), call `generateSpeechWithTimestamps` instead of `generateSpeech`.
  - Decode base64 audio from the JSON response and save as before (same path/filename).
  - Run `alignmentToSentenceTimings(script.content, alignment)` and store in `script.metadata.lastTTS.sentenceTimings` (and optionally `wordTimings` later).
- **1.4** Keep backward compatibility: if with-timestamps fails or is unavailable, fall back to current `generateSpeech` and leave `sentenceTimings` undefined.

### Phase 2: LLM sentence-level cues

- **2.1** Extend `AdProductionLLMResponse` (and Zod/OpenAI schema) with optional `scriptSentences`:
  - `scriptSentences?: Array<{ text: string; musicCue?: string; musicVolumeMultiplier?: number }>`  
  Or keep a single `script` string and add `sentenceCues?: Array<{ index: number; musicCue?: string; musicVolumeMultiplier?: number }>` (index = sentence index).
- **2.2** Prefer **one script string + sentence cues by index**: LLM outputs the same script as today plus an array of cues per sentence (by order). Fewer token/parsing issues than duplicating full text.
- **2.3** Update LLM prompts to ask for sentence-by-sentence scoring: e.g. “For each sentence, suggest a short musicCue and optional musicVolumeMultiplier (0.7–1.3) so the mix supports the message.”
- **2.4** After TTS, **merge** real timings with LLM cues: match by sentence index; output structure like `Array<{ text, startSeconds, endSeconds, musicCue?, musicVolumeMultiplier? }>`. Store merged list in `script.metadata.lastTTS.sentenceTimings` (or a dedicated `script.metadata.sentenceComposition`).

### Phase 3: Mixer uses sentence-level automation

- **3.1** Audio mixing worker:
  - Read `script.metadata.lastTTS.sentenceTimings` (or `sentenceComposition`) and production `settings.volumeSegments` (existing).
  - If sentence timings + per-sentence music volume are present, pass them to FFmpeg service (e.g. `sentenceVolumeCurve: Array<{ start, end, musicVolumeMultiplier }>`).
- **3.2** FFmpeg:
  - Build a music chain that applies **time-dependent volume**: e.g. split music into segments by sentence boundaries, apply per-segment volume, then concat. Alternative: use a single filter with `volume='if(between(t,start,end), mult, 1)'` style (can be complex with many segments). Simplest robust approach: for each sentence time range, use `atrim` + `volume` + concat for the music track, then mix with voice.
  - Apply the same automation logic for **existing** `volume.segments` (voice up / music up) so both sentence-level and segment-level cues are supported.

### Phase 4 (optional): Word-level or phrase-level

- Use the same character alignment to compute **word** timings; expose in metadata for future use (e.g. captions, even finer automation).

## Data flow summary

1. **Script generation**: LLM returns `script` + optional `sentenceCues[]` (per-sentence musicCue / musicVolumeMultiplier).
2. **TTS**: Call ElevenLabs with-timestamps; get character alignment; compute sentence timings; save audio + `sentenceTimings` (and merge cues if present).
3. **Music**: Unchanged (single track or arc-based composed track).
4. **Mixing**: Voice + music; music volume automation from sentence timings + sentenceCues (and existing volume.segments if present).

## Files to touch

| Area              | Files |
|-------------------|--------|
| TTS + alignment   | `backend/src/services/tts/elevenlabs.service.ts`, new util e.g. `backend/src/utils/alignment-to-sentences.ts`, `backend/src/jobs/ttsGeneration.worker.ts` |
| LLM schema/prompt | `backend/src/types/ad-production.ts`, `backend/src/services/llm/openai.service.ts` |
| Mixer             | `backend/src/jobs/audioMixing.worker.ts`, `backend/src/services/audio/ffmpeg.service.ts` |
| Orchestrator      | Only if we pass sentence composition into production settings (e.g. from script metadata) for the mixer. |

## Success criteria

- For pipeline runs, TTS returns and stores sentence-level timings.
- LLM can optionally output sentence-level music/volume cues (stored for future use).

**Current behaviour (continuous flow):** The mixer does *not* apply sentence-based volume automation. Music is kept at one continuous level (stretch/extend to voice length, then mix with ducking and fades only). This avoids any perception of music "stopping" between sentences. Any future dip or pause would only be applied when there is an explicit, intentional reason (e.g. a dedicated dramatic_pause cue) and implemented as a separate, sparing feature.
