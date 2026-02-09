import { Router } from 'express';
import * as projectController from '../controllers/project.controller';
import { validate, schemas } from '../middleware/validate';
import { authenticate } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

// CRUD operations
router.post('/', validate(schemas.createProject), projectController.createProject);
router.get('/', projectController.getProjects);
router.get('/:id', projectController.getProject);
router.put('/:id', validate(schemas.updateProject), projectController.updateProject);
router.delete('/:id', projectController.deleteProject);

// Archive project
router.post('/:id/archive', projectController.archiveProject);

export default router;
