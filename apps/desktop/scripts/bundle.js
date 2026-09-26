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
const { rmSync } = require('node:fs');
const { join } = require('node:path');

const desktopDir = join(__dirname, '..');

/**
 * Ficam de fora do bundle:
 * - electron: fornecido pelo runtime.
 * - better-sqlite3: binario nativo (.node).
 * - hyperswarm: puro JS, mas sua arvore usa node-gyp-build, que localiza os
 *   prebuilds por __dirname. Bundlar quebraria essa resolucao.
 * - electron-updater: resolve app-update.yml e o cache de download por
 *   caminhos relativos ao proprio pacote. Bundlar embaralharia isso, e uma
 *   falha ai so aparece no app instalado - o pior lugar para descobrir.
 */
const external = ['electron', 'better-sqlite3', 'hyperswarm', 'electron-updater'];

const producao = process.env.NODE_ENV !== 'development';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external,
  /**
   * Sem sourcemap em producao. O mapa carrega o TypeScript original inteiro,
   * comentarios inclusive - empacota-lo equivale a distribuir o codigo-fonte.
   */
  sourcemap: !producao,
  minify: producao,
  logLevel: 'info',
};

async function main() {
  // Limpa a saida antes de gerar: restos de builds anteriores (inclusive .map
  // de quando o tsc emitia arquivos) estavam sendo empacotados.
  rmSync(join(desktopDir, 'dist', 'main'), { recursive: true, force: true });
  rmSync(join(desktopDir, 'dist', 'preload'), { recursive: true, force: true });

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

  // Preload proprio do overlay: superficie minima, so recebe participantes.
  await build({
    ...common,
    entryPoints: [join(desktopDir, 'src', 'preload', 'overlay.ts')],
    outfile: join(desktopDir, 'dist', 'preload', 'overlay.js'),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
