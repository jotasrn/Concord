/**
 * Grava os fuses do Electron no binario empacotado.
 *
 * Fuses sao interruptores dentro do proprio executavel. Uma vez desligados,
 * so voltam se alguem reescrever e reassinar o binario - nao ha variavel de
 * ambiente nem argumento de linha de comando que os reative.
 *
 * Feito aqui (e nao via `electronFuses` do electron-builder 26) para manter
 * os fuses num arquivo so, testavel fora do empacotamento.
 */
const { join } = require('node:path');

module.exports = async function afterPack(context) {
  const { FuseV1Options, FuseVersion, flipFuses } = require('@electron/fuses');

  // Nome e extensao do executavel dependem da plataforma ALVO, nao da que
  // esta rodando o build: no Linux o binario e `concord`, no Windows
  // `Concord.exe`. Usar process.platform quebrava qualquer build cruzado.
  const plataforma = context.electronPlatformName;
  const nome =
    plataforma === 'darwin'
      ? join(`${context.packager.appInfo.productFilename}.app`)
      : `${context.packager.executableName}${plataforma === 'win32' ? '.exe' : ''}`;
  const executavel = join(context.appOutDir, nome);

  await flipFuses(executavel, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: false,

    // Sem isto, ELECTRON_RUN_AS_NODE=1 transforma o nosso executavel num
    // interpretador Node com acesso total ao sistema.
    [FuseV1Options.RunAsNode]: false,

    // Fecham o depurador: com ele daria para pausar a execucao, ler a memoria
    // e alterar o comportamento em tempo real.
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,

    // So executa codigo de dentro do asar. Largar um arquivo solto na pasta
    // do app deixa de funcionar como forma de injetar codigo.
    [FuseV1Options.OnlyLoadAppFromAsar]: true,

    // Valida o hash do asar ao iniciar: adulterar o pacote quebra o app em vez
    // de rodar o codigo alterado.
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,

    [FuseV1Options.EnableCookieEncryption]: true,
  });

  console.log(`fuses aplicados em ${executavel}`);
};
