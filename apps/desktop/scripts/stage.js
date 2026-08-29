/**
 * Monta um diretorio de empacotamento auto-contido em apps/desktop/staging.
 *
 * Por que nao empacotar direto de apps/desktop: o electron-builder roda
 * `npm install --production` no diretorio do app, e num monorepo com
 * workspaces isso poda as devDependencies do node_modules da RAIZ - o build
 * seguinte quebra por falta de electron/typescript/vite. Isolando o app em
 * staging, esse install acontece numa arvore propria e descartavel.
 */
const { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

const desktopDir = join(__dirname, '..');
const repoRoot = join(desktopDir, '..', '..');
const staging = join(desktopDir, 'staging');

const pkg = require(join(desktopDir, 'package.json'));

function requireBuilt(path, hint) {
  if (!existsSync(path)) {
    console.error(`Faltando: ${path}\n  -> ${hint}`);
    process.exit(1);
  }
}

requireBuilt(join(desktopDir, 'dist', 'main', 'index.js'), 'npm run build --workspace=apps/desktop');
requireBuilt(join(desktopDir, 'dist', 'renderer', 'index.html'), 'npm run build --workspace=apps/web');
requireBuilt(join(repoRoot, 'packages', 'core', 'dist', 'index.js'), 'npm run build --workspace=packages/core');

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

// 1. Codigo ja compilado.
cpSync(join(desktopDir, 'dist'), join(staging, 'dist'), { recursive: true });

/**
 * 2. package.json do app empacotado. Declara apenas o que precisa existir em
 *    node_modules no runtime: modulos nativos e as libs que o core carrega.
 *    O @concord/core e copiado a mao logo abaixo por ser workspace local.
 */
writeFileSync(
  join(staging, 'package.json'),
  JSON.stringify(
    {
      name: pkg.name.replace('@concord/', 'concord-'),
      // app.getName() prefere productName, e e ele que define a pasta em
      // AppData/Roaming. Sem isto os dados do usuario cairiam em
      // "concord-desktop".
      productName: 'Concord',
      version: pkg.version,
      description: pkg.description,
      author: pkg.author,
      main: 'dist/main/index.js',
      dependencies: {
        // Apenas modulos que precisam existir em disco. Todo o resto (core,
        // types, bip39) foi inlinado no bundle pelo esbuild.
        'better-sqlite3': require(join(repoRoot, 'node_modules', 'better-sqlite3', 'package.json')).version,
        hyperswarm: require(join(repoRoot, 'node_modules', 'hyperswarm', 'package.json')).version,
      },
    },
    null,
    2,
  ),
);

// 3. Instala a arvore de producao dentro do staging, isolada da raiz.
console.log('instalando dependencias de producao em staging...');
execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
  cwd: staging,
  stdio: 'inherit',
  shell: true,
});

console.log('staging pronto em', staging);
