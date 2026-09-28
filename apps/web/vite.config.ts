import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Versao do monorepo (package.json da raiz, a mesma que o electron-builder
// usa para nomear o instalador), embutida em tempo de build. E o fallback
// para quando nao ha IPC do Electron para perguntar a versao de verdade -
// ou seja, no cliente web.
const versaoDoMonorepo = JSON.parse(
  readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
).version as string;

export default defineConfig({
  plugins: [react()],
  define: {
    __CONCORD_VERSION__: JSON.stringify(versaoDoMonorepo),
  },
  // Caminhos relativos sao obrigatorios: o Electron carrega o bundle por
  // file://, onde "/assets/..." resolveria para a raiz do disco e a janela
  // abriria preta, sem erro visivel.
  base: './',
  build: {
    rollupOptions: {
      // O overlay e uma pagina separada: janela propria, sem React nem o
      // bundle do app, para pesar o minimo possivel sobre um jogo.
      input: {
        index: resolve(__dirname, 'index.html'),
        overlay: resolve(__dirname, 'overlay.html'),
      },
    },
  },
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
