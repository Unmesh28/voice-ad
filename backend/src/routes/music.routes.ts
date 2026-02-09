import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import * as musicController from '../controllers/music.controller';
import { validate, schemas } from '../middleware/validate';
import { authenticate } from '../middleware/auth';

const router = Router();

// Configure multer for music file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(process.env.UPLOAD_DIR || './uploads', 'music'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'upload-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '52428800'), // 50MB default
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only audio files are allowed.'));
    }
  },
});

// All routes require authentication
router.use(authenticate);

// Generate music
router.post('/generate', validate(schemas.generateMusic), musicController.generateMusic);
router.post('/generate-sync', validate(schemas.generateMusic), musicController.generateMusicSync);

// Music library
router.get('/library', musicController.getMusicLibrary);
router.get('/library/:id', musicController.getMusicTrack);
router.delete('/library/:id', musicController.deleteMusicTrack);

// Upload custom music
router.post('/upload', upload.single('file'), validate(schemas.uploadMusicTrack), musicController.uploadMusicTrack);

// Presets and helpers
router.get('/presets/genres', musicController.getGenrePresets);
router.get('/presets/moods', musicController.getMoodPresets);
router.get('/examples', musicController.getExamplePrompts);
router.post('/generate-prompt', validate(schemas.generateMusicPrompt), musicController.generatePrompt);

export default router;
