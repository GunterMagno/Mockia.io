import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { legalConfigProblem } from '@mockia/shared';

/**
 * Un build de produccion no sale sin los datos del titular (VITE_LEGAL_NAME/NIF/ADDRESS/EMAIL): el Aviso Legal y la
 * Politica de Privacidad los publican y la ley los exige. VITE_LEGAL_ALLOW_PLACEHOLDER=1 lo omite (CI, pruebas).
 * La decision vive en @mockia/shared (legalConfigProblem, probada en el backend); aqui solo se aplica.
 */
function legalGuard(mode: string): Plugin {
  return {
    name: 'mockia-legal-guard',
    apply: 'build',
    configResolved() {
      if (mode !== 'production') return;
      const problem = legalConfigProblem(loadEnv(mode, __dirname, 'VITE_LEGAL_'));
      if (problem) throw new Error(problem);
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), legalGuard(mode)],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: {
      usePolling: true,
    },
    proxy: {
      // Proxy API requests to the backend service
      '/api': {
        target: process.env.BACKEND_URL || 'http://mockia-backend:3000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
}));
