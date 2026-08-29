import { useQuery } from '@tanstack/react-query';
import { Activity, Database, Radio, ShieldCheck, TriangleAlert } from 'lucide-react';
import { fetchHealth } from '../services/health.service';

function ServiceRow({
  icon,
  label,
  healthy,
}: {
  icon: React.ReactNode;
  label: string;
  healthy: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-abyss-600 bg-abyss-700/60 px-4 py-3">
      <div className="flex items-center gap-3 text-ink-200">
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <span
        className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-wide ${
          healthy ? 'text-status-online' : 'text-status-dnd'
        }`}
      >
        <span
          className={`h-2 w-2 rounded-full ${healthy ? 'bg-status-online' : 'bg-status-dnd'}`}
        />
        {healthy ? 'operacional' : 'indisponivel'}
      </span>
    </div>
  );
}

export function StatusPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 10_000,
  });

  return (
    <main className="flex min-h-full items-center justify-center bg-abyss-900 p-6">
      <section className="w-full max-w-md space-y-6">
        <header className="space-y-1">
          <h1 className="bg-gradient-to-r from-plasma-400 to-ember-500 bg-clip-text text-4xl font-black tracking-tight text-transparent">
            Concord
          </h1>
          <p className="text-sm text-ink-300">Status da infraestrutura &mdash; Fase 1</p>
        </header>

        {isLoading && <p className="text-sm text-ink-300">Consultando a API&hellip;</p>}

        {isError && (
          <div className="flex items-start gap-3 rounded-lg border border-ember-600/50 bg-ember-600/10 p-4 text-sm text-ember-400">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              API inacessivel. Suba a stack com <code className="font-mono">docker compose up -d</code> e
              inicie a API com <code className="font-mono">npm run dev:api</code>.
            </p>
          </div>
        )}

        {data && (
          <div className="space-y-2">
            {/* A response at all proves the API is up; `status` only reflects
                whether its dependencies are reachable. */}
            <ServiceRow icon={<ShieldCheck className="h-4 w-4" />} label="API NestJS" healthy />
            <ServiceRow
              icon={<Database className="h-4 w-4" />}
              label="PostgreSQL"
              healthy={data.database}
            />
            <ServiceRow icon={<Radio className="h-4 w-4" />} label="Redis" healthy={data.redis} />
            <div className="flex items-center gap-2 pt-2 text-xs text-ink-300">
              <Activity className="h-3.5 w-3.5" />
              uptime {Math.floor(data.uptime)}s
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
