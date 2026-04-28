import { Response } from 'express';
import { AuthenticatedRequest } from '../../middlewares/authenticateToken';
import { asyncHandler } from '../../middlewares/errorHandler';
import { generateSwaggerForProject } from './swaggerGenerator';
import { ProjectModel } from '../../models/Project';

/**
 * GET /api/projects/:id/swagger.json
 * Returns the OpenAPI Swagger JSON for a given project
 */
export const getProjectSwagger = asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
  const projectId = req.params?.id as string | undefined;
  if (!projectId) {
    res.status(400).json({ error: 'Missing project id' });
    return;
  }

  // Validate project exists
  const project = await ProjectModel.findById(projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  // Generate OpenAPI specification for the project
  const swagger = await generateSwaggerForProject(projectId);
  res.setHeader('Content-Type', 'application/json');
  res.json(swagger);
});

export default getProjectSwagger;
