import { useEffect, useState } from 'react';
import { AlertTriangle, Cpu, HardDrive, MemoryStick, Power } from 'lucide-react';
import { Button, ErrorBanner } from '../../components/ui';

interface Recursos {
  maxHeapMb: number | null;
  maxCores: number | null;
  maxStorageMb: number | null;
  runInBackground: boolean;
  startWithSystem: boolean;
}

interface Uso {
  operations: number;
  messages: number;
  avatarBytes: number;
  diskBytes: number;
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Opcoes de heap derivadas da RAM da maquina, sempre com um piso utilizavel. */
function opcoesMemoria(totalMb: number): number[] {
  return [256, 512, 1024, 2048, 4096].filter((v) => v <= Math.max(1024, totalMb / 2));
}

export function ResourcesPanel() {
  const [recursos, setRecursos] = useState<Recursos | null>(null);
  const [maquina, setMaquina] = useState<{ cores: number; totalMemoryMb: number } | null>(null);
  const [uso, setUso] = useState<Uso | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [podando, setPodando] = useState(false);

  useEffect(() => {
    void window.concord.settings
      .get()
      .then((r) => {
        setRecursos(r.settings.resources);
        setMaquina(r.machine);
      })
      .catch((e) => setError(String(e)));
    void window.concord.settings.usage().then(setUso).catch(() => undefined);
  }, []);

  async function alterar(patch: Partial<Recursos>) {
    if (!recursos) return;
    const novo = { ...recursos, ...patch };
    setRecursos(novo);
    setError(null);
    try {
      const atual = await window.concord.settings.get();
      await window.concord.settings.save({ ...atual.settings, resources: novo });
      setSalvo(true);
      setTimeout(() => setSalvo(false), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nao foi possivel salvar');
    }
  }

  async function podar(dias: number) {
    setPodando(true);
    setError(null);
    try {
      const { removed } = await window.concord.settings.prune(dias);
      setUso(await window.concord.settings.usage());
      setError(removed === 0 ? 'Nada para remover nesse periodo.' : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nao foi possivel limpar');
    } finally {
      setPodando(false);
    }
  }

  if (!recursos || !maquina) {
    return <p className="text-sm text-ink-400">Carregando&hellip;</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-baseline gap-2">
        <h2 className="text-lg font-bold text-ink-100">Recursos</h2>
        {salvo && <span className="text-xs text-status-online">salvo</span>}
      </div>
      <ErrorBanner message={error} />

      <p className="text-[11px] text-ink-400">
        Sua maquina: {maquina.cores} nucleos &bull;{' '}
        {(maquina.totalMemoryMb / 1024).toFixed(1)} GB de RAM
      </p>

      {/* Memoria */}
      <section className="space-y-2">
        <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-ink-400">
          <MemoryStick className="h-3.5 w-3.5" /> Memoria
        </label>
        <select
          className="field"
          value={recursos.maxHeapMb ?? ''}
          onChange={(e) => alterar({ maxHeapMb: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Sem limite (padrao do sistema)</option>
          {opcoesMemoria(maquina.totalMemoryMb).map((v) => (
            <option key={v} value={v}>
              {v >= 1024 ? `${v / 1024} GB` : `${v} MB`}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-ink-400">
          Limita o heap de JavaScript, que e onde o historico vive. Buffers de video e o proprio
          Chromium ficam fora dessa conta, entao o consumo total do app sera maior que o valor
          escolhido. <span className="text-ink-300">Vale a partir da proxima abertura.</span>
        </p>
      </section>

      {/* Nucleos */}
      <section className="space-y-2">
        <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-ink-400">
          <Cpu className="h-3.5 w-3.5" /> Nucleos de processamento
        </label>
        <select
          className="field"
          value={recursos.maxCores ?? ''}
          onChange={(e) => alterar({ maxCores: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">Todos ({maquina.cores})</option>
          {Array.from({ length: maquina.cores }, (_, i) => i + 1)
            .filter((n) => n >= 2)
            .map((n) => (
              <option key={n} value={n}>
                {n} nucleos
              </option>
            ))}
        </select>
        {recursos.maxCores !== null && recursos.maxCores <= 3 && (
          <p className="flex items-start gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-[11px] text-yellow-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Poucos nucleos podem travar a codificacao de video ao compartilhar tela em 60fps.
          </p>
        )}
        <p className="text-[11px] text-ink-400">Aplicado na hora, sem reiniciar.</p>
      </section>

      {/* Armazenamento */}
      <section className="space-y-2">
        <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-ink-400">
          <HardDrive className="h-3.5 w-3.5" /> Armazenamento
        </label>

        {uso && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-void-600 bg-void-850 p-3 text-[11px]">
            <span className="text-ink-400">Em disco</span>
            <span className="text-right font-mono text-ink-200">{mb(uso.diskBytes)}</span>
            <span className="text-ink-400">Mensagens</span>
            <span className="text-right font-mono text-ink-200">{uso.messages}</span>
            <span className="text-ink-400">Operacoes no log</span>
            <span className="text-right font-mono text-ink-200">{uso.operations}</span>
            <span className="text-ink-400">Fotos de perfil</span>
            <span className="text-right font-mono text-ink-200">{mb(uso.avatarBytes)}</span>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {[30, 90, 180].map((dias) => (
            <Button key={dias} variant="ghost" disabled={podando} onClick={() => podar(dias)}>
              Limpar anteriores a {dias} dias
            </Button>
          ))}
        </div>
        <p className="text-[11px] text-ink-400">
          Remove mensagens antigas deste dispositivo. Canais, membros e permissoes ficam intactos.
          O que for removido aqui nao volta pela sincronizacao, mas continua com quem ainda tiver a
          copia.
        </p>
      </section>

      {/* Segundo plano */}
      <section className="space-y-2 border-t border-void-700 pt-4">
        <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-ink-400">
          <Power className="h-3.5 w-3.5" /> Segundo plano
        </label>

        <label className="flex items-center gap-2 text-sm text-ink-200">
          <input
            type="checkbox"
            className="accent-violet-500"
            checked={recursos.runInBackground}
            onChange={(e) => alterar({ runInBackground: e.target.checked })}
          />
          Continuar rodando ao fechar a janela
        </label>
        <p className="text-[11px] text-ink-400">
          O app fica na bandeja, mantendo a sincronizacao e as chamadas. Para encerrar de vez, use
          o menu do icone na bandeja.
        </p>

        <label className="flex items-center gap-2 text-sm text-ink-200">
          <input
            type="checkbox"
            className="accent-violet-500"
            checked={recursos.startWithSystem}
            onChange={(e) => alterar({ startWithSystem: e.target.checked })}
          />
          Iniciar junto com o Windows
        </label>
      </section>
    </div>
  );
}
