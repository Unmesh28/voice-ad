import jwt, { SignOptions } from 'jsonwebtoken';
import { User } from '@prisma/client';

interface JWTPayload {
  userId: string;
  email: string;
  role: string;
}

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key';
const JWT_EXPIRE = process.env.JWT_EXPIRE || '7d';
const JWT_REFRESH_EXPIRE = process.env.JWT_REFRESH_EXPIRE || '30d';

export const generateToken = (user: User): string => {
  const payload: JWTPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };

  const options: SignOptions = {
    expiresIn: JWT_EXPIRE as string | number,
  };

  return jwt.sign(payload, JWT_SECRET as string, options);
};

export const generateRefreshToken = (user: User): string => {
  const payload: JWTPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };

  const options: SignOptions = {
    expiresIn: JWT_REFRESH_EXPIRE as string | number,
  };

  return jwt.sign(payload, JWT_REFRESH_SECRET as string, options);
};

export const verifyToken = (token: string): JWTPayload => {
  try {
    return jwt.verify(token, JWT_SECRET as string) as JWTPayload;
  } catch (error) {
    throw new Error('Invalid token');
  }
};

export const verifyRefreshToken = (token: string): JWTPayload => {
  try {
    return jwt.verify(token, JWT_REFRESH_SECRET as string) as JWTPayload;
  } catch (error) {
    throw new Error('Invalid refresh token');
  }
};
