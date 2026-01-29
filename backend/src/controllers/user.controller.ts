import { Request, Response } from 'express';
import prisma from '../config/database';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { hashPassword } from '../utils/password';

export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { passwordHash: _, ...userWithoutPassword } = req.user;

  res.json({
    success: true,
    data: userWithoutPassword,
  });
});

export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { firstName, lastName } = req.body;

  const updatedUser = await prisma.user.update({
    where: { id: req.user.id },
    data: {
      firstName,
      lastName,
    },
  });

  const { passwordHash: _, ...userWithoutPassword } = updatedUser;

  res.json({
    success: true,
    data: userWithoutPassword,
  });
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { currentPassword, newPassword } = req.body;

  // Verify current password
  const { comparePassword } = await import('../utils/password');
  const isValid = await comparePassword(currentPassword, req.user.passwordHash);

  if (!isValid) {
    throw new AppError('Current password is incorrect', 400);
  }

  // Hash new password
  const passwordHash = await hashPassword(newPassword);

  // Update password
  await prisma.user.update({
    where: { id: req.user.id },
    data: { passwordHash },
  });

  res.json({
    success: true,
    message: 'Password changed successfully',
  });
});

export const getUsageStats = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const stats = await prisma.usageRecord.groupBy({
    by: ['resourceType'],
    where: {
      userId: req.user.id,
    },
    _sum: {
      quantity: true,
      cost: true,
    },
  });

  const formattedStats = {
    ttsCharacters: 0,
    musicGenerations: 0,
    scriptGenerations: 0,
    audioMixings: 0,
    totalCost: 0,
  };

  stats.forEach((stat) => {
    switch (stat.resourceType) {
      case 'TTS_CHARACTERS':
        formattedStats.ttsCharacters = stat._sum.quantity || 0;
        break;
      case 'MUSIC_GENERATION':
        formattedStats.musicGenerations = stat._sum.quantity || 0;
        break;
      case 'SCRIPT_GENERATION':
        formattedStats.scriptGenerations = stat._sum.quantity || 0;
        break;
      case 'AUDIO_MIXING':
        formattedStats.audioMixings = stat._sum.quantity || 0;
        break;
    }
    formattedStats.totalCost += stat._sum.cost || 0;
  });

  res.json({
    success: true,
    data: formattedStats,
  });
});
