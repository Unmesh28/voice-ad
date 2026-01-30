import { Request, Response } from 'express';
import { Project } from '../models/Project';
import { Script } from '../models/Script';
import { UsageRecord } from '../models/UsageRecord';
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
  const project = await Project.findOne({
    _id: projectId,
    userId: req.user._id,
  });

  if (!project) {
    throw new AppError('Project not found or access denied', 404);
  }

  // Add job to queue for async processing
  const job = await scriptGenerationQueue.add('generate-script', {
    userId: req.user._id.toString(),
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
  const project = await Project.findOne({
    _id: projectId,
    userId: req.user._id,
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
  const script = await Script.create({
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
  });

  // Track usage
  await UsageRecord.create({
    userId: req.user._id,
    resourceType: 'SCRIPT_GENERATION',
    quantity: 1,
    metadata: {
      scriptId: script._id.toString(),
      promptLength: prompt.length,
    },
  });

  logger.info(`Script generated successfully: ${script._id}`);

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
  const project = await Project.findOne({
    _id: projectId,
    userId: req.user._id,
  });

  if (!project) {
    throw new AppError('Project not found or access denied', 404);
  }

  const script = await Script.create({
    projectId,
    title,
    content,
    metadata,
  });

  logger.info(`Script created: ${script._id}`);

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
    const project = await Project.findOne({
      _id: projectId as string,
      userId: req.user._id,
    });

    if (!project) {
      throw new AppError('Project not found or access denied', 404);
    }

    where.projectId = projectId;
  } else {
    // Get all scripts from user's projects
    const userProjects = await Project.find(
      { userId: req.user._id },
      { _id: 1 }
    ).lean();

    where.projectId = {
      $in: userProjects.map((p) => p._id),
    };
  }

  const scripts = await Script.find(where)
    .populate('projectId', '_id name')
    .sort({ createdAt: -1 })
    .lean();

  // Transform the populated field to match expected format
  const scriptsWithProject = scripts.map((script: any) => ({
    ...script,
    project: script.projectId,
    projectId: script.projectId?._id,
  }));

  res.json({
    success: true,
    data: scriptsWithProject,
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

  const script = await Script.findById(id)
    .populate('projectId', '_id name userId')
    .lean();

  if (!script) {
    throw new AppError('Script not found or access denied', 404);
  }

  // Check if the project belongs to the user
  const project = script.projectId as any;
  if (!project || project.userId?.toString() !== req.user._id.toString()) {
    throw new AppError('Script not found or access denied', 404);
  }

  // Transform the populated field to match expected format
  const scriptWithProject = {
    ...script,
    project: { _id: project._id, name: project.name },
    projectId: project._id,
  };

  res.json({
    success: true,
    data: scriptWithProject,
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
  const existingScript = await Script.findById(id)
    .populate('projectId', 'userId')
    .lean();

  if (!existingScript) {
    throw new AppError('Script not found or access denied', 404);
  }

  const project = existingScript.projectId as any;
  if (!project || project.userId?.toString() !== req.user._id.toString()) {
    throw new AppError('Script not found or access denied', 404);
  }

  // Update script and increment version
  const updateData: any = {};
  if (title !== undefined) updateData.title = title;
  if (content !== undefined) updateData.content = content;
  if (metadata !== undefined) updateData.metadata = metadata;
  updateData.$inc = { version: 1 };

  const script = await Script.findByIdAndUpdate(
    id,
    updateData,
    { new: true }
  );

  logger.info(`Script updated: ${script?._id}, version: ${script?.version}`);

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
  const script = await Script.findById(id)
    .populate('projectId', 'userId')
    .lean();

  if (!script) {
    throw new AppError('Script not found or access denied', 404);
  }

  const project = script.projectId as any;
  if (!project || project.userId?.toString() !== req.user._id.toString()) {
    throw new AppError('Script not found or access denied', 404);
  }

  await Script.findByIdAndDelete(id);

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
  const script = await Script.findById(id)
    .populate('projectId', 'userId')
    .lean();

  if (!script) {
    throw new AppError('Script not found or access denied', 404);
  }

  const project = script.projectId as any;
  if (!project || project.userId?.toString() !== req.user._id.toString()) {
    throw new AppError('Script not found or access denied', 404);
  }

  // Refine script using AI
  const refinedContent = await openAIService.refineScript(script.content, improvementRequest);

  // Update script
  const updatedScript = await Script.findByIdAndUpdate(
    id,
    {
      content: refinedContent,
      $inc: { version: 1 },
      metadata: {
        ...(script.metadata as object),
        lastRefinement: {
          request: improvementRequest,
          refinedAt: new Date().toISOString(),
        },
      },
    },
    { new: true }
  );

  // Track usage
  await UsageRecord.create({
    userId: req.user._id,
    resourceType: 'SCRIPT_GENERATION',
    quantity: 1,
    metadata: {
      scriptId: script._id.toString(),
      action: 'refinement',
    },
  });

  logger.info(`Script refined: ${script._id}`);

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
  const project = await Project.findOne({
    _id: projectId,
    userId: req.user._id,
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
      Script.create({
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
      })
    )
  );

  // Track usage
  await UsageRecord.create({
    userId: req.user._id,
    resourceType: 'SCRIPT_GENERATION',
    quantity: variations.length,
    metadata: {
      action: 'variations',
      count: variations.length,
    },
  });

  logger.info(`Generated ${variations.length} script variations`);

  res.status(201).json({
    success: true,
    data: savedScripts,
  });
});
