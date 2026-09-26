# Atualizacao automatica

Como uma versao nova chega a todas as maquinas sem ninguem precisar baixar
nada a mao.

## O que acontece na maquina de quem usa

1. Vinte segundos depois de abrir, e de seis em seis horas, o app consulta os
   releases do repositorio no GitHub.
2. Se ha versao maior que a instalada, ele **baixa em segundo plano**. Uma faixa
   discreta no topo mostra o progresso.
3. Quando termina, a instalacao fica agendada para o **proximo encerramento do
   app**. Nada e interrompido.
4. Quem quiser antecipar clica em "Reiniciar agora" na faixa: o app fecha,
   instala e volta sozinho.

### Durante uma chamada nada reinicia

Essa e uma regra do codigo, nao uma configuracao:
[`updater.ts`](../apps/desktop/src/main/updater.ts) recusa instalar enquanto
houver chamada ativa, mesmo se a interface pedir. Se o download terminar no meio
de uma conversa, a faixa avisa que a troca fica para depois, e o convite para
reiniciar aparece quando a call acabar.

O estado da chamada vem do mesmo sinal que ja impedia o Windows de suspender
(`settings:callActive`), entao nao ha duas fontes de verdade para divergirem.

## Como publicar uma versao

Pre-requisito, uma vez so: o repositorio `jotasrn/Concord` precisa existir no
GitHub e ser **publico**. Num repositorio privado o download exigiria um token
embutido no app - e qualquer pessoa extrairia esse token do asar, entao essa
porta fica fechada de proposito.

O nome do repositorio esta em dois lugares, se precisar mudar:
`publish:` em [`electron-builder.yml`](../apps/desktop/electron-builder.yml).

Publicando: troque `version` em `package.json` e em
`apps/desktop/package.json` - so nesses dois. `npm version --workspaces`
reescreveria tambem os pacotes internos e as dependencias que apontam para
eles, o que quebra o build por um ganho nenhum.

```bash
git commit -am "Versao 0.3.0" && git tag v0.3.0 && git push origin master --tags
```

A tag dispara [`release.yml`](../.github/workflows/release.yml), que compila,
roda os testes, empacota e cria o release com o instalador e o `latest.yml`. Nao
ha segredo para configurar: o `GITHUB_TOKEN` do proprio Actions basta.

Assim que o release existe, as maquinas que estiverem abertas pegam a versao
nova na checagem seguinte - no maximo seis horas depois, ou na proxima vez que o
app abrir.

## Gerar um instalador local (sem publicar)

```bash
npm run dist
```

Sai em `%LOCALAPPDATA%\Concord-build\release`. O destino fica fora do OneDrive
porque a sincronizacao travava o `app.asar` no meio do empacotamento.

## Limitacoes conhecidas

- **Sem assinatura digital.** O SmartScreen continua avisando na primeira
  instalacao. Isso so desaparece com um certificado de code signing, que e pago.
  A versao `.zip` evita o instalador, mas nao o aviso.
- **Somente Windows.** O workflow empacota apenas `win`. Linux e macOS exigiriam
  outros runners e, no caso do macOS, notarizacao.
- **Uma versao maior e obrigatoria.** O electron-updater compara versoes por
  semver; republicar a mesma versao nao atualiza ninguem.
