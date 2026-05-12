import mongoose, { Connection } from 'mongoose';
import type { MongooseError } from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/mockia';
const MONGODB_OPTIONS = {
  maxPoolSize: 10,
  minPoolSize: 2,
  maxConnecting: 2,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
};

const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_INTERVAL_MS = 5000;

let reconnectAttempts = 0;

/**
 * Establishes connection to MongoDB with Mongoose
 * Includes automatic reconnection handling and logging
 */
export const connectDB = async (): Promise<Connection> => {
  try {
    if (mongoose.connection.readyState === 1) {
      console.log('[MongoDB] Connection already active');
      return mongoose.connection;
    }

    const maskedUri = MONGODB_URI.replace(/:([^:@]+)@/, ':****@');
    console.log(`[MongoDB] Connecting to: ${maskedUri}`);

    await mongoose.connect(MONGODB_URI, MONGODB_OPTIONS);

    reconnectAttempts = 0;
    console.log('[MongoDB] Connection established successfully');

    // Configure listeners for reconnection
    setupConnectionListeners();

    return mongoose.connection;
  } catch (error) {
    console.error('[MongoDB] Connection error:', error);
    throw error;
  }
};

/**
 * Configures listeners to handle connection events
 */
const setupConnectionListeners = (): void => {
  mongoose.connection.on('connected', () => {
    console.log('[MongoDB] Connected to MongoDB');
    reconnectAttempts = 0;
  });

  mongoose.connection.on('error', (error: MongooseError) => {
    console.error('[MongoDB] Connection error:', error);
    attemptReconnect();
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('[MongoDB] Disconnected from MongoDB');
    attemptReconnect();
  });

  mongoose.connection.on('reconnected', () => {
    console.log('[MongoDB] Reconnected to MongoDB');
    reconnectAttempts = 0;
  });
};

/**
 * Attempts to reconnect to MongoDB with exponential backoff
 */
const attemptReconnect = async (): Promise<void> => {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.error(
      `[MongoDB] Maximum reconnection attempts reached (${MAX_RECONNECT_ATTEMPTS})`
    );
    return;
  }

  reconnectAttempts++;
  const delay = RECONNECT_INTERVAL_MS * reconnectAttempts;

  console.log(
    `[MongoDB] Attempting to reconnect in ${delay}ms (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`
  );

  setTimeout(async () => {
    try {
      await mongoose.connect(MONGODB_URI, MONGODB_OPTIONS);
    } catch (error) {
      console.error('[MongoDB] Reconnection error:', error);
      attemptReconnect();
    }
  }, delay);
};

/**
 * Safely disconnects from MongoDB (graceful shutdown)
 */
export const disconnectDB = async (): Promise<void> => {
  try {
    if (mongoose.connection.readyState === 0) {
      console.log('[MongoDB] Already disconnected');
      return;
    }

    console.log('[MongoDB] Disconnecting...');
    await mongoose.disconnect();
    console.log('[MongoDB] Disconnection completed');
  } catch (error) {
    console.error('[MongoDB] Disconnection error:', error);
    throw error;
  }
};

/**
 * Gets connection status
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