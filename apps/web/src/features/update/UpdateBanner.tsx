import { useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import type { UpdateStatus } from '../../types/concord-api';

/**
 * Aviso de atualizacao.
 *
 * Aparece so quando ha algo a dizer: durante o download (discreto) e quando a
 * versao nova esta pronta. Se houver chamada em andamento, o convite para
 * reiniciar da lugar a um aviso de que a troca fica para depois - reiniciar no
 * meio de uma conversa e exatamente o que este projeto nao quer fazer.
 *
 * Fechar o aviso nao cancela nada: a instalacao acontece de qualquer forma no
 * proximo encerramento do app.
 */
export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dispensado, setDispensado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    void window.concord.update
      .status()
      .then(setStatus)
      .catch(() => undefined);
    return window.concord.update.onStatus((novo) => {
      setStatus(novo);
      // Versao diferente da que foi dispensada volta a aparecer.
      setDispensado(false);
    });
  }, []);

  if (!status || dispensado) return null;
  if (status.state !== 'ready' && status.state !== 'downloading') return null;

  if (status.state === 'downloading') {
    return (
      <div className="flex items-center gap-2 border-b border-void-800 bg-void-900 px-4 py-1.5 text-xs text-ink-300">
        <Download className="h-3.5 w-3.5 shrink-0 animate-pulse text-violet-400" />
        <span className="flex-1 truncate">
          Baixando atualizacao{status.version ? ` ${status.version}` : ''} &mdash; {status.percent}%
        </span>
        <div className="h-1 w-24 overflow-hidden rounded-full bg-void-700">
          <div
            className="h-full bg-violet-500 transition-all"
            style={{ width: `${status.percent}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 border-b border-violet-500/30 bg-violet-600/10 px-4 py-2 text-xs">
      <RefreshCw className="h-4 w-4 shrink-0 text-violet-300" />
      <span className="flex-1 text-ink-100">
        Versao {status.version ?? 'nova'} pronta.{' '}
        {status.waitingForCall ? (
          <span className="text-ink-300">
            Sera instalada quando a chamada terminar &mdash; nada e interrompido agora.
          </span>
        ) : (
          <span className="text-ink-300">A instalacao acontece ao fechar o Concord.</span>
        )}
      </span>
      {erro && <span className="text-status-dnd">{erro}</span>}
      {!status.waitingForCall && (
        <button
          onClick={() =>
            void window.concord.update.install().then((r) => {
              if (!r.ok) setErro(r.motivo ?? 'Nao foi possivel instalar agora');
            })
          }
          className="rounded-lg bg-violet-600 px-3 py-1 font-semibold text-white transition hover:bg-violet-500"
        >
          Reiniciar agora
        </button>
      )}
      <button
        onClick={() => setDispensado(true)}
        title="Esconder este aviso"
        className="rounded-sm px-2 py-1 text-ink-400 transition hover:text-ink-200"
      >
        Depois
      </button>
    </div>
  );
}
