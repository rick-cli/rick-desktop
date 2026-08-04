import { AuthProvider, ChatMessage, CommandSpec, DailyUsage, DesktopConfig, Provider, ResolvedConfig, RickEvent, RickStatus, RunOptions, RuntimeInfo, Session, ToolInfo, UpdateInfo, UsageStats } from './types';

type WailsApp = Record<string, (...args: any[]) => Promise<any>>;

function app(): WailsApp | undefined {
  return window.go?.main?.App;
}

export async function getProviders(): Promise<Provider[]> {
  return (await app()?.GetProviders()) || [];
}

export async function getTools(): Promise<ToolInfo[]> {
  return (await app()?.GetTools()) || [];
}

export async function getSessions(): Promise<Session[]> {
  return (await app()?.GetSessions()) || [];
}

export async function searchSessions(query: string): Promise<Session[]> {
  return (await app()?.SearchSessions(query)) || [];
}

export async function getSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  return (await app()?.GetSessionMessages(sessionId)) || [];
}

export async function renameSession(id: string, title: string): Promise<void> {
  await app()?.RenameSession(id, title);
}

export async function setSessionCategory(id: string, category: string): Promise<void> {
  await app()?.SetSessionCategory(id, category);
}

export async function setSessionFavorite(id: string, fav: boolean): Promise<void> {
  await app()?.SetSessionFavorite(id, fav);
}

export async function deleteSession(id: string): Promise<void> {
  await app()?.DeleteSession(id);
}

export async function forkSession(id: string): Promise<Session | null> {
  return (await app()?.ForkSession(id)) || null;
}

export async function exportSession(id: string): Promise<string> {
  return (await app()?.ExportSession(id)) || '';
}

export async function importSession(path: string, source = 'auto'): Promise<Session | null> {
  return (await app()?.ImportSession(path, source)) || null;
}

export async function runPrompt(prompt: string, model: string, sessionId?: string, options?: RunOptions): Promise<string> {
  const value = options
    ? await app()?.RunPromptWithOptions(prompt, model, sessionId ?? '', options)
    : await app()?.RunPrompt(prompt, model, sessionId ?? '');
  return typeof value === 'string' ? value : '';
}

export async function stopRun(sessionId?: string): Promise<void> {
  await app()?.StopRun(sessionId ?? '');
}

export async function respondPermission(requestId: string, decision: 'accept' | 'reject' | 'always'): Promise<void> {
  await app()?.RespondPermission(requestId, decision);
}

export async function getResolvedConfig(cwd = ''): Promise<ResolvedConfig | null> {
  return (await app()?.GetResolvedConfig(cwd)) || null;
}

export async function updateRickConfig(patch: Record<string, unknown>): Promise<Record<string, any> | null> {
  return (await app()?.UpdateRickConfig(patch)) || null;
}

export async function requestSnapshot(action: 'list' | 'can' | 'undo' | 'redo' | 'snapshot', cwd = '', title = ''): Promise<Record<string, any> | null> {
  return (await app()?.RequestSnapshot(action, cwd, title)) || null;
}

export async function requestGoals(action: string, options: { goalId?: string; stepId?: string; title?: string; content?: string; status?: string; budget?: number; steps?: string[] } = {}): Promise<Record<string, any> | null> {
  return (await app()?.RequestGoals(action, options.goalId || '', options.stepId || '', options.title || '', options.content || '', options.status || '', options.budget || 0, options.steps || [])) || null;
}

export async function requestCompact(sessionId: string): Promise<Record<string, any> | null> {
  return (await app()?.RequestCompact(sessionId)) || null;
}

export async function getMCPStatus(): Promise<Record<string, any>[]> {
  return (await app()?.GetMCPStatus()) || [];
}

export async function requestPlugins(action: 'list' | 'toggle' | 'add' | 'remove', name = '', source = '', enabled?: boolean): Promise<any> {
  return (await app()?.RequestPlugins(action, name, source, enabled ?? undefined)) || null;
}

export async function getAuthStatus(): Promise<AuthProvider[]> {
  return (await app()?.GetAuthStatus()) || [];
}

export async function saveProvider(provider: string, apiKey: string, baseURL = '', label = ''): Promise<AuthProvider[]> {
  return (await app()?.SaveProvider(provider, apiKey, baseURL, label)) || [];
}

export async function updateProvider(provider: string, onlyFree?: boolean, disabled?: boolean, keyMode?: string, baseURL?: string, label?: string, defaultModel?: string): Promise<AuthProvider[]> {
  return (await app()?.UpdateProvider(provider, onlyFree ?? null, disabled ?? null, keyMode || '', baseURL || '', label || '', defaultModel || '')) || [];
}

export async function addProviderKeys(provider: string, keys: string[]): Promise<AuthProvider[]> {
  return (await app()?.AddProviderKeys(provider, keys)) || [];
}

export async function removeProviderKey(provider: string, keyIndex: number): Promise<AuthProvider[]> {
  return (await app()?.RemoveProviderKey(provider, keyIndex)) || [];
}

export async function removeProvider(provider: string): Promise<AuthProvider[]> {
  return (await app()?.RemoveProvider(provider)) || [];
}

export async function listAgents(sessionId: string): Promise<void> {
  await app()?.ListAgents(sessionId);
}

export async function killAgent(sessionId: string, agentId: string): Promise<void> {
  await app()?.KillAgent(sessionId, agentId);
}

export async function steerAgent(sessionId: string, agentId: string, from: string, content: string): Promise<void> {
  await app()?.SteerAgent(sessionId, agentId, from, content);
}

export async function getDefaultModel(): Promise<string> {
  return (await app()?.GetDefaultModel()) || '';
}

export async function getConfig(): Promise<DesktopConfig> {
  const config = await app()?.GetConfig();
  return config || {
    schema_version: 1,
    theme: 'graphite',
    font_size: 'medium',
    permission_profile: 'standard',
    sandbox: 'workspace-write',
    show_reasoning: true,
    reasoning_expanded: true,
    max_swarm_concurrency: 4,
    thinking_mode: 'auto',
    yolo: false,
  };
}

export async function updateConfig(config: DesktopConfig): Promise<void> {
  await app()?.UpdateConfig(config);
}

export async function exportSettings(): Promise<string> {
  return (await app()?.ExportSettings()) || '';
}

export async function importSettings(payload: string): Promise<void> {
  await app()?.ImportSettings(payload);
}

export async function resetSettings(): Promise<void> {
  await app()?.ResetSettings();
}

export async function executeRickCommand(line: string, approved: boolean): Promise<{ command: string; exit_code: number; output: string }> {
  return (await app()?.ExecuteRickCommand(line, approved)) || { command: line, exit_code: -1, output: '' };
}

export async function getCommandCatalog(): Promise<CommandSpec[]> {
  return (await app()?.GetCommandCatalog()) || [];
}


export async function getRuntimeInfo(): Promise<RuntimeInfo | null> {
  return (await app()?.GetRuntimeInfo()) || null;
}

export async function getUpdateStatus(): Promise<UpdateInfo> {
  return (await app()?.GetUpdateStatus()) || { current_version: '', latest_version: '', update_available: false, asset_name: '', download_url: '', checked_at: '', error: 'Update check unavailable' };
}

export async function installUpdate(): Promise<void> {
  await app()?.InstallUpdate();
}

export async function getRickStatus(): Promise<RickStatus> {
  return (await app()?.GetRickStatus()) || { installed: false, rick_path: '', rickserve_path: '', rick_version: '', install_dir: '' };
}

export async function installRick(): Promise<RickStatus> {
  return (await app()?.InstallRick()) || { installed: false, rick_path: '', rickserve_path: '', rick_version: '', install_dir: '' };
}

export async function getUsageStats(sessionId = '', model = ''): Promise<UsageStats> {
  return (await app()?.GetUsageStats(sessionId, model)) || {
    session: { input: 0, output: 0, cache_read: 0, cache_write: 0, cached: 0, total: 0 },
    total: { input: 0, output: 0, cache_read: 0, cache_write: 0, cached: 0, total: 0 },
    context_known: false,
  };
}

export async function getUsageDaily(days = 14): Promise<DailyUsage[]> {
  return (await app()?.GetUsageDaily(days)) || [];
}

export async function pickFolder(): Promise<string> {
  return (await app()?.PickFolder()) || '';
}

export function onRickEvent(callback: (event: RickEvent) => void): () => void {
  if (!window.runtime) return () => {};
  return window.runtime.EventsOn('rick:event', callback);
}

export function onRickError(callback: (event: { error?: string }) => void): () => void {
  if (!window.runtime) return () => {};
  return window.runtime.EventsOn('rick:error', callback);
}

export function onRickStatus(callback: (status: RickStatus) => void): () => void {
  if (!window.runtime) return () => {};
  return window.runtime.EventsOn('rick:status', callback);
}

export function onUpdateAvailable(callback: (info: UpdateInfo) => void): () => void {
  if (!window.runtime) return () => {};
  return window.runtime.EventsOn('rick:update-available', callback);
}
