# Plan: Replace AI-Generated Music with Pre-Analyzed Music Library (RAG)

## Overview

Replace the Suno/Kie.ai music generation pipeline with a **music library selection system** where an LLM chooses the best pre-analyzed track from a local JSON catalog based on the user's prompt. TTS continues using ElevenLabs as before. The LLM returns the selected track along with mixing parameters (volume, pauses, fades, etc.), and the audio mixing stage combines the selected track with the TTS output.

---

## Step-by-Step Plan

### Step 1: Save the Music Catalog JSON

- **File**: `backend/src/data/music-catalog.json`
- Save the 47-track analyzed music catalog as a static JSON file in the backend
- This serves as the "memory" / knowledge base for the LLM

### Step 2: Create a Music Library Service

- **File**: `backend/src/services/music/music-library.service.ts`
- Responsibilities:
  - Load and parse `music-catalog.json` at startup
  - Provide a method `getTrackSummaries()` that returns a compact representation of all tracks (filename, genre, mood, energy_level, instruments, tempo_bpm, duration, brief_description, suitable_use_cases) — stripped of raw technical data to fit in LLM context
  - Provide a method `getTrackByFilename(filename: string)` to retrieve full track details
  - Provide a method `getTrackFilePath(filename: string)` to return the absolute path to the music file

### Step 3: Create LLM Music Selector Service

- **File**: `backend/src/services/music/llm-music-selector.service.ts`
- Responsibilities:
  - Takes the user prompt (and optionally the generated script + context metadata) as input
  - Builds a system prompt that includes the compact track summaries from Step 2
  - Calls OpenAI GPT-4 asking it to select the best track for the ad, returning structured JSON:
    ```typescript
    {
      selectedTrack: {
        filename: string,           // The chosen track's filename
        reasoning: string,          // Why this track was chosen
      },
      mixingParameters: {
        musicVolume: number,        // 0.0 - 1.0 (relative to voice)
        fadeInSeconds: number,      // Music fade-in duration
        fadeOutSeconds: number,     // Music fade-out duration
        fadeCurve: string,          // "exp" | "tri" | "qsin"
        voiceVolume: number,        // Voice volume multiplier
        audioDucking: boolean,      // Whether to duck music when voice plays
        duckingAmount: number,      // 0.0 - 1.0
        musicDelay: number,         // Seconds before music starts (pre-roll)
        pauseBeforeCTA: number,     // Seconds of pause before call-to-action
      },
      script: string,               // The generated ad script
      scriptContext: {               // Metadata about the script
        adCategory: string,
        tone: string,
        emotion: string,
        pace: string,
      }
    }
    ```
  - Uses OpenAI structured output (json_schema) for reliable parsing

### Step 4: Modify the Script Generation to Include Music Selection

- **File**: `backend/src/services/llm/openai.service.ts`
- Add a new method `generateAdWithMusicSelection()` that:
  1. Receives user prompt + compact track catalog
  2. In a single LLM call, generates both:
     - The ad script (text, context, tone, etc.)
     - The selected music track (from catalog) with mixing parameters
  - This is more efficient than two separate LLM calls and ensures the script and music choice are coherent
- Alternatively, keep script generation separate and add music selection as a second LLM call in the orchestrator. (The single-call approach is preferred for coherence.)

### Step 5: Update the Music Generation Worker

- **File**: `backend/src/jobs/musicGeneration.worker.ts`
- Instead of calling Suno/Kie.ai API:
  - Receive the selected track filename from the LLM selector
  - Copy/reference the track file from the music library directory to the production's working directory
  - Skip polling, quality scoring (the tracks are pre-analyzed)
  - Return the music file path as before, so downstream mixing is unaffected

### Step 6: Update the Production Orchestrator

- **File**: `backend/src/services/production.orchestrator.ts`
- Modify the pipeline flow:
  1. **Script Generation** stage now also includes music selection (via the new `generateAdWithMusicSelection()` method or a separate `selectMusicFromLibrary()` call after script generation)
  2. **Music "Generation"** stage becomes **Music Selection** — no API call, just resolve the file from the library
  3. **TTS Generation** stage remains the same (ElevenLabs)
  4. **Audio Mixing** stage remains the same (FFmpeg) — it receives voice file + music file + mixing parameters and combines them
- The mixing parameters (volume, fades, ducking) from the LLM response are passed through to the mixing stage instead of the hardcoded/script-derived values

### Step 7: Update Types

- **File**: `backend/src/types/` (relevant type files)
- Add types for:
  - `MusicCatalogTrack` — shape of each track in the catalog
  - `MusicSelectionResult` — LLM's selection response
  - `MusicLibraryMixParams` — mixing parameters from LLM
- Update `ProductionJobData` or equivalent to carry the selected track info

### Step 8: Configure Music Library Path

- **File**: `backend/.env` / config
- Add env var `MUSIC_LIBRARY_PATH` pointing to the directory containing the actual music files (e.g., `/Users/unmeshdabhade/Downloads/music` or a deployed location)
- The catalog JSON maps filenames to this directory

### Step 9: Handle Edge Cases

- If the LLM cannot find a suitable track (unlikely with 47 tracks), fall back to the closest match or return an error
- Tracks with `parse_error` in `human_analysis` (like the first track) or `error: "File too large"` — use only their technical data for matching, or exclude them from LLM context
- Handle missing music files gracefully (file not found at expected path)

---

## What Changes vs. What Stays the Same

| Component | Before | After |
|-----------|--------|-------|
| Script Generation | OpenAI GPT-4 | OpenAI GPT-4 (same, but now also selects music) |
| TTS | ElevenLabs | ElevenLabs (unchanged) |
| Music | Suno API call + polling + quality scoring | LLM selects from pre-analyzed catalog (instant) |
| Audio Mixing | FFmpeg (voice + music) | FFmpeg (voice + music) — unchanged |
| Music Prompts | Generated from script metadata | Not needed — LLM picks from catalog |
| Quality Scoring | Analyze generated music | Not needed — tracks pre-analyzed |

## Files to Create
1. `backend/src/data/music-catalog.json` — the track catalog
2. `backend/src/services/music/music-library.service.ts` — catalog loader + query
3. `backend/src/services/music/llm-music-selector.service.ts` — LLM-based track selection

## Files to Modify
4. `backend/src/services/llm/openai.service.ts` — add music selection method
5. `backend/src/services/production.orchestrator.ts` — update pipeline flow
6. `backend/src/jobs/musicGeneration.worker.ts` — replace API calls with file lookup
7. `backend/src/types/` — add new types
8. `backend/.env` / config — add music library path
