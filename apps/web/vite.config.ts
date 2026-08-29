import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  // Caminhos relativos sao obrigatorios: o Electron carrega o bundle por
  // file://, onde "/assets/..." resolveria para a raiz do disco e a janela
  // abriria preta, sem erro visivel.
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});
