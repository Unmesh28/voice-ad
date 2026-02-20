import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { logger } from '../../config/logger';

/** Default Suno API base URL. Supports sunoapi.org and kie.ai (same interface). */
const DEFAULT_SUNO_API_BASE = 'https://api.sunoapi.org/api/v1';
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_WAIT_MS = 300000; // 5 min

export interface KieSunoGenerateOptions {
  /** Text prompt for music (max 500 chars in non-custom mode). Required in non-custom; can be empty in custom instrumental. */
  prompt: string;
  /** Instrumental only (no vocals) - best for ad background. */
  instrumental?: boolean;
  /** Model: V5 recommended for quality/speed. */
  model?: 'V4' | 'V4_5' | 'V4_5PLUS' | 'V4_5ALL' | 'V5';
  /** Use custom mode with style + title (e.g. timestamped composition for ad arcs). */
  customMode?: boolean;
  /** Required when customMode true. Music style / timestamped description. V5: max 1000 chars. */
  style?: string;
  /** Required when customMode true. Track title. Max 80 chars. */
  title?: string;
}

interface KieGenerateResponse {
  code: number;
  msg: string;
  data?: { taskId: string };
}

/** Track from Get Music Task Details (camelCase) or callback (snake_case). */
interface SunoTrack {
  id?: string;
  audioUrl?: string;
  audio_url?: string;
  streamAudioUrl?: string;
  stream_audio_url?: string;
  duration?: number;
  title?: string;
  prompt?: string;
}

interface KieRecordInfoResponse {
  code: number;
  msg: string;
  data?: {
    taskId: string;
    status: string;
    response?: {
      sunoData?: SunoTrack[];
    };
    errorMessage?: string | null;
  };
}

/**
 * Kie.ai Suno API client for text-to-music (production pipeline).
 *
 * Implements:
 * - POST /api/v1/generate (required: prompt, customMode, instrumental, callBackUrl, model)
 * - GET /api/v1/generate/record-info?taskId= (poll until status SUCCESS)
 *
 * Non-custom mode: only prompt required, max 500 chars. Instrumental for ad background.
 * @see https://docs.kie.ai/suno-api/generate-music
 * @see https://kie.ai/suno-api
 */
class KieSunoMusicService {
  private apiKey: string;
  private baseUrl: string;
  private callbackUrl: string;

  constructor() {
    this.apiKey = process.env.SUNO_API_KEY || process.env.KIE_API_KEY || '';
    this.baseUrl = process.env.SUNO_API_URL || process.env.KIE_API_URL || DEFAULT_SUNO_API_BASE;
    this.callbackUrl =
      process.env.SUNO_CALLBACK_URL || 'https://example.com/api/webhooks/suno';

    if (!this.apiKey) {
      logger.warn('Suno API key not configured (SUNO_API_KEY or KIE_API_KEY)');
    } else {
      logger.info(`Suno API configured: ${this.baseUrl}`);
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }

  /**
   * Generate instrumental background music from a text prompt.
   * Non-custom: prompt only (max 500 chars). Custom: style + title (timestamped arc for ad sections).
   */
  async generateAndSave(
    options: KieSunoGenerateOptions,
    filename: string
  ): Promise<{ filePath: string; audioBuffer: Buffer; duration: number }> {
    if (!this.apiKey) {
      throw new Error('Kie.ai Suno API key is not configured');
    }

    const customMode = !!options.customMode;
    const prompt = (options.prompt || '').slice(0, customMode ? 5000 : 500);
    const style = (options.style || '').slice(0, 1000);
    const title = (options.title || '').slice(0, 80);
    const instrumental = options.instrumental !== false;
    const model = options.model || 'V5';

    if (customMode && (!style.trim() || !title.trim())) {
      throw new Error('Kie Suno custom mode requires style and title');
    }

    logger.info('Starting Kie.ai Suno music generation', {
      customMode,
      promptLength: prompt.length,
      styleLength: style.length,
      instrumental,
      model,
    });

    const taskId = await this.submitGenerate(
      { prompt, customMode, style, title, instrumental, model }
    );
    const track = await this.waitForCompletion(taskId);
    const audioUrl = track.audioUrl ?? track.audio_url;
    if (!audioUrl) throw new Error('Kie.ai response missing audio URL');
    const audioBuffer = await this.downloadAudio(audioUrl);
    const duration = track.duration ?? 60;
    const filePath = await this.saveToFile(audioBuffer, filename);

    return {
      filePath,
      audioBuffer,
      duration,
    };
  }

  /**
   * Make an HTTP request using curl (bypasses Cloudflare TLS fingerprint blocking).
   * Falls back to axios if curl is unavailable.
   */
  private curlPost(url: string, body: Record<string, unknown>): any {
    const bodyJson = JSON.stringify(body);
    // Escape single quotes in JSON for shell safety
    const escaped = bodyJson.replace(/'/g, "'\\''");
    try {
      const result = execSync(
        `curl -s -X POST "${url}" ` +
        `-H "Authorization: Bearer ${this.apiKey}" ` +
        `-H "Content-Type: application/json" ` +
        `-d '${escaped}'`,
        { timeout: 30000, encoding: 'utf-8' }
      );
      return JSON.parse(result);
    } catch (err: any) {
      logger.warn(`curl POST failed, falling back to axios: ${err.message}`);
      return null; // Will trigger axios fallback
    }
  }

  private curlGet(url: string): any {
    try {
      const result = execSync(
        `curl -s "${url}" ` +
        `-H "Authorization: Bearer ${this.apiKey}" ` +
        `-H "Content-Type: application/json"`,
        { timeout: 15000, encoding: 'utf-8' }
      );
      return JSON.parse(result);
    } catch (err: any) {
      logger.warn(`curl GET failed, falling back to axios: ${err.message}`);
      return null;
    }
  }

  private async submitGenerate(params: {
    prompt: string;
    customMode: boolean;
    style: string;
    title: string;
    instrumental: boolean;
    model: string;
  }): Promise<string> {
    const { prompt, customMode, style, title, instrumental, model } = params;
    const url = `${this.baseUrl}/generate`;
    const body: Record<string, unknown> = {
      prompt: customMode ? (prompt || style) : prompt,
      customMode,
      instrumental,
      model,
      callBackUrl: this.callbackUrl,
    };
    if (customMode) {
      body.style = style;
      body.title = title;
    }

    // Try curl first (bypasses Cloudflare TLS fingerprint blocking)
    let data: KieGenerateResponse | null = this.curlPost(url, body);

    // Fallback to axios if curl failed
    if (!data) {
      const response = await axios.post<KieGenerateResponse>(url, body, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });
      data = response.data;
    }

    if (data.code !== 200 || !data.data?.taskId) {
      const msg = (data as any).msg || 'Unknown error';
      if (data.code === 402) throw new Error(`Kie.ai insufficient credits: ${msg}`);
      if (data.code === 401) throw new Error(`Kie.ai invalid API key: ${msg}`);
      if (data.code === 429) throw new Error(`Kie.ai rate limited: ${msg}`);
      throw new Error(`Kie.ai generate failed (${data.code}): ${msg}`);
    }

    logger.info('Kie.ai Suno task submitted', { taskId: data.data.taskId });
    return data.data.taskId;
  }

  private async waitForCompletion(taskId: string): Promise<SunoTrack> {
    const start = Date.now();
    while (Date.now() - start < MAX_POLL_WAIT_MS) {
      const result = await this.getTaskDetails(taskId);
      const status = result.data?.status;
      const sunoData = result.data?.response?.sunoData;

      if (status === 'SUCCESS' && sunoData?.length) {
        const track = sunoData[0];
        if (track.audioUrl || track.audio_url) return track;
      }
      if (
        status === 'CREATE_TASK_FAILED' ||
        status === 'GENERATE_AUDIO_FAILED' ||
        status === 'CALLBACK_EXCEPTION' ||
        status === 'SENSITIVE_WORD_ERROR'
      ) {
        const err = result.data?.errorMessage || status;
        throw new Error(`Kie.ai generation failed: ${err}`);
      }

      await this.sleep(POLL_INTERVAL_MS);
    }

    throw new Error('Kie.ai Suno generation timed out');
  }

  private async getTaskDetails(taskId: string): Promise<KieRecordInfoResponse> {
    const url = `${this.baseUrl}/generate/record-info?taskId=${encodeURIComponent(taskId)}`;

    // Try curl first
    const curlResult = this.curlGet(url);
    if (curlResult) return curlResult;

    // Fallback to axios
    const { data } = await axios.get<KieRecordInfoResponse>(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });
    return data;
  }

  private async downloadAudio(audioUrl: string): Promise<Buffer> {
    // Try curl first (audio downloads usually don't have Cloudflare, but just in case)
    try {
      const result = execSync(
        `curl -s -L "${audioUrl}" --output -`,
        { timeout: 120000, maxBuffer: 100 * 1024 * 1024 }
      );
      if (result.length > 0) return result;
    } catch {
      // Fallback to axios
    }

    const response = await axios.get(audioUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
    });
    return Buffer.from(response.data);
  }

  private async saveToFile(audioBuffer: Buffer, filename: string): Promise<string> {
    const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
    const musicDir = path.join(uploadDir, 'music');
    if (!fs.existsSync(musicDir)) {
      fs.mkdirSync(musicDir, { recursive: true });
    }
    const filePath = path.join(musicDir, filename);
    fs.writeFileSync(filePath, audioBuffer);
    logger.info('Kie Suno music saved', { filePath });
    return filePath;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

const kieSunoMusicService = new KieSunoMusicService();
export default kieSunoMusicService;
