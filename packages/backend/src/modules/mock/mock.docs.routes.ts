/** Mock Docs Routes
 * Expose a Swagger UI per-project at /mock/:projectSlug/docs
 * The UI points to the OpenAPI spec served at /api/projects/:id/swagger.json
 */

import { Application } from 'express';
import { ProjectModel } from '../../models/Project.js';

/** Mount Swagger UI page for a given project */
export function mountMockDocsRoutes(app: Application) {
  app.get('/mock/:projectSlug/docs', async (req, res) => {
    const projectSlug = req.params?.projectSlug as string | undefined;
    if (!projectSlug) {
      return res.status(400).send('Missing projectSlug');
    }

    // Resolve project by slug to obtain its ID for the swagger.json URL
    const project = await ProjectModel.findOne({ slug: projectSlug });
    if (!project) {
      return res.status(404).send('Project not found');
    }

    // URL to the dynamically generated swagger spec for this project
    const specUrl = `/api/projects/${project._id}/swagger.json`;

    // Minimal Swagger UI HTML instance against the dynamic spec URL
    const html = 
    `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Swagger UI - ${projectSlug}</title>
        <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist/swagger-ui.css" />
      </head>
      <body>
        <div id="swagger-ui" style="min-height: 80vh; margin: 0 auto; width: 90%;"></div>
        <script src="https://unpkg.com/swagger-ui-dist/swagger-ui-bundle.js"></script>
        <script src="https://unpkg.com/swagger-ui-dist/swagger-ui-standalone-preset.js"></script>
        <script>
          window.onload = function() {
            const ui = SwaggerUIBundle({
              url: '${specUrl}',
              dom_id: '#swagger-ui',
              presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
              layout: 'BaseLayout',
            });
            window.ui = ui;
          };
        </script>
      </body>
      </html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  });
}

export default mountMockDocsRoutes;
