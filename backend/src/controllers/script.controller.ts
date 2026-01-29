import { Request, Response } from 'express';
import prisma from '../config/database';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import openAIService from '../services/llm/openai.service';
import { scriptGenerationQueue } from '../config/redis';
import { logger } from '../config/logger';

/**
 * Generate a new script using AI
 */
export const generateScript = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { projectId, prompt, tone, length, targetAudience, productName, additionalContext } =
    req.body;

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

  // Add job to queue for async processing
  const job = await scriptGenerationQueue.add('generate-script', {
    userId: req.user.id,
    projectId,
    prompt,
    tone,
    length,
    targetAudience,
    productName,
    additionalContext,
  });

  logger.info(`Script generation job queued: ${job.id}`);

  res.status(202).json({
    success: true,
    message: 'Script generation started',
    data: {
      jobId: job.id,
    },
  });
});

/**
 * Generate script synchronously (for immediate results)
 */
export const generateScriptSync = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { projectId, prompt, tone, length, targetAudience, productName, additionalContext, title } =
    req.body;

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

  // Generate script using OpenAI
  const generatedContent = await openAIService.generateScript({
    prompt,
    tone,
    length,
    targetAudience,
    productName,
    additionalContext,
  });

  // Save script to database
  const script = await prisma.script.create({
    data: {
      projectId,
      title: title || `Generated Script - ${new Date().toLocaleString()}`,
      content: generatedContent,
      metadata: {
        prompt,
        tone,
        length,
        targetAudience,
        productName,
        generatedAt: new Date().toISOString(),
      },
    },
  });

  // Track usage
  await prisma.usageRecord.create({
    data: {
      userId: req.user.id,
      resourceType: 'SCRIPT_GENERATION',
      quantity: 1,
      metadata: {
        scriptId: script.id,
        promptLength: prompt.length,
      },
    },
  });

  logger.info(`Script generated successfully: ${script.id}`);

  res.status(201).json({
    success: true,
    data: script,
  });
});

/**
 * Create a new script manually
 */
export const createScript = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { projectId, title, content, metadata } = req.body;

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

  const script = await prisma.script.create({
    data: {
      projectId,
      title,
      content,
      metadata,
    },
  });

  logger.info(`Script created: ${script.id}`);

  res.status(201).json({
    success: true,
    data: script,
  });
});

/**
 * Get all scripts for a project
 */
export const getScripts = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { projectId } = req.query;

  const where: any = {};

  if (projectId) {
    // Verify project access
    const project = await prisma.project.findFirst({
      where: {
        id: projectId as string,
        userId: req.user.id,
      },
    });

    if (!project) {
      throw new AppError('Project not found or access denied', 404);
    }

    where.projectId = projectId;
  } else {
    // Get all scripts from user's projects
    const userProjects = await prisma.project.findMany({
      where: { userId: req.user.id },
      select: { id: true },
    });

    where.projectId = {
      in: userProjects.map((p) => p.id),
    };
  }

  const scripts = await prisma.script.findMany({
    where,
    include: {
      project: {
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
    data: scripts,
  });
});

/**
 * Get a single script by ID
 */
export const getScript = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;

  const script = await prisma.script.findFirst({
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
    },
  });

  if (!script) {
    throw new AppError('Script not found or access denied', 404);
  }

  res.json({
    success: true,
    data: script,
  });
});

/**
 * Update a script
 */
export const updateScript = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;
  const { title, content, metadata } = req.body;

  // Verify script exists and belongs to user
  const existingScript = await prisma.script.findFirst({
    where: {
      id,
      project: {
        userId: req.user.id,
      },
    },
  });

  if (!existingScript) {
    throw new AppError('Script not found or access denied', 404);
  }

  // Update script and increment version
  const script = await prisma.script.update({
    where: { id },
    data: {
      title,
      content,
      metadata,
      version: {
        increment: 1,
      },
    },
  });

  logger.info(`Script updated: ${script.id}, version: ${script.version}`);

  res.json({
    success: true,
    data: script,
  });
});

/**
 * Delete a script
 */
export const deleteScript = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;

  // Verify script exists and belongs to user
  const script = await prisma.script.findFirst({
    where: {
      id,
      project: {
        userId: req.user.id,
      },
    },
  });

  if (!script) {
    throw new AppError('Script not found or access denied', 404);
  }

  await prisma.script.delete({
    where: { id },
  });

  logger.info(`Script deleted: ${id}`);

  res.json({
    success: true,
    message: 'Script deleted successfully',
  });
});

/**
 * Refine/improve an existing script
 */
export const refineScript = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;
  const { improvementRequest } = req.body;

  // Verify script exists and belongs to user
  const script = await prisma.script.findFirst({
    where: {
      id,
      project: {
        userId: req.user.id,
      },
    },
  });

  if (!script) {
    throw new AppError('Script not found or access denied', 404);
  }

  // Refine script using AI
  const refinedContent = await openAIService.refineScript(script.content, improvementRequest);

  // Update script
  const updatedScript = await prisma.script.update({
    where: { id },
    data: {
      content: refinedContent,
      version: {
        increment: 1,
      },
      metadata: {
        ...(script.metadata as object),
        lastRefinement: {
          request: improvementRequest,
          refinedAt: new Date().toISOString(),
        },
      },
    },
  });

  // Track usage
  await prisma.usageRecord.create({
    data: {
      userId: req.user.id,
      resourceType: 'SCRIPT_GENERATION',
      quantity: 1,
      metadata: {
        scriptId: script.id,
        action: 'refinement',
      },
    },
  });

  logger.info(`Script refined: ${script.id}`);

  res.json({
    success: true,
    data: updatedScript,
  });
});

/**
 * Generate multiple variations of a script
 */
export const generateVariations = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { projectId, prompt, tone, length, targetAudience, productName, count } = req.body;

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

  // Generate variations
  const variations = await openAIService.generateVariations(
    {
      prompt,
      tone,
      length,
      targetAudience,
      productName,
    },
    count || 3
  );

  // Save all variations as separate scripts
  const savedScripts = await Promise.all(
    variations.map((content, index) =>
      prisma.script.create({
        data: {
          projectId,
          title: `Variation ${index + 1} - ${new Date().toLocaleString()}`,
          content,
          metadata: {
            prompt,
            tone,
            length,
            targetAudience,
            isVariation: true,
            variationNumber: index + 1,
            generatedAt: new Date().toISOString(),
          },
        },
      })
    )
  );

  // Track usage
  await prisma.usageRecord.create({
    data: {
      userId: req.user.id,
      resourceType: 'SCRIPT_GENERATION',
      quantity: variations.length,
      metadata: {
        action: 'variations',
        count: variations.length,
      },
    },
  });

  logger.info(`Generated ${variations.length} script variations`);

  res.status(201).json({
    success: true,
    data: savedScripts,
  });
});
