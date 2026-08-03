import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plug, Plus, Puzzle, RefreshCw, Trash2 } from 'lucide-react';
import { getMCPStatus, getResolvedConfig, requestPlugins, updateRickConfig } from '../lib/wails';
import { useNotifications } from './Notifications';
import { Overlay } from './Overlay';

const inputClass = 'w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary';
const actionButton = 'rounded-lg border border-border px-2.5 py-1.5 text-[10px] text-foreground transition hover:bg-surface-2 disabled:opacity-40';
const primaryButton = 'rounded-lg bg-primary px-2.5 py-1.5 text-[10px] font-medium text-primary-foreground transition hover:bg-primary/85 disabled:opacity-40';
const dangerButton = 'rounded-lg border border-border px-2.5 py-1.5 text-[10px] text-foreground transition hover:bg-muted disabled:opacity-40';

interface MCPServer {
  type?: string;
  command?: string[];
  environment?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

interface RegistryPlugin {
  name: string;
  description?: string;
  enabled?: boolean;
  source?: string;
}

// Canonical built-in tools Rick ships (per docs/rick-cli-desktop-gaps.md).
// Tools absent from the config map use their default (enabled) state.
const BUILTIN_TOOLS = ['read', 'write', 'edit', 'bash', 'grep', 'glob', 'list', 'apply_patch', 'todo', 'code_symbols', 'git', 'diagnostics', 'test', 'tree', 'fetch', 'memory', 'websearch'];

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <section className="glass-card rounded-lg p-4"><h2 className="text-xs font-medium text-foreground">{title}</h2>{description && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{description}</p>}<div className="mt-3">{children}</div></section>;
}

function ToggleRow({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-muted-foreground"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="h-3 w-3 accent-primary" />{label}</label>;
}

export function ToolsMCPPanel({ setStatus }: { setStatus: (value: string) => void }) {
  const [mcp, setMcp] = useState<Record<string, MCPServer>>({});
  const [tools, setTools] = useState<Record<string, boolean>>({});
  const [pluginList, setPluginList] = useState<string[]>([]);
  const [registry, setRegistry] = useState<RegistryPlugin[]>([]);
  const [mcpStatus, setMcpStatus] = useState<Record<string, any>[]>([]);
  const [busy, setBusy] = useState(false);
  const { confirm, toast } = useNotifications();

  const reload = useCallback(async () => {
    const [resolvedValue, mcpValue, pluginsValue] = await Promise.all([
      getResolvedConfig(),
      getMCPStatus().catch(() => []),
      requestPlugins('list').catch(() => null),
    ]);
    const config = (resolvedValue?.config || {}) as Record<string, any>;
    setMcp((config.mcp as Record<string, MCPServer>) || {});
    setTools((config.tools as Record<string, boolean>) || {});
    setPluginList((config.plugin as string[]) || []);
    setMcpStatus(mcpValue);
    const list = (pluginsValue as { plugins?: unknown } | null)?.plugins ?? pluginsValue;
    setRegistry(Array.isArray(list) ? list as RegistryPlugin[] : []);
  }, []);

  useEffect(() => { reload().catch(error => setStatus(error instanceof Error ? error.message : 'Failed to load Rick config')); }, [reload, setStatus]);

  const save = useCallback(async (patch: Record<string, any>, message: string) => {
    setBusy(true);
    try {
      const result = await updateRickConfig(patch);
      const config = (result?.config || {}) as Record<string, any>;
      if (config.mcp) setMcp(config.mcp as Record<string, MCPServer>);
      if (config.tools) setTools(config.tools as Record<string, boolean>);
      if (config.plugin) setPluginList(config.plugin as string[]);
      toast({ title: message, tone: 'success' });
      setStatus(message);
    } catch (error) {
      toast({ title: 'Save failed', message: error instanceof Error ? error.message : 'Unknown error', tone: 'error' });
      setStatus(error instanceof Error ? error.message : 'Save failed');
    } finally { setBusy(false); }
  }, [setStatus, toast]);

  const notifyError = (error: unknown, fallback: string) => {
    const message = error instanceof Error ? error.message : fallback;
    toast({ title: fallback, message, tone: 'error' });
    setStatus(message);
  };

  // ---------- MCP servers ----------

  const setServer = (next: Record<string, MCPServer>, message: string) => save({ mcp: next }, message);

  const toggleServer = (name: string) => {
    const next = { ...mcp, [name]: { ...mcp[name], enabled: !(mcp[name].enabled ?? true) } };
    setServer(next, mcp[name].enabled === false ? 'MCP server enabled' : 'MCP server disabled');
  };

  const removeServer = async (name: string) => {
    if (!(await confirm({ title: `Remove MCP server "${name}"?`, message: 'The server entry is removed from rick.json and will not load on the next launch.', confirmLabel: 'Remove', tone: 'danger' }))) return;
    const next = { ...mcp };
    delete next[name];
    setServer(next, 'MCP server removed');
  };

  const addServer = (name: string, server: MCPServer) => {
    const next = { ...mcp, [name]: server };
    setServer(next, 'MCP server added');
  };

  // ---------- tools ----------

  const setToolMap = (next: Record<string, boolean>, message: string) => save({ tools: next }, message);

  const removeTool = async (name: string) => {
    if (!(await confirm({ title: `Remove tool "${name}"?`, message: 'The tool override is removed from rick.json; the built-in default applies again.', confirmLabel: 'Remove', tone: 'danger' }))) return;
    const next = { ...tools };
    delete next[name];
    setToolMap(next, 'Tool removed');
  };

  const addTool = (name: string, enabled: boolean) => {
    const next = { ...tools, [name]: enabled };
    setToolMap(next, 'Tool added');
  };

  const toggleTool = (name: string) => {
    const current = tools[name] ?? true;
    const nextEnabled = !current;
    if (nextEnabled) {
      if (name in tools) {
        const next = { ...tools };
        if (BUILTIN_TOOLS.includes(name)) delete next[name]; // restore the built-in default
        else next[name] = true;
        setToolMap(next, 'Tool enabled');
      }
      // not overridden → already at the built-in default, nothing to persist
    } else {
      setToolMap({ ...tools, [name]: false }, 'Tool disabled');
    }
  };

  const renameTool = (from: string, to: string) => {
    if (!to.trim() || to === from) return;
    const next = { ...tools };
    const enabled = next[from] ?? true;
    delete next[from];
    next[to.trim()] = enabled;
    setToolMap(next, 'Tool renamed');
  };

  // ---------- plugins ----------

  const setPluginArray = (next: string[], message: string) => save({ plugin: next }, message);

  const togglePlugin = (name: string, enabled: boolean) => {
    const next = enabled ? (pluginList.includes(name) ? pluginList : [...pluginList, name]) : pluginList.filter(entry => entry !== name);
    setPluginArray(next, enabled ? 'Plugin enabled' : 'Plugin disabled');
    requestPlugins('toggle', name, '', enabled).catch(error => notifyError(error, 'Failed to toggle plugin in registry'));
  };

  const removePlugin = async (name: string) => {
    if (!(await confirm({ title: `Remove plugin "${name}"?`, message: 'The plugin is removed from the enabled list and the live registry.', confirmLabel: 'Remove', tone: 'danger' }))) return;
    const next = pluginList.filter(entry => entry !== name);
    setPluginArray(next, 'Plugin removed');
    requestPlugins('remove', name, '').catch(error => notifyError(error, 'Failed to remove plugin from registry'));
  };

  const renamePlugin = (from: string, to: string) => {
    if (!to.trim() || to === from) return;
    const next = pluginList.map(entry => entry === from ? to.trim() : entry);
    if (!pluginList.includes(from)) next.push(to.trim());
    setPluginArray(next, 'Plugin renamed');
  };

  const addPluginSource = async (source: string) => {
    if (!source.trim()) return;
    try {
      const result = await requestPlugins('add', '', source.trim());
      const added = Array.isArray(result?.added) ? (result.added as string[]).join(', ') : source.trim();
      toast({ title: 'Plugin added', message: added, tone: 'success' });
      setStatus(`Added plugin: ${added}`);
      await reload();
    } catch (error) {
      notifyError(error, 'Failed to add plugin');
    }
  };

  const addPluginName = (name: string) => {
    if (!name.trim()) return;
    const next = pluginList.includes(name.trim()) ? pluginList : [...pluginList, name.trim()];
    setPluginArray(next, 'Plugin added');
  };

  const mcpLive = new Map(mcpStatus.map(entry => [String(entry.name), entry]));

  return <div className="space-y-3">
    <PluginsCard pluginList={pluginList} registry={registry} busy={busy} onToggle={togglePlugin} onRemove={removePlugin} onRename={renamePlugin} onAddSource={addPluginSource} onAddName={addPluginName} />
    <MCPServersCard mcp={mcp} mcpLive={mcpLive} busy={busy} onToggle={toggleServer} onRemove={removeServer} onAdd={addServer} onSave={setServer} />
    <ToolsCard tools={tools} busy={busy} onToggle={toggleTool} onRemove={removeTool} onAdd={addTool} onRename={renameTool} />
    <Card title="Live MCP status" description="Connection state reported by the running rickserve process.">
      {mcpStatus.length === 0 ? <p className="py-2 text-[11px] text-muted-foreground">No MCP servers reported by the daemon.</p> : <div className="space-y-1.5">{mcpStatus.map(entry => <div key={String(entry.name)} className="flex items-center justify-between gap-3 rounded-lg border border-border px-2.5 py-2 text-xs"><span className="text-foreground">{String(entry.name)}</span><span className="text-[10px] text-muted-foreground">{String(entry.status)}</span></div>)}</div>}
      <button type="button" onClick={() => reload().catch(error => notifyError(error, 'Refresh failed'))} className={`${actionButton} mt-3`}><RefreshCw size={10} className="mr-1 inline" />Refresh</button>
    </Card>
  </div>;
}

// ---------- Plugins ----------

function PluginsCard({ pluginList, registry, busy, onToggle, onRemove, onRename, onAddSource, onAddName }: {
  pluginList: string[];
  registry: RegistryPlugin[];
  busy: boolean;
  onToggle: (name: string, enabled: boolean) => void;
  onRemove: (name: string) => void;
  onRename: (from: string, to: string) => void;
  onAddSource: (source: string) => void;
  onAddName: (name: string) => void;
}) {
  const [source, setSource] = useState('');
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const registryNames = new Set(registry.map(plugin => plugin.name));
  const rows: Array<{ name: string; enabled: boolean; description?: string; source?: string }> = [
    ...registry.map(plugin => ({ name: plugin.name, enabled: Boolean(plugin.enabled ?? pluginList.includes(plugin.name)), description: plugin.description, source: plugin.source })),
    ...pluginList.filter(name => !registryNames.has(name)).map(name => ({ name, enabled: true, description: undefined, source: undefined })),
  ];

  const submitEdit = (from: string) => {
    if (editText.trim() && editText.trim() !== from) onRename(from, editText);
    setEditing(null);
  };

  return <Card title="Plugins" description="Plugins listed here are enabled in rick.json; toggling also updates the live registry. Add a plugin from a manifest URL or local path, exactly like /plugins add in the terminal.">
    <div className="space-y-2">
      {rows.map(plugin => (
        <div key={plugin.name} className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-3 py-2.5">
          {editing === plugin.name
            ? <input autoFocus value={editText} onChange={event => setEditText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') submitEdit(plugin.name); if (event.key === 'Escape') setEditing(null); }} onBlur={() => submitEdit(plugin.name)} className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none" />
            : <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2"><Puzzle size={12} className="shrink-0 text-muted-foreground" /><span className="truncate text-xs text-foreground">{plugin.name}</span></span>
                {plugin.description && <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{plugin.description}</span>}
                {plugin.source && <span className="block truncate text-[9px] text-muted-foreground/60">{plugin.source}</span>}
              </span>}
          <ToggleRow checked={plugin.enabled} onChange={value => onToggle(plugin.name, value)} label="on" />
          <button type="button" disabled={busy} onClick={() => { setEditing(plugin.name); setEditText(plugin.name); }} className={actionButton}><Pencil size={10} className="mr-1 inline" />Edit</button>
          <button type="button" disabled={busy} onClick={() => onRemove(plugin.name)} className={dangerButton}><Trash2 size={10} className="mr-1 inline" />Remove</button>
        </div>
      ))}
      {rows.length === 0 && <p className="py-2 text-[11px] text-muted-foreground">No plugins loaded. Add one below or in rick.json.</p>}
    </div>
    <div className="mt-3 space-y-2 rounded-xl border border-border bg-background p-3">
      <div className="text-[10px] text-muted-foreground">Add from URL or file path</div>
      <div className="flex gap-2">
        <input value={source} onChange={event => setSource(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { addSource(); } }} placeholder="https://example.com/plugin.json or C:\path\to\plugin" className={inputClass} />
        <button type="button" disabled={!source.trim()} onClick={addSource} className={`${primaryButton} shrink-0`}>Add</button>
      </div>
      <div className="text-[10px] text-muted-foreground">or enable a known plugin name</div>
      <div className="flex gap-2">
        <input value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { addName(); } }} placeholder="Plugin name to enable" className={inputClass} />
        <button type="button" onClick={addName} className={`${actionButton} shrink-0`}>Add</button>
      </div>
    </div>
  </Card>;

  function addSource() { onAddSource(source); setSource(''); }
  function addName() { onAddName(name); setName(''); }
}

// ---------- MCP servers ----------

function MCPServersCard({ mcp, mcpLive, busy, onToggle, onRemove, onAdd, onSave }: {
  mcp: Record<string, MCPServer>;
  mcpLive: Map<string, Record<string, any>>;
  busy: boolean;
  onToggle: (name: string) => void;
  onRemove: (name: string) => void;
  onAdd: (name: string, server: MCPServer) => void;
  onSave: (next: Record<string, MCPServer>, message: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  return <Card title="MCP servers" description="Servers are stored in rick.json and loaded by every Rick launch, terminal and desktop alike. Edit the command, URL, and environment variables freely.">
    <div className="space-y-2">
      {Object.entries(mcp).map(([name, server]) => {
        const live = mcpLive.get(name);
        return <div key={name} className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-3 py-2.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${live ? (live.status === 'connected' ? 'bg-foreground/70' : 'bg-muted-foreground/60') : 'bg-muted-foreground/40'}`} title={live ? String(live.status) : 'not loaded'} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs text-foreground">{name}</span>
            <span className="block truncate text-[10px] text-muted-foreground">{server.type === 'remote' ? server.url : server.command?.join(' ')}</span>
          </span>
          <ToggleRow checked={server.enabled !== false} onChange={() => onToggle(name)} label="on" />
          <button type="button" disabled={busy} onClick={() => setEditing(name)} className={actionButton}><Pencil size={10} className="mr-1 inline" />Edit</button>
          <button type="button" disabled={busy} onClick={() => onRemove(name)} className={dangerButton}><Trash2 size={10} className="mr-1 inline" />Remove</button>
        </div>;
      })}
      {Object.keys(mcp).length === 0 && <p className="py-2 text-[11px] text-muted-foreground">No MCP servers configured.</p>}
    </div>
    {!adding && <button type="button" onClick={() => setAdding(true)} className={`${primaryButton} mt-3`}><Plus size={11} className="mr-1 inline" />Add server</button>}
    {adding && <Overlay title="Add MCP server" subtitle="Written to rick.json and loaded on the next launch." onClose={() => setAdding(false)}>
      <MCPServerEditor name="" server={{ enabled: true }} busy={busy} onSave={(nextName, next) => { onAdd(nextName, next); setAdding(false); }} onCancel={() => setAdding(false)} />
    </Overlay>}
    {editing !== null && mcp[editing] && <Overlay title="Edit MCP server" subtitle={editing} onClose={() => setEditing(null)}>
      <MCPServerEditor name={editing} server={mcp[editing]} busy={busy} onSave={(nextName, next) => {
        const updated = { ...mcp };
        delete updated[editing];
        updated[nextName] = next;
        onSave(updated, nextName === editing ? 'MCP server updated' : 'MCP server renamed');
        setEditing(null);
      }} onCancel={() => setEditing(null)} />
    </Overlay>}
  </Card>;
}

function MCPServerEditor({ name, server, busy, onSave, onCancel }: {
  name: string;
  server: MCPServer;
  busy: boolean;
  onSave: (name: string, server: MCPServer) => void;
  onCancel: () => void;
}) {
  const [serverName, setServerName] = useState(name);
  const [type, setType] = useState<'local' | 'remote'>(server.type === 'remote' ? 'remote' : 'local');
  const [command, setCommand] = useState((server.command || []).join(' '));
  const [url, setUrl] = useState(server.url || '');
  const [envText, setEnvText] = useState(Object.entries(server.environment || {}).map(([key, value]) => `${key}=${value}`).join('\n'));
  const [headersText, setHeadersText] = useState(Object.entries(server.headers || {}).map(([key, value]) => `${key}=${value}`).join('\n'));
  const [enabled, setEnabled] = useState(server.enabled !== false);

  const parseKV = (text: string): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const equals = trimmed.indexOf('=');
      if (equals <= 0) continue;
      result[trimmed.slice(0, equals).trim()] = trimmed.slice(equals + 1).trim();
    }
    return result;
  };

  const canSave = serverName.trim() && (type === 'local' ? command.trim() : url.trim());
  const commit = () => {
    if (!canSave) return;
    onSave(serverName.trim(), type === 'local'
      ? { type: 'local', command: command.trim().split(/\s+/), environment: parseKV(envText), enabled }
      : { type: 'remote', url: url.trim(), headers: parseKV(headersText), enabled });
  };

  return <div className="space-y-3">
    <div className="flex gap-2">
      <input value={serverName} onChange={event => setServerName(event.target.value)} placeholder="Server name (e.g. filesystem)" className={inputClass} />
      <select value={type} onChange={event => setType(event.target.value as 'local' | 'remote')} className="shrink-0 rounded-lg border border-border bg-muted/50 px-2 py-2 text-xs text-foreground outline-none"><option value="local">local</option><option value="remote">remote</option></select>
    </div>
    {type === 'local'
      ? <input value={command} onChange={event => setCommand(event.target.value)} placeholder="Command line, e.g. npx -y @modelcontextprotocol/server-filesystem ." className={inputClass} />
      : <input value={url} onChange={event => setUrl(event.target.value)} placeholder="https://mcp.example.com/sse" className={inputClass} />}
    {type === 'local'
      ? <textarea value={envText} onChange={event => setEnvText(event.target.value)} placeholder={'Environment variables, one per line:\nTOKEN=abc123'} spellCheck={false} className="h-16 w-full rounded-lg border border-border bg-muted/50 p-2.5 font-mono text-[10px] text-foreground outline-none focus:ring-1 focus:ring-primary" />
      : <textarea value={headersText} onChange={event => setHeadersText(event.target.value)} placeholder={'Request headers, one per line:\nAuthorization=Bearer abc123'} spellCheck={false} className="h-16 w-full rounded-lg border border-border bg-muted/50 p-2.5 font-mono text-[10px] text-foreground outline-none focus:ring-1 focus:ring-primary" />}
    <div className="flex items-center justify-between">
      <ToggleRow checked={enabled} onChange={setEnabled} label="Enabled" />
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className={actionButton}>Cancel</button>
        <button type="button" disabled={busy || !canSave} onClick={commit} className={primaryButton}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  </div>;
}

// ---------- Built-in tools ----------

function ToolsCard({ tools, busy, onToggle, onRemove, onAdd, onRename }: {
  tools: Record<string, boolean>;
  busy: boolean;
  onToggle: (name: string) => void;
  onRemove: (name: string) => void;
  onAdd: (name: string, enabled: boolean) => void;
  onRename: (from: string, to: string) => void;
}) {
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const submitEdit = (from: string) => {
    if (editText.trim() && editText.trim() !== from) onRename(from, editText);
    setEditing(null);
  };

  const overrideNames = new Set(Object.keys(tools));
  const rows = [
    ...BUILTIN_TOOLS.map(toolName => ({ name: toolName, enabled: tools[toolName] ?? true, override: overrideNames.has(toolName) })),
    ...Object.keys(tools).filter(toolName => !BUILTIN_TOOLS.includes(toolName)).map(toolName => ({ name: toolName, enabled: tools[toolName] ?? true, override: true })),
  ];

  return <Card title="Built-in tools" description="Every tool Rick ships is listed with its current state. Toggling one off writes an override into rick.json's tools map; removing an override restores the default.">
    <div className="space-y-1.5">
      {rows.map(tool => (
        <div key={tool.name} className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-3 py-2.5">
          {editing === tool.name
            ? <input autoFocus value={editText} onChange={event => setEditText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') submitEdit(tool.name); if (event.key === 'Escape') setEditing(null); }} onBlur={() => submitEdit(tool.name)} className="min-w-0 flex-1 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs text-foreground outline-none" />
            : <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <Plug size={12} className="shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono text-xs text-foreground">{tool.name}</span>
                  {tool.override
                    ? <span className="rounded border border-primary/25 px-1 text-[9px] text-primary">override</span>
                    : <span className="rounded border border-border px-1 text-[9px] text-muted-foreground">default</span>}
                </span>
              </span>}
          <ToggleRow checked={tool.enabled} onChange={() => onToggle(tool.name)} label="on" />
          <button type="button" disabled={busy} onClick={() => { setEditing(tool.name); setEditText(tool.name); }} className={actionButton}><Pencil size={10} className="mr-1 inline" />Edit</button>
          {tool.override && <button type="button" disabled={busy} onClick={() => onRemove(tool.name)} className={dangerButton}><Trash2 size={10} className="mr-1 inline" />Remove</button>}
        </div>
      ))}
    </div>
    <div className="mt-3 flex gap-2">
      <input value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { add(); } }} placeholder="Tool name" className={inputClass} />
      <label className="flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} className="h-3 w-3 accent-primary" />enabled</label>
      <button type="button" onClick={add} className={`${primaryButton} shrink-0`}><Plug size={10} className="mr-1 inline" />Add</button>
    </div>
  </Card>;

  function add() { if (name.trim()) { onAdd(name.trim(), enabled); setName(''); } }
}
