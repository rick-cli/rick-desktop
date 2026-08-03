import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

export function Overlay({ title, subtitle, onClose, children, maxWidth = 'max-w-lg' }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center overlay-scrim p-4 sm:p-6" onMouseDown={onClose}>
      <div className={`flex max-h-[88vh] w-full ${maxWidth} flex-col overflow-hidden rounded-xl border border-border bg-popover`} onMouseDown={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            <div id={titleId} className="text-sm font-medium text-foreground">{title}</div>
            {subtitle && <div className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</div>}
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} className="shrink-0 rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground" aria-label="Close"><X size={14} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
