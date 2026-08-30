import { ReactNode } from 'react';

export function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
  type = 'button',
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'ghost';
  type?: 'button' | 'submit';
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${variant === 'primary' ? 'btn-primary' : 'btn-ghost'} ${className}`}
    >
      {children}
    </button>
  );
}

export function Input({
  value,
  onChange,
  placeholder,
  type = 'text',
  autoFocus,
  onKeyDown,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <input
      className="field"
      type={type}
      value={value}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onKeyDown={onKeyDown}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
      {message}
    </p>
  );
}

export type PresenceStatus = 'ONLINE' | 'IDLE' | 'DND' | 'INVISIBLE' | 'OFFLINE';

const CORES_STATUS: Record<PresenceStatus, string> = {
  ONLINE: 'bg-status-online',
  IDLE: 'bg-status-idle',
  DND: 'bg-status-dnd',
  INVISIBLE: 'bg-status-offline',
  OFFLINE: 'bg-status-offline',
};

export const ROTULOS_STATUS: Record<PresenceStatus, string> = {
  ONLINE: 'Online',
  IDLE: 'Ausente',
  DND: 'Nao perturbe',
  INVISIBLE: 'Invisivel',
  OFFLINE: 'Offline',
};

/**
 * Avatar do usuario.
 *
 * Usa a foto quando existe; sem ela cai numa cor derivada da chave publica -
 * deterministica, entao a mesma pessoa aparece com a mesma cor em todas as
 * maquinas, sem precisar combinar nada.
 */
export function Avatar({
  name,
  userKey,
  size = 36,
  src,
  status,
}: {
  name: string;
  userKey: string;
  size?: number;
  src?: string | null;
  status?: PresenceStatus;
}) {
  const hue = parseInt(userKey.slice(0, 6) || '0', 16) % 360;
  const ponto = Math.max(8, Math.round(size * 0.3));

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {src ? (
        <img src={src} alt="" draggable={false} className="h-full w-full rounded-full object-cover" />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center rounded-full font-bold text-white"
          style={{
            fontSize: size * 0.4,
            background: `linear-gradient(135deg, hsl(${hue} 65% 45%), hsl(${(hue + 40) % 360} 70% 35%))`,
          }}
        >
          {(name || '?').slice(0, 1).toUpperCase()}
        </div>
      )}

      {status && (
        <span
          title={ROTULOS_STATUS[status]}
          className={`absolute bottom-0 right-0 rounded-full border-2 border-void-900 ${CORES_STATUS[status]}`}
          style={{ width: ponto, height: ponto }}
        />
      )}
    </div>
  );
}
