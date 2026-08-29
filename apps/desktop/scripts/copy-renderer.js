// Copia o bundle do Vite para dentro de dist/, que e o que o electron-builder
// empacota. O main carrega dist/renderer/index.html quando nao esta em dev.
const { cpSync, existsSync, rmSync } = require('node:fs');
const { join } = require('node:path');

const from = join(__dirname, '..', '..', 'web', 'dist');
const to = join(__dirname, '..', 'dist', 'renderer');

if (!existsSync(from)) {
  console.error('Bundle do renderer nao encontrado. Rode: npm run build --workspace=apps/web');
  process.exit(1);
}

rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
console.log('renderer copiado para', to);
