import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { AuthProvider } from '../lib/types';
import { addProviderKeys, getAuthStatus, removeProvider, removeProviderKey, saveProvider, updateProvider } from '../lib/wails';
import { useNotifications } from './Notifications';
import { Overlay } from './Overlay';

const inputClass = 'w-full rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary';
const actionButton = 'rounded-lg border border-border px-2.5 py-1.5 text-[10px] text-foreground transition hover:bg-accent disabled:opacity-40';
const primaryButton = 'rounded-lg bg-primary px-2.5 py-1.5 text-[10px] font-medium text-primary-foreground transition hover:bg-primary/85 disabled:opacity-40';
const dangerButton = 'rounded-lg border border-border px-2.5 py-1.5 text-[10px] text-foreground transition hover:bg-muted disabled:opacity-40';

function StatusBadge({ provider }: { provider: AuthProvider }) {
  if (provider.disabled) return <span className="rounded-full border border-border px-2 py-0.5 text-[9px] text-muted-foreground">disabled</span>;
  if (provider.connected) return <span className="rounded-full border border-border px-2 py-0.5 text-[9px] text-foreground">{provider.env_only ? 'env' : 'connected'}</span>;
  return <span className="rounded-full border border-border px-2 py-0.5 text-[9px] text-muted-foreground">{provider.auth === 'oauth_device_code' ? 'oauth' : 'not configured'}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[10px] text-muted-foreground">{label}</span>{children}</label>;
}

function ProviderForm({ provider, busy, onSave, onCancel }: {
  provider: AuthProvider | null;
  busy: boolean;
  onSave: (apiKey: string, baseURL: string, label: string, id: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState(provider?.base_url || '');
  const [label, setLabel] = useState(provider?.label || '');
  const [customId, setCustomId] = useState('');
  const isNew = !provider;
  const oauth = provider?.auth === 'oauth_device_code';
  return <div className="space-y-3">
    {oauth && <p className="text-[11px] leading-relaxed text-muted-foreground">This provider uses a browser sign-in flow. Configure it in the Rick terminal with <span className="font-mono text-foreground">/auth</span>, or add an API key below if you have one.</p>}
    {isNew && <Field label="Provider id (used in model ids, e.g. acme-corp)">
      <input type="text" value={customId} onChange={event => setCustomId(event.target.value)} placeholder="my-provider" className={inputClass} />
    </Field>}
    <Field label={`API key ${oauth ? '(optional)' : ''}`}>
      <input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={isNew ? 'Paste API key' : 'Leave blank to keep the stored key'} className={inputClass} />
    </Field>
    <Field label="Base URL">
      <input type="text" value={baseURL} onChange={event => setBaseURL(event.target.value)} placeholder="https://api.example.com/v1" className={inputClass} />
    </Field>
    {(!provider || provider.custom) && <Field label="Display name">
      <input type="text" value={label} onChange={event => setLabel(event.target.value)} placeholder={provider?.label || 'My provider'} className={inputClass} />
    </Field>}
    <div className="flex justify-end gap-2 pt-1">
      <button type="button" onClick={onCancel} className={actionButton}>Cancel</button>
      <button type="button" disabled={busy || (!isNew && !apiKey.trim() && !baseURL.trim()) || (isNew && !customId.trim())} onClick={() => onSave(apiKey.trim(), baseURL.trim(), label.trim(), customId.trim())} className={primaryButton}>{busy ? 'Saving…' : 'Save'}</button>
    </div>
  </div>;
}

function KeysPanel({ provider, busy, setBusy, setStatus }: {
  provider: AuthProvider;
  busy: boolean;
  setBusy: (value: boolean) => void;
  setStatus: (value: string) => void;
}) {
  const [row, setRow] = useState<AuthProvider>(provider);
  const [newKeys, setNewKeys] = useState('');
  const [editingKey, setEditingKey] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const { confirm, toast } = useNotifications();

  const refresh = useCallback(async () => {
    const list = await getAuthStatus().catch(() => []);
    const found = list.find(entry => entry.id === provider.id);
    if (found) setRow(found);
  }, [provider.id]);
  useEffect(() => { refresh(); }, [refresh]);

  const run = async (action: () => Promise<AuthProvider[]>, message: string) => {
    setBusy(true);
    try {
      const list = await action();
      const found = list.find(entry => entry.id === provider.id);
      if (found) setRow(found);
      toast({ title: message, tone: 'success' });
      setStatus(message);
    } catch (error) {
      toast({ title: 'Action failed', message: error instanceof Error ? error.message : 'Unknown error', tone: 'error' });
      setStatus(error instanceof Error ? error.message : 'Action failed');
    } finally { setBusy(false); }
  };

  // Replace a key's value: append the new key first (so the provider always
  // has a credential), then remove the old key at its original position.
  const replaceKey = (index: number, value: string) => run(async () => {
    await addProviderKeys(provider.id, [value]);
    return removeProviderKey(provider.id, index + 1);
  }, 'Key updated');

  const keyMode = row.key_mode || 'single';
  return <div className="space-y-4">
    <div className="space-y-1.5">
      {Array.from({ length: row.key_count || 0 }, (_, index) => {
        const label = index === 0 ? row.masked_key || '(key)' : `key ${index + 1}`;
        if (editingKey === index) {
          return <div key={index} className="flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/[0.06] px-3 py-2">
            <KeyRound size={12} className="shrink-0 text-muted-foreground" />
            <input autoFocus type="password" value={editValue} onChange={event => setEditValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && editValue.trim()) replaceKey(index, editValue.trim()); if (event.key === 'Escape') { setEditingKey(null); setEditValue(''); } }} placeholder={`New value for ${label}`} className="min-w-0 flex-1 rounded-md border border-border bg-muted/50 px-2 py-1 font-mono text-[11px] text-foreground outline-none focus:ring-1 focus:ring-primary" />
            <button type="button" disabled={busy || !editValue.trim()} onClick={() => { if (editValue.trim()) replaceKey(index, editValue.trim()); }} className={primaryButton}>Save</button>
            <button type="button" onClick={() => { setEditingKey(null); setEditValue(''); }} className={actionButton}>Cancel</button>
          </div>;
        }
        return <div key={index} className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
          <KeyRound size={12} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{label}</span>
          <span className="text-[9px] text-muted-foreground">{index === 0 ? 'primary' : `rotation ${index + 1}`}</span>
          <button type="button" disabled={busy} onClick={() => { setEditingKey(index); setEditValue(''); }} className={actionButton}><Pencil size={10} className="mr-1 inline" />Edit</button>
          <button type="button" disabled={busy} onClick={async () => {
            if (await confirm({ title: `Remove ${label}?`, message: 'This key will stop being used for provider requests.', confirmLabel: 'Remove', tone: 'danger' })) run(() => removeProviderKey(provider.id, index + 1), 'Key removed');
          }} className={dangerButton}><Trash2 size={10} className="mr-1 inline" />Remove</button>
        </div>;
      })}
      {!row.key_count && <p className="py-1 text-[11px] text-muted-foreground">No keys stored.</p>}
    </div>
    <div>
      <div className="mb-1 text-[10px] text-muted-foreground">Add a key</div>
      <div className="flex gap-2">
        <input type="password" value={newKeys} onChange={event => setNewKeys(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && newKeys.trim()) { addKeys(); } }} placeholder="New API key (semicolon-separated for several)" className={inputClass} />
        <button type="button" disabled={busy || !newKeys.trim()} onClick={addKeys} className={`${primaryButton} shrink-0`}>Add</button>
      </div>
    </div>
    <div>
      <div className="mb-1 text-[10px] text-muted-foreground">Key rotation mode</div>
      <div className="flex gap-2">
        {(['single', 'round-robin', 'failover'] as const).map(mode => <button key={mode} type="button" disabled={busy} onClick={() => run(() => updateProvider(provider.id, undefined, undefined, mode), `Mode: ${mode}`)} className={`rounded-lg border px-3 py-1.5 text-[11px] transition disabled:opacity-40 ${keyMode === mode ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-border text-muted-foreground hover:bg-accent'}`}>{mode}</button>)}
      </div>
      <p className="mt-1 text-[9px] text-muted-foreground">single = first key · round-robin = rotate each request · failover = rotate on rate-limit</p>
    </div>
  </div>;

  function addKeys() {
    run(() => addProviderKeys(provider.id, newKeys.split(';').map(entry => entry.trim()).filter(Boolean)), 'Key added');
    setNewKeys('');
  }
}

export function ProvidersPanel({ setStatus }: { setStatus: (value: string) => void }) {
  const [providers, setProviders] = useState<AuthProvider[]>([]);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<AuthProvider | null>(null);
  const [keysFor, setKeysFor] = useState<AuthProvider | null>(null);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const { confirm, toast } = useNotifications();

  const reload = useCallback(async () => { setProviders(await getAuthStatus().catch(() => [])); }, []);
  useEffect(() => { reload().catch(error => setStatus(error instanceof Error ? error.message : 'Failed to load providers')); }, [reload, setStatus]);

  const run = async (action: () => Promise<AuthProvider[]>, message: string) => {
    setBusy(true);
    try {
      const list = await action();
      setProviders(list);
      setEditing(null);
      setAdding(false);
      setKeysFor(current => (current ? list.find(row => row.id === current.id) || null : null));
      toast({ title: message, tone: 'success' });
      setStatus(message);
    } catch (error) {
      toast({ title: 'Action failed', message: error instanceof Error ? error.message : 'Unknown error', tone: 'error' });
      setStatus(error instanceof Error ? error.message : 'Action failed');
    } finally { setBusy(false); }
  };

  const handleSave = (apiKey: string, baseURL: string, label: string, id: string) => run(() => saveProvider(editing?.id || id, apiKey, baseURL, label), editing ? 'Provider updated' : 'Provider saved');

  const handleRemove = async (provider: AuthProvider) => {
    if (!(await confirm({ title: `Remove ${provider.label} credentials?`, message: 'This keeps the provider listed but unconfigured. Any stored API keys are deleted.', confirmLabel: 'Remove', tone: 'danger' }))) return;
    run(() => removeProvider(provider.id), 'Provider removed');
  };

  const toggleOnlyFree = (provider: AuthProvider, value: boolean) => run(() => updateProvider(provider.id, value), value ? 'Free models only' : 'All models shown');
  const toggleDisabled = (provider: AuthProvider, value: boolean) => run(() => updateProvider(provider.id, undefined, value), value ? 'Provider disabled' : 'Provider enabled');

  const filtered = providers.filter(provider => {
    if (!query.trim()) return true;
    const haystack = `${provider.label} ${provider.id} ${provider.detail || ''} ${provider.base_url || ''} ${provider.masked_key || ''}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  return <div className="space-y-3">
    <section className="glass-card rounded-lg p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xs font-medium text-foreground">Providers</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">API keys and endpoints stored in Rick's auth.json — the same file the terminal /auth flow uses. Keys are masked and never leave your machine.</p>
        </div>
        <button type="button" onClick={() => { setAdding(true); setEditing(null); setKeysFor(null); }} className={primaryButton}><Plus size={11} className="mr-1 inline" />Add custom provider</button>
      </div>
      <div className="relative mt-3">
        <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${providers.length} providers…`} className="w-full rounded-lg border border-border bg-muted/50 py-2 pl-8 pr-3 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary" />
      </div>
      {filtered.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">{providers.length === 0 ? 'No providers found. Add a custom provider or configure one below.' : `No providers match "${query}".`}</p>
        : <div className="provider-list mt-3 space-y-2 overflow-y-auto pr-1">
          {filtered.map(provider => <ProviderRow key={provider.id} provider={provider} busy={busy} expanded={!!expanded[provider.id]} onToggleExpand={() => setExpanded(current => ({ ...current, [provider.id]: !current[provider.id] }))} onEdit={() => { setEditing(provider); setAdding(false); setKeysFor(null); }} onKeys={() => { setKeysFor(provider); setEditing(null); setAdding(false); }} onRemove={() => handleRemove(provider)} onToggleOnlyFree={toggleOnlyFree} onToggleDisabled={toggleDisabled} />)}
        </div>}
    </section>
    {adding && <Overlay title="Add custom provider" subtitle="Point Rick at any OpenAI-compatible endpoint, exactly like the terminal /auth flow." onClose={() => setAdding(false)}>
      <ProviderForm provider={null} busy={busy} onSave={handleSave} onCancel={() => setAdding(false)} />
    </Overlay>}
    {editing && <Overlay title={`Edit ${editing.label}`} subtitle={editing.id} onClose={() => setEditing(null)}>
      <ProviderForm provider={editing} busy={busy} onSave={handleSave} onCancel={() => setEditing(null)} />
    </Overlay>}
    {keysFor && <Overlay title={`API keys · ${keysFor.label}`} subtitle="Add, edit, or remove rotation keys. Values are masked and only replaced, never displayed." onClose={() => setKeysFor(null)}>
      <KeysPanel provider={keysFor} busy={busy} setBusy={setBusy} setStatus={setStatus} />
    </Overlay>}
  </div>;
}

function ProviderRow({ provider, busy, expanded, onToggleExpand, onEdit, onKeys, onRemove, onToggleOnlyFree, onToggleDisabled }: {
  provider: AuthProvider;
  busy: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onKeys: () => void;
  onRemove: () => void;
  onToggleOnlyFree: (provider: AuthProvider, value: boolean) => void;
  onToggleDisabled: (provider: AuthProvider, value: boolean) => void;
}) {
  const hasCredential = provider.connected && !provider.env_only;
  return <div className="rounded-xl border border-border bg-surface-2">
    <div className="flex items-center gap-3 px-3 py-2.5">
      <button type="button" onClick={onToggleExpand} className="flex min-w-0 flex-1 items-center gap-3 text-left" title={provider.detail}>
        <span className={`h-2 w-2 shrink-0 rounded-full ${provider.disabled ? 'bg-muted-foreground/30' : provider.connected ? 'bg-foreground/70' : 'bg-muted-foreground/40'}`} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2"><span className="truncate text-xs text-foreground">{provider.label}</span><span className="truncate text-[9px] text-muted-foreground">{provider.id}</span>{provider.custom && <span className="rounded border border-primary/25 px-1 text-[9px] text-primary">custom</span>}</span>
          <span className="block truncate text-[10px] text-muted-foreground">
            {provider.env_only ? `from $${provider.env_var}` : provider.masked_key ? `${provider.masked_key}${provider.key_count && provider.key_count > 1 ? ` (+${provider.key_count - 1})` : ''}` : provider.detail || provider.base_url || ''}
            {provider.only_free ? ' · free only' : ''}
          </span>
        </span>
        <StatusBadge provider={provider} />
      </button>
      <div className="flex shrink-0 items-center gap-1.5">
        {hasCredential && <button type="button" disabled={busy} onClick={onKeys} className={actionButton}><KeyRound size={10} className="mr-1 inline" />Keys</button>}
        <button type="button" disabled={busy} onClick={onEdit} className={actionButton}>{hasCredential ? 'Edit' : 'Configure'}</button>
        {hasCredential && <button type="button" disabled={busy} onClick={onRemove} className={dangerButton}><Trash2 size={10} className="mr-1 inline" />Remove</button>}
      </div>
    </div>
    {expanded && <div className="border-t border-border px-4 py-3">
      <p className="text-[11px] leading-relaxed text-muted-foreground">{provider.detail}{provider.base_url ? ` — ${provider.base_url}` : ''}{provider.key_count ? ` · ${provider.key_count} key${provider.key_count === 1 ? '' : 's'}` : ''}{provider.key_mode ? ` · ${provider.key_mode}` : ''}{provider.default_model ? ` · default ${provider.default_model}` : ''}</p>
      {provider.env_only && <p className="mt-1 text-[11px] text-muted-foreground">Using the <span className="font-mono text-foreground">{provider.env_var}</span> environment variable. Add a key here to store it in auth.json instead.</p>}
      {hasCredential && <div className="mt-2 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><input type="checkbox" checked={!!provider.only_free} onChange={event => onToggleOnlyFree(provider, event.target.checked)} className="h-3 w-3 accent-primary" />Free models only</label>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><input type="checkbox" checked={!!provider.disabled} onChange={event => onToggleDisabled(provider, event.target.checked)} className="h-3 w-3 accent-primary" />Disabled (kept but not used)</label>
      </div>}
    </div>}
  </div>;
}
