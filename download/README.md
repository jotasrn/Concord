# Baixar o Concord

<p align="center">
  <a href="https://github.com/jotasrn/Concord/releases/latest/download/Concord-Setup.exe">
    <img alt="Baixar instalador para Windows" src="https://img.shields.io/badge/Baixar-Instalador%20Windows-8B5CF6?style=for-the-badge&logo=windows&logoColor=white">
  </a>
  &nbsp;
  <a href="https://github.com/jotasrn/Concord/releases/latest/download/Concord-Portable.zip">
    <img alt="Baixar versão portátil" src="https://img.shields.io/badge/Baixar-Port%C3%A1til%20(.zip)-24242E?style=for-the-badge&logo=files&logoColor=white">
  </a>
</p>

<p align="center">
  <img alt="Versão mais recente" src="https://img.shields.io/github/v/release/jotasrn/Concord?label=vers%C3%A3o&color=8B5CF6">
  <img alt="Windows 10/11 64 bits" src="https://img.shields.io/badge/Windows-10%20%2F%2011%20(64%20bits)-0C0C11">
</p>

Os dois botões baixam sempre a **versão mais nova**: o link não muda de uma
versão para outra, então pode mandar este endereço para os amigos à vontade.

> Os arquivos não ficam dentro do repositório: o GitHub não aceita arquivos
> acima de 100 MB, e versionar binários deixaria o projeto pesado para sempre.
> Eles ficam em [Releases](https://github.com/jotasrn/Concord/releases), e os
> botões acima apontam direto para lá.

---

## Qual escolher

| | Instalador | Portátil |
| --- | --- | --- |
| Arquivo | `Concord-Setup.exe` | `Concord-Portable.zip` |
| Instalação | Assistente de instalação, atalho na área de trabalho e no Iniciar | Descompacte numa pasta e rode `Concord.exe` |
| Atualização automática | ✅ Sim | ❌ Não, baixe a versão nova à mão |
| Precisa de administrador | Não | Não |

**Na dúvida, use o instalador.** O portátil serve para testar sem instalar
ou para rodar de um pendrive.

## Instalar

1. Baixe o `Concord-Setup.exe` pelo botão acima.
2. Abra o arquivo. O Windows vai mostrar **"O Windows protegeu o computador"**
   (SmartScreen). É esperado: o instalador ainda não tem assinatura digital,
   que é um certificado pago.
   Clique em **Mais informações** e depois em **Executar assim mesmo**.
3. Siga o assistente. Dá para escolher a pasta de instalação.
4. Na primeira abertura o Firewall do Windows pode perguntar se o Concord pode
   usar a rede. **Permita**: é por aí que ele conversa direto com os amigos,
   sem servidor no meio.

## Primeiro uso

1. Escolha um nome de exibição e uma senha. A senha protege sua conta **neste
   computador** e não é enviada para lugar nenhum.
2. O app mostra **12 palavras**. Elas **são** a sua conta: anote em papel e
   guarde. Não existe "esqueci minha senha", porque não existe servidor para
   recuperar nada. Perdeu a senha e as palavras, perdeu a conta.
3. Crie um servidor ou entre num usando um convite de um amigo.

Para usar a mesma conta em outro computador, escolha **"Já tenho uma conta —
restaurar com a frase"** e digite as 12 palavras.

## Atualizar

Quem instalou pelo instalador **não precisa fazer nada**. O app procura
versões novas ao abrir e a cada seis horas, baixa em segundo plano e instala
quando você fechar. Nunca reinicia no meio de uma chamada. Detalhes em
[ATUALIZACAO.md](../docs/ATUALIZACAO.md).

Na versão portátil, baixe o zip novo e substitua a pasta. Sua conta e suas
mensagens ficam fora dela (veja abaixo) e não se perdem.

## Conferir o arquivo baixado (opcional)

Cada versão publica um `SHA256SUMS.txt` junto dos arquivos. No PowerShell:

```powershell
Get-FileHash .\Concord-Setup.exe -Algorithm SHA256
```

O resultado deve ser igual à linha do `Concord-Setup.exe` no
[`SHA256SUMS.txt` da versão mais recente](https://github.com/jotasrn/Concord/releases/latest/download/SHA256SUMS.txt).

## Onde ficam seus dados

| O quê | Onde |
| --- | --- |
| Conta (cifrada), mensagens e configurações | `%APPDATA%\Concord` |
| Log de diagnóstico | `%APPDATA%\Concord\concord.log` |

Cole `%APPDATA%\Concord` na barra de endereço do Explorador de Arquivos para
abrir a pasta.

## Desinstalar

**Configurações → Aplicativos → Concord → Desinstalar.** A pasta
`%APPDATA%\Concord` é mantida de propósito, para uma reinstalação não perder
sua conta. Para apagar tudo, apague essa pasta depois de desinstalar.

## Problemas comuns

| Sintoma | O que fazer |
| --- | --- |
| "O Windows protegeu o computador" | **Mais informações → Executar assim mesmo** (veja [Instalar](#instalar)) |
| O antivírus bloqueou o instalador | Mesmo motivo: falta de assinatura digital. Libere o arquivo ou use o portátil |
| Fica em "0 peers" | Confira se o firewall liberou o Concord. Os amigos também precisam estar com o app aberto |
| A chamada não conecta com uma pessoa específica | Pode ser NAT restritivo dos dois lados ao mesmo tempo (o Concord não usa servidor de retransmissão). Tente outra rede, por exemplo o 4G do celular |
| Esqueci a senha | Na tela de entrada, clique em **Esqueci a senha — restaurar com a frase de recuperação** e crie uma senha nova |
| O app não abre | Mande o arquivo `%APPDATA%\Concord\concord.log` ao abrir uma [issue](https://github.com/jotasrn/Concord/issues) |

## Outras plataformas

Por enquanto só há build oficial para **Windows**. No Linux e no macOS dá para
rodar a partir do código: veja [Rodar em desenvolvimento](../README.md#rodar-em-desenvolvimento).
Também existe uma versão que roda no navegador, para quem hospedar a ponte web:
[DEPLOY_WEB.md](../docs/DEPLOY_WEB.md).
