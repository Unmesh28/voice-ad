# Music continuity in audio ads – research and plan

## Problem

Music is perceived as **breaking in between** during the ad – it does not feel like a continuous flow.

## Research: how human ads handle music

### One track per ad

- **Spotify / best practice**: “Stick to **one music track per ad**.” Background music should be one continuous bed.
- **Music beds**: Defined as “**single, continuous tracks** without cuts or breaks” (stock music / radio production). Instrumental, loopable, steady.
- **Talk-over beds**: One instrumental track under the whole spot; “**subtle presence**” and “low volume” so the voice stays focal. Music **supports** the voice, does not compete.

### No mid-ad cuts or seams

- Music beds use “**minimalist composition that avoids dramatic changes** that could distract.” So no sudden drops, stops, or obvious segment boundaries.
- **Ducking** = lowering music *level* when voice is present. The music **keeps playing**; only the volume changes. It does not mean cutting or splicing the music.
- Crossfades between *programme* elements are a separate concern; for the **ad itself**, the bed is one continuous piece.

### Root cause in our pipeline

When the LLM returns **music.arc** (2–4 segments, e.g. intro → product_intro → CTA), we:

1. Generate a **separate AI music clip per segment** (different prompts, BPM, feel).
2. **Concatenate** them with FFmpeg `concat` demuxer (`-c copy`), i.e. **hard cuts** with no crossfade.

Result: at each segment boundary there is an **audible seam** – different key, texture, energy, or tone. That is what listeners hear as “music breaking in between.”

So the break is not from sentence-level volume automation (that’s already disabled). It comes from **arc-based multi-clip composition**.

## Plan (aligned with human ad practice)

1. **One music track per ad**  
   Do **not** use music.arc to generate multiple clips and concatenate them. Always generate **one** music track per production from the main `music.prompt` (and targetBPM / genre / mood).

2. **Orchestrator**  
   - **Disable** the arc path: when the LLM returns `music.arc`, ignore it for generation.  
   - Always take the **single-track path**: one `musicGenerationQueue.add` using the main prompt and duration (stretch or extend to voice length as we already do).

3. **LLM / schema**  
   - Keep `music.arc` in the schema and in the prompt as **optional creative guidance** (e.g. for logging or future “one track with arc-inspired prompt”).  
   - Optionally adjust the prompt so we encourage “one cohesive music bed for the whole ad” and de-emphasise “different music per section” so the model tends toward one style.

4. **Mix**  
   - No change: one continuous music file, stretch/extend to voice length, then mix with **ducking and fades only**. No sentence-level volume automation.

## Outcome

- Music is a **single continuous bed** from start to end.  
- No seams from concatenating different clips.  
- Aligns with human ad practice: one track, continuous flow, ducking under voice only.
