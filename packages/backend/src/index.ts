import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { connectDB, disconnectDB, getConnectionStatus } from './config/connection.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { authRouter } from './modules/auth/routes.js';
import { testOutboxRouter, shouldMountTestOutbox } from './modules/testSupport/outboxRoutes.js';
import { projectsRouter } from './modules/projects/routes.js';
import { userRouter } from './modules/users/routes.js';
import { githubRouter } from './routes/github.routes.js';
import { mockRouter } from './routes/mock.routes.js';
import { mockRouter as catchAllMockRouter } from './modules/mock/mockRouter.js';
import { endpointsRouter } from './routes/endpoints.routes.js';
import { mountInterceptorRoutes } from './modules/mock/interceptor.routes.js';
import aiRouter from './routes/ai.routes.js';
import notificationRouter from './routes/notification.routes.js';
import { startProjectCleanupScheduler } from './scheduler/projectCleanup.js';
import swaggerUi from 'swagger-ui-express';
import { specs } from './config/swagger.js';
import { billingRouter } from './modules/billing/routes.js';
import { mockQuotaGate } from './middlewares/planGate.js';
import { MOCK_CORS_OPTIONS } from './modules/mock/mockAuth.js';
import { migrateLegacyApiKeys } from './modules/projects/apiKeyMigration.js';
import { flushUsage } from './modules/billing/usage.js';
import { rateLimit, isStrictAuthPath } from './middlewares/rateLimit.js';
import { authenticateToken } from './middlewares/authenticateToken.js';
import { isEmailVerificationRequired } from './middlewares/requireVerifiedEmail.js';
import { authorizeRole } from './middlewares/authorizeRole.js';
import { assertJwtConfig } from './services/jwt.service.js';
import { assertProdConfig } from './config/assertProdConfig.js';
import { getLlm } from './modules/ai/providers/index.js';
import type { ProjectRole } from '@mockia/shared';

dotenv.config();

const app: Express = express();
const port = process.env.BACKEND_PORT || 3000;
const isDevelopment = process.env.NODE_ENV === 'development';

// Behind a reverse proxy (nginx) req.ip must come from X-Forwarded-For, or every client shares one rate-limit bucket.
// TRUST_PROXY = number of proxy hops (default 1 in production, off otherwise).
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? (process.env.NODE_ENV === 'production' ? 1 : 0)));

// ============================================================================
// SECURITY AND UTILITY MIDDLEWARES
// ============================================================================

// Helmet: HTTP headers security
app.use(helmet());

// CORS: comma-separated allow-list. Unset = local dev origin only (never open by default).
// "*" is accepted but then credentials are disabled (Bearer tokens do not need them).
const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const corsWildcard = corsOrigins.includes('*');
const corsMiddleware = cors({
  origin: corsWildcard ? '*' : corsOrigins,
  credentials: !corsWildcard,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  // X-Requested-With: the CSRF header of the cookie-based /auth/refresh and /auth/logout
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
});
app.use((req, res, next) => {
  // Bypasses the restrictive global CORS domain check for public/mock endpoints,
  // allowing them to handle their own open CORS rules (origin: '*') in their respective routers.
  if (req.path.startsWith('/api/mock') || req.path.startsWith('/mock')) {
    return next();
  }
  corsMiddleware(req, res, next);
});

// Morgan: HTTP request logging
const morganFormat = isDevelopment ? 'dev' : 'combined';
app.use(morgan(morganFormat));

// Rate limiting (sliding window, per IP). Off under jest so suites that hammer login/register stay deterministic.
if (process.env.NODE_ENV !== 'test') {
  const MIN15 = 15 * 60 * 1000;
  const globalLimiter = rateLimit({ windowMs: MIN15, max: 1000 });
  // login / register brute force. AUTH_RATE_LIMIT_MAX raises it for the e2e suite, which logs in more than 20 times from one IP.
  const authLimiter = rateLimit({ windowMs: MIN15, max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20 });
  const heavyLimiter = rateLimit({ windowMs: MIN15, max: 60 }); // AI (paid upstream) and GitHub clone
  // Public mock traffic (own quota gate), Stripe webhook and health probes are not throttled here.
  app.use('/api', (req, res, next) =>
    /^\/(mock|billing|health)(\/|$)/.test(req.path) ? next() : globalLimiter(req, res, next)
  );
  // Only login, register and the password-reset pair (forgot, reset) get the strict bucket. /refresh and /logout need a
  // signed token (nothing to brute-force) and every active client calls /refresh every 15 min: sharing the 20-per-IP
  // bucket would lock out users behind one NAT.
  app.use('/api/auth', (req, res, next) =>
    req.method === 'POST' && isStrictAuthPath(req.path) ? authLimiter(req, res, next) : next()
  );
  app.use('/api/ai', heavyLimiter);
  app.use('/api/github', heavyLimiter);
}

// Billing: MUST stay before express.json (Stripe webhook needs the raw body). Mock quota gate self-scopes to /mock and /api/mock.
app.use('/api/billing', billingRouter);
app.use(mockQuotaGate);

// Body size limit (1mb: enough for OpenAPI/spec payloads, cuts memory-exhaustion DoS)
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));

// Cookies (the HttpOnly refresh token): must be registered before the auth routes
app.use(cookieParser());

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
    database: dbStatus,
  });
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

// Test-only: read/clear the in-memory mail outbox. Mounted only for NODE_ENV=test or E2E_EXPOSE_MAIL_OUTBOX=true, never in production.
if (shouldMountTestOutbox()) {
  app.use('/api/__test__', testOutboxRouter);
}

// Users routes (protected)
app.use('/api/users', userRouter);

// Projects routes (protected)
app.use('/api/projects', projectsRouter);

// GitHub ingestion routes
app.use('/api/github', githubRouter);

// Mock Router routes (public with API Key)
app.use('/api/mock', cors(MOCK_CORS_OPTIONS), mockRouter);

// Endpoints routes (protected)
app.use('/api/endpoints', endpointsRouter);

// Interceptor/Override config routes.
// Guard for the unauthenticated PUT (was P0: anyone could rewrite any endpoint's config): only OWNER/EDITOR of the
// project pass; then next() falls through to the interceptor route. endpointId/_id are dropped from the body
// so the DTO cannot override the endpoint bound by the URL.
app.put(
  '/api/projects/:id/endpoints/:eid/config',
  authenticateToken,
  authorizeRole(['OWNER', 'EDITOR'] as unknown as ProjectRole[]),
  (req: Request, _res: Response, next) => {
    if (req.body && typeof req.body === 'object') {
      delete req.body.endpointId;
      delete req.body._id;
    }
    next();
  }
);
mountInterceptorRoutes(app);

// Catch-all Mock Router for direct project path interception
// Intercepts any request to /mock/:projectSlug/* and serves default responses
app.all(
  '/mock/:projectSlug/*',
  cors(MOCK_CORS_OPTIONS),
  catchAllMockRouter
);

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
    // Fail fast on missing/weak JWT secrets
    assertJwtConfig();
    // Fail fast on insecure production config (open CORS, default DB password, missing APP_URL, default secrets)
    assertProdConfig();
    // Fail fast on an AI_PROVIDERS list without a valid provider; unknown names only produce a warning.
    const aiChain = getLlm().name;
    if (process.env.NODE_ENV === 'production' && !process.env.SMTP_URL?.trim() && isEmailVerificationRequired()) {
      console.warn(
        '[Backend] SMTP_URL is not set: verification and password reset emails cannot be delivered, and with email ' +
          'verification required users could not unlock AI generation or billing. Set SMTP_URL and MAIL_FROM.'
      );
    }

    console.log(`[Backend] AI providers (in order): ${aiChain}`);

    // Connect to MongoDB
    await connectDB();

    // Plain-text project API keys of older versions become SHA-256 hashes (idempotent, no-op once migrated).
    // Not caught on purpose: if it fails the server must not start, or private mocks would be served as public.
    const migratedKeys = await migrateLegacyApiKeys();
    if (migratedKeys > 0) console.log(`[Backend] Migrated ${migratedKeys} project API key(s) to hashes`);

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
          // Persist the mock requests counted since the last flush (billing quota)
          await flushUsage().catch((err) => console.error('[Backend] Could not flush usage:', err));
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
if (process.env.NODE_ENV !== 'test' || process.env.E2E === 'true') {
  // In production, start the server directly
  startServer();
}

export default app;
