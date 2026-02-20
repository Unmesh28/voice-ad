import axios from 'axios';
import { logger } from '../../config/logger';
import type { AdProductionInput, AdProductionLLMResponse, MusicSelectionResult } from '../../types/ad-production';
import {
  parseAndValidateAdProductionResponse,
  getAdProductionExampleJSONString,
  getOpenAIAdProductionJsonSchema,
} from '../../types/ad-production';
import { getTemplateSummaryForPrompt } from '../../types/ad-format';
import musicLibraryService from '../music/music-library.service';

interface GenerateScriptParams {
  prompt: string;
  tone?: string;
  length?: 'short' | 'medium' | 'long';
  durationSeconds?: number;
  targetAudience?: string;
  productName?: string;
  additionalContext?: string;
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

class OpenAIService {
  private apiKey: string;
  private apiUrl: string;
  private model: string;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || '';
    this.apiUrl = 'https://api.openai.com/v1/chat/completions';
    this.model = process.env.OPENAI_MODEL || 'gpt-4o';

    if (!this.apiKey) {
      logger.warn('OpenAI API key not configured');
    }
  }

  /**
   * Generate ad script using OpenAI GPT-4
   */
  async generateScript(params: GenerateScriptParams): Promise<string> {
    try {
      const systemPrompt = this.buildSystemPrompt();
      const userPrompt = this.buildUserPrompt(params);

      const messages: OpenAIMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      logger.info('Generating script with OpenAI', {
        model: this.model,
        tone: params.tone,
        length: params.length,
      });

      const response = await axios.post(
        this.apiUrl,
        {
          model: this.model,
          messages,
          temperature: 0.7,
          max_tokens: this.getMaxTokens(params.length),
          top_p: 1,
          frequency_penalty: 0.3,
          presence_penalty: 0.3,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          timeout: 60000, // 60 seconds timeout
        }
      );

      const generatedText = response.data.choices[0]?.message?.content?.trim();

      if (!generatedText) {
        throw new Error('No content generated from OpenAI');
      }

      logger.info('Script generated successfully', {
        length: generatedText.length,
        tokens: response.data.usage?.total_tokens,
      });

      return generatedText;
    } catch (error: any) {
      logger.error('Error generating script with OpenAI:', {
        message: error.message,
        response: error.response?.data,
      });

      if (error.response?.status === 401) {
        throw new Error('Invalid OpenAI API key');
      } else if (error.response?.status === 429) {
        throw new Error('OpenAI rate limit exceeded. Please try again later.');
      } else if (error.response?.status === 500) {
        throw new Error('OpenAI service error. Please try again later.');
      }

      throw new Error(`Failed to generate script: ${error.message}`);
    }
  }

  /**
   * Generate full ad production payload as structured JSON (script, context, music, fades, volume).
   * Single LLM call returns everything needed for the pipeline.
   * Uses OpenAI Structured Output (json_schema) when the model supports it; otherwise json_object + Zod.
   */
  async generateAdProductionJSON(
    input: AdProductionInput
  ): Promise<AdProductionLLMResponse> {
    const durationSeconds = input.durationSeconds ?? 30;
    // Detect non-English scripts (Hindi, Devanagari, etc.) which have longer words
    // and need fewer words per second to fill the same duration.
    const promptText = (input.prompt || '').toLowerCase();
    const hasDevanagari = /[\u0900-\u097F]/.test(input.prompt || '');
    const hindiKeywords = /\b(hindi|हिन्दी|हिंदी|devanagari)\b/i.test(promptText);
    const isNonEnglish = hasDevanagari || hindiKeywords;
    // Hindi/Devanagari: ~2.0 words/sec (longer compound words, more syllables)
    // English: ~2.5 words/sec
    const wordsPerSecond = isNonEnglish ? 2.0 : 2.5;
    const targetWords = Math.round(durationSeconds * wordsPerSecond);

    let systemPrompt = this.buildAdProductionSystemPrompt();
    const userPrompt = this.buildAdProductionUserPrompt(input, targetWords);

    // Check if prompt fits within model context window; if not, use condensed prompt
    const contextLimit = this.getModelContextLimit();
    let maxTokens = 2000;
    const estimatedPromptTokens = this.estimateTokens(systemPrompt + userPrompt);
    if (estimatedPromptTokens + maxTokens > contextLimit) {
      logger.warn(`Prompt too large for ${this.model} (${estimatedPromptTokens} + ${maxTokens} > ${contextLimit}). Using condensed prompt.`);
      systemPrompt = this.buildCondensedAdProductionSystemPrompt();
      const condensedEstimate = this.estimateTokens(systemPrompt + userPrompt);
      // Also reduce max_tokens if still tight
      maxTokens = Math.min(maxTokens, contextLimit - condensedEstimate - 100);
      maxTokens = Math.max(maxTokens, 1000); // never below 1000
      logger.info(`Condensed prompt: ${condensedEstimate} tokens, max_tokens: ${maxTokens}`);
    }

    const messages: OpenAIMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const useStructuredOutput = this.modelSupportsStructuredOutput();
    const jsonSchema = getOpenAIAdProductionJsonSchema();
    const requestBody: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: 0.6,
      max_tokens: maxTokens,
    };
    if (useStructuredOutput) {
      requestBody.response_format = {
        type: 'json_schema',
        json_schema: {
          name: jsonSchema.name,
          strict: jsonSchema.strict,
          schema: jsonSchema.schema,
        },
      };
    }
    // Omit response_format for models that don't support it (e.g. gpt-4, gpt-3.5-turbo) to avoid 400

    logger.info('Generating ad production JSON with OpenAI', {
      model: this.model,
      durationSeconds,
      targetWords,
      useStructuredOutput,
    });

    let response: any;
    try {
      response = await axios.post(this.apiUrl, requestBody, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        timeout: 60000,
      });
    } catch (error: any) {
      const apiError = error.response?.data;
      logger.error('OpenAI API error', {
        status: error.response?.status,
        data: apiError,
        model: this.model,
      });
      throw error;
    }

    const rawContent = response.data.choices[0]?.message?.content?.trim();
    if (!rawContent) {
      throw new Error('No content generated from OpenAI for ad production');
    }

    const validated = parseAndValidateAdProductionResponse(rawContent);
    logger.info('Ad production JSON generated and validated', {
      scriptLength: validated.script.length,
      adCategory: validated.context.adCategory,
      targetBPM: validated.music.targetBPM,
    });
    return validated;
  }

  /** True if the configured model supports response_format json_schema (gpt-4o, gpt-4o-mini, etc.). */
  private modelSupportsStructuredOutput(): boolean {
    const m = this.model.toLowerCase();
    return m.includes('gpt-4o') || m.includes('gpt-4.1') || m.includes('gpt-4.2');
  }

  /** Approximate context window for common OpenAI models. */
  private getModelContextLimit(): number {
    const m = this.model.toLowerCase();
    if (m.includes('gpt-4o') || m.includes('gpt-4-turbo') || m.includes('gpt-4.1') || m.includes('gpt-4.2')) return 128000;
    if (m.includes('gpt-4-32k')) return 32768;
    if (m === 'gpt-4' || m.startsWith('gpt-4-0')) return 8192;
    if (m.includes('gpt-3.5-turbo-16k')) return 16384;
    if (m.includes('gpt-3.5')) return 4096;
    return 128000; // default for newer models
  }

  /** Rough token estimate: ~4 chars per token for English/JSON. */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
  }

  private buildAdProductionSystemPrompt(): string {
    return `You are an expert audio ad producer. You output a single JSON object that drives the entire ad pipeline: script (with TTS tags), context, music prompt, fades, and volume.

STRICT REQUIREMENTS:
- Respond with ONLY valid JSON matching the schema. No markdown, no explanation.
- Script: Use ONLY ElevenLabs v3 audio tags ([happy], [excited], [pause], [whispers], [warmly], [sighs], [laughs], etc.). No SSML, no stage directions, no [emphasis] or [dramatic]—only spoken words and these audio tags.
- Context: You MUST set context.adCategory, context.pace, and context.emotion from the user prompt and brief. Infer adCategory (retail, automotive, tech, finance, food, healthcare, entertainment, real_estate, other), pace (slow, moderate, fast), and emotion from the request.

MUSICAL PHRASING AWARENESS (apply when writing the script):
- Write sentences that naturally group into 2-bar or 4-bar musical phrases at the target BPM. At 100 BPM in 4/4, one bar = 2.4s, so 4 bars = 9.6s. A sentence that takes ~5s to read = ~2 bars.
- Place the most important words (brand name, key benefit, CTA) at positions that would naturally fall on downbeats (bar starts). Put them at the BEGINNING of sentences, not buried in the middle.
- Create natural pauses of 0.5-1.5 seconds between major sections (these become musical breathing points).
- Short punchy sentences (1-2 bars) for high-energy/CTA sections. Longer flowing sentences (2-4 bars) for emotional/building sections.
- The CTA should be preceded by a brief pause (0.3-0.8s) so the music can set up a resolve.
- Think of the script as lyrics to a song: rhythm, cadence, and pacing matter as much as the words themselves.

MUSIC DIRECTOR PRINCIPLES (apply before composing):

1. EMOTION DECIDES MUSIC, NOT TASTE. Before any technical decision, ask:
   - What is being sold?
   - Who is the audience?
   - What emotion should they feel at EACH MOMENT of the ad?

2. IDENTIFY KEY SYNC POINTS (3-5 critical moments where music must align perfectly):
   - Brand name first mention (subtle accent/lift in music)
   - Key benefit or emotional payoff (peak energy moment)
   - Product reveal or problem-solution transition (energy shift)
   - Call-to-action (confident, resolving)
   - Final word (button ending lands just after, NOT fade-out)

3. ENERGY CURVE (1-10 scale per arc segment):
   - 1-2 = Minimal/ambient (barely perceptible)
   - 3-4 = Building/supportive (present but unobtrusive)
   - 5-6 = Established/engaging (confident groove)
   - 7-8 = Peak/climactic (fullest arrangement)
   - 9-10 = Maximum (use sparingly, brief moments only)
   
   Common patterns:
   - Standard ad: 3 → 5 → 7 → 5 (build, peak, resolve)
   - Urgent/sale: 6 → 7 → 8 → 7 (high energy throughout)
   - Premium/luxury: 3 → 4 → 5 → 4 (subtle, elegant, never overwhelming)
   - Emotional/story: 2 → 4 → 7 → 3 (slow build, big peak, soft resolve)

4. VOICE IS THE STAR. Music is supporting actor. Every instrumentation decision must carve space for voice clarity (especially 1-4kHz mid-range where consonants and intelligibility live).

5. PROFESSIONAL MIXING AWARENESS:
   - Music sits 15-20dB below voice level
   - Button endings (clean cutoffs or stingers), NOT fade-outs
   - Test mentally: can you hear every word clearly with music underneath?

AD MUSIC COMPOSER (your role for the "music" object):
- Act as an expert ad music composer. Your job is to break down the ad script into clear SEGMENTS (e.g. intro/hook, features, benefits, product_intro, problem_solution, cta) and decide the right music, timing, tempo, and BPM for each segment—the way top ad composers do.

CRITICAL — DO NOT stereotype music by language or category:
- Do NOT choose music based on the script's LANGUAGE. For example: if the script is in Hindi (or any language), do NOT default to "Traditional Indian instruments" or any region-specific style. The language of the script does not determine the music. Base music on the MESSAGE, emotion, and story of the ad.
- Do NOT default music by ad category alone. For example: "tech" does not always mean electronic; "food" does not always mean acoustic. Infer the actual tone and message from the brief and script content (what is being said, emotional arc, pace, product type) and choose genre, mood, and BPM to support THAT. Same brief in different languages should get the same music concept if the message is the same.
- music.prompt, music.genre, music.mood, and each arc segment's musicPrompt must reflect the script's CONTENT and EMOTIONAL ARC (e.g. urgent, warm, innovative, premium, playful)—not the script language or a fixed category stereotype.

Best-practice approach used by professional ad composers:
  1) HOOK/INTRO (first ~15–25% of duration): Lower energy, subtle build, or gentle curiosity to grab attention without overwhelming. BPM often 5–15 lower than main body. Labels: "intro", "hook".
  2) FEATURES/BENEFITS (middle section): Match energy to the message—innovative products = slightly driving; trust/calm = steady, warm. BPM in 85–115 range typical for voice-over. Labels: "features", "benefits", "product_intro".
  3) PRODUCT REVEAL or KEY MESSAGE: Slight lift or peak in energy so the main sell feels momentous. Short segment (e.g. 3–8s). Labels: "product_intro", "highlight".
  4) CTA / CLOSE (last ~15–20%): Punchy resolve, confident ending, no fade-into-nowhere. BPM can dip 5–10 for resolution or stay up for urgency. Labels: "cta", "close".
- Use music.arc with 2–4 segments: startSeconds, endSeconds, label, musicPrompt, targetBPM, energyLevel (1-10). Each segment must have a clear label, a musicPrompt that describes feel + energy + instrumentation + BPM (e.g. "Subtle build, low energy, minimal instrumentation, 80 BPM" or "Peak energy, fullest arrangement, driving, 100 BPM"), and an energyLevel (1-10 scale) that guides arrangement density. Instrumentation can vary per segment (intro: minimal drums/bass; CTA: fuller). Total arc must cover 0 to durationSeconds.
- Set music.prompt = one cohesive overall description (genre, mood, BPM, instrumental, no vocals) that fits the WHOLE AD'S MESSAGE AND TONE from the brief—not from script language or category stereotype. Set music.targetBPM to the "main body" BPM (70–130). Set genre and mood from the brief's intent and emotional content.
- Output music.composerDirection: one short paragraph (2–4 sentences) you would give to the music generator—overall intent, section-by-section feel, and key timing or energy shifts. This is sent verbatim to text-to-music. Example: "Open with a subtle build, no drums. From 10s bring the main theme, driving but not loud. CTA: punchy resolve." Max 300 characters.

INSTRUMENTATION (critical for professional voice-under mixing):
- You MUST output music.instrumentation with four elements: drums, bass, mids, effects.
- Drums: Describe rhythmic foundation (type, pattern, intensity, when they enter/exit). Examples: "Tight electronic kick and hi-hat, minimal pattern" or "No drums intro, brushes from 8s" or "No drums throughout".
- Bass: Describe low-end foundation (instrument, style, presence). Examples: "Deep sub bass, sustained notes" or "Warm acoustic bass, walking line" or "Minimal synth bass pads".
- Mids: Describe melody/harmony instruments in mid-range (piano, guitar, synths, strings). CRITICAL: MUST explicitly leave 1–4 kHz clear for voice. Examples: "Clean piano melody + soft string pads, carved 1-4kHz for voice" or "Acoustic guitar chords, gentle, voice-under" or "Bright synth lead, stays below voice range".
- Effects: Describe spatial/time effects (reverb, delay, chorus). Examples: "Subtle room reverb on piano, no delay" or "Short delay on lead, light reverb" or "None".
- Decide instrumentation based on genre, mood, and arc segments. Intro may have minimal drums/bass; CTA may have fuller instrumentation. Always carve mid-range for voice clarity.
- Output music.buttonEnding (optional): { type, timing?, description? }. Professional ads use clean button endings (sustained chord cutoff, punchy stinger), NOT fade-outs. Example: { type: "sustained chord cutoff", timing: "0.5s after final word", description: "Warm major chord, clean release" }. When buttonEnding is present, the music generator will be instructed to end cleanly.

MUSICAL STRUCTURE (for bar-aware blueprint):
- You SHOULD output music.musicalStructure: { introType, introBars, bodyFeel, peakMoment, endingType, outroBars, keySignature?, phraseLength? }.
  - introType: "ambient_build" (soft pads building), "rhythmic_hook" (beat-driven opening), "melodic_theme" (main melody intro), or "silence_to_entry" (minimal/silence then music enters with voice).
  - introBars: 1-4 bars of music before voice enters (1-2 for short ads <20s, 2-4 for longer).
  - bodyFeel: one-word feel for main section ("driving", "flowing", "pulsing", "steady", "bouncy", "ethereal").
  - peakMoment: where peak energy should land ("at brand reveal", "at key benefit", "bar 12", "at problem-solution transition").
  - endingType: "button" (clean chord cutoff), "sustain" (held chord fading naturally), "stinger" (short punchy hit), "decay" (natural instrument decay).
  - outroBars: 1-4 bars after last word for the ending.
  - keySignature: optional (e.g. "C major", "A minor"). Helps maintain harmonic consistency.
  - phraseLength: bars per musical phrase (usually 4 for pop/corporate, 2 for urgent/fast ads).

- Fades: You MUST set fades.fadeInSeconds (0.08–0.12) and fades.fadeOutSeconds (0.2–0.6). Note: fadeOut is for the ENTIRE ad output (voice+music), not the music track button ending.
- Volume: You MUST set volume.voiceVolume (0.8–1.0) and volume.musicVolume (0.15–0.30). Music should be clearly audible underneath the voice — not buried. Add volume.segments for "music_up" at open and "voice_up" at CTA when it helps.
- Sentence-by-sentence: Add "sentenceCues" (array of { index, musicCue, musicVolumeMultiplier, musicDirection?, musicalFunction? })—one object per sentence. musicCue = short label (hook, excitement, highlight, pause, warm, cta). musicVolumeMultiplier 0.7–1.3 so music ducks or swells per sentence. Optional musicDirection = one short phrase per sentence (e.g. swell, staccato, hold, hit on downbeat, quiet under) for the music generator. Optional musicalFunction = the structural role of this sentence: "hook" (attention-grab), "build" (rising energy), "peak" (climax), "resolve" (settling), "transition" (bridging between sections), "pause" (musical breathing point).

SEGMENT-BASED AD FORMAT (adFormat — REQUIRED):
You MUST output an "adFormat" object that breaks the ad into ORDERED SEGMENTS. Each segment defines what audio layers are active (voice, music, SFX) and how they behave. This replaces the flat "voice over background music" structure with a creative timeline.

STEP 1: Choose a template that best fits the brief. Available templates:
${getTemplateSummaryForPrompt()}

STEP 2: Fill in the template's segments with actual content:
- For each segment, set: type, label, duration, voiceover (text + style or null), music (description + behavior + volume or null), sfx (description or null), transition.
- The "script" field should contain the FULL concatenated voiceover text (all voiceover segments joined). The adFormat segments contain the per-segment breakdown.
- Segment durations must sum to totalDuration (= context.durationSeconds).
- voiceover_with_music segments: both voiceover and music are NOT null.
- sfx_hit segments: sfx is NOT null; voiceover and music are both null.
- For culturally-targeted ads (e.g. Punjabi, Latin, Japanese), use "cultural_hook" template and set culturalStyle + instruments on music segments.

CRITICAL RULE — NO MUSIC-ONLY GAPS IN THE MIDDLE:
- music_solo segments (voiceover IS null, music plays alone) are ONLY allowed as the VERY FIRST segment (brief intro, max 1-2 seconds) or the VERY LAST segment (outro/button ending, max 2-3 seconds).
- ALL middle segments MUST have voiceover (type = "voiceover_with_music"). The voiceover must be CONTINUOUS with NO gaps. There should be NO music_solo or silent segments between voiceover segments.
- The listener should hear voice continuously from the first voiceover segment to the last. Music plays underneath throughout but voice never stops mid-ad.
- If you need a musical transition between sections, do it WITH voiceover playing — use musicDirection to mark a "swell" or "transition" instead of creating a music-only gap.

STEP 3: Set overallMusicDirection (genre, mood, BPM, cultural style for the whole ad) and culturalContext if applicable.

TOP-LEVEL KEYS: script, context, music, fades, volume, version (optional), mixPreset (optional), sentenceCues (optional), adFormat (REQUIRED).

1. "script" (string): Ad script with ElevenLabs v3 tags only. Word count must fit the duration.

2. "context" (object): adCategory, tone, emotion, pace, durationSeconds, targetWordsPerMinute (optional), voiceHints (optional).

3. "music" (object): As the ad music composer: prompt (overall description), targetBPM (70–130), genre, mood, composerDirection (short paragraph, max 300 chars), instrumentation (drums, bass, mids, effects), buttonEnding (optional: type, timing, description for clean endings), musicalStructure (introType, introBars, bodyFeel, peakMoment, endingType, outroBars, keySignature, phraseLength). MUST include "arc" (2–4 segments) with startSeconds, endSeconds, label, musicPrompt, targetBPM, energyLevel (1-10)—each segment aligned to script structure and emotional arc.

4. "fades" (object): fadeInSeconds (0.08–0.12), fadeOutSeconds (0.2–0.6), curve (optional).

5. "volume" (object): voiceVolume, musicVolume, segments (optional).

6. "mixPreset" (optional): "voiceProminent" | "balanced" | "musicEmotional". Prefer "voiceProminent" for ads.

7. "sentenceCues" (optional): One { index, musicCue, musicVolumeMultiplier, musicDirection?, musicalFunction? } per sentence in order. musicDirection = optional short composer note (swell, staccato, hold, hit on downbeat, quiet under). musicalFunction = structural role (hook, build, peak, resolve, transition, pause).

EXAMPLE OUTPUT (follow this structure; adapt content to the user's brief):
${getAdProductionExampleJSONString()}`;
  }

  /**
   * Condensed system prompt for models with small context windows (e.g. gpt-4 8K).
   * Strips the bulky example JSON and template summary to save ~1,500 tokens.
   */
  private buildCondensedAdProductionSystemPrompt(): string {
    return `You are an expert audio ad producer. Output a single JSON object that drives the ad pipeline.

RULES:
- Respond with ONLY valid JSON. No markdown, no explanation.
- Script: Use ElevenLabs v3 audio tags only ([happy], [excited], [pause], [whispers], etc.). No SSML.
- Write sentences that fit musical phrasing. Place brand/CTA at sentence beginnings.
- Music is supporting actor — voice is the star. Music sits 15-20dB below voice.

REQUIRED JSON KEYS:
1. "script" (string): Ad script with ElevenLabs tags. Word count must match duration.
2. "context" (object): { adCategory, tone, emotion, pace, durationSeconds }
   - adCategory: retail|automotive|tech|finance|food|healthcare|entertainment|real_estate|other
   - pace: slow|moderate|fast
3. "music" (object): { prompt, targetBPM (70-130), genre, mood, composerDirection (max 300 chars), instrumentation: { drums, bass, mids, effects }, arc: [2-4 segments with startSeconds, endSeconds, label, musicPrompt, targetBPM, energyLevel (1-10)] }
   - Do NOT stereotype music by language or category. Base on message and emotion.
   - Mids must leave 1-4kHz clear for voice.
4. "fades" (object): { fadeInSeconds (0.08-0.12), fadeOutSeconds (0.2-0.6) }
5. "volume" (object): { voiceVolume (0.8-1.0), musicVolume (0.15-0.30) }
6. "adFormat" (object): { templateId, segments: [{ type, label, duration, voiceover, music, sfx, transition }] }
   - templateId: classic_radio|cultural_hook|sfx_driven|storytelling|high_energy_sale|custom
   - Segment types: music_solo, voiceover_with_music, sfx_hit
   - Segment durations must sum to durationSeconds
   - CRITICAL: music_solo segments ONLY allowed as FIRST (intro, max 1-2s) or LAST (outro, max 2-3s) segment. ALL middle segments MUST be voiceover_with_music. NO music-only gaps between voiceover segments.
7. "sentenceCues" (optional): [{ index, musicCue, musicVolumeMultiplier (0.7-1.3) }]
8. "mixPreset" (optional): "voiceProminent"|"balanced"|"musicEmotional"`;
  }

  private buildAdProductionUserPrompt(
    input: AdProductionInput,
    targetWords: number
  ): string {
    const duration = input.durationSeconds ?? 30;
    const wordRange = `${Math.round(targetWords * 0.9)}-${Math.round(targetWords * 1.05)}`;
    const parts: string[] = [
      `Create an audio ad production JSON for the following brief.`,
      ``,
      `Brief: ${input.prompt}`,
      ``,
      `Constraints:`,
      `- Duration: EXACTLY ${duration} seconds when read at natural pace. The script MUST be long enough to fill ${duration}s.`,
      `- Script length: ${wordRange} words (so it fills ${duration}s). Do NOT write a shorter script.`,
      ``,
      `As the AD MUSIC COMPOSER:`,
      `1. Base music on the brief's MESSAGE, tone, and emotional arc—NOT on script language (e.g. Hindi) or ad category alone. Do not use "Traditional Indian instruments" just because the script is in Hindi; do not default to "electronic" just because category is tech. Choose genre and mood from what the ad is actually saying and selling.`,
      `2. Mentally break down the script into segments (intro/hook, features or benefits, product intro or key message, call-to-action) and assign precise timing (startSeconds, endSeconds) so they sum to ${duration}s.`,
      `3. For each segment, decide: label, musicPrompt (feel + BPM in words), and targetBPM. Follow best practices: intro = subtle build/lower BPM; middle = main energy/BPM; CTA = punchy resolve.`,
      `4. Output music.prompt, music.targetBPM, music.genre, music.mood, music.composerDirection (max 300 chars), music.instrumentation (drums, bass, mids, effects—ensure mids leave 1-4kHz clear for voice), optional music.buttonEnding (for clean endings, not fade-outs), music.musicalStructure (introType, introBars, bodyFeel, peakMoment, endingType, outroBars, keySignature, phraseLength), and music.arc with 2–4 segments covering 0–${duration}s.`,
      `5. Think like a professional Music Director: Apply the emotion-first principle. Before composing, identify the emotional journey (e.g. Frustration → Curiosity → Relief → Action). Map key sync points: brand name mention (subtle lift), key benefit (peak energy), CTA (resolve). Assign energy level (1-10) to each arc segment that serves the emotion at that moment (e.g. intro=3, peak=7, resolve=5). Ensure instrumentation density matches energy (low=sparse, high=full).`,
      `6. Add sentenceCues: one per sentence (index 0, 1, 2...), with musicCue (e.g. hook, excitement, highlight, cta), musicVolumeMultiplier (0.7–1.3), optional musicDirection (e.g. swell, staccato, hold, hit on downbeat), and musicalFunction (hook, build, peak, resolve, transition, pause).`,
      `7. REQUIRED: Output "adFormat" — choose the best template for this brief (classic_radio, cultural_hook, sfx_driven, storytelling, high_energy_sale, or "custom") and fill in each segment with content. Segment durations must sum to ${duration}s. For culturally-targeted briefs, prefer "cultural_hook" template and set culturalStyle/instruments.`,
      `8. CRITICAL: music_solo segments are ONLY allowed as the FIRST (intro, max 1-2s) or LAST (outro) segment. ALL middle segments MUST be voiceover_with_music — voiceover must be continuous with NO gaps. Do NOT create music-only breaks between voiceover segments.`,
    ];
    if (input.tone) {
      parts.push(`- Tone: ${input.tone}`);
    }
    parts.push(
      ``,
      `Respond with a single JSON object: script (ElevenLabs audio tags only), context, music (composer-led arc + prompt + BPM), fades, volume, mixPreset, sentenceCues, adFormat (segment-based creative plan). No other text.`
    );
    return parts.join('\n');
  }

  /**
   * Build system prompt for script generation
   */
  private buildSystemPrompt(): string {
    return `You are an expert advertising copywriter specializing in creating compelling audio advertisements.
Your scripts are designed for voice synthesis and audio production.

Key guidelines:
1. Write clear, conversational scripts optimized for voice delivery
2. Use punctuation for natural pauses (commas, periods, exclamation marks)
3. Create engaging hooks in the first 3 seconds
4. Build clear value propositions
5. End with strong, memorable calls-to-action
6. Use simple, direct language that sounds natural when spoken
7. Avoid complex words or tongue-twisters
8. Consider pacing and rhythm for audio delivery
9. Keep sentences short and punchy for better comprehension
10. Include emotional triggers appropriate to the product/service

CRITICAL FORMATTING RULES:
- DO NOT include stage directions like [pause], [emphasis], [end], [dramatic], etc.
- DO NOT include speaker labels or character names
- DO NOT include action descriptions in brackets or parentheses
- Write ONLY the spoken words that will be read by the voice actor
- Use punctuation (periods, commas, exclamation marks, question marks) to control pacing
- Output pure, clean script text that can be directly sent to text-to-speech

Format your output as a clean, ready-to-use script without any extra commentary, markup, or stage directions.`;
  }

  /**
   * Build user prompt based on parameters
   */
  private buildUserPrompt(params: GenerateScriptParams): string {
    const parts: string[] = [];

    parts.push(`Create an audio advertisement script with the following requirements:\n`);
    parts.push(`Brief: ${params.prompt}\n`);

    if (params.productName) {
      parts.push(`Product/Service: ${params.productName}\n`);
    }

    if (params.tone) {
      parts.push(`Tone: ${params.tone}\n`);
    }

    if (params.targetAudience) {
      parts.push(`Target Audience: ${params.targetAudience}\n`);
    }

    // Prioritize exact duration if provided
    if (params.durationSeconds) {
      const wordsPerSecond = 2.5; // Average speaking rate for ads
      const targetWords = Math.round(params.durationSeconds * wordsPerSecond);
      const wordRange = `${Math.round(targetWords * 0.9)}-${Math.round(targetWords * 1.1)}`;
      parts.push(`Duration: EXACTLY ${params.durationSeconds} seconds (approximately ${wordRange} words)\n`);
      parts.push(`CRITICAL: The script must be precisely ${params.durationSeconds} seconds when read at a natural pace. Do NOT exceed this duration.\n`);
    } else if (params.length) {
      const lengthGuide = {
        short: '15-20 seconds (approximately 40-60 words)',
        medium: '30-40 seconds (approximately 80-120 words)',
        long: '50-60 seconds (approximately 140-180 words)',
      };
      parts.push(`Length: ${lengthGuide[params.length]}\n`);
    }

    if (params.additionalContext) {
      parts.push(`Additional Context: ${params.additionalContext}\n`);
    }

    parts.push(`\nGenerate a professional, engaging audio ad script that can be directly used for voice synthesis.`);

    return parts.join('');
  }

  /**
   * Get max tokens based on script length
   */
  private getMaxTokens(length?: 'short' | 'medium' | 'long'): number {
    const tokenLimits = {
      short: 200,
      medium: 400,
      long: 600,
    };

    return tokenLimits[length || 'medium'];
  }

  /**
   * Generate ad production JSON AND select the best music track from the pre-analyzed catalog.
   * This combines script generation + music selection in a single workflow:
   * 1. Generate the ad script + metadata via generateAdProductionJSON()
   * 2. Use a second LLM call to select the best music from the catalog
   * Returns both the standard ad production response and the music selection.
   */
  async generateAdWithMusicSelection(
    input: AdProductionInput
  ): Promise<{ adProduction: AdProductionLLMResponse; musicSelection: MusicSelectionResult }> {
    // Step 1: Generate the ad script and metadata as usual
    const adProduction = await this.generateAdProductionJSON(input);

    // Step 2: Select music from library using the generated script + context
    const trackSummaries = musicLibraryService.getSummariesForLLM();

    const systemPrompt = `You are an expert music supervisor for audio advertisements. Select the BEST background music track from this pre-analyzed music library for the given ad.

AVAILABLE TRACKS:
${trackSummaries}

SELECTION CRITERIA:
1. Match the emotional tone and energy of the ad script
2. Appropriate tempo/BPM for the ad pace (slow ads = lower BPM tracks, fast = higher)
3. Prefer instrumental tracks that won't overpower voiceover
4. Fit the ad category and target audience
5. Track duration should ideally be >= ad duration
6. Consider cultural context if the ad targets a specific audience
7. Do NOT stereotype by language — base choice on the ad's MESSAGE and emotion

MIXING PARAMETERS:
- musicVolume: 0.15-0.35 (music should be clearly audible under voice, not buried)
- duckingAmount: 0.25-0.60 (higher = more ducking when voice plays)
- musicDelay: 0-3s of music before voice starts (pre-roll intro)
- fadeInSeconds: 0.05-1.0 (music fade-in)
- fadeOutSeconds: 0.2-1.5 (music fade-out)

Respond with ONLY valid JSON:
{
  "selectedTrack": { "filename": "exact_filename.mp3", "reasoning": "why this track" },
  "mixingParameters": { "musicVolume": 0.15, "fadeInSeconds": 0.1, "fadeOutSeconds": 0.4, "fadeCurve": "exp", "voiceVolume": 1.0, "audioDucking": true, "duckingAmount": 0.35, "musicDelay": 1.5 }
}`;

    const userMessage = [
      `Select background music for this ad:`,
      ``,
      `Brief: ${input.prompt}`,
      `Script: ${adProduction.script}`,
      `Tone: ${adProduction.context.tone}`,
      `Emotion: ${adProduction.context.emotion}`,
      `Pace: ${adProduction.context.pace}`,
      `Category: ${adProduction.context.adCategory}`,
      `Duration: ${adProduction.context.durationSeconds}s`,
      `Music direction: ${adProduction.music.prompt}`,
      `Target BPM: ${adProduction.music.targetBPM}`,
      `Genre preference: ${adProduction.music.genre || 'any'}`,
      `Mood preference: ${adProduction.music.mood || 'any'}`,
      ``,
      `Choose the best matching track and optimal mixing parameters. JSON only.`,
    ].join('\n');

    logger.info('Selecting music from library via LLM', {
      model: this.model,
      adCategory: adProduction.context.adCategory,
      targetBPM: adProduction.music.targetBPM,
    });

    let musicSelection: MusicSelectionResult;
    try {
      const response = await axios.post(
        this.apiUrl,
        {
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.3,
          max_tokens: 500,
          ...(this.modelSupportsStructuredOutput()
            ? { response_format: { type: 'json_object' } }
            : {}),
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          timeout: 30000,
        }
      );

      const rawContent = response.data.choices[0]?.message?.content?.trim();
      if (!rawContent) throw new Error('No content from OpenAI for music selection');

      musicSelection = this.parseMusicSelectionResponse(rawContent);

      // Validate selected track exists
      const track = musicLibraryService.getTrackByFilename(musicSelection.selectedTrack.filename);
      if (!track) {
        logger.warn(`LLM selected non-existent track: ${musicSelection.selectedTrack.filename}`);
        musicSelection = this.getFallbackMusicSelection(adProduction.context.pace);
      }

      logger.info('Music selected from library', {
        track: musicSelection.selectedTrack.filename,
        reasoning: musicSelection.selectedTrack.reasoning,
      });
    } catch (error: any) {
      logger.error('LLM music selection failed, using fallback:', { message: error.message });
      musicSelection = this.getFallbackMusicSelection(adProduction.context.pace);
    }

    return { adProduction, musicSelection };
  }

  private parseMusicSelectionResponse(raw: string): MusicSelectionResult {
    let content = raw.trim();
    if (content.startsWith('```json')) content = content.replace(/^```json\s*/i, '').replace(/\s*```\s*$/, '');
    else if (content.startsWith('```')) content = content.replace(/^```\s*/, '').replace(/\s*```\s*$/, '');

    const parsed = JSON.parse(content);
    return {
      selectedTrack: {
        filename: parsed.selectedTrack?.filename || '',
        reasoning: parsed.selectedTrack?.reasoning || 'No reasoning provided',
      },
      mixingParameters: {
        musicVolume: clampValue(parsed.mixingParameters?.musicVolume ?? 0.25, 0.12, 0.5),
        fadeInSeconds: clampValue(parsed.mixingParameters?.fadeInSeconds ?? 0.1, 0.02, 2),
        fadeOutSeconds: clampValue(parsed.mixingParameters?.fadeOutSeconds ?? 0.4, 0.1, 2),
        fadeCurve: ['exp', 'tri', 'qsin'].includes(parsed.mixingParameters?.fadeCurve) ? parsed.mixingParameters.fadeCurve : 'exp',
        voiceVolume: clampValue(parsed.mixingParameters?.voiceVolume ?? 1.0, 0.5, 1.5),
        audioDucking: parsed.mixingParameters?.audioDucking !== false,
        duckingAmount: clampValue(parsed.mixingParameters?.duckingAmount ?? 0.35, 0.1, 0.8),
        musicDelay: clampValue(parsed.mixingParameters?.musicDelay ?? 1.0, 0, 5),
      },
    };
  }

  private getFallbackMusicSelection(pace?: string): MusicSelectionResult {
    const summaries = musicLibraryService.getTrackSummaries();
    const targetEnergy = pace === 'fast' ? 'high' : pace === 'slow' ? 'low' : 'medium';
    let selected = summaries.find((t) => t.energy_level === targetEnergy);
    if (!selected) selected = summaries[0];

    return {
      selectedTrack: {
        filename: selected?.filename || 'unknown',
        reasoning: `Fallback selection based on energy level (${targetEnergy})`,
      },
      mixingParameters: {
        musicVolume: 0.25,
        fadeInSeconds: 0.1,
        fadeOutSeconds: 0.4,
        fadeCurve: 'exp',
        voiceVolume: 1.0,
        audioDucking: true,
        duckingAmount: 0.35,
        musicDelay: 1.0,
      },
    };
  }

  /**
   * Improve/refine an existing script
   */
  async refineScript(originalScript: string, improvementRequest: string): Promise<string> {
    try {
      const messages: OpenAIMessage[] = [
        {
          role: 'system',
          content: 'You are an expert advertising copywriter. Improve and refine ad scripts while maintaining their core message and structure.',
        },
        {
          role: 'user',
          content: `Original Script:\n${originalScript}\n\nImprovement Request:\n${improvementRequest}\n\nPlease provide the improved version of the script.`,
        },
      ];

      logger.info('Refining script with OpenAI');

      const response = await axios.post(
        this.apiUrl,
        {
          model: this.model,
          messages,
          temperature: 0.7,
          max_tokens: 800,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          timeout: 60000,
        }
      );

      const refinedText = response.data.choices[0]?.message?.content?.trim();

      if (!refinedText) {
        throw new Error('No content generated from OpenAI');
      }

      logger.info('Script refined successfully');

      return refinedText;
    } catch (error: any) {
      logger.error('Error refining script with OpenAI:', error.message);
      throw new Error(`Failed to refine script: ${error.message}`);
    }
  }

  /**
   * Generate multiple script variations
   */
  async generateVariations(
    params: GenerateScriptParams,
    count: number = 3
  ): Promise<string[]> {
    try {
      const systemPrompt = this.buildSystemPrompt();
      const userPrompt =
        this.buildUserPrompt(params) +
        `\n\nGenerate ${count} different variations of this script, each with a unique approach or angle. Separate each variation with "---VARIATION---"`;

      const messages: OpenAIMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      logger.info(`Generating ${count} script variations with OpenAI`);

      const response = await axios.post(
        this.apiUrl,
        {
          model: this.model,
          messages,
          temperature: 0.8, // Higher temperature for more variety
          max_tokens: this.getMaxTokens(params.length) * count,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          timeout: 90000, // 90 seconds for multiple variations
        }
      );

      const generatedText = response.data.choices[0]?.message?.content?.trim();

      if (!generatedText) {
        throw new Error('No content generated from OpenAI');
      }

      // Split variations
      const variations = generatedText
        .split('---VARIATION---')
        .map((v: string) => v.trim())
        .filter((v: string) => v.length > 0);

      logger.info(`Generated ${variations.length} script variations`);

      return variations;
    } catch (error: any) {
      logger.error('Error generating script variations:', error.message);
      throw new Error(`Failed to generate variations: ${error.message}`);
    }
  }
}

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export default new OpenAIService();
