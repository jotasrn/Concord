import { useEffect, useState } from 'react';
import { Cpu, Mic, User, Video, X } from 'lucide-react';
import { AudioSettingsPanel } from '../voice/AudioSettingsPanel';
import { ProfilePanel } from '../profile/ProfilePanel';
import { ResourcesPanel } from './ResourcesPanel';
import { VideoPanel } from './VideoPanel';
import type { Profile, SettableStatus } from '../../types/concord-api';

type Aba = 'perfil' | 'audio' | 'video' | 'recursos';

const SECOES: {
  titulo: string;
  abas: { id: Aba; rotulo: string; icone: React.ReactNode }[];
}[] = [
  {
    titulo: 'Configuracoes de usuario',
    abas: [
      {
        id: 'perfil',
        rotulo: 'Meu perfil',
        icone: <User className="h-4 w-4" />,
      },
    ],
  },
  {
    titulo: 'Configuracoes do app',
    abas: [
      { id: 'audio', rotulo: 'Voz', icone: <Mic className="h-4 w-4" /> },
      { id: 'video', rotulo: 'Video', icone: <Video className="h-4 w-4" /> },
      {
        id: 'recursos',
        rotulo: 'Recursos',
        icone: <Cpu className="h-4 w-4" />,
      },
    ],
  },
];

/**
 * Configuracoes em tela cheia, como no Discord: navegacao a esquerda,
 * conteudo ao centro e o botao de fechar (ou Esc) no canto.
 */
export function SettingsModal({
  profile,
  status,
  onClose,
  onProfileSaved,
}: {
  profile: Profile;
  status: SettableStatus;
  onClose: () => void;
  onProfileSaved: (displayName: string) => void;
}) {
  const [tab, setTab] = useState<Aba>('perfil');
  const [versao, setVersao] = useState<string | null>(null);

  useEffect(() => {
    void window.concord.app
      .version()
      .then(setVersao)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Configuracoes"
      className="fixed inset-0 z-50 flex animate-fade-in bg-void-800"
    >
      <div className="flex flex-1 justify-end bg-void-900">
        <nav className="scroll-thin w-56 overflow-y-auto px-2 py-14">
          {SECOES.map((secao) => (
            <div key={secao.titulo} className="mb-4">
              <p className="px-2.5 pb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-400">
                {secao.titulo}
              </p>
              {secao.abas.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setTab(a.id)}
                  aria-label={a.rotulo}
                  aria-current={tab === a.id ? 'page' : undefined}
                  className={`mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[15px] transition ${
                    tab === a.id
                      ? 'bg-void-600 text-ink-100'
                      : 'text-ink-300 hover:bg-void-700 hover:text-ink-100'
                  }`}
                >
                  <span className={tab === a.id ? 'text-violet-300' : 'text-ink-400'}>
                    {a.icone}
                  </span>
                  {a.rotulo}
                </button>
              ))}
            </div>
          ))}
          <div className="mx-2.5 my-2 h-px bg-void-600" />
          {versao && (
            <p className="px-2.5 pt-1 font-mono text-[11px] text-ink-400" title="Versao instalada">
              Concord v{versao}
            </p>
          )}
        </nav>
      </div>

      <div className="flex min-w-0 flex-[1.6] bg-void-800">
        <div className="scroll-thin min-w-0 max-w-3xl flex-1 overflow-y-auto px-10 py-14">
          {tab === 'perfil' && (
            <ProfilePanel profile={profile} status={status} onSaved={onProfileSaved} />
          )}
          {tab === 'audio' && <AudioSettingsPanel />}
          {tab === 'video' && <VideoPanel />}
          {tab === 'recursos' && <ResourcesPanel />}
        </div>

        <div className="shrink-0 pr-6 pt-14">
          <button
            onClick={onClose}
            aria-label="Fechar configuracoes"
            className="group flex flex-col items-center gap-1.5"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-ink-400 text-ink-300 transition group-hover:border-ink-100 group-hover:bg-void-700 group-hover:text-ink-100">
              <X className="h-5 w-5" />
            </span>
            <span className="text-xs font-semibold text-ink-400 group-hover:text-ink-200">ESC</span>
          </button>
        </div>
      </div>
    </div>
  );
}
