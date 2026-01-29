import { Router } from 'express';
import * as scriptController from '../controllers/script.controller';
import { validate, schemas } from '../middleware/validate';
import { authenticate } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Generate script (async with queue)
router.post('/generate', validate(schemas.generateScript), scriptController.generateScript);

// Generate script (synchronous)
router.post(
  '/generate-sync',
  validate(schemas.generateScript),
  scriptController.generateScriptSync
);

// Generate multiple variations
router.post(
  '/generate-variations',
  validate(schemas.generateVariations),
  scriptController.generateVariations
);

// CRUD operations
router.post('/', validate(schemas.createScript), scriptController.createScript);
router.get('/', scriptController.getScripts);
router.get('/:id', scriptController.getScript);
router.put('/:id', validate(schemas.updateScript), scriptController.updateScript);
router.delete('/:id', scriptController.deleteScript);

// Refine script
router.post('/:id/refine', validate(schemas.refineScript), scriptController.refineScript);

export default router;
