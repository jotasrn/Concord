import { ExternalLink } from 'lucide-react';

/**
 * Detecta http/https e endereco iniciado por www.
 *
 * Deliberadamente restrito: aceitar qualquer esquema abriria a porta para
 * `javascript:` e `file:` vindos de uma mensagem de outra pessoa.
 */
const PADRAO_LINK = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;

function normalizar(bruto: string): string | null {
  // Pontuacao final costuma ser da frase, nao do endereco.
  const limpo = bruto.replace(/[.,;:!?)\]}]+$/, '');
  const comEsquema = limpo.startsWith('www.') ? `https://${limpo}` : limpo;

  try {
    const url = new URL(comEsquema);
    // Ultima barreira: so estes dois esquemas viram link clicavel.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Texto de mensagem com links clicaveis.
 *
 * Nunca usa innerHTML: o conteudo vem de outro usuario, e montar HTML a partir
 * dele seria injecao direta. A quebra em pedacos deixa o React escapar tudo.
 */
export function MessageText({ content }: { content: string }) {
  const partes: React.ReactNode[] = [];
  let ultimo = 0;
  let chave = 0;

  for (const achado of content.matchAll(PADRAO_LINK)) {
    const indice = achado.index ?? 0;
    const bruto = achado[0];
    const href = normalizar(bruto);

    if (indice > ultimo) partes.push(content.slice(ultimo, indice));

    if (href) {
      // A pontuacao removida na normalizacao volta como texto comum.
      const sufixo = bruto.slice(bruto.replace(/[.,;:!?)\]}]+$/, '').length);
      partes.push(
        <a
          key={`link-${chave++}`}
          href={href}
          // O processo principal intercepta e abre no navegador do sistema;
          // a janela do app nunca navega para fora.
          target="_blank"
          rel="noreferrer noopener"
          title={href}
          className="inline-flex items-baseline gap-0.5 break-all text-violet-300 underline decoration-violet-500/50 underline-offset-2 transition hover:text-violet-200"
        >
          {bruto.replace(/[.,;:!?)\]}]+$/, '')}
          <ExternalLink className="h-2.5 w-2.5 shrink-0 self-center opacity-60" />
        </a>,
      );
      if (sufixo) partes.push(sufixo);
    } else {
      partes.push(bruto);
    }

    ultimo = indice + bruto.length;
  }

  if (ultimo < content.length) partes.push(content.slice(ultimo));

  return (
    <p className="selectable whitespace-pre-wrap break-words text-sm text-ink-200">
      {partes.length > 0 ? partes : content}
    </p>
  );
}
