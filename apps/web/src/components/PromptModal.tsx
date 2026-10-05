import { useEffect, useState } from 'react';
import { Button } from './ui';

export interface PromptField {
  name: string;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  /** Valor inicial do campo. */
  defaultValue?: string;
}

export interface PromptRequest {
  title: string;
  description?: string;
  fields: PromptField[];
  confirmLabel?: string;
  onSubmit: (values: Record<string, string>) => void | Promise<void>;
}

/**
 * Substitui window.prompt(), que o Electron nao implementa - usa-lo deixava os
 * botoes de criar servidor e canal sem efeito no app empacotado.
 */
export function PromptModal({ request, onClose }: { request: PromptRequest; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValues(Object.fromEntries(request.fields.map((f) => [f.name, f.defaultValue ?? ''])));
  }, [request]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const primeiro = request.fields[0];
  const podeEnviar = primeiro ? Boolean(values[primeiro.name]?.trim()) : true;

  async function submit() {
    if (!podeEnviar || busy) return;
    setBusy(true);
    try {
      await request.onSubmit(values);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 p-6"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="panel w-full max-w-sm space-y-4 p-5">
        <div className="space-y-1">
          <h3 className="text-base font-bold text-ink-100">{request.title}</h3>
          {request.description && <p className="text-xs text-ink-400">{request.description}</p>}
        </div>

        {request.fields.map((field, index) => (
          <div key={field.name} className="space-y-1">
            <label className="text-xs uppercase tracking-wide text-ink-400">{field.label}</label>
            {field.multiline ? (
              <textarea
                className="field h-20 resize-none font-mono text-xs"
                autoFocus={index === 0}
                placeholder={field.placeholder}
                value={values[field.name] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
              />
            ) : (
              <input
                className="field"
                autoFocus={index === 0}
                placeholder={field.placeholder}
                value={values[field.name] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
              />
            )}
          </div>
        ))}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!podeEnviar || busy}>
            {busy ? 'Aguarde...' : (request.confirmLabel ?? 'Confirmar')}
          </Button>
        </div>
      </div>
    </div>
  );
}
