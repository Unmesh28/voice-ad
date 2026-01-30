import { Request, Response } from 'express';
import { User } from '../models/User';
import { UsageRecord, ResourceType } from '../models/UsageRecord';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { hashPassword } from '../utils/password';

export const getProfile = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const { password: _, ...userWithoutPassword } = req.user.toObject();

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

  const updatedUser = await User.findByIdAndUpdate(
    req.user._id,
    {
      firstName,
      lastName,
    },
    { new: true }
  );

  if (!updatedUser) {
    throw new AppError('User not found', 404);
  }

  const { password: _, ...userWithoutPassword } = updatedUser.toObject();

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
  const isValid = await comparePassword(currentPassword, req.user.password);

  if (!isValid) {
    throw new AppError('Current password is incorrect', 400);
  }

  // Hash new password
  const password = await hashPassword(newPassword);

  // Update password
  await User.findByIdAndUpdate(req.user._id, { password });

  res.json({
    success: true,
    message: 'Password changed successfully',
  });
});

export const getUsageStats = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('User not authenticated', 401);
  }

  const stats = await UsageRecord.aggregate([
    {
      $match: {
        userId: req.user._id,
      },
    },
    {
      $group: {
        _id: '$resourceType',
        totalQuantity: { $sum: '$quantity' },
        totalCost: { $sum: '$cost' },
      },
    },
  ]);

  const formattedStats = {
    ttsCharacters: 0,
    musicGenerations: 0,
    scriptGenerations: 0,
    audioMixings: 0,
    totalCost: 0,
  };

  stats.forEach((stat) => {
    switch (stat._id) {
      case ResourceType.TTS_CHARACTERS:
        formattedStats.ttsCharacters = stat.totalQuantity || 0;
        break;
      case ResourceType.MUSIC_GENERATION:
        formattedStats.musicGenerations = stat.totalQuantity || 0;
        break;
      case ResourceType.SCRIPT_GENERATION:
        formattedStats.scriptGenerations = stat.totalQuantity || 0;
        break;
      case ResourceType.AUDIO_MIXING:
        formattedStats.audioMixings = stat.totalQuantity || 0;
        break;
    }
    formattedStats.totalCost += stat.totalCost || 0;
  });

  res.json({
    success: true,
    data: formattedStats,
  });
});
