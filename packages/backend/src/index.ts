import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { connectDB, disconnectDB, getConnectionStatus } from './config/connection';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';

dotenv.config();

const app: Express = express();
const port = process.env.BACKEND_PORT || 3000;
const isDevelopment = process.env.NODE_ENV === 'development';

// ============================================================================
// MIDDLEWARES DE SEGURIDAD Y UTILIDAD
// ============================================================================

// Helmet: Asegura headers HTTP
app.use(helmet());

// CORS: Control de acceso entre orígenes
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Morgan: Logging de solicitudes HTTP
const morganFormat = isDevelopment ? 'dev' : 'combined';
app.use(morgan(morganFormat));

// Express.json con límite de 10mb
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ============================================================================
// RUTAS DE SALUD
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

/**
 * Root endpoint
 */
app.get('/api', (req: Request, res: Response) => {
  res.json({
    message: 'Mockia.io API',
    version: '1.0.0',
    description: 'Generador Inteligente de Mock APIs y Documentación',
    endpoints: {
      health: '/api/health',
      docs: '/api/docs',
    },
  });
});

// ============================================================================
// RUTAS DE APLICACIÓN
// ============================================================================

// TODO: Agregar rutas de la aplicación aquí
// app.use('/api/users', userRoutes);
// app.use('/api/mocks', mockRoutes);
// etc.

// ============================================================================
// MANEJO DE ERRORES
// ============================================================================

// 404 handler: debe estar antes del error handler
app.use(notFoundHandler);

// Error handler global: debe estar al final
app.use(errorHandler);

// ============================================================================
// INICIALIZACIÓN DEL SERVIDOR
// ============================================================================

/**
 * Inicia el servidor con graceful shutdown
 */
const startServer = async (): Promise<void> => {
  try {
    // Conectar a MongoDB
    await connectDB();

    const server = app.listen(port, () => {
      console.log(`[Backend] Servidor iniciado en http://localhost:${port}/api`);
      console.log(`[Backend] Environment: ${process.env.NODE_ENV}`);
      console.log(`[Backend] Directorio: ${process.cwd()}`);
    });

    // ========================================================================
    // GRACEFUL SHUTDOWN
    // ========================================================================

    /**
     * Maneja el shutdown elegante del servidor
     */
    const gracefulShutdown = async (signal: string): Promise<void> => {
      console.log(`[Backend] Señal recibida: ${signal}`);
      console.log('[Backend] Iniciando shutdown elegante...');

      // Dejar de aceptar nuevas conexiones
      server.close(async () => {
        console.log('[Backend] Servidor HTTP cerrado');

        try {
          // Desconectar de MongoDB
          await disconnectDB();
          console.log('[Backend] Aplicación cerrada correctamente');
          process.exit(0);
        } catch (error) {
          console.error('[Backend] Error durante shutdown:', error);
          process.exit(1);
        }
      });

      // Timeout de 10 segundos para forzar el cierre
      setTimeout(() => {
        console.error('[Backend] Forzando cierre después de timeout');
        process.exit(1);
      }, 10000);
    };

    // Escuchar señales de terminación
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Manejar excepciones no capturadas
    process.on('uncaughtException', (error: Error) => {
      console.error('[Backend] Excepción no capturada:', error);
      process.exit(1);
    });

    // Manejar promesas rechazadas no capturadas
    process.on('unhandledRejection', (reason: any) => {
      console.error('[Backend] Promesa rechazada no capturada:', reason);
      process.exit(1);
    });
  } catch (error) {
    console.error('[Backend] Error al iniciar servidor:', error);
    process.exit(1);
  }
};

// Iniciar servidor solo si se ejecuta directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}

export default app;
