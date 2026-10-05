import { useEffect, useState } from 'react';
import { AlertTriangle, Copy, KeyRound, ShieldCheck } from 'lucide-react';
import { Button, ErrorBanner, Input } from '../components/ui';
import type { Profile } from '../types/concord-api';

type Mode = 'loading' | 'unlock' | 'create' | 'phrase' | 'confirm' | 'restore';

export function OnboardingPage({ onReady }: { onReady: (profile: Profile) => void }) {
  const [mode, setMode] = useState<Mode>('loading');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [phrase, setPhrase] = useState('');
  const [typedPhrase, setTypedPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** A frase digitada e de uma conta diferente da que ja esta neste dispositivo. */
  const [precisaConfirmarTroca, setPrecisaConfirmarTroca] = useState(false);

  useEffect(() => {
    void window.concord.account.status().then((s) => {
      setMode(s.hasAccount ? 'unlock' : 'create');
      if (s.displayName) setDisplayName(s.displayName);
    });
  }, []);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro inesperado');
    } finally {
      setBusy(false);
    }
  }

  const unlock = () =>
    run(async () => {
      const profile = await window.concord.account.unlock(password);
      onReady(profile);
    });

  const startCreate = () =>
    run(async () => {
      if (!displayName.trim()) throw new Error('Escolha um nome de exibicao');
      if (password.length < 8) throw new Error('A senha precisa ter ao menos 8 caracteres');
      setPhrase(await window.concord.account.newPhrase());
      setMode('phrase');
    });

  const confirmPhrase = () =>
    run(async () => {
      if (typedPhrase.trim().toLowerCase() !== phrase.toLowerCase()) {
        throw new Error('A frase digitada nao confere com a que foi mostrada');
      }
      await window.concord.account.create(displayName, password, phrase);
      const profile = await window.concord.account.unlock(password);
      onReady(profile);
    });

  const restore = (confirmOverwrite = false) =>
    run(async () => {
      try {
        await window.concord.account.restore(displayName, password, typedPhrase, confirmOverwrite);
      } catch (e) {
        /*
         * CONTA_DIFERENTE: ja existe uma conta neste dispositivo e a frase
         * digitada e de uma identidade DIFERENTE dela. Restaurar sobrescreve
         * o keystore e torna o banco atual ilegivel para sempre (a chave do
         * banco deriva da semente da frase antiga, que deixa de existir) -
         * isso merece uma confirmacao explicita antes de acontecer, nao um
         * erro generico.
         */
        if (e instanceof Error && e.message.includes('CONTA_DIFERENTE')) {
          setPrecisaConfirmarTroca(true);
          return;
        }
        throw e;
      }
      setPrecisaConfirmarTroca(false);
      const profile = await window.concord.account.unlock(password);
      onReady(profile);
    });

  return (
    <main className="flex min-h-full items-center justify-center bg-void-950 p-6">
      <section className="w-full max-w-md space-y-6">
        <header className="space-y-1 text-center">
          <h1 className="text-4xl font-black tracking-tight">
            <span className="text-ink-100">Con</span>
            <span className="text-violet-400">cord</span>
          </h1>
          <p className="text-sm text-ink-300">Comunicacao P2P. Seus dados ficam com voces.</p>
        </header>

        <div className="panel space-y-4 p-6">
          <ErrorBanner message={error} />

          {mode === 'loading' && <p className="text-sm text-ink-300">Carregando&hellip;</p>}

          {mode === 'unlock' && (
            <>
              <div className="flex items-center gap-2 text-sm text-ink-200">
                <KeyRound className="h-4 w-4 text-violet-400" />
                Desbloquear conta de <strong className="text-ink-100">{displayName}</strong>
              </div>
              <Input
                type="password"
                value={password}
                onChange={setPassword}
                placeholder="Sua senha"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && void unlock()}
              />
              <Button onClick={unlock} disabled={busy} className="w-full">
                {busy ? 'Abrindo...' : 'Entrar'}
              </Button>
              <button
                className="w-full text-xs text-ink-400 hover:text-violet-400"
                onClick={() => {
                  setMode('restore');
                  setError(null);
                }}
              >
                Esqueci a senha &mdash; restaurar com a frase de recuperacao
              </button>
            </>
          )}

          {mode === 'create' && (
            <>
              <p className="text-sm text-ink-200">Criar conta neste dispositivo</p>
              <Input
                value={displayName}
                onChange={setDisplayName}
                placeholder="Nome de exibicao"
                autoFocus
              />
              <Input
                type="password"
                value={password}
                onChange={setPassword}
                placeholder="Senha (minimo 8 caracteres)"
              />
              <p className="text-xs text-ink-400">
                A senha protege sua chave neste computador. Ela nao e enviada a lugar nenhum.
              </p>
              <Button onClick={startCreate} disabled={busy} className="w-full">
                Continuar
              </Button>
              <button
                className="w-full text-xs text-ink-400 hover:text-violet-400"
                onClick={() => {
                  setMode('restore');
                  setError(null);
                }}
              >
                Ja tenho uma conta &mdash; restaurar com a frase
              </button>
            </>
          )}

          {mode === 'phrase' && (
            <>
              <div className="flex items-start gap-2 rounded-lg border border-violet-500/40 bg-violet-500/10 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-violet-300" />
                <p className="text-xs text-violet-200">
                  Estas 12 palavras <strong>sao</strong> a sua conta. Nao existe servidor para
                  recuperar sua senha. Se voce perder a senha e esta frase, a conta se perde para
                  sempre. Anote em papel e guarde fora do computador.
                </p>
              </div>
              <div className="selectable grid grid-cols-3 gap-2 rounded-lg border border-void-600 bg-void-850 p-3">
                {phrase.split(' ').map((word, i) => (
                  <div key={i} className="text-xs">
                    <span className="mr-1 text-ink-400">{i + 1}.</span>
                    <span className="font-mono text-ink-100">{word}</span>
                  </div>
                ))}
              </div>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => void navigator.clipboard.writeText(phrase)}
              >
                <span className="flex items-center justify-center gap-2">
                  <Copy className="h-3.5 w-3.5" /> Copiar frase
                </span>
              </Button>
              <Button onClick={() => setMode('confirm')} className="w-full">
                Ja anotei
              </Button>
            </>
          )}

          {mode === 'confirm' && (
            <>
              <p className="text-sm text-ink-200">Digite a frase para confirmar que anotou</p>
              <textarea
                className="field h-24 resize-none font-mono"
                value={typedPhrase}
                autoFocus
                placeholder="as 12 palavras, separadas por espaco"
                onChange={(e) => setTypedPhrase(e.target.value)}
              />
              <Button onClick={confirmPhrase} disabled={busy} className="w-full">
                {busy ? 'Criando conta...' : 'Criar conta'}
              </Button>
              <button
                className="w-full text-xs text-ink-400 hover:text-violet-400"
                onClick={() => setMode('phrase')}
              >
                Ver a frase de novo
              </button>
            </>
          )}

          {mode === 'restore' && (
            <>
              <div className="flex items-center gap-2 text-sm text-ink-200">
                <ShieldCheck className="h-4 w-4 text-violet-400" />
                Restaurar conta com a frase
              </div>
              <Input value={displayName} onChange={setDisplayName} placeholder="Nome de exibicao" />
              <textarea
                className="field h-24 resize-none font-mono"
                value={typedPhrase}
                placeholder="as 12 palavras da sua frase de recuperacao"
                onChange={(e) => setTypedPhrase(e.target.value)}
              />
              <Input
                type="password"
                value={password}
                onChange={setPassword}
                placeholder="Nova senha para este dispositivo"
              />

              {precisaConfirmarTroca ? (
                <div className="space-y-2 rounded-lg border border-status-dnd/40 bg-status-dnd/10 p-3">
                  <p className="flex items-start gap-2 text-xs text-status-dnd">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Essa frase e de uma conta DIFERENTE da que ja esta neste dispositivo. Continuar
                    substitui a conta atual, e as mensagens dela ficam ilegiveis para sempre - a
                    chave que as protege muda junto com a identidade.
                  </p>
                  <div className="flex gap-2">
                    <Button onClick={() => restore(true)} disabled={busy} className="flex-1">
                      {busy ? 'Substituindo...' : 'Substituir mesmo assim'}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setPrecisaConfirmarTroca(false)}
                      className="flex-1"
                    >
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <Button onClick={() => restore()} disabled={busy} className="w-full">
                  {busy ? 'Restaurando...' : 'Restaurar'}
                </Button>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
