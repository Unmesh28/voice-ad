import { Request, Response } from 'express';
import prisma from '../config/database';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import elevenLabsService from '../services/tts/elevenlabs.service';
import { ttsGenerationQueue } from '../config/redis';
import { logger } from '../config/logger';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * Get all available voices from ElevenLabs
 */
export const getVoices = asyncHandler(async (req: Request, res: Response) => {
  if (!elevenLabsService.isConfigured()) {
    throw new AppError('ElevenLabs API key not configured', 500);
  }

  const voices = await elevenLabsService.getVoices();

  res.json({
    success: true,
    data: voices,
  });
});

/**
 * Get a specific voice by ID
 */
export const getVoice = asyncHandler(async (req: Request, res: Response) => {
  if (!elevenLabsService.isConfigured()) {
    throw new AppError('ElevenLabs API key not configured', 500);
  }

  const { id } = req.params;

  const voice = await elevenLabsService.getVoice(id);

  res.json({
    success: true,
    data: voice,
  });
});

/**
 * Generate TTS from script (async with queue)
 */
export const generateTTS = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  if (!elevenLabsService.isConfigured()) {
    throw new AppError('ElevenLabs API key not configured', 500);
  }

  const { scriptId, voiceId, voiceSettings } = req.body;

  // Verify script exists and belongs to user
  const script = await prisma.script.findFirst({
    where: {
      id: scriptId,
      project: {
        userId: req.user.id,
      },
    },
  });

  if (!script) {
    throw new AppError('Script not found or access denied', 404);
  }

  // Add job to queue for async processing
  const job = await ttsGenerationQueue.add('generate-tts', {
    userId: req.user.id,
    scriptId,
    voiceId,
    voiceSettings,
  });

  logger.info(`TTS generation job queued: ${job.id}`);

  res.status(202).json({
    success: true,
    message: 'TTS generation started',
    data: {
      jobId: job.id,
    },
  });
});

/**
 * Generate TTS synchronously (for immediate results)
 */
export const generateTTSSync = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  if (!elevenLabsService.isConfigured()) {
    throw new AppError('ElevenLabs API key not configured', 500);
  }

  const { scriptId, voiceId, voiceSettings } = req.body;

  // Verify script exists and belongs to user
  const script = await prisma.script.findFirst({
    where: {
      id: scriptId,
      project: {
        userId: req.user.id,
      },
    },
    include: {
      project: true,
    },
  });

  if (!script) {
    throw new AppError('Script not found or access denied', 404);
  }

  // Validate and sanitize voice settings
  const settings = voiceSettings
    ? elevenLabsService.validateVoiceSettings(voiceSettings)
    : elevenLabsService.getDefaultVoiceSettings();

  // Generate unique filename
  const filename = `tts_${script.id}_${uuidv4()}.mp3`;

  // Generate speech
  const { filePath, audioBuffer } = await elevenLabsService.generateAndSave(
    {
      voiceId,
      text: script.content,
      voiceSettings: settings,
    },
    filename
  );

  // Get file stats
  const characterCount = elevenLabsService.getCharacterCount(script.content);
  const estimatedDuration = elevenLabsService.estimateAudioDuration(script.content);

  // Save file info to database (could create an Audio table or use production)
  const audioUrl = `/uploads/audio/${filename}`;

  // Update script metadata with audio info
  await prisma.script.update({
    where: { id: script.id },
    data: {
      metadata: {
        ...(script.metadata as object),
        lastTTS: {
          voiceId,
          voiceSettings: settings as any,
          audioUrl,
          characterCount,
          estimatedDuration,
          generatedAt: new Date().toISOString(),
        },
      } as any,
    },
  });

  // Track usage
  await prisma.usageRecord.create({
    data: {
      userId: req.user.id,
      resourceType: 'TTS_CHARACTERS',
      quantity: characterCount,
      metadata: {
        scriptId: script.id,
        voiceId,
        duration: estimatedDuration,
      },
    },
  });

  logger.info(`TTS generated successfully for script ${script.id}`);

  res.status(201).json({
    success: true,
    data: {
      audioUrl,
      characterCount,
      estimatedDuration,
      voiceId,
    },
  });
});

/**
 * Generate TTS from custom text (not from script)
 */
export const generateTTSFromText = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  if (!elevenLabsService.isConfigured()) {
    throw new AppError('ElevenLabs API key not configured', 500);
  }

  const { text, voiceId, voiceSettings } = req.body;

  if (!text || text.length < 1) {
    throw new AppError('Text is required', 400);
  }

  if (text.length > 5000) {
    throw new AppError('Text exceeds maximum length of 5000 characters', 400);
  }

  // Validate and sanitize voice settings
  const settings = voiceSettings
    ? elevenLabsService.validateVoiceSettings(voiceSettings)
    : elevenLabsService.getDefaultVoiceSettings();

  // Generate unique filename
  const filename = `tts_custom_${uuidv4()}.mp3`;

  // Generate speech
  const { filePath, audioBuffer } = await elevenLabsService.generateAndSave(
    {
      voiceId,
      text,
      voiceSettings: settings,
    },
    filename
  );

  // Get file stats
  const characterCount = elevenLabsService.getCharacterCount(text);
  const estimatedDuration = elevenLabsService.estimateAudioDuration(text);

  const audioUrl = `/uploads/audio/${filename}`;

  // Track usage
  await prisma.usageRecord.create({
    data: {
      userId: req.user.id,
      resourceType: 'TTS_CHARACTERS',
      quantity: characterCount,
      metadata: {
        voiceId,
        duration: estimatedDuration,
        custom: true,
      },
    },
  });

  logger.info(`TTS generated successfully for custom text`);

  res.status(201).json({
    success: true,
    data: {
      audioUrl,
      characterCount,
      estimatedDuration,
      voiceId,
    },
  });
});

/**
 * Get subscription info (quota remaining, etc.)
 */
export const getSubscriptionInfo = asyncHandler(async (req: Request, res: Response) => {
  if (!elevenLabsService.isConfigured()) {
    throw new AppError('ElevenLabs API key not configured', 500);
  }

  const info = await elevenLabsService.getSubscriptionInfo();

  res.json({
    success: true,
    data: info,
  });
});

/**
 * Preview a voice (generate sample text)
 */
export const previewVoice = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  if (!elevenLabsService.isConfigured()) {
    throw new AppError('ElevenLabs API key not configured', 500);
  }

  const { voiceId } = req.params;
  const { text } = req.body;

  const previewText =
    text || 'Hello! This is a preview of this voice. How does it sound to you?';

  if (previewText.length > 500) {
    throw new AppError('Preview text too long (max 500 characters)', 400);
  }

  // Generate speech
  const audioBuffer = await elevenLabsService.generateSpeech({
    voiceId,
    text: previewText,
  });

  // Send audio directly
  res.set({
    'Content-Type': 'audio/mpeg',
    'Content-Length': audioBuffer.length,
    'Content-Disposition': `inline; filename="preview_${voiceId}.mp3"`,
  });

  res.send(audioBuffer);
});
