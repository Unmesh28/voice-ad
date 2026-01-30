import { Request, Response } from 'express';
import { Project } from '../models/Project';
import { Production } from '../models/Production';
import { Script } from '../models/Script';
import { MusicTrack } from '../models/MusicTrack';
import { UsageRecord } from '../models/UsageRecord';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import ffmpegService from '../services/audio/ffmpeg.service';
import { audioMixingQueue } from '../config/redis';
import { logger } from '../config/logger';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import productionOrchestrator from '../services/production.orchestrator';

/**
 * Create a new production
 */
export const createProduction = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { projectId, scriptId, voiceId, musicId, settings } = req.body;

  // Verify project exists and belongs to user
  const project = await Project.findOne({
    _id: projectId,
    userId: req.user._id,
  });

  if (!project) {
    throw new AppError('Project not found or access denied', 404);
  }

  // Create production
  const production = await Production.create({
    projectId,
    scriptId: scriptId || undefined,
    voiceId: voiceId || undefined,
    musicId: musicId || undefined,
    status: 'PENDING',
    settings: settings || {},
    progress: 0,
  });

  logger.info(`Production created: ${production._id}`);

  res.status(201).json({
    success: true,
    data: production,
  });
});

/**
 * Mix production audio (async with queue)
 */
export const mixProduction = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;

  // Verify production exists and belongs to user
  const production = await Production.findById(id)
    .populate('projectId', 'userId')
    .populate('scriptId')
    .populate('musicId')
    .lean();

  if (!production) {
    throw new AppError('Production not found or access denied', 404);
  }

  const project = production.projectId as any;
  if (!project || project.userId?.toString() !== req.user._id.toString()) {
    throw new AppError('Production not found or access denied', 404);
  }

  // Add job to queue
  const job = await audioMixingQueue.add('mix-audio', {
    userId: req.user._id.toString(),
    productionId: production._id.toString(),
  });

  logger.info(`Audio mixing job queued: ${job.id}`);

  res.status(202).json({
    success: true,
    message: 'Audio mixing started',
    data: {
      jobId: job.id,
      productionId: production._id,
    },
  });
});

/**
 * Mix production audio synchronously
 */
export const mixProductionSync = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;

  // Verify production exists and belongs to user
  const production = await Production.findById(id)
    .populate('projectId', 'userId')
    .populate('scriptId')
    .populate('musicId')
    .lean();

  if (!production) {
    throw new AppError('Production not found or access denied', 404);
  }

  const project = production.projectId as any;
  if (!project || project.userId?.toString() !== req.user._id.toString()) {
    throw new AppError('Production not found or access denied', 404);
  }

  // Update status
  await Production.findByIdAndUpdate(id, {
    status: 'MIXING',
    progress: 10,
  });

  try {
    // Get voice audio URL from script metadata
    const script = production.scriptId as any;
    const scriptMetadata = script?.metadata as any;
    const voiceAudioUrl = scriptMetadata?.lastTTS?.audioUrl;

    if (!voiceAudioUrl) {
      throw new AppError('No voice audio found for this script. Please generate TTS first.', 400);
    }

    // Get music audio URL
    const music = production.musicId as any;
    const musicAudioUrl = music?.fileUrl;

    // Prepare file paths
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const voicePath = voiceAudioUrl ? path.join(uploadDir, voiceAudioUrl.replace('/uploads/', '')) : undefined;
    const musicPath = musicAudioUrl ? path.join(uploadDir, musicAudioUrl.replace('/uploads/', '')) : undefined;

    // Get settings
    const settings = (production.settings as any) || {};
    const voiceVolume = settings.voiceVolume !== undefined ? settings.voiceVolume : 1.0;
    const musicVolume = settings.musicVolume !== undefined ? settings.musicVolume : 0.3;
    const fadeIn = settings.fadeIn || 0;
    const fadeOut = settings.fadeOut || 0;
    const audioDucking = settings.audioDucking !== false;
    const outputFormat = settings.outputFormat || 'mp3';

    // Generate output filename
    const filename = `production_${production._id}_${uuidv4()}.${outputFormat}`;
    const outputPath = path.join(uploadDir, 'productions', filename);

    // Ensure productions directory exists
    const fs = require('fs');
    const productionsDir = path.join(uploadDir, 'productions');
    if (!fs.existsSync(productionsDir)) {
      fs.mkdirSync(productionsDir, { recursive: true });
    }

    // Update progress
    await Production.findByIdAndUpdate(id, { progress: 30 });

    // Mix audio
    await ffmpegService.mixAudio({
      voiceInput: voicePath ? {
        filePath: voicePath,
        volume: voiceVolume,
        fadeIn,
        fadeOut,
      } : undefined,
      musicInput: musicPath ? {
        filePath: musicPath,
        volume: musicVolume,
        fadeIn,
        fadeOut,
      } : undefined,
      outputPath,
      outputFormat: outputFormat as any,
      audioDucking,
      normalize: true,
    });

    // Get duration
    const duration = await ffmpegService.getAudioDuration(outputPath);

    const productionUrl = `/uploads/productions/${filename}`;

    // Update production
    const updatedProduction = await Production.findByIdAndUpdate(
      id,
      {
        status: 'COMPLETED',
        progress: 100,
        outputUrl: productionUrl,
        duration: Math.round(duration),
      },
      { new: true }
    );

    // Track usage
    await UsageRecord.create({
      userId: req.user._id,
      resourceType: 'AUDIO_MIXING',
      quantity: 1,
      metadata: {
        productionId: production._id.toString(),
        duration: Math.round(duration),
      },
    });

    logger.info(`Production mixed successfully: ${production._id}`);

    res.json({
      success: true,
      data: updatedProduction,
    });
  } catch (error: any) {
    // Update production status to failed
    await Production.findByIdAndUpdate(id, {
      status: 'FAILED',
      errorMessage: error.message,
    });

    throw error;
  }
});

/**
 * Get all productions
 */
export const getProductions = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { projectId, status } = req.query;

  // First get user's projects
  const userProjects = await Project.find(
    { userId: req.user._id },
    { _id: 1 }
  ).lean();

  const where: any = {
    projectId: {
      $in: userProjects.map((p) => p._id),
    },
  };

  if (projectId) {
    where.projectId = projectId;
  }

  if (status) {
    where.status = status;
  }

  const productions = await Production.find(where)
    .populate('projectId', '_id name')
    .populate('scriptId', '_id title')
    .populate('musicId', '_id name')
    .sort({ createdAt: -1 })
    .lean();

  // Transform the populated fields to match expected format
  const productionsWithPopulated = productions.map((production: any) => ({
    ...production,
    project: production.projectId,
    script: production.scriptId,
    music: production.musicId,
  }));

  res.json({
    success: true,
    data: productionsWithPopulated,
  });
});

/**
 * Get a single production
 */
export const getProduction = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;

  const production = await Production.findById(id)
    .populate('projectId', '_id name userId')
    .populate('scriptId', '_id title content')
    .populate('musicId', '_id name fileUrl duration')
    .lean();

  if (!production) {
    throw new AppError('Production not found or access denied', 404);
  }

  // Check if the project belongs to the user
  const project = production.projectId as any;
  if (!project || project.userId?.toString() !== req.user._id.toString()) {
    throw new AppError('Production not found or access denied', 404);
  }

  // Transform the populated fields to match expected format
  const productionWithPopulated = {
    ...production,
    project: { _id: project._id, name: project.name },
    script: production.scriptId,
    music: production.musicId,
  };

  res.json({
    success: true,
    data: productionWithPopulated,
  });
});

/**
 * Update production settings
 */
export const updateProduction = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;
  const { scriptId, voiceId, musicId, settings } = req.body;

  // Verify production exists and belongs to user
  const existingProduction = await Production.findById(id)
    .populate('projectId', 'userId')
    .lean();

  if (!existingProduction) {
    throw new AppError('Production not found or access denied', 404);
  }

  const project = existingProduction.projectId as any;
  if (!project || project.userId?.toString() !== req.user._id.toString()) {
    throw new AppError('Production not found or access denied', 404);
  }

  const updateData: any = {
    status: 'PENDING', // Reset status when settings change
    progress: 0,
  };
  if (scriptId !== undefined) updateData.scriptId = scriptId;
  if (voiceId !== undefined) updateData.voiceId = voiceId;
  if (musicId !== undefined) updateData.musicId = musicId;
  if (settings !== undefined) updateData.settings = settings;

  const production = await Production.findByIdAndUpdate(
    id,
    updateData,
    { new: true }
  );

  logger.info(`Production updated: ${production?._id}`);

  res.json({
    success: true,
    data: production,
  });
});

/**
 * Delete a production
 */
export const deleteProduction = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;

  // Verify production exists and belongs to user
  const production = await Production.findById(id)
    .populate('projectId', 'userId')
    .lean();

  if (!production) {
    throw new AppError('Production not found or access denied', 404);
  }

  const project = production.projectId as any;
  if (!project || project.userId?.toString() !== req.user._id.toString()) {
    throw new AppError('Production not found or access denied', 404);
  }

  // Delete output file if exists
  if (production.outputUrl) {
    const fs = require('fs');
    const path = require('path');
    const uploadDir = process.env.UPLOAD_DIR || './uploads';
    const filePath = path.join(uploadDir, production.outputUrl.replace('/uploads/', ''));

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  // Delete production
  await Production.findByIdAndDelete(id);

  logger.info(`Production deleted: ${id}`);

  res.json({
    success: true,
    message: 'Production deleted successfully',
  });
});

/**
 * Create a quick production from a single prompt (One-click production)
 * @route POST /api/productions/quick
 */
export const createQuickProduction = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { prompt, voiceId, duration, tone } = req.body;

  if (!prompt) {
    throw new AppError('Prompt is required', 400);
  }

  logger.info(`Creating quick production for user ${req.user._id}`);

  const productionId = await productionOrchestrator.createQuickProduction({
    userId: req.user._id.toString(),
    prompt,
    voiceId,
    duration,
    tone,
  });

  res.status(202).json({
    success: true,
    data: {
      productionId,
      message: 'Production pipeline started. Check progress using the progress endpoint.',
    },
  });
});

/**
 * Get production progress for quick production
 * @route GET /api/productions/:id/progress
 */
export const getProductionProgress = asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  const progress = await productionOrchestrator.getProductionProgress(id);

  res.json({
    success: true,
    data: progress,
  });
});
