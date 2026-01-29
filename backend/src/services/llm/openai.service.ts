import axios from 'axios';
import { logger } from '../../config/logger';

interface GenerateScriptParams {
  prompt: string;
  tone?: string;
  length?: 'short' | 'medium' | 'long';
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
   * Build system prompt for script generation
   */
  private buildSystemPrompt(): string {
    return `You are an expert advertising copywriter specializing in creating compelling audio advertisements.
Your scripts are designed for voice synthesis and audio production.

Key guidelines:
1. Write clear, conversational scripts optimized for voice delivery
2. Include natural pauses and emphasis where appropriate (use punctuation)
3. Create engaging hooks in the first 3 seconds
4. Build clear value propositions
5. End with strong, memorable calls-to-action
6. Use simple, direct language that sounds natural when spoken
7. Avoid complex words or tongue-twisters
8. Consider pacing and rhythm for audio delivery
9. Keep sentences short and punchy for better comprehension
10. Include emotional triggers appropriate to the product/service

Format your output as a clean, ready-to-use script without extra commentary or stage directions unless specifically requested.`;
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

    if (params.length) {
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
        .map((v) => v.trim())
        .filter((v) => v.length > 0);

      logger.info(`Generated ${variations.length} script variations`);

      return variations;
    } catch (error: any) {
      logger.error('Error generating script variations:', error.message);
      throw new Error(`Failed to generate variations: ${error.message}`);
    }
  }
}

export default new OpenAIService();
