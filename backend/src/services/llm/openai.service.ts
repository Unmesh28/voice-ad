import axios from 'axios';
import { logger } from '../../config/logger';
import type { AdProductionInput, AdProductionLLMResponse } from '../../types/ad-production';
import {
  parseAndValidateAdProductionResponse,
  getAdProductionExampleJSONString,
  getOpenAIAdProductionJsonSchema,
} from '../../types/ad-production';
import { getTemplateSummaryForPrompt } from '../../types/ad-format';

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
    this.model = process.env.OPENAI_MODEL || 'gpt-4-turbo-preview';

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
    // ~2.8 words/sec at natural pace so script length matches requested duration (e.g. 30s → 84 words)
    const targetWords = Math.round(durationSeconds * 2.8);

    const systemPrompt = this.buildAdProductionSystemPrompt();
    const userPrompt = this.buildAdProductionUserPrompt(input, targetWords);

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
      max_tokens: 2000,
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
- Volume: You MUST set volume.voiceVolume (0.8–1.0) and volume.musicVolume (0.1–0.25). Add volume.segments for "music_up" at open and "voice_up" at CTA when it helps.
- Sentence-by-sentence: Add "sentenceCues" (array of { index, musicCue, musicVolumeMultiplier, musicDirection?, musicalFunction? })—one object per sentence. musicCue = short label (hook, excitement, highlight, pause, warm, cta). musicVolumeMultiplier 0.7–1.3 so music ducks or swells per sentence. Optional musicDirection = one short phrase per sentence (e.g. swell, staccato, hold, hit on downbeat, quiet under) for the music generator. Optional musicalFunction = the structural role of this sentence: "hook" (attention-grab), "build" (rising energy), "peak" (climax), "resolve" (settling), "transition" (bridging between sections), "pause" (musical breathing point).

SEGMENT-BASED AD FORMAT (adFormat — REQUIRED):
You MUST output an "adFormat" object that breaks the ad into ORDERED SEGMENTS. Each segment defines what audio layers are active (voice, music, SFX) and how they behave. This replaces the flat "voice over background music" structure with a creative timeline.

STEP 1: Choose a template that best fits the brief. Available templates:
${getTemplateSummaryForPrompt()}

STEP 2: Fill in the template's segments with actual content:
- For each segment, set: type, label, duration, voiceover (text + style or null), music (description + behavior + volume or null), sfx (description or null), transition.
- The "script" field should contain the FULL concatenated voiceover text (all voiceover segments joined). The adFormat segments contain the per-segment breakdown.
- Segment durations must sum to totalDuration (= context.durationSeconds).
- music_solo segments: music is NOT null, voiceover IS null.
- voiceover_with_music segments: both voiceover and music are NOT null.
- sfx_hit segments: sfx is NOT null; voiceover and music are both null.
- For culturally-targeted ads (e.g. Punjabi, Latin, Japanese), use "cultural_hook" template and set culturalStyle + instruments on music segments.

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

export default new OpenAIService();
