import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { AppError } from './errorHandler';

export const validate = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errorMessage = error.details
        .map((detail) => detail.message)
        .join(', ');
      throw new AppError(errorMessage, 400);
    }

    // Replace request body with validated value
    req.body = value;
    next();
  };
};

// Common validation schemas
export const schemas = {
  register: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    firstName: Joi.string().optional(),
    lastName: Joi.string().optional(),
  }),

  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
  }),

  createProject: Joi.object({
    name: Joi.string().min(1).max(255).required(),
    description: Joi.string().max(1000).optional(),
  }),

  updateProject: Joi.object({
    name: Joi.string().min(1).max(255).optional(),
    description: Joi.string().max(1000).optional(),
    status: Joi.string().valid('ACTIVE', 'ARCHIVED', 'DELETED').optional(),
  }),

  createScript: Joi.object({
    projectId: Joi.string().uuid().required(),
    title: Joi.string().min(1).max(255).required(),
    content: Joi.string().required(),
    metadata: Joi.object().optional(),
  }),

  generateScript: Joi.object({
    projectId: Joi.string().uuid().required(),
    prompt: Joi.string().min(10).max(2000).required(),
    tone: Joi.string().optional(),
    length: Joi.string().valid('short', 'medium', 'long').optional(),
    targetAudience: Joi.string().optional(),
  }),
};
