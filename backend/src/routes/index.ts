import { Router } from 'express';
import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import projectRoutes from './project.routes';
import scriptRoutes from './script.routes';
import ttsRoutes from './tts.routes';

const router = Router();

// Mount routes
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/projects', projectRoutes);
router.use('/scripts', scriptRoutes);
router.use('/tts', ttsRoutes);

// Health check for API
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'API is running',
    timestamp: new Date().toISOString(),
  });
});

export default router;
