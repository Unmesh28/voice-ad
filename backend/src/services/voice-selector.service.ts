import axios from 'axios';
import { logger } from '../config/logger';
import voiceCatalog from '../data/voice-catalog.json';

interface ScriptAnalysis {
  tone: string; // professional, friendly, energetic, calm, exciting, authoritative, warm, etc.
  gender: string; // male, female, neutral
  ageRange: string; // young, middle-aged, mature
  style: string; // conversational, formal, dramatic, casual
  pace: string; // fast, moderate, slow
  emotion: string; // excited, calm, serious, playful, etc.
}

interface VoiceMatch {
  voiceId: string;
  name: string;
  score: number;
  reason: string;
}

interface CatalogVoice {
  voice_id: string;
  label: string;
  gender: string;
  categories: string[];
  keywords: string[];
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

class VoiceSelectionService {
  private apiKey: string;
  private apiUrl: string;
  private model: string;
  private voices: CatalogVoice[];
  private defaultVoiceId: string;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || '';
    this.apiUrl = 'https://api.openai.com/v1/chat/completions';
    this.model = process.env.OPENAI_MODEL || 'gpt-4';
    this.voices = voiceCatalog.voices as CatalogVoice[];
    this.defaultVoiceId = voiceCatalog.metadata.default_voice_id;

    if (!this.apiKey) {
      logger.warn('OpenAI API key not configured');
    }
  }

  /**
   * Select the best voice from the catalog based on script content and user prompt.
   *
   * Flow:
   *  1. Ask the LLM to classify the ad into one of the catalog categories
   *  2. Match the category to a catalog voice
   *  3. Fall back to keyword scoring if no category match
   */
  async selectVoiceForScript(scriptContent: string, userPrompt?: string): Promise<VoiceMatch> {
    try {
      // Build the category list for the LLM prompt
      const voiceSummary = this.voices
        .map((v) => `- "${v.label}" (categories: ${v.categories.join(', ')})`)
        .join('\n');

      const combinedText = [userPrompt, scriptContent].filter(Boolean).join('\n\n');

      const prompt = `You are a voice casting director for advertisements. Given the ad script and prompt below, pick the single best voice category for this ad.

Available voice categories:
${voiceSummary}

Ad prompt and script:
${combinedText}

Respond with ONLY a JSON object:
{
  "selected_label": "exact label from the list above",
  "reason": "one sentence explanation"
}`;

      const messages: OpenAIMessage[] = [
        {
          role: 'system',
          content: 'You are an expert ad voice casting director. You must select exactly one voice label from the provided list. Respond only with valid JSON.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ];

      const response = await axios.post(
        this.apiUrl,
        {
          model: this.model,
          messages,
          temperature: 0.2,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }
      );

      const content = response.data.choices[0].message.content || '{}';

      // Parse JSON (strip markdown fences if present)
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/\n?```/g, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```\n?/g, '').replace(/\n?```/g, '');
      }

      const parsed = JSON.parse(jsonStr);
      const selectedLabel: string = parsed.selected_label || '';
      const reason: string = parsed.reason || '';

      // Find matching voice by label (case-insensitive)
      const matched = this.voices.find(
        (v) => v.label.toLowerCase() === selectedLabel.toLowerCase()
      );

      if (matched) {
        logger.info(`Voice catalog match: "${matched.label}" (${matched.voice_id}) - ${reason}`);
        return {
          voiceId: matched.voice_id,
          name: matched.label,
          score: 100,
          reason: `Catalog match: ${reason}`,
        };
      }

      // LLM returned a label that doesn't match — fall back to keyword scoring
      logger.warn(`LLM returned unknown label "${selectedLabel}", falling back to keyword scoring`);
      return this.selectByKeywordScoring(combinedText);
    } catch (error: any) {
      logger.error('LLM voice selection failed, falling back to keyword scoring:', error.message);
      const combinedText = [userPrompt, scriptContent].filter(Boolean).join('\n\n');
      return this.selectByKeywordScoring(combinedText);
    }
  }

  /**
   * Fallback: score each catalog voice by counting keyword hits in the text.
   */
  private selectByKeywordScoring(text: string): VoiceMatch {
    const lowerText = text.toLowerCase();

    let bestVoice: CatalogVoice = this.voices[0];
    let bestScore = 0;
    let bestKeywords: string[] = [];

    for (const voice of this.voices) {
      let score = 0;
      const matched: string[] = [];

      for (const kw of voice.keywords) {
        if (lowerText.includes(kw.toLowerCase())) {
          score += 1;
          matched.push(kw);
        }
      }

      // Also check category names
      for (const cat of voice.categories) {
        if (lowerText.includes(cat.replace(/_/g, ' '))) {
          score += 2;
          matched.push(cat);
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestVoice = voice;
        bestKeywords = matched;
      }
    }

    if (bestScore === 0) {
      // No keywords matched at all — use default voice (Ads)
      const defaultVoice = this.voices.find((v) => v.voice_id === this.defaultVoiceId) || this.voices[0];
      logger.info(`No keyword matches, using default voice: "${defaultVoice.label}"`);
      return {
        voiceId: defaultVoice.voice_id,
        name: defaultVoice.label,
        score: 0,
        reason: 'Default fallback — no category or keyword match',
      };
    }

    logger.info(`Keyword-based voice match: "${bestVoice.label}" (score: ${bestScore}, keywords: ${bestKeywords.join(', ')})`);
    return {
      voiceId: bestVoice.voice_id,
      name: bestVoice.label,
      score: bestScore,
      reason: `Keyword match (${bestKeywords.slice(0, 5).join(', ')})`,
    };
  }

  /**
   * Analyze script content to determine appropriate voice characteristics.
   * Still used by generateMusicPrompt() for tone/emotion extraction.
   */
  async analyzeScript(scriptContent: string): Promise<ScriptAnalysis> {
    try {
      logger.info('Analyzing script for voice selection');

      const prompt = `Analyze this advertisement script and determine the ideal voice characteristics.

Script:
${scriptContent}

Based on this script, provide a JSON response with these fields:
- tone: The overall tone (professional, friendly, energetic, calm, exciting, authoritative, warm, etc.)
- gender: Preferred gender (male, female, neutral)
- ageRange: Age range (young, middle-aged, mature)
- style: Speaking style (conversational, formal, dramatic, casual)
- pace: Speaking pace (fast, moderate, slow)
- emotion: Primary emotion (excited, calm, serious, playful, confident, etc.)

Respond ONLY with valid JSON, no additional text.`;

      const messages: OpenAIMessage[] = [
        {
          role: 'system',
          content: 'You are an expert voice casting director who analyzes scripts to determine ideal voice characteristics. Respond only with valid JSON.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ];

      const response = await axios.post(
        this.apiUrl,
        {
          model: this.model,
          messages,
          temperature: 0.3,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }
      );

      const content = response.data.choices[0].message.content || '{}';

      let jsonStr = content.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/\n?```/g, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```\n?/g, '').replace(/\n?```/g, '');
      }

      const analysis = JSON.parse(jsonStr);
      logger.info('Script analysis completed', analysis);
      return analysis as ScriptAnalysis;
    } catch (error: any) {
      logger.error('Error analyzing script:', error.message);
      return {
        tone: 'professional',
        gender: 'neutral',
        ageRange: 'middle-aged',
        style: 'conversational',
        pace: 'moderate',
        emotion: 'confident',
      };
    }
  }

  /**
   * Get voice recommendations with explanations
   */
  async getVoiceRecommendations(scriptContent: string, topN: number = 3): Promise<VoiceMatch[]> {
    const lowerText = scriptContent.toLowerCase();

    const scored = this.voices.map((voice) => {
      let score = 0;
      const matched: string[] = [];

      for (const kw of voice.keywords) {
        if (lowerText.includes(kw.toLowerCase())) {
          score += 1;
          matched.push(kw);
        }
      }
      for (const cat of voice.categories) {
        if (lowerText.includes(cat.replace(/_/g, ' '))) {
          score += 2;
          matched.push(cat);
        }
      }

      return {
        voiceId: voice.voice_id,
        name: voice.label,
        score,
        reason: matched.length > 0 ? `Matched: ${matched.join(', ')}` : 'general match',
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topN);
  }

  /**
   * Generate music prompt based on script analysis (fallback when LLM ad-production has no music suggestion).
   * Production-style: studio quality, -16 LUFS, leaves 1-4kHz clear for voice.
   */
  async generateMusicPrompt(scriptContent: string, duration: number): Promise<string> {
    try {
      logger.info('Generating music prompt based on script');

      const analysis = await this.analyzeScript(scriptContent);
      const stylePresets: Record<string, string> = {
        corporate:
          'Corporate contemporary with acoustic piano, warm strings, and subtle percussion',
        energetic:
          'Energetic modern pop with bright synths, driving beat, and uplifting melody',
        calm:
          'Calm ambient with soft piano, atmospheric pads, and minimal percussion',
        dramatic:
          'Dramatic cinematic with orchestral strings, powerful brass, and impactful percussion',
      };
      const style =
        analysis.tone === 'professional'
          ? 'corporate'
          : analysis.emotion === 'excited'
            ? 'energetic'
            : analysis.emotion === 'calm'
              ? 'calm'
              : 'corporate';
      const basePrompt = stylePresets[style] || stylePresets.corporate;

      return `Professional ${duration}-second advertisement music: ${basePrompt}, studio-quality production, -16 LUFS loudness, leaves 1-4kHz clear for voice, smooth fade in/out, ${analysis.tone} mood`;
    } catch (error: any) {
      logger.error('Error generating music prompt:', error.message);
      return 'Professional corporate background music with piano and strings, uplifting but subtle, studio quality';
    }
  }
}

export default new VoiceSelectionService();
