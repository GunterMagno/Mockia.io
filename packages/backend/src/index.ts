import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { connectDB, disconnectDB, getConnectionStatus } from './config/connection.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { authRouter } from './modules/auth/routes.js';
import { projectsRouter } from './modules/projects/routes.js';
import { userRouter } from './modules/users/routes.js';
import { githubRouter } from './routes/github.routes.js';
import { mockRouter } from './routes/mock.routes.js';
import mountMockDocsRoutes from './modules/mock/mock.docs.routes.js';
import { mockRouter as catchAllMockRouter } from './modules/mock/mockRouter.js';
import { endpointsRouter } from './routes/endpoints.routes.js';
import aiRouter from './routes/ai.routes.js';
import notificationRouter from './routes/notification.routes.js';
import { startProjectCleanupScheduler } from './scheduler/projectCleanup.js';
import swaggerUi from 'swagger-ui-express';
import { specs } from './config/swagger.js';

dotenv.config();

const app: Express = express();
const port = process.env.BACKEND_PORT || 3000;
const isDevelopment = process.env.NODE_ENV === 'development';

// ============================================================================
// SECURITY AND UTILITY MIDDLEWARES
// ============================================================================

// Helmet: HTTP headers security
app.use(helmet());

// CORS: Cross-origin resource sharing control
app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Morgan: HTTP request logging
const morganFormat = isDevelopment ? 'dev' : 'combined';
app.use(morgan(morganFormat));

// Express.json with 10mb limit
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ============================================================================
// HEALTH CHECK ROUTES
// ============================================================================

/**
 * Health check endpoint
 */
app.get('/api/health', (req: Request, res: Response) => {
  const dbStatus = getConnectionStatus();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    database: dbStatus,
  });
});

// Test Logger endpoint to capture headless browser console logs in CI
app.get('/api/test-log', (req: Request, res: Response) => {
  const message = req.query.message as string;
  if (message) {
    console.log(`[Browser Console] ${message}`);
  }
  res.sendStatus(200);
});



/**
 * Root endpoint
 */
app.get('/api', (req: Request, res: Response) => {
  res.json({
    message: 'Mockia.io API',
    version: '1.0.0',
    description: 'Intelligent Mock API and Documentation Generator',
    endpoints: {
      health: '/api/health',
      docs: '/api/docs',
    },
  });
});

// API Documentation (OpenAPI)
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(specs));

// ============================================================================
// APPLICATION ROUTES
// ============================================================================

// Authentication routes
app.use('/api/auth', authRouter);

// Users routes (protected)
app.use('/api/users', userRouter);

// Projects routes (protected)
app.use('/api/projects', projectsRouter);

// GitHub ingestion routes
app.use('/api/github', githubRouter);

// Mock Router routes (public with API Key)
app.use('/api/mock', cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Mockia-API-Key', 'X-Mockia-Response-Status', 'X-Mockia-Response-Name'],
}), mockRouter);

// Endpoints routes (protected)
app.use('/api/endpoints', endpointsRouter);

// Swagger Docs for Mock Router per-project (before catch-all)
mountMockDocsRoutes(app);

// Catch-all Mock Router for direct project path interception
// Intercepts any request to /mock/:projectSlug/* and serves default responses
app.all('/mock/:projectSlug/*', catchAllMockRouter);

// AI generation routes (protected)
app.use('/api/ai', aiRouter);

// Notification routes (protected)
app.use('/api/notifications', notificationRouter);


// ============================================================================
// ERROR HANDLING
// ============================================================================

// 404 handler: must be before the error handler
app.use(notFoundHandler);

// Global error handler: must be at the end
app.use(errorHandler);

// ============================================================================
// SERVER INITIALIZATION
// ============================================================================

/**
 * Start server with graceful shutdown
 */
const startServer = async (): Promise<void> => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Start project cleanup scheduler
    startProjectCleanupScheduler();

    const server = app.listen(port, () => {
      console.log(`[Backend] Server started at http://localhost:${port}/api`);
      console.log(`[Backend] Environment: ${process.env.NODE_ENV}`);
      console.log(`[Backend] Directory: ${process.cwd()}`);
    });

    // ========================================================================
    // GRACEFUL SHUTDOWN
    // ========================================================================

    /**Handles graceful server shutdown
     */
    const gracefulShutdown = async (signal: string): Promise<void> => {
      console.log(`[Backend] Signal received: ${signal}`);
      console.log('[Backend] Starting graceful shutdown...');

      // Stop accepting new connections
      server.close(async () => {
        console.log('[Backend] HTTP server closed');

        try {
          // Disconnect from MongoDB
          await disconnectDB();
          console.log('[Backend] Application closed successfully');
          process.exit(0);
        } catch (error) {
          console.error('[Backend] Error during shutdown:', error);
          process.exit(1);
        }
      });

      // 10 second timeout to force closure
      setTimeout(() => {
        console.error('[Backend] Forcing shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    // Listen for termination signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      console.error('[Backend] Uncaught exception:', error);
      process.exit(1);
    });

    // Handle uncaught promise rejections
    process.on('unhandledRejection', (reason: any) => {
      console.error('[Backend] Uncaught promise rejection:', reason);
      process.exit(1);
    });
  } catch (error) {
    console.error('[Backend] Error starting server:', error);
    process.exit(1);
  }
};

// Start server only if NOT in test environment
// Note: Direct execution check commented out due to ESM/CommonJS module compatibility
// The app is exported below for testing purposes
if (process.env.NODE_ENV !== 'test') {
  // In production, start the server directly
  startServer();
}

export default app;
