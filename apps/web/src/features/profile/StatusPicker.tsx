import { ReactNode, useState } from 'react';
import { Check } from 'lucide-react';
import { CORES_STATUS, Popover, ROTULOS_STATUS } from '../../components/ui';
import type { SettableStatus } from '../../types/concord-api';

const OPCOES: { status: SettableStatus; nota?: string }[] = [
  { status: 'ONLINE' },
  { status: 'IDLE' },
  { status: 'DND', nota: 'Silencia os sons de notificacao' },
  { status: 'INVISIBLE', nota: 'Voce aparece offline para os outros' },
];

/**
 * Menu de status. O gatilho (avatar e nome, no painel do usuario) vem como
 * children; o menu abre acima dele, como no Discord.
 */
export function StatusPicker({
  status,
  onChange,
  children,
  className = '',
}: {
  status: SettableStatus;
  onChange: (status: SettableStatus) => void;
  children: ReactNode;
  className?: string;
}) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

  return (
    <>
      <button
        type="button"
        title="Mudar status"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAnchor((a) => (a ? null : { x: r.left, y: r.top - 8 }));
        }}
        className={className}
      >
        {children}
      </button>

      {anchor && (
        <Popover anchor={anchor} align="above" onClose={() => setAnchor(null)} className="w-64">
          <p className="label-caps px-2 pb-1 pt-1">Definir status</p>
          {OPCOES.map((opcao) => (
            <button
              key={opcao.status}
              onClick={() => {
                onChange(opcao.status);
                setAnchor(null);
              }}
              className="group flex w-full items-start gap-3 rounded px-2 py-2 text-left transition hover:bg-violet-600"
            >
              <span
                className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${CORES_STATUS[opcao.status]}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink-100 group-hover:text-white">
                  {ROTULOS_STATUS[opcao.status]}
                </span>
                {opcao.nota && (
                  <span className="block text-xs text-ink-400 group-hover:text-violet-100">
                    {opcao.nota}
                  </span>
                )}
              </span>
              {opcao.status === status && (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-violet-300 group-hover:text-white" />
              )}
            </button>
          ))}
        </Popover>
      )}
    </>
  );
}
