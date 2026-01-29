import { Request, Response } from 'express';
import prisma from '../config/database';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import elevenLabsMusicService from '../services/music/elevenlabs-music.service';
import { musicGenerationQueue } from '../config/redis';
import { logger } from '../config/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * Generate music from text description (async with queue)
 */
export const generateMusic = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  if (!elevenLabsMusicService.isConfigured()) {
    throw new AppError('ElevenLabs API key not configured', 500);
  }

  const { text, duration_seconds, prompt_influence, name, genre, mood } = req.body;

  // Add job to queue for async processing
  const job = await musicGenerationQueue.add('generate-music', {
    userId: req.user.id,
    text,
    duration_seconds,
    prompt_influence,
    name,
    genre,
    mood,
  });

  logger.info(`Music generation job queued: ${job.id}`);

  res.status(202).json({
    success: true,
    message: 'Music generation started',
    data: {
      jobId: job.id,
    },
  });
});

/**
 * Generate music synchronously (for immediate results)
 */
export const generateMusicSync = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  if (!elevenLabsMusicService.isConfigured()) {
    throw new AppError('ElevenLabs API key not configured', 500);
  }

  const { text, duration_seconds, prompt_influence, name, genre, mood } = req.body;

  // Validate options
  const options = elevenLabsMusicService.validateOptions({
    text,
    duration_seconds,
    prompt_influence,
  });

  // Generate unique filename
  const filename = `music_${uuidv4()}.mp3`;

  // Generate music
  const { filePath, audioBuffer, duration } = await elevenLabsMusicService.generateAndSave(
    options,
    filename
  );

  const musicUrl = `/uploads/music/${filename}`;

  // Save to database
  const musicTrack = await prisma.musicTrack.create({
    data: {
      name: name || `Generated Music - ${new Date().toLocaleString()}`,
      description: text,
      genre: genre || null,
      mood: mood || null,
      duration,
      fileUrl: musicUrl,
      isGenerated: true,
      metadata: {
        prompt: text,
        duration_seconds,
        prompt_influence,
        generatedAt: new Date().toISOString(),
      },
    },
  });

  // Track usage
  await prisma.usageRecord.create({
    data: {
      userId: req.user.id,
      resourceType: 'MUSIC_GENERATION',
      quantity: 1,
      metadata: {
        musicId: musicTrack.id,
        duration,
        prompt: text,
      },
    },
  });

  logger.info(`Music generated successfully: ${musicTrack.id}`);

  res.status(201).json({
    success: true,
    data: musicTrack,
  });
});

/**
 * Get music library (all music tracks)
 */
export const getMusicLibrary = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { genre, mood, isGenerated } = req.query;

  const where: any = {};

  if (genre) {
    where.genre = genre;
  }

  if (mood) {
    where.mood = mood;
  }

  if (isGenerated !== undefined) {
    where.isGenerated = isGenerated === 'true';
  }

  const musicTracks = await prisma.musicTrack.findMany({
    where,
    orderBy: {
      createdAt: 'desc',
    },
  });

  res.json({
    success: true,
    data: musicTracks,
  });
});

/**
 * Get a single music track by ID
 */
export const getMusicTrack = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;

  const musicTrack = await prisma.musicTrack.findUnique({
    where: { id },
  });

  if (!musicTrack) {
    throw new AppError('Music track not found', 404);
  }

  res.json({
    success: true,
    data: musicTrack,
  });
});

/**
 * Upload custom music track
 */
export const uploadMusicTrack = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  if (!req.file) {
    throw new AppError('No file uploaded', 400);
  }

  const { name, description, genre, mood } = req.body;

  // File is already saved by multer
  const musicUrl = `/uploads/music/${req.file.filename}`;

  // Get audio duration (simplified - you might want to use a library like 'music-metadata')
  const duration = 0; // TODO: Calculate actual duration

  const musicTrack = await prisma.musicTrack.create({
    data: {
      name,
      description,
      genre,
      mood,
      duration,
      fileUrl: musicUrl,
      isGenerated: false,
    },
  });

  logger.info(`Music uploaded: ${musicTrack.id}`);

  res.status(201).json({
    success: true,
    data: musicTrack,
  });
});

/**
 * Delete a music track
 */
export const deleteMusicTrack = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;

  const musicTrack = await prisma.musicTrack.findUnique({
    where: { id },
  });

  if (!musicTrack) {
    throw new AppError('Music track not found', 404);
  }

  // Delete file from filesystem
  const fs = require('fs');
  const path = require('path');
  const uploadDir = process.env.UPLOAD_DIR || './uploads';
  const filePath = path.join(uploadDir, musicTrack.fileUrl.replace('/uploads/', ''));

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  // Delete from database
  await prisma.musicTrack.delete({
    where: { id },
  });

  logger.info(`Music deleted: ${id}`);

  res.json({
    success: true,
    message: 'Music track deleted successfully',
  });
});

/**
 * Get genre presets
 */
export const getGenrePresets = asyncHandler(async (req: Request, res: Response) => {
  const presets = elevenLabsMusicService.getGenrePresets();

  res.json({
    success: true,
    data: presets,
  });
});

/**
 * Get mood presets
 */
export const getMoodPresets = asyncHandler(async (req: Request, res: Response) => {
  const presets = elevenLabsMusicService.getMoodPresets();

  res.json({
    success: true,
    data: presets,
  });
});

/**
 * Get example prompts
 */
export const getExamplePrompts = asyncHandler(async (req: Request, res: Response) => {
  const examples = elevenLabsMusicService.getExamplePrompts();

  res.json({
    success: true,
    data: examples,
  });
});

/**
 * Generate music prompt from genre/mood
 */
export const generatePrompt = asyncHandler(async (req: Request, res: Response) => {
  const { genre, mood, tempo, instruments } = req.body;

  const prompt = elevenLabsMusicService.generateMusicPrompt(genre, mood, tempo, instruments);

  res.json({
    success: true,
    data: { prompt },
  });
});
