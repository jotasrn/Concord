import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

type ButtonVariant = 'primary' | 'ghost' | 'secondary' | 'danger';

const CLASSES_BOTAO: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  ghost: 'btn-ghost',
  secondary: 'btn-secondary',
  danger: 'btn-danger',
};

export function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
  type = 'button',
  className = '',
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: ButtonVariant;
  type?: 'button' | 'submit';
  className?: string;
  title?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${CLASSES_BOTAO[variant]} ${className}`}
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
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  className?: string;
}) {
  return (
    <input
      className={`field ${className}`}
      type={type}
      value={value}
      placeholder={placeholder}
      autoFocus={autoFocus}
      onKeyDown={onKeyDown}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss?: () => void;
}) {
  if (!message) return null;
  return (
    <p className="flex items-start gap-2 rounded-md border border-status-dnd/40 bg-status-dnd/10 px-3 py-2 text-sm text-red-300">
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Fechar aviso"
          className="shrink-0 rounded p-0.5 text-red-300/70 transition hover:text-red-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </p>
  );
}

export function InfoBanner({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss?: () => void;
}) {
  if (!message) return null;
  return (
    <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Fechar aviso"
          className="shrink-0 rounded p-0.5 text-amber-300/70 transition hover:text-amber-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </p>
  );
}

export type PresenceStatus = 'ONLINE' | 'IDLE' | 'DND' | 'INVISIBLE' | 'OFFLINE';

export const CORES_STATUS: Record<PresenceStatus, string> = {
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
 *
 * `statusBorder` e a cor do fundo atras do avatar: o ponto de status "recorta"
 * o avatar com essa cor, como no Discord.
 */
export function Avatar({
  name,
  userKey,
  size = 36,
  src,
  status,
  speaking,
  statusBorder = 'border-void-900',
}: {
  name: string;
  userKey: string;
  size?: number;
  src?: string | null;
  status?: PresenceStatus;
  speaking?: boolean;
  statusBorder?: string;
}) {
  const hue = parseInt(userKey.slice(0, 6) || '0', 16) % 360;
  const ponto = Math.max(10, Math.round(size * 0.34));

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {src ? (
        <img
          src={src}
          alt=""
          draggable={false}
          className={`h-full w-full rounded-full object-cover transition-shadow ${
            speaking ? 'ring-2 ring-status-online ring-offset-2 ring-offset-void-900' : ''
          }`}
        />
      ) : (
        <div
          className={`flex h-full w-full items-center justify-center rounded-full font-bold text-white transition-shadow ${
            speaking ? 'ring-2 ring-status-online ring-offset-2 ring-offset-void-900' : ''
          }`}
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
          className={`absolute -bottom-0.5 -right-0.5 rounded-full border-[3px] ${statusBorder} ${CORES_STATUS[status]}`}
          style={{ width: ponto, height: ponto }}
        />
      )}
    </div>
  );
}

/**
 * Dica flutuante.
 *
 * Renderizada num portal com posicao fixa: as barras laterais tem rolagem
 * propria (overflow), que cortaria uma dica posicionada de forma absoluta.
 */
export function Tooltip({
  label,
  side = 'top',
  children,
  className = '',
}: {
  label: ReactNode;
  side?: 'top' | 'right' | 'bottom';
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const mostrar = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    if (side === 'right') setPos({ x: r.right + 12, y: r.top + r.height / 2 });
    else if (side === 'bottom') setPos({ x: r.left + r.width / 2, y: r.bottom + 8 });
    else setPos({ x: r.left + r.width / 2, y: r.top - 8 });
  };

  const transform =
    side === 'right'
      ? 'translateY(-50%)'
      : side === 'bottom'
        ? 'translateX(-50%)'
        : 'translate(-50%, -100%)';

  return (
    <div
      ref={ref}
      className={className}
      onMouseEnter={mostrar}
      onMouseLeave={() => setPos(null)}
      onMouseDown={() => setPos(null)}
    >
      {children}
      {pos &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-100 max-w-xs animate-fade-in rounded-md bg-void-950 px-3 py-1.5 text-sm font-semibold text-ink-100 shadow-pop"
            style={{ left: pos.x, top: pos.y, transform }}
          >
            {label}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Botao so de icone, com dica. */
export function IconButton({
  label,
  onClick,
  children,
  active,
  danger,
  disabled,
  side = 'top',
  className = '',
}: {
  label: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  side?: 'top' | 'right' | 'bottom';
  className?: string;
}) {
  return (
    <Tooltip label={label} side={side}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={`flex h-8 w-8 items-center justify-center rounded-md transition disabled:cursor-not-allowed disabled:opacity-35 ${
          danger
            ? 'text-status-dnd hover:bg-status-dnd/15'
            : active
              ? 'bg-void-600 text-ink-100'
              : 'text-ink-300 hover:bg-void-600 hover:text-ink-100'
        } ${className}`}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/**
 * Menu flutuante ancorado num ponto da tela. Fecha ao clicar fora ou com Esc,
 * e se reposiciona para nao sair da janela.
 */
export function Popover({
  anchor,
  onClose,
  children,
  className = '',
  align = 'start',
}: {
  anchor: { x: number; y: number };
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** start: o menu cresce para a direita/baixo; end: para cima. */
  align?: 'start' | 'above';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(anchor);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let x = anchor.x;
    let y = align === 'above' ? anchor.y - r.height : anchor.y;
    x = Math.min(x, window.innerWidth - r.width - 8);
    y = Math.max(8, Math.min(y, window.innerHeight - r.height - 8));
    setPos({ x: Math.max(8, x), y });
  }, [anchor, align]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className={`menu fixed z-80 animate-pop-in ${className}`}
      style={{ left: pos.x, top: pos.y }}
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * Janela modal no estilo do app: titulo, corpo e rodape com acoes.
 * Fecha com Esc e com clique fora.
 */
export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  width = 'max-w-md',
  zIndex = 'z-60',
}: {
  title?: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
  zIndex?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className={`fixed inset-0 ${zIndex} flex animate-fade-in items-center justify-center bg-black/75 p-6`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`relative w-full ${width} animate-pop-in overflow-hidden rounded-xl bg-void-800 shadow-pop`}
      >
        <button
          onClick={onClose}
          aria-label="Fechar"
          className="absolute right-3 top-3 rounded-md p-1 text-ink-400 transition hover:bg-void-700 hover:text-ink-100"
        >
          <X className="h-5 w-5" />
        </button>
        {(title || description) && (
          <header className="space-y-2 px-6 pb-2 pt-6 text-center">
            {title && <h3 className="text-xl font-bold text-ink-100">{title}</h3>}
            {description && <p className="text-sm text-ink-300">{description}</p>}
          </header>
        )}
        <div className="max-h-[70vh] overflow-y-auto px-6 py-4">{children}</div>
        {footer && (
          <footer className="flex justify-end gap-2 bg-void-900 px-6 py-4">{footer}</footer>
        )}
      </div>
    </div>
  );
}
