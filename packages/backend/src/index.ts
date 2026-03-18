import express, { Express, Request, Response } from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app: Express = express();
const port = process.env.BACKEND_PORT || 3000;

// Middleware
app.use(express.json());

// Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Root endpoint
app.get('/api', (req: Request, res: Response) => {
  res.json({
    message: 'Mockia.io API',
    version: '1.0.0',
    description: 'Generador Inteligente de Mock APIs y Documentación',
  });
});

// Error handling middleware
app.use((err: any, req: Request, res: Response) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(port, () => {
  console.log(`[Backend] 🚀 Server running on http://localhost:${port}/api`);
  console.log(`[Backend] Environment: ${process.env.NODE_ENV}`);
});

export default app;
