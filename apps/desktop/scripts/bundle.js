/**
 * Empacota o processo principal e o preload em arquivos CJS auto-contidos.
 *
 * Motivo: o electron-builder monta o node_modules do app a partir das
 * `dependencies` do package.json e ignora padroes em `files` para esse
 * diretorio. Pacotes de workspace (@concord/core, @concord/types) nunca sao
 * publicados no registry, entao nao ha como declara-los - e o app empacotado
 * quebrava com "Cannot find module '@concord/core'".
 *
 * Inlinando esse codigo, o app empacotado passa a depender apenas dos modulos
 * que realmente precisam existir em disco: os nativos.
 */
const { build } = require('esbuild');
const { join } = require('node:path');

const desktopDir = join(__dirname, '..');

/**
 * Ficam de fora do bundle:
 * - electron: fornecido pelo runtime.
 * - better-sqlite3: binario nativo (.node).
 * - hyperswarm: puro JS, mas sua arvore usa node-gyp-build, que localiza os
 *   prebuilds por __dirname. Bundlar quebraria essa resolucao.
 */
const external = ['electron', 'better-sqlite3', 'hyperswarm'];

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external,
  sourcemap: true,
  logLevel: 'info',
};

async function main() {
  await build({
    ...common,
    entryPoints: [join(desktopDir, 'src', 'main', 'index.ts')],
    outfile: join(desktopDir, 'dist', 'main', 'index.js'),
  });

  await build({
    ...common,
    entryPoints: [join(desktopDir, 'src', 'preload', 'index.ts')],
    outfile: join(desktopDir, 'dist', 'preload', 'index.js'),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
