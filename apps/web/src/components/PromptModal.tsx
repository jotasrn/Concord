import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, Modal } from './ui';

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
  const [copiado, setCopiado] = useState<string | null>(null);

  useEffect(() => {
    setValues(Object.fromEntries(request.fields.map((f) => [f.name, f.defaultValue ?? ''])));
  }, [request]);

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
    <Modal
      title={request.title}
      description={request.description}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!podeEnviar || busy}>
            {busy ? 'Aguarde...' : (request.confirmLabel ?? 'Confirmar')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {request.fields.map((field, index) => (
          <div key={field.name} className="space-y-2">
            <label htmlFor={`prompt-${field.name}`} className="label-caps">
              {field.label}
            </label>
            {field.multiline ? (
              <div className="relative">
                <textarea
                  id={`prompt-${field.name}`}
                  className="field h-24 resize-none pr-10 font-mono text-xs"
                  autoFocus={index === 0}
                  placeholder={field.placeholder}
                  value={values[field.name] ?? ''}
                  onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
                />
                {field.defaultValue && (
                  <button
                    type="button"
                    title="Copiar"
                    aria-label="Copiar"
                    onClick={() => {
                      void navigator.clipboard.writeText(values[field.name] ?? '');
                      setCopiado(field.name);
                      setTimeout(() => setCopiado(null), 1500);
                    }}
                    className="absolute right-2 top-2 rounded-md bg-void-700 p-1.5 text-ink-300 transition hover:bg-violet-600 hover:text-white"
                  >
                    {copiado === field.name ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                )}
              </div>
            ) : (
              <input
                id={`prompt-${field.name}`}
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
      </div>
    </Modal>
  );
}
