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
    productName: Joi.string().optional(),
    additionalContext: Joi.string().max(1000).optional(),
    title: Joi.string().max(255).optional(),
  }),

  updateScript: Joi.object({
    title: Joi.string().min(1).max(255).optional(),
    content: Joi.string().optional(),
    metadata: Joi.object().optional(),
  }),

  refineScript: Joi.object({
    improvementRequest: Joi.string().min(10).max(1000).required(),
  }),

  generateVariations: Joi.object({
    projectId: Joi.string().uuid().required(),
    prompt: Joi.string().min(10).max(2000).required(),
    tone: Joi.string().optional(),
    length: Joi.string().valid('short', 'medium', 'long').optional(),
    targetAudience: Joi.string().optional(),
    productName: Joi.string().optional(),
    count: Joi.number().min(1).max(5).optional(),
  }),

  generateTTS: Joi.object({
    scriptId: Joi.string().uuid().required(),
    voiceId: Joi.string().required(),
    voiceSettings: Joi.object({
      stability: Joi.number().min(0).max(1).optional(),
      similarity_boost: Joi.number().min(0).max(1).optional(),
      style: Joi.number().min(0).max(1).optional(),
      use_speaker_boost: Joi.boolean().optional(),
    }).optional(),
  }),

  generateTTSFromText: Joi.object({
    text: Joi.string().min(1).max(5000).required(),
    voiceId: Joi.string().required(),
    voiceSettings: Joi.object({
      stability: Joi.number().min(0).max(1).optional(),
      similarity_boost: Joi.number().min(0).max(1).optional(),
      style: Joi.number().min(0).max(1).optional(),
      use_speaker_boost: Joi.boolean().optional(),
    }).optional(),
  }),

  previewVoice: Joi.object({
    text: Joi.string().min(1).max(500).optional(),
  }),

  generateMusic: Joi.object({
    text: Joi.string().min(10).max(500).required(),
    duration_seconds: Joi.number().min(0.5).max(22).optional(),
    prompt_influence: Joi.number().min(0).max(1).optional(),
    name: Joi.string().max(255).optional(),
    genre: Joi.string().max(100).optional(),
    mood: Joi.string().max(100).optional(),
  }),

  uploadMusicTrack: Joi.object({
    name: Joi.string().min(1).max(255).required(),
    description: Joi.string().max(1000).optional(),
    genre: Joi.string().max(100).optional(),
    mood: Joi.string().max(100).optional(),
  }),

  generateMusicPrompt: Joi.object({
    genre: Joi.string().optional(),
    mood: Joi.string().optional(),
    tempo: Joi.string().optional(),
    instruments: Joi.string().optional(),
  }),
};
