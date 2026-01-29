import { Router } from 'express';
import * as productionController from '../controllers/production.controller';
import { validate, schemas } from '../middleware/validate';
import { authenticate } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Production CRUD
router.post('/', validate(schemas.createProduction), productionController.createProduction);
router.get('/', productionController.getProductions);
router.get('/:id', productionController.getProduction);
router.put('/:id', validate(schemas.updateProduction), productionController.updateProduction);
router.delete('/:id', productionController.deleteProduction);

// Mix production
router.post('/:id/mix', productionController.mixProduction);
router.post('/:id/mix-sync', productionController.mixProductionSync);

export default router;
