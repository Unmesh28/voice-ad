import axios from 'axios';
import elevenLabsService from './tts/elevenlabs.service';
import { logger } from '../config/logger';

interface ScriptAnalysis {
  tone: string; // professional, friendly, energetic, calm, exciting, authoritative, warm, etc.
  gender: string; // male, female, neutral
  ageRange: string; // young, middle-aged, mature
  style: string; // conversational, formal, dramatic, casual
  pace: string; // fast, moderate, slow
  emotion: string; // excited, calm, serious, playful, etc.
}

interface PromptVoicePreference {
  hasPreference: boolean;
  gender?: string;
  ageRange?: string;
  tone?: string;
  accent?: string;
  specificVoiceName?: string;
  keywords: string[];
}

interface VoiceMatch {
  voiceId: string;
  name: string;
  score: number;
  reason: string;
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

class VoiceSelectionService {
  private apiKey: string;
  private apiUrl: string;
  private model: string;

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || '';
    this.apiUrl = 'https://api.openai.com/v1/chat/completions';
    this.model = process.env.OPENAI_MODEL || 'gpt-4';

    if (!this.apiKey) {
      logger.warn('OpenAI API key not configured');
    }
  }

  /**
   * Analyze user prompt for explicit voice preferences
   */
  async analyzePromptForVoicePreferences(userPrompt: string): Promise<PromptVoicePreference> {
    try {
      logger.info('Analyzing user prompt for voice preferences');

      const prompt = `Analyze this user prompt to extract any voice preferences they mentioned.

User Prompt:
${userPrompt}

Look for:
- Gender preferences (male, female, neutral, non-binary)
- Age preferences (young, middle-aged, mature, elderly, child)
- Tone preferences (professional, friendly, warm, authoritative, energetic, calm, etc.)
- Accent preferences (American, British, Australian, etc.)
- Specific voice characteristics (deep, high-pitched, raspy, smooth, etc.)
- Any specific voice names mentioned

Respond with a JSON object:
{
  "hasPreference": boolean,
  "gender": "male/female/neutral or null",
  "ageRange": "young/middle-aged/mature or null",
  "tone": "tone description or null",
  "accent": "accent preference or null",
  "specificVoiceName": "specific name if mentioned or null",
  "keywords": ["relevant", "keywords", "found"]
}

Respond ONLY with valid JSON, no additional text.`;

      const messages: OpenAIMessage[] = [
        {
          role: 'system',
          content: 'You are an expert at understanding user voice preferences from natural language. Respond only with valid JSON.',
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

      // Extract JSON from response
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/\n?```/g, '');
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```\n?/g, '').replace(/\n?```/g, '');
      }

      const preferences = JSON.parse(jsonStr);

      logger.info('User prompt voice preferences:', preferences);

      return preferences as PromptVoicePreference;
    } catch (error: any) {
      logger.error('Error analyzing prompt for voice preferences:', error.message);

      // Return no preferences if analysis fails
      return {
        hasPreference: false,
        keywords: [],
      };
    }
  }

  /**
   * Analyze script content to determine appropriate voice characteristics
   */
  async analyzeScript(scriptContent: string, userPreferences?: PromptVoicePreference): Promise<ScriptAnalysis> {
    try {
      logger.info('Analyzing script for voice selection');

      const userConstraints = userPreferences?.hasPreference
        ? `\nUser explicitly requested: ${userPreferences.gender ? `${userPreferences.gender} voice, ` : ''}${userPreferences.accent ? `${userPreferences.accent} accent, ` : ''}${userPreferences.tone ? `${userPreferences.tone} tone` : ''}`
        : '';

      const prompt = `Analyze this advertisement script and determine the ideal voice characteristics.${userConstraints}

Script:
${scriptContent}

Based on this script${userPreferences?.hasPreference ? ' and user preferences' : ''}, provide a JSON response with these fields:
- tone: The overall tone (professional, friendly, energetic, calm, exciting, authoritative, warm, etc.)
- gender: Preferred gender (male, female, neutral)${userPreferences?.gender ? ` - USER REQUESTED: ${userPreferences.gender}` : ''}
- ageRange: Age range (young, middle-aged, mature)
- style: Speaking style (conversational, formal, dramatic, casual)
- pace: Speaking pace (fast, moderate, slow)
- emotion: Primary emotion (excited, calm, serious, playful, confident, etc.)

Important: If user specified gender, tone, or other preferences, ALWAYS use those values.

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

      // Extract JSON from response (may be wrapped in markdown code blocks)
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

      // Return default analysis if OpenAI fails
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
   * Select the best voice based on script analysis and optional user prompt preferences
   */
  async selectVoiceForScript(scriptContent: string, userPrompt?: string): Promise<VoiceMatch> {
    try {
      // Step 1: Analyze user prompt for explicit voice preferences (if provided)
      let promptPreferences: PromptVoicePreference | null = null;
      if (userPrompt) {
        promptPreferences = await this.analyzePromptForVoicePreferences(userPrompt);
      }

      // Step 2: Analyze the script (with user preferences to guide the analysis)
      const analysis = await this.analyzeScript(scriptContent, promptPreferences || undefined);

      // Step 3: Get available voices from ElevenLabs
      const voices = await elevenLabsService.getVoices();

      if (!voices || voices.length === 0) {
        throw new Error('No voices available from ElevenLabs');
      }

      logger.info(`Found ${voices.length} available voices, matching with analysis`);

      // Step 4: Score and rank voices based on both prompt preferences and script analysis
      const scoredVoices = voices.map((voice) => {
        let score = 0;
        const reasons: string[] = [];

        // PRIORITY 1: Match user's explicit voice preferences from prompt (if any)
        if (promptPreferences?.hasPreference) {
          if (voice.labels) {
            const labels = voice.labels;

            // Match gender (highest priority if specified) - must be EXACT match
            if (promptPreferences.gender && labels.gender) {
              const voiceGender = labels.gender.toLowerCase();
              const requestedGender = promptPreferences.gender.toLowerCase();

              if (voiceGender === requestedGender || voiceGender.includes(requestedGender)) {
                score += 50;
                reasons.push(`user requested ${promptPreferences.gender}`);
              } else {
                // PENALTY for wrong gender if user explicitly requested it
                score -= 100;
              }
            }

            // Match age preference
            if (promptPreferences.ageRange &&
                labels.age?.toLowerCase().includes(promptPreferences.ageRange.toLowerCase())) {
              score += 40;
              reasons.push(`user requested ${promptPreferences.ageRange}`);
            }

            // Match accent preference
            if (promptPreferences.accent &&
                labels.accent?.toLowerCase().includes(promptPreferences.accent.toLowerCase())) {
              score += 35;
              reasons.push(`user requested ${promptPreferences.accent} accent`);
            }

            // Match tone preference
            if (promptPreferences.tone &&
                labels.descriptive?.toLowerCase().includes(promptPreferences.tone.toLowerCase())) {
              score += 30;
              reasons.push(`user requested ${promptPreferences.tone} tone`);
            }
          }

          // Check for specific voice name match
          if (promptPreferences.specificVoiceName) {
            if (voice.name.toLowerCase().includes(promptPreferences.specificVoiceName.toLowerCase())) {
              score += 100; // Very high score for exact name match
              reasons.push(`matches requested voice name`);
            }
          }

          // Check for keyword matches in voice description
          promptPreferences.keywords.forEach((keyword) => {
            const voiceText = `${voice.name} ${voice.description || ''}`.toLowerCase();
            if (voiceText.includes(keyword.toLowerCase())) {
              score += 15;
              reasons.push(`matches keyword: ${keyword}`);
            }
          });
        }

        // PRIORITY 2: Match script analysis (lower weight than explicit preferences)
        // Only apply script-based scoring if not overridden by user preferences
        if (voice.labels) {
          const labels = voice.labels;

          // Match gender (only if user didn't specify)
          if (!promptPreferences?.gender &&
              labels.gender?.toLowerCase().includes(analysis.gender.toLowerCase())) {
            score += 25;
            reasons.push(`script suggests ${labels.gender}`);
          }

          // Match age (only if user didn't specify)
          if (!promptPreferences?.ageRange &&
              labels.age?.toLowerCase().includes(analysis.ageRange.toLowerCase())) {
            score += 20;
            reasons.push(`script suggests ${labels.age}`);
          }

          // Match accent (prefer neutral/american for professional)
          if (!promptPreferences?.accent && labels.accent) {
            if (analysis.tone === 'professional' &&
                (labels.accent.toLowerCase().includes('american') ||
                 labels.accent.toLowerCase().includes('neutral'))) {
              score += 15;
              reasons.push(`professional ${labels.accent} accent`);
            }
          }

          // Match use case
          if (labels.use_case) {
            if (labels.use_case.toLowerCase().includes('narration') ||
                labels.use_case.toLowerCase().includes('commercial') ||
                labels.use_case.toLowerCase().includes('advertisement')) {
              score += 25;
              reasons.push(`${labels.use_case} voice`);
            }
          }

          // Match descriptive tags (only if user didn't specify tone)
          if (!promptPreferences?.tone && labels.descriptive) {
            const descriptive = labels.descriptive.toLowerCase();
            if (descriptive.includes(analysis.tone.toLowerCase()) ||
                descriptive.includes(analysis.emotion.toLowerCase())) {
              score += 20;
              reasons.push(`${analysis.tone} tone`);
            }
          }
        }

        // Check voice name and description for keywords
        const voiceText = `${voice.name} ${voice.description || ''}`.toLowerCase();

        // Bonus for expressive voices
        if (voiceText.includes('expressive')) {
          score += 15;
          reasons.push('expressive voice model');
        }

        // Match tone keywords in name/description
        if (voiceText.includes(analysis.tone.toLowerCase())) {
          score += 10;
          reasons.push(`tone match in description`);
        }

        // Prefer voices in professional/premade category for ads
        if (voice.category === 'premade' || voice.category === 'professional') {
          score += 10;
          reasons.push(`category: ${voice.category}`);
        }

        return {
          voiceId: voice.voice_id,
          name: voice.name,
          score,
          reason: reasons.join(', '),
          labels: voice.labels,
          description: voice.description,
        };
      });

      // Sort by score (descending)
      scoredVoices.sort((a, b) => b.score - a.score);

      // Get top match
      const topMatch = scoredVoices[0];

      if (!topMatch || topMatch.score === 0) {
        // If no good match, use a default high-quality voice
        logger.warn('No good voice match found, using first available voice');
        return {
          voiceId: voices[0].voice_id,
          name: voices[0].name,
          score: 0,
          reason: 'default fallback',
        };
      }

      logger.info('Selected voice:', {
        name: topMatch.name,
        voiceId: topMatch.voiceId,
        score: topMatch.score,
        reason: topMatch.reason,
        analysis,
      });

      return {
        voiceId: topMatch.voiceId,
        name: topMatch.name,
        score: topMatch.score,
        reason: topMatch.reason,
      };
    } catch (error: any) {
      logger.error('Error selecting voice:', error.message);
      throw new Error(`Failed to select voice: ${error.message}`);
    }
  }

  /**
   * Get voice recommendations with explanations
   */
  async getVoiceRecommendations(scriptContent: string, topN: number = 3): Promise<VoiceMatch[]> {
    try {
      const analysis = await this.analyzeScript(scriptContent);
      const voices = await elevenLabsService.getVoices();

      const scoredVoices = voices.map((voice) => {
        let score = 0;
        const reasons: string[] = [];

        if (voice.labels) {
          const labels = voice.labels;

          if (labels.gender?.toLowerCase().includes(analysis.gender.toLowerCase())) {
            score += 30;
            reasons.push(`gender: ${labels.gender}`);
          }

          if (labels.age?.toLowerCase().includes(analysis.ageRange.toLowerCase())) {
            score += 20;
            reasons.push(`age: ${labels.age}`);
          }

          if (labels.use_case?.toLowerCase().includes('commercial')) {
            score += 25;
            reasons.push(`commercial voice`);
          }

          if (labels.descriptive?.toLowerCase().includes(analysis.tone.toLowerCase())) {
            score += 20;
            reasons.push(`tone: ${analysis.tone}`);
          }
        }

        const voiceText = `${voice.name} ${voice.description || ''}`.toLowerCase();
        if (voiceText.includes('expressive')) {
          score += 15;
          reasons.push('expressive');
        }

        return {
          voiceId: voice.voice_id,
          name: voice.name,
          score,
          reason: reasons.join(', ') || 'general match',
        };
      });

      scoredVoices.sort((a, b) => b.score - a.score);

      return scoredVoices.slice(0, topN);
    } catch (error: any) {
      logger.error('Error getting voice recommendations:', error.message);
      throw error;
    }
  }

  /**
   * Generate music prompt based on script analysis
   */
  async generateMusicPrompt(scriptContent: string, duration: number): Promise<string> {
    try {
      logger.info('Generating music prompt based on script');

      const prompt = `Analyze this advertisement script and create a perfect background music description for ElevenLabs music generation.

Script:
${scriptContent}

Create a music prompt that:
1. Matches the tone and emotion of the script
2. Enhances the message without overpowering the voice
3. Is suitable for a ${duration}-second advertisement
4. Uses specific musical elements (instruments, tempo, mood, genre)

Provide a concise music generation prompt (1-2 sentences, max 200 characters) that will create the perfect background music for this ad.

Respond with ONLY the music prompt, no additional explanation.`;

      const messages: OpenAIMessage[] = [
        {
          role: 'system',
          content: 'You are an expert music director who creates perfect background music descriptions for advertisements.',
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
          temperature: 0.7,
          max_tokens: 100,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        }
      );

      const musicPrompt = response.data.choices[0].message.content?.trim() || '';

      logger.info('Generated music prompt:', musicPrompt);

      return musicPrompt;
    } catch (error: any) {
      logger.error('Error generating music prompt:', error.message);

      // Return a safe default
      return 'Upbeat corporate background music with soft piano and gentle percussion, professional and positive';
    }
  }
}

export default new VoiceSelectionService();
