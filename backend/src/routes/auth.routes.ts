import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { validate, schemas } from '../middleware/validate';
import { authenticate } from '../middleware/auth';

const router = Router();

// Public routes
router.post('/register', validate(schemas.register), authController.register);
router.post('/login', validate(schemas.login), authController.login);
router.post('/refresh', authController.refreshToken);

// Protected routes
router.post('/logout', authenticate, authController.logout);

export default router;
