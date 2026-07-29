import { useEffect, type ReactNode } from 'react';

/**
 * The app's dialog shell — used instead of window.prompt/confirm and native
 * <select> pickers so every prompt matches the rest of the UI. Closes on
 * Escape or a backdrop click.
 */
export default function Modal({
  title,
  subtitle,
  onClose,
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="iconbtn modal-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {subtitle && <p className="muted modal-sub">{subtitle}</p>}
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}
