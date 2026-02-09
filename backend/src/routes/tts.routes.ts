import { Router } from 'express';
import * as ttsController from '../controllers/tts.controller';
import { validate, schemas } from '../middleware/validate';
import { authenticate } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get available voices
router.get('/voices', ttsController.getVoices);
router.get('/voices/:id', ttsController.getVoice);

// Preview voice
router.post('/voices/:voiceId/preview', validate(schemas.previewVoice), ttsController.previewVoice);

// Generate TTS
router.post('/generate', validate(schemas.generateTTS), ttsController.generateTTS);
router.post('/generate-sync', validate(schemas.generateTTS), ttsController.generateTTSSync);
router.post('/generate-text', validate(schemas.generateTTSFromText), ttsController.generateTTSFromText);

// Get subscription info
router.get('/subscription', ttsController.getSubscriptionInfo);

export default router;
