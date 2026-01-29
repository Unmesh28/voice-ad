import { Request, Response } from 'express';
import prisma from '../config/database';
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

  const project = await prisma.project.create({
    data: {
      userId: req.user.id,
      name,
      description,
    },
  });

  logger.info(`Project created: ${project.id} by user ${req.user.email}`);

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
    userId: req.user.id,
  };

  if (status) {
    where.status = status;
  }

  const projects = await prisma.project.findMany({
    where,
    include: {
      _count: {
        select: {
          scripts: true,
          productions: true,
        },
      },
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  res.json({
    success: true,
    data: projects,
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

  const project = await prisma.project.findFirst({
    where: {
      id,
      userId: req.user.id,
    },
    include: {
      scripts: {
        orderBy: {
          createdAt: 'desc',
        },
        take: 10,
      },
      productions: {
        orderBy: {
          createdAt: 'desc',
        },
        take: 10,
      },
      _count: {
        select: {
          scripts: true,
          productions: true,
        },
      },
    },
  });

  if (!project) {
    throw new AppError('Project not found or access denied', 404);
  }

  res.json({
    success: true,
    data: project,
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
  const existingProject = await prisma.project.findFirst({
    where: {
      id,
      userId: req.user.id,
    },
  });

  if (!existingProject) {
    throw new AppError('Project not found or access denied', 404);
  }

  const project = await prisma.project.update({
    where: { id },
    data: {
      name,
      description,
      status,
    },
  });

  logger.info(`Project updated: ${project.id}`);

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
  const project = await prisma.project.findFirst({
    where: {
      id,
      userId: req.user.id,
    },
  });

  if (!project) {
    throw new AppError('Project not found or access denied', 404);
  }

  // Delete project (cascade will delete related scripts and productions)
  await prisma.project.delete({
    where: { id },
  });

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
  const existingProject = await prisma.project.findFirst({
    where: {
      id,
      userId: req.user.id,
    },
  });

  if (!existingProject) {
    throw new AppError('Project not found or access denied', 404);
  }

  const project = await prisma.project.update({
    where: { id },
    data: {
      status: 'ARCHIVED',
    },
  });

  logger.info(`Project archived: ${project.id}`);

  res.json({
    success: true,
    data: project,
  });
});
