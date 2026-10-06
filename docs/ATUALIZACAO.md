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

Publicando:

1. Troque `version` em `package.json` e em `apps/desktop/package.json` - so
   nesses dois. `npm version --workspaces` reescreveria tambem os pacotes
   internos e as dependencias que apontam para eles, o que quebra o build por
   um ganho nenhum.
2. Confirme que o CI do commit esta verde (lint, testes, audit).
3. Crie a tag e envie:

```bash
git commit -am "Versao 0.7.0" && git tag v0.7.0 && git push origin master --tags
```

A tag dispara [`release.yml`](../.github/workflows/release.yml), que compila,
roda os testes, empacota e cria o release. Nao ha segredo para configurar: o
`GITHUB_TOKEN` do proprio Actions basta.

### O que o release contem

| Arquivo | Para que |
|---|---|
| `Concord-Setup.exe` | Instalador, **nome fixo**. E o que os botoes do README e da pasta [`download/`](../download/README.md) baixam |
| `Concord-Portable.zip` | Versao sem instalacao, **nome fixo** |
| `Concord-Setup-<versao>.exe` | O mesmo instalador com a versao no nome. E o que o `latest.yml` referencia |
| `Concord-Portable-<versao>.zip` | O mesmo zip com a versao no nome |
| `latest.yml` + `.blockmap` | Lidos pelo electron-updater dentro do app para saber se ha versao nova e baixar so o que mudou |
| `SHA256SUMS.txt` | Hashes para quem quiser conferir o download |

Os links fixos usam o atalho do GitHub para o release mais recente:

```
https://github.com/jotasrn/Concord/releases/latest/download/Concord-Setup.exe
https://github.com/jotasrn/Concord/releases/latest/download/Concord-Portable.zip
```

Eles nunca mudam: quem recebeu o link uma vez sempre baixa a versao atual. O
workflow tambem escreve as notas do release, com uma tabela de download no
topo seguida das mudancas geradas automaticamente a partir dos PRs.

Releases publicados antes da v0.7.0 usam os nomes antigos
(`Concord-<versao>-exe.exe`) e nao tem as copias de nome fixo, entao os links
acima so passam a funcionar a partir do primeiro release feito com este
workflow.

Assim que o release existe, as maquinas que estiverem abertas pegam a versao
nova na checagem seguinte - no maximo seis horas depois, ou na proxima vez que o
app abrir.

## Gerar um instalador local (sem publicar)

```bash
npm run dist
```

Sai em `%LOCALAPPDATA%\Concord-build\release`, com os nomes
`Concord-Setup-<versao>.exe` e `Concord-Portable-<versao>.zip`.

Rodar o workflow de release manualmente (aba Actions, "Run workflow") gera os
mesmos arquivos como artefato do Actions, sem criar release - util para testar
o instalador antes de publicar. O destino fica fora do OneDrive
porque a sincronizacao travava o `app.asar` no meio do empacotamento.

## Limitacoes conhecidas

- **Sem assinatura digital.** O SmartScreen continua avisando na primeira
  instalacao. Isso so desaparece com um certificado de code signing, que e pago.
  A versao `.zip` evita o instalador, mas nao o aviso.
- **Somente Windows.** O workflow empacota apenas `win`. O empacotamento Linux
  funciona (`--linux dir` foi validado com os fuses), mas nao e publicado;
  macOS exigiria runner proprio e notarizacao.
- **Uma versao maior e obrigatoria.** O electron-updater compara versoes por
  semver; republicar a mesma versao nao atualiza ninguem.
