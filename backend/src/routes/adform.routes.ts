import { Router, Request, Response } from 'express';
import adFormBuilder from '../services/adform/adform-builder.service';
import ttsManager from '../services/tts/tts-manager.service';
import soundTemplateService from '../services/music/sound-template.service';
import soundTemplateGenerator from '../services/music/sound-template-generator.service';
import { TEMPLATE_DEFINITIONS } from '../services/music/sound-template-generator.service';
import { validateAdForm, ADFORM_VERSION, getLoudnessValues, MASTERING_PRESETS, LOUDNESS_PRESETS, AUDIO_FORMAT_PRESETS } from '../types/adform';
import type { AdForm, AdFormBatchRequest } from '../types/adform';
import { logger } from '../config/logger';

const router = Router();

// ===========================================================================
// AdForm API — AudioStack-like endpoints
//
// Pipeline: Content → Speech → Production → Delivery
//
// Endpoints:
//   POST   /api/adform/build         — Build a single AdForm
//   POST   /api/adform/batch         — Build multiple AdForms in parallel
//   POST   /api/adform/validate      — Validate an AdForm without building
//   GET    /api/adform/presets        — List available presets
//   GET    /api/adform/voices         — List voices across all providers
//   GET    /api/adform/voices/:provider — List voices for a specific provider
//   GET    /api/adform/templates      — List sound templates
//   GET    /api/adform/templates/search — Search sound templates
// ===========================================================================

/**
 * POST /api/adform/build
 *
 * Build a complete audio ad from an AdForm JSON document.
 * This is the main entry point — equivalent to AudioStack's Audioform build.
 */
router.post('/build', async (req: Request, res: Response) => {
  try {
    const { valid, errors, adform } = validateAdForm(req.body);

    if (!valid || !adform) {
      return res.status(400).json({
        success: false,
        message: 'Invalid AdForm document',
        errors,
      });
    }

    logger.info('AdForm build request received', {
      version: adform.version,
      sections: adform.content.sections?.length ?? 0,
      provider: adform.speech.voice.provider,
      template: typeof adform.production.soundTemplate === 'string'
        ? adform.production.soundTemplate
        : (adform.production.soundTemplate as any).id,
    });

    const result = await adFormBuilder.build(adform);

    if (result.status === 'failed') {
      return res.status(500).json({
        success: false,
        message: 'AdForm build failed',
        error: result.error,
        buildId: result.buildId,
        timing: result.timing,
      });
    }

    return res.json({
      success: true,
      data: result,
    });
  } catch (err: any) {
    logger.error('AdForm build error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Internal error during AdForm build',
      error: err.message,
    });
  }
});

/**
 * POST /api/adform/batch
 *
 * Build multiple AdForms in parallel (up to 100).
 * Equivalent to AudioStack's batch Audioform endpoint.
 */
router.post('/batch', async (req: Request, res: Response) => {
  try {
    const { adforms, delivery } = req.body as AdFormBatchRequest;

    if (!Array.isArray(adforms) || adforms.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Request must include an "adforms" array with at least 1 item',
      });
    }

    if (adforms.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Maximum 100 AdForms per batch',
      });
    }

    // Validate all AdForms first
    const validationErrors: { index: number; errors: string[] }[] = [];
    for (let i = 0; i < adforms.length; i++) {
      const { valid, errors } = validateAdForm(adforms[i]);
      if (!valid) {
        validationErrors.push({ index: i, errors });
      }
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: `${validationErrors.length} AdForm(s) failed validation`,
        validationErrors,
      });
    }

    logger.info(`AdForm batch request: ${adforms.length} items`);
    const result = await adFormBuilder.buildBatch({ adforms, delivery });

    return res.json({
      success: true,
      data: result,
    });
  } catch (err: any) {
    logger.error('AdForm batch error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Internal error during batch build',
      error: err.message,
    });
  }
});

/**
 * POST /api/adform/validate
 *
 * Validate an AdForm document without building it.
 * Useful for checking syntax before submitting.
 */
router.post('/validate', (req: Request, res: Response) => {
  const { valid, errors } = validateAdForm(req.body);

  return res.json({
    success: true,
    data: {
      valid,
      errors: valid ? [] : errors,
      version: ADFORM_VERSION,
    },
  });
});

/**
 * GET /api/adform/presets
 *
 * List all available presets (mastering, loudness, format).
 */
router.get('/presets', (_req: Request, res: Response) => {
  const loudnessDetails = Object.fromEntries(
    (LOUDNESS_PRESETS as readonly string[]).map((p) => [
      p,
      getLoudnessValues(p as any),
    ])
  );

  return res.json({
    success: true,
    data: {
      mastering: [...MASTERING_PRESETS],
      loudness: loudnessDetails,
      formats: [...AUDIO_FORMAT_PRESETS],
    },
  });
});

/**
 * GET /api/adform/voices
 *
 * List all voices across all configured TTS providers.
 */
router.get('/voices', async (_req: Request, res: Response) => {
  try {
    const voices = await ttsManager.getAllVoices();
    const providers = ttsManager.listProviders();

    return res.json({
      success: true,
      data: {
        totalVoices: voices.length,
        providers,
        voices,
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch voices',
      error: err.message,
    });
  }
});

/**
 * GET /api/adform/voices/:provider
 *
 * List voices for a specific TTS provider.
 */
router.get('/voices/:provider', async (req: Request, res: Response) => {
  try {
    const provider = req.params.provider;
    const voices = await ttsManager.getVoices(provider as any);

    return res.json({
      success: true,
      data: {
        provider,
        totalVoices: voices.length,
        voices,
      },
    });
  } catch (err: any) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
});

/**
 * GET /api/adform/templates
 *
 * List all available sound templates.
 */
router.get('/templates', (_req: Request, res: Response) => {
  const templates = soundTemplateService.getTemplates();

  return res.json({
    success: true,
    data: {
      total: templates.length,
      templates,
    },
  });
});

/**
 * GET /api/adform/templates/search
 *
 * Search sound templates by genre, mood, energy, or tags.
 * Query params: genre, mood, energy, category, tags (comma-separated)
 */
router.get('/templates/search', (req: Request, res: Response) => {
  const { genre, mood, energy, category, tags } = req.query;

  const results = soundTemplateService.searchTemplates({
    genre: genre as string,
    mood: mood as string,
    energy: energy as string,
    category: category as string,
    tags: tags ? (tags as string).split(',').map((t) => t.trim()) : undefined,
  });

  return res.json({
    success: true,
    data: {
      total: results.length,
      templates: results,
    },
  });
});

// ===========================================================================
// Sound Template Generation Endpoints
// ===========================================================================

/**
 * GET /api/adform/templates/definitions
 *
 * List all available template definitions that can be generated.
 * Shows genres, moods, and template IDs without generating anything.
 */
router.get('/templates/definitions', (_req: Request, res: Response) => {
  const definitions = soundTemplateGenerator.listDefinitions();
  const genres = soundTemplateGenerator.listGenres();

  // Group by genre
  const grouped: Record<string, typeof definitions> = {};
  for (const d of definitions) {
    if (!grouped[d.genre]) grouped[d.genre] = [];
    grouped[d.genre].push(d);
  }

  return res.json({
    success: true,
    data: {
      totalDefinitions: definitions.length,
      genres,
      byGenre: grouped,
    },
  });
});

/**
 * POST /api/adform/templates/generate
 *
 * Generate sound templates using Suno API.
 * This calls Suno to generate intro/main/outro for each template.
 *
 * Body:
 *   { genre?: string, ids?: string[], concurrency?: number }
 *
 * - No body = generate ALL templates
 * - genre = generate all templates for that genre
 * - ids = generate specific templates by ID
 */
router.post('/templates/generate', async (req: Request, res: Response) => {
  try {
    const { genre, ids, concurrency = 2 } = req.body || {};

    const progressLog: any[] = [];
    const onProgress = (p: any) => {
      progressLog.push({ ...p, timestamp: new Date().toISOString() });
    };

    let results;

    if (ids && Array.isArray(ids) && ids.length > 0) {
      logger.info(`Template generation requested for IDs: ${ids.join(', ')}`);
      results = await soundTemplateGenerator.generateByIds(ids, onProgress, concurrency);
    } else if (genre) {
      logger.info(`Template generation requested for genre: ${genre}`);
      results = await soundTemplateGenerator.generateByGenre(genre, onProgress, concurrency);
    } else {
      logger.info('Template generation requested for ALL templates');
      results = await soundTemplateGenerator.generateAll(onProgress, concurrency);
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return res.json({
      success: true,
      data: {
        total: results.length,
        succeeded,
        failed,
        results,
      },
    });
  } catch (err: any) {
    logger.error('Template generation error:', err.message);
    return res.status(500).json({
      success: false,
      message: 'Template generation failed',
      error: err.message,
    });
  }
});

export default router;
