import mongoose, { Connection } from 'mongoose';
import type { MongooseError } from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mockia';
const MONGODB_OPTIONS = {
  maxPoolSize: 10,
  minPoolSize: 2,
  maxConnecting: 2,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  family: 4, // Use IPv4
};

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_INTERVAL_MS = 5000;

let reconnectAttempts = 0;

/**
 * Establece la conexión a MongoDB con Mongoose
 * Incluye manejo de reconexiones automáticas y logging
 */
export const connectDB = async (): Promise<Connection> => {
  try {
    if (mongoose.connection.readyState === 1) {
      console.log('[MongoDB] Ya hay conexión activa');
      return mongoose.connection;
    }

    console.log('[MongoDB] Conectando a MongoDB...');

    await mongoose.connect(MONGODB_URI, MONGODB_OPTIONS);

    reconnectAttempts = 0;
    console.log('[MongoDB] Conexión establecida exitosamente');

    // Configurar listeners para reconexión
    setupConnectionListeners();

    return mongoose.connection;
  } catch (error) {
    console.error('[MongoDB] Error al conectar:', error);
    throw error;
  }
};

/**
 * Configura listeners para manejar eventos de conexión
 */
const setupConnectionListeners = (): void => {
  mongoose.connection.on('connected', () => {
    console.log('[MongoDB] Conectado a MongoDB');
    reconnectAttempts = 0;
  });

  mongoose.connection.on('error', (error: MongooseError) => {
    console.error('[MongoDB] Error de conexión:', error);
    attemptReconnect();
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('[MongoDB] Desconectado de MongoDB');
    attemptReconnect();
  });

  mongoose.connection.on('reconnected', () => {
    console.log('[MongoDB] Reconectado a MongoDB');
    reconnectAttempts = 0;
  });
};

/**
 * Intenta reconectar a MongoDB con backoff exponencial
 */
const attemptReconnect = async (): Promise<void> => {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error(
      `[MongoDB] Se alcanzó el máximo de intentos de reconexión (${MAX_RECONNECT_ATTEMPTS})`
    );
    return;
  }

  reconnectAttempts++;
  const delay = RECONNECT_INTERVAL_MS * reconnectAttempts;

  console.log(
    `[MongoDB] Intentando reconectar en ${delay}ms (intento ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`
  );

  setTimeout(async () => {
    try {
      await mongoose.connect(MONGODB_URI, MONGODB_OPTIONS);
    } catch (error) {
      console.error('[MongoDB] Error en reconexión:', error);
      attemptReconnect();
    }
  }, delay);
};

/**
 * Desconecta de MongoDB de forma segura (graceful shutdown)
 */
export const disconnectDB = async (): Promise<void> => {
  try {
    if (mongoose.connection.readyState === 0) {
      console.log('[MongoDB] Ya está desconectado');
      return;
    }

    console.log('[MongoDB] Desconectando...');
    await mongoose.disconnect();
    console.log('[MongoDB] Desconexión completada');
  } catch (error) {
    console.error('[MongoDB] Error al desconectar:', error);
    throw error;
  }
};

/**
 * Obtiene el estado de la conexión
 */
export const getConnectionStatus = (): {
  isConnected: boolean;
  readyState: number;
  host?: string;
  name?: string;
} => {
  return {
    isConnected: mongoose.connection.readyState === 1,
    readyState: mongoose.connection.readyState,
    host: mongoose.connection.host,
    name: mongoose.connection.name,
  };
};

export default mongoose;