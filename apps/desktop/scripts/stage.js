/**
 * Monta um diretorio de empacotamento auto-contido em apps/desktop/staging.
 *
 * Por que nao empacotar direto de apps/desktop: o electron-builder roda
 * `npm install --production` no diretorio do app, e num monorepo com
 * workspaces isso poda as devDependencies do node_modules da RAIZ - o build
 * seguinte quebra por falta de electron/typescript/vite. Isolando o app em
 * staging, esse install acontece numa arvore propria e descartavel.
 */
const { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } = require('node:fs');
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

/**
 * Recusa empacotar artefatos mais velhos que o codigo-fonte.
 *
 * Sem esta checagem, um `npm run build` que falha no typecheck deixa o dist
 * anterior no lugar e o instalador sai com codigo defasado - sem nenhum aviso.
 */
function assertFresh(built, sourceDir) {
  const buildTime = statSync(built).mtimeMs;
  const newest = newestMtime(sourceDir);
  if (newest > buildTime) {
    console.error(
      `Artefato desatualizado: ${built}\n` +
        `  Codigo-fonte em ${sourceDir} e mais recente. Rode o build e confirme que ele passou.`,
    );
    process.exit(1);
  }
}

function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const mtime = entry.isDirectory() ? newestMtime(full) : statSync(full).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

assertFresh(join(desktopDir, 'dist', 'main', 'index.js'), join(desktopDir, 'src'));
assertFresh(join(repoRoot, 'packages', 'core', 'dist', 'index.js'), join(repoRoot, 'packages', 'core', 'src'));

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
