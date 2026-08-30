import { useEffect, useRef, useState } from 'react';
import { ROTULOS_STATUS } from '../../components/ui';
import type { SettableStatus } from '../../types/concord-api';

const OPCOES: { status: SettableStatus; cor: string; nota?: string }[] = [
  { status: 'ONLINE', cor: 'bg-status-online' },
  { status: 'IDLE', cor: 'bg-status-idle' },
  { status: 'DND', cor: 'bg-status-dnd', nota: 'Silencia os sons de notificacao' },
  { status: 'INVISIBLE', cor: 'bg-status-offline', nota: 'Voce aparece offline para os outros' },
];

/** Menu de status ancorado no rodape do usuario. */
export function StatusPicker({
  status,
  onChange,
}: {
  status: SettableStatus;
  onChange: (status: SettableStatus) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora, que e o comportamento esperado de um menu flutuante.
  useEffect(() => {
    if (!aberto) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false);

    document.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [aberto]);

  const atual = OPCOES.find((o) => o.status === status);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setAberto((a) => !a)}
        title="Mudar status"
        className="flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-ink-400 transition hover:bg-void-700 hover:text-ink-200"
      >
        <span className={`h-2 w-2 rounded-full ${atual?.cor ?? 'bg-status-offline'}`} />
        {ROTULOS_STATUS[status]}
      </button>

      {aberto && (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-52 overflow-hidden rounded-lg border border-void-600 bg-void-850 shadow-xl">
          {OPCOES.map((opcao) => (
            <button
              key={opcao.status}
              onClick={() => {
                onChange(opcao.status);
                setAberto(false);
              }}
              className={`flex w-full items-start gap-2 px-3 py-2 text-left transition hover:bg-void-700 ${
                opcao.status === status ? 'bg-violet-600/15' : ''
              }`}
            >
              <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${opcao.cor}`} />
              <span className="min-w-0">
                <span className="block text-xs text-ink-100">{ROTULOS_STATUS[opcao.status]}</span>
                {opcao.nota && <span className="block text-[10px] text-ink-400">{opcao.nota}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
