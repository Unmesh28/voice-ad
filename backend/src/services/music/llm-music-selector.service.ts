import axios from 'axios';
import { logger } from '../../config/logger';
import musicLibraryService from './music-library.service';
import type { MusicSelectionResult } from './music-library.service';

class LLMMusicSelectorService {
  private apiKey: string;
  private apiUrl: string;
  private model: string;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || '';
    this.apiUrl = 'https://api.openai.com/v1/chat/completions';
    this.model = process.env.OPENAI_MODEL || 'gpt-4-turbo-preview';
  }

  /**
   * Select the best music track from the library for a given ad prompt and script.
   */
  async selectMusic(params: {
    userPrompt: string;
    script?: string;
    tone?: string;
    duration?: number;
    adCategory?: string;
    emotion?: string;
    pace?: string;
  }): Promise<MusicSelectionResult> {
    // Get compact track summaries for LLM context
    const trackSummaries = musicLibraryService.getSummariesForLLM();

    const systemPrompt = `You are an expert music supervisor for audio advertisements. Your job is to select the BEST background music track from a pre-analyzed music library for a given ad.

AVAILABLE TRACKS:
${trackSummaries}

Your task:
1. Analyze the ad prompt, script, tone, and context
2. Choose the single best track from the library that:
   - Matches the emotional tone and energy of the ad
   - Has appropriate tempo/BPM for the ad pace
   - Won't overpower the voiceover (prefer instrumental tracks)
   - Fits the ad category and target audience
   - Has suitable duration (ideally >= ad duration)
3. Determine optimal mixing parameters for combining voice + music

IMPORTANT RULES:
- ONLY select from the tracks listed above. Use the exact filename.
- Prefer tracks with energy_level matching the ad mood (e.g., "high" for energetic ads, "low" for calm/meditative)
- For voice-over ads, prefer instrumental tracks with medium-low energy so voice stays prominent
- Consider cultural context if the ad targets a specific audience
- musicVolume should be 0.08-0.25 (lower for dense voiceover, higher for music-forward segments)
- duckingAmount should be 0.25-0.60 (higher = more ducking when voice plays)
- musicDelay: seconds of music before voice starts (0-3s, use 1-2s for a music intro)

Respond with ONLY valid JSON matching this schema:
{
  "selectedTrack": {
    "filename": "exact_filename.mp3",
    "reasoning": "Brief explanation of why this track was chosen"
  },
  "mixingParameters": {
    "musicVolume": 0.15,
    "fadeInSeconds": 0.1,
    "fadeOutSeconds": 0.4,
    "fadeCurve": "exp",
    "voiceVolume": 1.0,
    "audioDucking": true,
    "duckingAmount": 0.35,
    "musicDelay": 1.5
  }
}`;

    const userMessage = this.buildUserMessage(params);

    logger.info('Selecting music from library via LLM', {
      model: this.model,
      promptLength: userMessage.length,
      catalogSize: musicLibraryService.getTrackSummaries().length,
    });

    try {
      const response = await axios.post(
        this.apiUrl,
        {
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.3, // Low temperature for consistent selection
          max_tokens: 500,
          response_format: this.modelSupportsJsonMode() ? { type: 'json_object' } : undefined,
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
      if (!rawContent) {
        throw new Error('No content from OpenAI for music selection');
      }

      const parsed = this.parseResponse(rawContent);

      // Validate selected track exists in catalog
      const track = musicLibraryService.getTrackByFilename(parsed.selectedTrack.filename);
      if (!track) {
        logger.warn(`LLM selected non-existent track: ${parsed.selectedTrack.filename}, falling back to first track`);
        const summaries = musicLibraryService.getTrackSummaries();
        parsed.selectedTrack.filename = summaries[0].filename;
        parsed.selectedTrack.reasoning = 'Fallback: originally selected track not found in catalog';
      }

      logger.info('Music selected from library', {
        track: parsed.selectedTrack.filename,
        reasoning: parsed.selectedTrack.reasoning,
        musicVolume: parsed.mixingParameters.musicVolume,
      });

      return parsed;
    } catch (error: any) {
      logger.error('LLM music selection failed:', { message: error.message });
      // Return a sensible fallback
      return this.getFallbackSelection(params);
    }
  }

  private buildUserMessage(params: {
    userPrompt: string;
    script?: string;
    tone?: string;
    duration?: number;
    adCategory?: string;
    emotion?: string;
    pace?: string;
  }): string {
    const parts: string[] = [
      `Select the best background music track for this ad:`,
      ``,
      `Ad Brief: ${params.userPrompt}`,
    ];
    if (params.script) parts.push(`Script: ${params.script}`);
    if (params.tone) parts.push(`Tone: ${params.tone}`);
    if (params.duration) parts.push(`Duration: ${params.duration} seconds`);
    if (params.adCategory) parts.push(`Category: ${params.adCategory}`);
    if (params.emotion) parts.push(`Emotion: ${params.emotion}`);
    if (params.pace) parts.push(`Pace: ${params.pace}`);
    parts.push('', 'Choose the best matching track and optimal mixing parameters. Respond with JSON only.');
    return parts.join('\n');
  }

  private parseResponse(raw: string): MusicSelectionResult {
    // Strip markdown fences
    let content = raw.trim();
    if (content.startsWith('```json')) content = content.replace(/^```json\s*/i, '').replace(/\s*```\s*$/, '');
    else if (content.startsWith('```')) content = content.replace(/^```\s*/, '').replace(/\s*```\s*$/, '');

    const parsed = JSON.parse(content);

    // Validate and clamp
    return {
      selectedTrack: {
        filename: parsed.selectedTrack?.filename || '',
        reasoning: parsed.selectedTrack?.reasoning || 'No reasoning provided',
      },
      mixingParameters: {
        musicVolume: Math.max(0.05, Math.min(0.5, parsed.mixingParameters?.musicVolume ?? 0.15)),
        fadeInSeconds: Math.max(0.02, Math.min(2, parsed.mixingParameters?.fadeInSeconds ?? 0.1)),
        fadeOutSeconds: Math.max(0.1, Math.min(2, parsed.mixingParameters?.fadeOutSeconds ?? 0.4)),
        fadeCurve: ['exp', 'tri', 'qsin'].includes(parsed.mixingParameters?.fadeCurve) ? parsed.mixingParameters.fadeCurve : 'exp',
        voiceVolume: Math.max(0.5, Math.min(1.5, parsed.mixingParameters?.voiceVolume ?? 1.0)),
        audioDucking: parsed.mixingParameters?.audioDucking !== false,
        duckingAmount: Math.max(0.1, Math.min(0.8, parsed.mixingParameters?.duckingAmount ?? 0.35)),
        musicDelay: Math.max(0, Math.min(5, parsed.mixingParameters?.musicDelay ?? 1.0)),
      },
    };
  }

  private getFallbackSelection(params: {
    userPrompt: string;
    tone?: string;
    pace?: string;
  }): MusicSelectionResult {
    // Simple heuristic fallback: pick based on tone/energy
    const summaries = musicLibraryService.getTrackSummaries();
    const targetEnergy = params.pace === 'fast' ? 'high' : params.pace === 'slow' ? 'low' : 'medium';

    // Try to find a track matching the energy level
    let selected = summaries.find(t => t.energy_level === targetEnergy);
    if (!selected) selected = summaries[0];

    return {
      selectedTrack: {
        filename: selected.filename,
        reasoning: `Fallback selection based on energy level (${targetEnergy})`,
      },
      mixingParameters: {
        musicVolume: 0.15,
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

  private modelSupportsJsonMode(): boolean {
    const m = this.model.toLowerCase();
    return m.includes('gpt-4o') || m.includes('gpt-4.1') || m.includes('gpt-4.2') || m.includes('gpt-4-turbo');
  }
}

export default new LLMMusicSelectorService();
