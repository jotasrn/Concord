import { useEffect, useState } from 'react';
import { AudioSettingsPanel } from '../voice/AudioSettingsPanel';
import { ProfilePanel } from '../profile/ProfilePanel';
import { FriendsPanel } from '../friends/FriendsPanel';
import { ResourcesPanel } from './ResourcesPanel';
import { VideoPanel } from './VideoPanel';
import type { Profile, PresenceStatus, SettableStatus, ServerView } from '../../types/concord-api';

const ROTULOS_ABA = {
  perfil: 'Meu perfil',
  amigos: 'Amigos',
  audio: 'Voz',
  video: 'Video',
  recursos: 'Recursos',
} as const;

export function SettingsModal({
  profile,
  status,
  onClose,
  onProfileSaved,
  servers,
  presencaDe,
  onFriendsChanged,
  onCall,
}: {
  profile: Profile;
  status: SettableStatus;
  onClose: () => void;
  onProfileSaved: (displayName: string) => void;
  servers: ServerView[];
  presencaDe: (userKey: string) => PresenceStatus;
  onFriendsChanged: () => void;
  onCall: (userKey: string, displayName: string, avatar: string | null) => void;
}) {
  const [tab, setTab] = useState<'perfil' | 'amigos' | 'audio' | 'video' | 'recursos'>('perfil');
  const [versao, setVersao] = useState<string | null>(null);

  useEffect(() => {
    void window.concord.app.version().then(setVersao).catch(() => undefined);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6">
      <div className="panel flex h-[640px] w-full max-w-3xl overflow-hidden">
        <nav className="w-44 shrink-0 space-y-1 border-r border-void-700 bg-void-850 p-3">
          {(['perfil', 'amigos', 'audio', 'video', 'recursos'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-label={ROTULOS_ABA[t]}
              className={`w-full rounded px-3 py-2 text-left text-sm transition ${
                tab === t ? 'bg-violet-600/20 text-violet-200' : 'text-ink-300 hover:bg-void-700'
              }`}
            >
              {ROTULOS_ABA[t]}
            </button>
          ))}
          <button
            onClick={onClose}
            aria-label="Fechar configuracoes"
            className="mt-4 w-full rounded px-3 py-2 text-left text-sm text-ink-400 hover:text-ink-100"
          >
            Fechar
          </button>

          {versao && (
            <p className="px-3 pt-2 font-mono text-[10px] text-ink-400" title="Versao instalada">
              Concord v{versao}
            </p>
          )}
        </nav>

        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'perfil' && (
            <ProfilePanel profile={profile} status={status} onSaved={onProfileSaved} />
          )}
          {tab === 'amigos' && (
            <FriendsPanel
              servers={servers}
              presencaDe={presencaDe}
              onChanged={onFriendsChanged}
              onCall={(userKey, displayName, avatar) => {
                onClose();
                onCall(userKey, displayName, avatar);
              }}
            />
          )}
          {tab === 'audio' && <AudioSettingsPanel />}
          {tab === 'video' && <VideoPanel />}
          {tab === 'recursos' && <ResourcesPanel />}
        </div>
      </div>
    </div>
  );
}
