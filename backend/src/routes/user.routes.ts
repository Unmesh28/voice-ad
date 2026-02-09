import { Router } from 'express';
import * as userController from '../controllers/user.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

router.get('/profile', userController.getProfile);
router.put('/profile', userController.updateProfile);
router.post('/change-password', userController.changePassword);
router.get('/usage', userController.getUsageStats);

export default router;
