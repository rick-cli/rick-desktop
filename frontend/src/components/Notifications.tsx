import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleAlert, Info, X } from 'lucide-react';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
}

export interface PromptOptions {
  title: string;
  message?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface ToastOptions {
  title: string;
  message?: string;
  tone?: 'success' | 'error' | 'info';
}

type DialogState =
  | { kind: 'confirm'; resolve: (value: boolean) => void; options: ConfirmOptions }
  | { kind: 'prompt'; resolve: (value: string | null) => void; options: PromptOptions }
  | { kind: 'alert'; resolve: (value: void) => void; title: string; message?: string };

interface ToastState extends Required<Pick<ToastOptions, 'title' | 'tone'>> {
  id: number;
  message?: string;
}

interface NotificationsApi {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
  alert: (title: string, message?: string) => Promise<void>;
  toast: (options: ToastOptions) => void;
}

const NotificationsContext = createContext<NotificationsApi | null>(null);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const [promptValue, setPromptValue] = useState('');
  const toastCounter = useRef(0);

  const dismissToast = useCallback((id: number) => {
    setToasts(current => current.filter(toast => toast.id !== id));
  }, []);

  const toast = useCallback((options: ToastOptions) => {
    toastCounter.current += 1;
    const id = toastCounter.current;
    setToasts(current => [...current, { id, title: options.title, message: options.message, tone: options.tone || 'info' }]);
    window.setTimeout(() => dismissToast(id), 4200);
  }, [dismissToast]);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>(resolve => {
    setDialog({ kind: 'confirm', resolve, options });
  }), []);

  const prompt = useCallback((options: PromptOptions) => new Promise<string | null>(resolve => {
    setPromptValue(options.initialValue || '');
    setDialog({ kind: 'prompt', resolve, options });
  }), []);

  const alert = useCallback((title: string, message?: string) => new Promise<void>(resolve => {
    setDialog({ kind: 'alert', resolve, title, message });
  }), []);

  const closeDialog = (value: boolean | string | null | void) => {
    if (!dialog) return;
    dialog.resolve(value as never);
    setDialog(null);
  };

  const dismissDialog = () => {
    if (!dialog) return;
    if (dialog.kind === 'confirm') closeDialog(false);
    else if (dialog.kind === 'prompt') closeDialog(null);
    else closeDialog();
  };

  const api: NotificationsApi = { confirm, prompt, alert, toast };

  return (
    <NotificationsContext.Provider value={api}>
      {children}
      {toasts.length > 0 && (
        <div className="pointer-events-none fixed bottom-24 left-1/2 z-[100] flex w-[360px] max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-center gap-2">
          {toasts.map(item => <ToastCard key={item.id} toast={item} onClose={() => dismissToast(item.id)} />)}
        </div>
      )}
      {dialog && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center overlay-scrim p-6" onMouseDown={dismissDialog}>
          <div className="w-full max-w-sm rounded-xl border border-border bg-popover p-5" onMouseDown={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') dismissDialog(); }} role="dialog" aria-modal="true" aria-label={dialog.kind === 'alert' ? dialog.title : dialog.options.title}>
            {dialog.kind === 'confirm' && <ConfirmBody dialog={dialog} onClose={closeDialog} />}
            {dialog.kind === 'prompt' && <PromptBody dialog={dialog} value={promptValue} onChange={setPromptValue} onClose={closeDialog} />}
            {dialog.kind === 'alert' && <AlertBody dialog={dialog} onClose={closeDialog} />}
          </div>
        </div>
      )}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsApi {
  const api = useContext(NotificationsContext);
  if (!api) throw new Error('useNotifications must be used within NotificationsProvider');
  return api;
}

function ToastCard({ toast, onClose }: { toast: ToastState; onClose: () => void }) {
  const tone = toast.tone === 'info' ? 'text-primary' : 'text-foreground';
  const Icon = toast.tone === 'success' ? CheckCircle2 : toast.tone === 'error' ? CircleAlert : Info;
  return (
    <div className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-border bg-popover p-3" role={toast.tone === 'error' ? 'alert' : 'status'}>
      <Icon size={15} className={`mt-0.5 shrink-0 ${tone}`} />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-foreground">{toast.title}</div>
        {toast.message && <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{toast.message}</div>}
      </div>
      <button type="button" onClick={onClose} className="shrink-0 rounded p-0.5 text-muted-foreground transition hover:bg-surface-2 hover:text-foreground" aria-label="Dismiss notification"><X size={12} /></button>
    </div>
  );
}

function DialogHeader({ icon, tone, title }: { icon: React.ReactNode; tone: string; title: string }) {
  return <div className="flex items-center gap-2.5"><span className={`flex h-8 w-8 items-center justify-center rounded-lg border ${tone}`}>{icon}</span><div className="min-w-0"><div className="text-sm font-medium text-foreground">{title}</div></div></div>;
}

function ConfirmBody({ dialog, onClose }: { dialog: Extract<DialogState, { kind: 'confirm' }>; onClose: (value: boolean) => void }) {
  const { options } = dialog;
  const danger = options.tone === 'danger';
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <DialogHeader icon={<AlertTriangle size={15} className={danger ? 'text-foreground' : 'text-primary'} />} tone={danger ? 'border-border bg-muted' : 'border-primary/25 bg-primary/10'} title={options.title} />
      {options.message && <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">{options.message}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button autoFocus type="button" disabled={busy} onClick={() => onClose(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground transition hover:bg-accent disabled:opacity-40">{options.cancelLabel || 'Cancel'}</button>
        <button type="button" disabled={busy} onClick={() => { setBusy(true); onClose(true); }} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/85 disabled:opacity-40">{options.confirmLabel || 'Confirm'}</button>
      </div>
    </div>
  );
}

function PromptBody({ dialog, value, onChange, onClose }: { dialog: Extract<DialogState, { kind: 'prompt' }>; value: string; onChange: (value: string) => void; onClose: (value: string | null) => void }) {
  const { options } = dialog;
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
  const submit = () => { if (value.trim()) onClose(value.trim()); };
  return (
    <div>
      <DialogHeader icon={<AlertTriangle size={15} className="text-primary" />} tone="border-primary/25 bg-primary/10" title={options.title} />
      {options.message && <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">{options.message}</p>}
      <input ref={inputRef} type="text" value={value} onChange={event => onChange(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') submit(); if (event.key === 'Escape') onClose(null); }} placeholder={options.placeholder} className="mt-3 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary" />
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={() => onClose(null)} className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground transition hover:bg-accent">{options.cancelLabel || 'Cancel'}</button>
        <button type="button" disabled={!value.trim()} onClick={submit} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/85 disabled:opacity-40">{options.confirmLabel || 'Save'}</button>
      </div>
    </div>
  );
}

function AlertBody({ dialog, onClose }: { dialog: Extract<DialogState, { kind: 'alert' }>; onClose: (value: null) => void }) {
  return (
    <div>
      <DialogHeader icon={<CircleAlert size={15} className="text-muted-foreground" />} tone="border-border bg-muted" title={dialog.title} />
      {dialog.message && <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">{dialog.message}</p>}
      <div className="mt-5 flex justify-end">
        <button autoFocus type="button" onClick={() => onClose(null)} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:bg-primary/85">OK</button>
      </div>
    </div>
  );
}
