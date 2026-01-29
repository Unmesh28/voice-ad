import { Request, Response } from 'express';
import prisma from '../config/database';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import ffmpegService from '../services/audio/ffmpeg.service';
import { audioMixingQueue } from '../config/redis';
import { logger } from '../config/logger';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';

/**
 * Create a new production
 */
export const createProduction = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { projectId, scriptId, voiceId, musicId, settings } = req.body;

  // Verify project exists and belongs to user
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      userId: req.user.id,
    },
  });

  if (!project) {
    throw new AppError('Project not found or access denied', 404);
  }

  // Create production
  const production = await prisma.production.create({
    data: {
      projectId,
      scriptId: scriptId || null,
      voiceId: voiceId || null,
      musicId: musicId || null,
      status: 'PENDING',
      settings: settings || {},
      progress: 0,
    },
  });

  logger.info(`Production created: ${production.id}`);

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
  const production = await prisma.production.findFirst({
    where: {
      id,
      project: {
        userId: req.user.id,
      },
    },
    include: {
      script: true,
      music: true,
    },
  });

  if (!production) {
    throw new AppError('Production not found or access denied', 404);
  }

  // Add job to queue
  const job = await audioMixingQueue.add('mix-audio', {
    userId: req.user.id,
    productionId: production.id,
  });

  logger.info(`Audio mixing job queued: ${job.id}`);

  res.status(202).json({
    success: true,
    message: 'Audio mixing started',
    data: {
      jobId: job.id,
      productionId: production.id,
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
  const production = await prisma.production.findFirst({
    where: {
      id,
      project: {
        userId: req.user.id,
      },
    },
    include: {
      script: true,
      music: true,
    },
  });

  if (!production) {
    throw new AppError('Production not found or access denied', 404);
  }

  // Update status
  await prisma.production.update({
    where: { id: production.id },
    data: { status: 'MIXING', progress: 10 },
  });

  try {
    // Get voice audio URL from script metadata
    const scriptMetadata = production.script?.metadata as any;
    const voiceAudioUrl = scriptMetadata?.lastTTS?.audioUrl;

    if (!voiceAudioUrl) {
      throw new AppError('No voice audio found for this script. Please generate TTS first.', 400);
    }

    // Get music audio URL
    const musicAudioUrl = production.music?.fileUrl;

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
    const filename = `production_${production.id}_${uuidv4()}.${outputFormat}`;
    const outputPath = path.join(uploadDir, 'productions', filename);

    // Ensure productions directory exists
    const fs = require('fs');
    const productionsDir = path.join(uploadDir, 'productions');
    if (!fs.existsSync(productionsDir)) {
      fs.mkdirSync(productionsDir, { recursive: true });
    }

    // Update progress
    await prisma.production.update({
      where: { id: production.id },
      data: { progress: 30 },
    });

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
    const updatedProduction = await prisma.production.update({
      where: { id: production.id },
      data: {
        status: 'COMPLETED',
        progress: 100,
        outputUrl: productionUrl,
        duration: Math.round(duration),
      },
    });

    // Track usage
    await prisma.usageRecord.create({
      data: {
        userId: req.user.id,
        resourceType: 'AUDIO_MIXING',
        quantity: 1,
        metadata: {
          productionId: production.id,
          duration: Math.round(duration),
        },
      },
    });

    logger.info(`Production mixed successfully: ${production.id}`);

    res.json({
      success: true,
      data: updatedProduction,
    });
  } catch (error: any) {
    // Update production status to failed
    await prisma.production.update({
      where: { id: production.id },
      data: {
        status: 'FAILED',
        errorMessage: error.message,
      },
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

  const where: any = {
    project: {
      userId: req.user.id,
    },
  };

  if (projectId) {
    where.projectId = projectId;
  }

  if (status) {
    where.status = status;
  }

  const productions = await prisma.production.findMany({
    where,
    include: {
      project: {
        select: {
          id: true,
          name: true,
        },
      },
      script: {
        select: {
          id: true,
          title: true,
        },
      },
      music: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  res.json({
    success: true,
    data: productions,
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

  const production = await prisma.production.findFirst({
    where: {
      id,
      project: {
        userId: req.user.id,
      },
    },
    include: {
      project: {
        select: {
          id: true,
          name: true,
        },
      },
      script: {
        select: {
          id: true,
          title: true,
          content: true,
        },
      },
      music: {
        select: {
          id: true,
          name: true,
          fileUrl: true,
          duration: true,
        },
      },
    },
  });

  if (!production) {
    throw new AppError('Production not found or access denied', 404);
  }

  res.json({
    success: true,
    data: production,
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
  const existingProduction = await prisma.production.findFirst({
    where: {
      id,
      project: {
        userId: req.user.id,
      },
    },
  });

  if (!existingProduction) {
    throw new AppError('Production not found or access denied', 404);
  }

  const production = await prisma.production.update({
    where: { id },
    data: {
      scriptId: scriptId !== undefined ? scriptId : undefined,
      voiceId: voiceId !== undefined ? voiceId : undefined,
      musicId: musicId !== undefined ? musicId : undefined,
      settings: settings !== undefined ? settings : undefined,
      status: 'PENDING', // Reset status when settings change
      progress: 0,
    },
  });

  logger.info(`Production updated: ${production.id}`);

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
  const production = await prisma.production.findFirst({
    where: {
      id,
      project: {
        userId: req.user.id,
      },
    },
  });

  if (!production) {
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
  await prisma.production.delete({
    where: { id },
  });

  logger.info(`Production deleted: ${id}`);

  res.json({
    success: true,
    message: 'Production deleted successfully',
  });
});
