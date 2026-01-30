import { Request, Response } from 'express';
import { Project } from '../models/Project';
import { Script } from '../models/Script';
import { Production } from '../models/Production';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { logger } from '../config/logger';

/**
 * Create a new project
 */
export const createProject = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { name, description } = req.body;

  const project = await Project.create({
    userId: req.user._id,
    name,
    description,
  });

  logger.info(`Project created: ${project._id} by user ${req.user.email}`);

  res.status(201).json({
    success: true,
    data: project,
  });
});

/**
 * Get all projects for the authenticated user
 */
export const getProjects = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { status } = req.query;

  const where: any = {
    userId: req.user._id,
  };

  if (status) {
    where.status = status;
  }

  const projects = await Project.find(where).sort({ updatedAt: -1 }).lean();

  // Add counts for scripts and productions
  const projectsWithCounts = await Promise.all(
    projects.map(async (project) => {
      const [scriptsCount, productionsCount] = await Promise.all([
        Script.countDocuments({ projectId: project._id }),
        Production.countDocuments({ projectId: project._id }),
      ]);
      return {
        ...project,
        _count: {
          scripts: scriptsCount,
          productions: productionsCount,
        },
      };
    })
  );

  res.json({
    success: true,
    data: projectsWithCounts,
  });
});

/**
 * Get a single project by ID
 */
export const getProject = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;

  const project = await Project.findOne({
    _id: id,
    userId: req.user._id,
  }).lean();

  if (!project) {
    throw new AppError('Project not found or access denied', 404);
  }

  // Get recent scripts and productions
  const [scripts, productions, scriptsCount, productionsCount] = await Promise.all([
    Script.find({ projectId: project._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
    Production.find({ projectId: project._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
    Script.countDocuments({ projectId: project._id }),
    Production.countDocuments({ projectId: project._id }),
  ]);

  res.json({
    success: true,
    data: {
      ...project,
      scripts,
      productions,
      _count: {
        scripts: scriptsCount,
        productions: productionsCount,
      },
    },
  });
});

/**
 * Update a project
 */
export const updateProject = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;
  const { name, description, status } = req.body;

  // Verify project exists and belongs to user
  const existingProject = await Project.findOne({
    _id: id,
    userId: req.user._id,
  });

  if (!existingProject) {
    throw new AppError('Project not found or access denied', 404);
  }

  const updateData: any = {};
  if (name !== undefined) updateData.name = name;
  if (description !== undefined) updateData.description = description;
  if (status !== undefined) updateData.status = status;

  const project = await Project.findByIdAndUpdate(
    id,
    updateData,
    { new: true }
  );

  logger.info(`Project updated: ${project?._id}`);

  res.json({
    success: true,
    data: project,
  });
});

/**
 * Delete a project
 */
export const deleteProject = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;

  // Verify project exists and belongs to user
  const project = await Project.findOne({
    _id: id,
    userId: req.user._id,
  });

  if (!project) {
    throw new AppError('Project not found or access denied', 404);
  }

  // Delete related scripts and productions first
  await Promise.all([
    Script.deleteMany({ projectId: id }),
    Production.deleteMany({ projectId: id }),
  ]);

  // Delete project
  await Project.findByIdAndDelete(id);

  logger.info(`Project deleted: ${id}`);

  res.json({
    success: true,
    message: 'Project deleted successfully',
  });
});

/**
 * Archive a project
 */
export const archiveProject = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { id } = req.params;

  // Verify project exists and belongs to user
  const existingProject = await Project.findOne({
    _id: id,
    userId: req.user._id,
  });

  if (!existingProject) {
    throw new AppError('Project not found or access denied', 404);
  }

  const project = await Project.findByIdAndUpdate(
    id,
    { status: 'ARCHIVED' },
    { new: true }
  );

  logger.info(`Project archived: ${project?._id}`);

  res.json({
    success: true,
    data: project,
  });
});
