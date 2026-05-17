import { Router } from 'express';
import {
  createProjectHandler,
  getUserProjectsHandler,
  getProjectByIdHandler,
  updateProjectHandler,
  archiveProjectHandler,
  cleanupArchivedProjectsHandler,
  addProjectMemberHandler,
  removeProjectMemberHandler,
  importGitHubRepositoryHandler,
  getProjectContextHandler,
  deleteProjectContextHandler,
  regenerateApiKeyHandler,
  hardDeleteProjectHandler,
  leaveProjectHandler,
} from './controller.js';
import { authenticateToken } from '../../middlewares/authenticateToken.js';
import { authorizeRole } from '../../middlewares/authorizeRole.js';
import { validate } from '../../middlewares/validateRequest.js';
import { createProjectSchema, updateProjectSchema, addProjectMemberSchema, importGitHubSchema } from './validation.js';
import type { ProjectRole } from '@mockia/shared';
import { getProjectSwagger } from '../mock/swagger.controller.js';

/**
 * Projects router
 * All routes in this router require authentication
 *
 * Routes:
 * - POST   /          Create a new project
 * - GET    /          List user's projects
 * - GET    /:id       Get a specific project
 */
export const projectsRouter = Router();

/**
 * @swagger
 * tags:
 *   name: Projects
 *   description: Project management and configuration
 */

/**
 * @swagger
 * /projects:
 *   post:
 *     summary: Create a new project
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Project created
 *       400:
 *         description: Invalid input
 *       401:
 *         description: Unauthorized
 */
projectsRouter.post(
  '/',
  authenticateToken,
  validate({ body: createProjectSchema }),
  createProjectHandler
);

/**
 * @swagger
 * /projects:
 *   get:
 *     summary: List user projects
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of projects
 *       401:
 *         description: Unauthorized
 */
projectsRouter.get(
  '/',
  authenticateToken,
  getUserProjectsHandler
);

/**
 * @swagger
 * /projects/cleanup-archived:
 *   post:
 *     summary: Cleanup archived projects
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cleanup successful
 */
projectsRouter.post(
  '/cleanup-archived',
  authenticateToken,
  cleanupArchivedProjectsHandler
);

/**
 * @swagger
 * /projects/{id}:
 *   get:
 *     summary: Get project by ID
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Project details
 *       404:
 *         description: Project not found
 */
projectsRouter.get(
  '/:id',
  authenticateToken,
  getProjectByIdHandler
);

/**
 * @swagger
 * /projects/{id}/swagger.json:
 *   get:
 *     summary: Get project mock swagger
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Project Swagger JSON
 */
projectsRouter.get(
  '/:id/swagger.json',
  authenticateToken,
  getProjectSwagger
);

/**
 * @swagger
 * /projects/{id}/regenerate-api-key:
 *   post:
 *     summary: Regenerate project API key
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: API Key regenerated
 */
projectsRouter.post(
  '/:id/regenerate-api-key',
  authenticateToken,
  regenerateApiKeyHandler
);

/**
 * @swagger
 * /projects/{id}:
 *   put:
 *     summary: Update project
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Project updated
 */
projectsRouter.put(
  '/:id',
  authenticateToken,
  validate({ body: updateProjectSchema }),
  updateProjectHandler
);

/**
 * @swagger
 * /projects/{id}:
 *   delete:
 *     summary: Archive project
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Project archived
 */
projectsRouter.delete(
  '/:id',
  authenticateToken,
  archiveProjectHandler
);

/**
 * @swagger
 * /projects/{id}/hard:
 *   delete:
 *     summary: Permanently delete project
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Project deleted
 */
projectsRouter.delete(
  '/:id/hard',
  authenticateToken,
  hardDeleteProjectHandler
);

/**
 * @swagger
 * /projects/{id}/members:
 *   post:
 *     summary: Add project member
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - targetEmail
 *               - role
 *             properties:
 *               targetEmail:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [OWNER, EDITOR, VIEWER]
 *     responses:
 *       201:
 *         description: Member added
 */
projectsRouter.post(
  '/:id/members',
  authenticateToken,
  authorizeRole(['OWNER', 'EDITOR'] as unknown as ProjectRole[]),
  validate({ body: addProjectMemberSchema }),
  addProjectMemberHandler
);

/**
 * @swagger
 * /projects/{id}/members/{targetUserId}:
 *   delete:
 *     summary: Remove project member
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: targetUserId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Member removed
 */
projectsRouter.delete(
  '/:id/members/:targetUserId',
  authenticateToken,
  authorizeRole(['OWNER', 'EDITOR'] as unknown as ProjectRole[]),
  removeProjectMemberHandler
);

/**
 * @swagger
 * /projects/{id}/import/github:
 *   post:
 *     summary: Import GitHub repository
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - repoUrl
 *             properties:
 *               repoUrl:
 *                 type: string
 *               branch:
 *                 type: string
 *     responses:
 *       200:
 *         description: Repository imported
 */
projectsRouter.post(
  '/:id/import/github',
  authenticateToken,
  validate({ body: importGitHubSchema }),
  importGitHubRepositoryHandler
);

/**
 * @swagger
 * /projects/{id}/context:
 *   get:
 *     summary: Get project GitHub context
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Project context
 */
projectsRouter.get(
  '/:id/context',
  authenticateToken,
  getProjectContextHandler
);

/**
 * @swagger
 * /projects/{id}/context:
 *   delete:
 *     summary: Delete project GitHub context
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Context deleted
 */
projectsRouter.delete(
  '/:id/context',
  authenticateToken,
  deleteProjectContextHandler
);

/**
 * @swagger
 * /projects/{id}/leave:
 *   post:
 *     summary: Leave project
 *     tags: [Projects]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successfully left the project
 */
projectsRouter.post(
  '/:id/leave',
  authenticateToken,
  leaveProjectHandler
);

export default projectsRouter;
