import { Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { User } from '../models/User';
import { hashPassword, comparePassword } from '../utils/password';
import { generateToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { logger } from '../config/logger';

export const register = asyncHandler(async (req: Request, res: Response) => {
  const { email, password, firstName, lastName } = req.body;

  // Check if user already exists
  const existingUser = await User.findOne({ email });

  if (existingUser) {
    throw new AppError('User with this email already exists', 400);
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // Generate unique API key
  const apiKey = `vad_${randomBytes(32).toString('hex')}`;

  // Create user
  const user = await User.create({
    email,
    password: passwordHash,
    firstName,
    lastName,
    apiKey,
  });

  // Create user object for token
  const userForToken = {
    id: user._id.toString(),
    email: user.email,
    role: 'user',
    firstName: user.firstName,
    lastName: user.lastName,
    apiKey: user.apiKey,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    passwordHash: '',
    lastLoginAt: null,
  };

  // Generate tokens
  const token = generateToken(userForToken as any);
  const refreshToken = generateRefreshToken(userForToken as any);

  logger.info(`New user registered: ${user.email}`);

  // Remove password from response
  const userResponse = {
    id: user._id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    apiKey: user.apiKey,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };

  res.status(201).json({
    success: true,
    data: {
      user: userResponse,
      token,
      refreshToken,
    },
  });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  // Find user by email
  const user = await User.findOne({ email });

  if (!user) {
    logger.warn('Invalid email or password');
    throw new AppError('Invalid email or password', 401);
  }

  // Check if user is active
  if (!user.isActive) {
    throw new AppError('Account is inactive', 401);
  }

  // Verify password
  const isPasswordValid = await comparePassword(password, user.password);

  if (!isPasswordValid) {
    logger.warn('Invalid email or password');
    throw new AppError('Invalid email or password', 401);
  }

  // Create user object for token
  const userForToken = {
    id: user._id.toString(),
    email: user.email,
    role: 'user',
    firstName: user.firstName,
    lastName: user.lastName,
    apiKey: user.apiKey,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    passwordHash: '',
    lastLoginAt: null,
  };

  // Generate tokens
  const token = generateToken(userForToken as any);
  const refreshToken = generateRefreshToken(userForToken as any);

  logger.info(`User logged in: ${user.email}`);

  // Remove password from response
  const userResponse = {
    id: user._id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    apiKey: user.apiKey,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };

  res.json({
    success: true,
    data: {
      user: userResponse,
      token,
      refreshToken,
    },
  });
});

export const refreshToken = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    throw new AppError('Refresh token is required', 400);
  }

  // Verify refresh token
  const decoded = verifyRefreshToken(refreshToken);

  // Get user
  const user = await User.findById(decoded.userId);

  if (!user || !user.isActive) {
    throw new AppError('Invalid refresh token', 401);
  }

  // Create user object for token
  const userForToken = {
    id: user._id.toString(),
    email: user.email,
    role: 'user',
    firstName: user.firstName,
    lastName: user.lastName,
    apiKey: user.apiKey,
    isActive: user.isActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    passwordHash: '',
    lastLoginAt: null,
  };

  // Generate new tokens
  const newToken = generateToken(userForToken as any);
  const newRefreshToken = generateRefreshToken(userForToken as any);

  res.json({
    success: true,
    data: {
      token: newToken,
      refreshToken: newRefreshToken,
    },
  });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  // In a more complex implementation, you might want to blacklist the token
  logger.info(`User logged out: ${req.user?.email}`);

  res.json({
    success: true,
    message: 'Logged out successfully',
  });
});
