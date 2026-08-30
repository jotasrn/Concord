import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Copy, Trash2 } from 'lucide-react';
import { Avatar, Button, ErrorBanner, Input } from '../../components/ui';
import { prepareAvatar } from './avatarImage';
import type { Profile, SettableStatus } from '../../types/concord-api';

const BIO_MAX = 300;

/** Edicao do proprio perfil: foto, apelido e biografia. */
export function ProfilePanel({
  profile,
  status,
  onSaved,
}: {
  profile: Profile;
  status: SettableStatus;
  onSaved: (displayName: string) => void;
}) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputArquivo = useRef<HTMLInputElement>(null);

  // Carrega o que ja esta publicado, para editar em vez de sobrescrever.
  useEffect(() => {
    void window.concord.profile
      .get(profile.publicKey)
      .then((atual) => {
        if (atual) {
          setDisplayName(atual.displayName || profile.displayName);
          setBio(atual.bio ?? '');
          setAvatar(atual.avatar);
        }
      })
      .catch(() => undefined)
      .finally(() => setCarregado(true));
  }, [profile.publicKey, profile.displayName]);

  async function escolherImagem(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      setAvatar(await prepareAvatar(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nao foi possivel usar esta imagem');
    }
  }

  async function salvar() {
    setSalvando(true);
    setError(null);
    try {
      await window.concord.profile.update({ displayName, avatar, bio });
      onSaved(displayName);
      setSalvo(true);
      setTimeout(() => setSalvo(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nao foi possivel salvar');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold text-ink-100">Meu perfil</h2>
      <ErrorBanner message={error} />

      <div className="flex items-start gap-4">
        <div className="relative">
          <Avatar
            name={displayName}
            userKey={profile.publicKey}
            src={avatar}
            size={88}
            status={status}
          />
          <button
            onClick={() => inputArquivo.current?.click()}
            title="Trocar foto"
            className="absolute -bottom-1 -right-1 rounded-full bg-violet-600 p-1.5 text-white transition hover:bg-violet-500"
          >
            <Camera className="h-3.5 w-3.5" />
          </button>
          <input
            ref={inputArquivo}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void escolherImagem(e.target.files?.[0]);
              // Permite escolher o mesmo arquivo de novo apos remover.
              e.target.value = '';
            }}
          />
        </div>

        <div className="flex-1 space-y-2">
          <label className="text-xs uppercase tracking-wide text-ink-400">Apelido</label>
          <Input value={displayName} onChange={setDisplayName} placeholder="Como voce aparece" />
          <p className="text-[11px] text-ink-400">
            Seu identificador continua sendo{' '}
            <span className="font-mono text-violet-300">
              {displayName || 'nome'}#{profile.publicKey.slice(0, 4)}
            </span>{' '}
            &mdash; o final vem da sua chave e nunca muda.
          </p>
          {avatar && (
            <button
              onClick={() => setAvatar(null)}
              className="flex items-center gap-1 text-[11px] text-ink-400 transition hover:text-status-dnd"
            >
              <Trash2 className="h-3 w-3" /> Remover foto
            </button>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-baseline justify-between">
          <label className="text-xs uppercase tracking-wide text-ink-400">Biografia</label>
          <span
            className={`text-[10px] ${bio.length > BIO_MAX ? 'text-status-dnd' : 'text-ink-400'}`}
          >
            {bio.length}/{BIO_MAX}
          </span>
        </div>
        <textarea
          className="field h-24 resize-none"
          value={bio}
          maxLength={BIO_MAX}
          placeholder="Conte algo sobre voce"
          onChange={(e) => setBio(e.target.value)}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={salvar} disabled={salvando || !carregado || !displayName.trim()}>
          {salvando ? 'Salvando...' : 'Salvar perfil'}
        </Button>
        {salvo && (
          <span className="flex items-center gap-1 text-xs text-status-online">
            <Check className="h-3.5 w-3.5" /> Publicado
          </span>
        )}
      </div>

      <div className="space-y-1 border-t border-void-700 pt-4">
        <p className="text-xs uppercase tracking-wide text-ink-400">
          Sua chave publica &mdash; mande para quem for te adicionar
        </p>
        <div className="flex gap-2">
          <p className="selectable min-w-0 flex-1 break-all rounded-lg border border-void-600 bg-void-850 p-2 font-mono text-[11px] text-ink-200">
            {profile.publicKey}
          </p>
          <Button
            variant="ghost"
            onClick={() => void navigator.clipboard.writeText(profile.publicKey)}
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <p className="text-[11px] text-ink-400">
        O perfil e publicado nos servidores em que voce participa, entao so quem compartilha um
        servidor com voce consegue ve-lo.
      </p>
    </div>
  );
}
