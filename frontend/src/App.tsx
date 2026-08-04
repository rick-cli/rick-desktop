import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowLeft, ArrowUp, ArrowUpFromLine, Bot, BrainCircuit, ChartColumnBig, Check, ChevronDown, CircleStop, Command, Cpu, Database, FileText, Gauge, Layers3, ListChecks, Palette, Paperclip, Redo2, RefreshCw, Search, Settings2, ShieldCheck, Target, Undo2, UsersRound, Wrench, X, Zap } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import { UsageInsights } from './components/UsageInsights';
import { useNotifications } from './components/Notifications';
import { ProvidersPanel } from './components/ProvidersPanel';
import { ToolsMCPPanel } from './components/ToolsMCPPanel';
import { UsageStatus, SessionTokens } from './components/UsageStatus';
import { addSystemMessage, addUserMessage, accumulateUsage, hydrateMessages, initialTimelineState, parseUsage, pendingApprovals, reduceRickEvent, resolvePermission, visibleMessages } from './lib/timeline';
import { commandSuggestions, applySuggestion, CommandSuggestion } from './lib/commands';
import { collectContextFiles } from './lib/workspace';
import { buildRunOptions } from './lib/runOptions';
import { Attachment, CommandSpec, DailyUsage, DesktopConfig, Goal, PermissionRequest, Provider, ResolvedConfig, RickStatus, RuntimeInfo, Session, SwarmActivity, TimelineBlock, TimelineMessage, TimelineState, UpdateInfo, Usage, UsageStats } from './lib/types';
import { executeRickCommand, deleteSession, exportSession, exportSettings, forkSession, getCommandCatalog, getConfig, getDefaultModel, getProviders, getResolvedConfig, getRickStatus, getRuntimeInfo, getSessionMessages, getSessions, getUpdateStatus, getUsageDaily, getUsageStats, importSettings, installRick, installUpdate, onRickError, onRickEvent, onRickStatus, onUpdateAvailable, pickFolder, renameSession, requestCompact, requestGoals, requestSnapshot, resetSettings, respondPermission, runPrompt, searchSessions, setSessionCategory, setSessionFavorite, stopRun, updateConfig } from './lib/wails';

function applyTheme(theme: DesktopConfig['theme']) {
  const normalized = theme === 'dark' ? 'graphite' : theme;
  document.documentElement.dataset.theme = normalized;
  document.documentElement.classList.toggle('dark', normalized !== 'light');
}

let lastDarkTheme: DesktopConfig['theme'] = 'graphite';

export default function App() {
  const { confirm, prompt, toast } = useNotifications();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [currentModel, setCurrentModel] = useState('');
  const [timeline, setTimeline] = useState<TimelineState>(initialTimelineState);
  // In-progress timelines for sessions running in the background while the
  // user views another thread, keyed by session id. Switching threads mid-run
  // keeps the live tool/swarm blocks the disk store does not persist.
  const backgroundTimelinesRef = useRef<Map<string, TimelineState>>(new Map());
  // Sessions with an active run, keyed by session id (green dot in sidebar).
  const [runningSessions, setRunningSessions] = useState<Record<string, boolean>>({});
  const runningSessionsRef = useRef<Record<string, boolean>>({});
  runningSessionsRef.current = runningSessions;
  const selectedSessionRef = useRef<Session | null>(null);
  selectedSessionRef.current = selectedSession;
  // The session currently being viewed, updated synchronously (not on render)
  // so event routing never races with React's commit of a selection change.
  const viewedSessionIdRef = useRef<string>('');
  const [showReasoning, setShowReasoning] = useState(true);
  const [desktopConfig, setDesktopConfig] = useState<DesktopConfig | null>(null);
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);
  const [liveUsage, setLiveUsage] = useState<Usage | null>(null);
  const [commandCatalog, setCommandCatalog] = useState<CommandSpec[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [initStatus, setInitStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [showSettings, setShowSettings] = useState(false);
  const [openSwarm, setOpenSwarm] = useState<SwarmActivity | null>(null);
  const [agentType, setAgentType] = useState('build');
  const [rickStatus, setRickStatus] = useState<RickStatus | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [installingRick, setInstallingRick] = useState(false);
  const [updating, setUpdating] = useState(false);

  const contextFiles = useMemo(() => collectContextFiles(timeline.messages), [timeline.messages]);
  const visible = useMemo(() => visibleMessages(timeline.messages), [timeline.messages]);

  const selectedModel = useMemo(() => {
    const [providerName, modelId] = currentModel.split('/');
    return providers.find(provider => provider.name === providerName)?.models.find(model => model.id === modelId) || null;
  }, [providers, currentModel]);

  const sessionTokens = useMemo<SessionTokens>(() => {
    const base = usageStats?.session;
    const live = liveUsage;
    return {
      input: (base?.input || 0) + (live?.input_tokens || 0),
      output: (base?.output || 0) + (live?.output_tokens || 0),
      cached: (base?.cached || 0) + (live?.cached_tokens || 0),
    };
  }, [usageStats, liveUsage]);

  const contextUsage = useMemo(() => {
    const input = sessionTokens.input;
    const cached = sessionTokens.cached;
    return {
      used: usageStats?.context_used || (input + cached),
      // The model's own context window wins, exactly like the TUI reads it
      // from the model info; the backend and event limits are fallbacks.
      limit: selectedModel?.context_window || usageStats?.context_limit || liveUsage?.context_limit || 0,
    };
  }, [sessionTokens, usageStats, selectedModel, liveUsage]);

  const refreshSessions = useCallback(() => getSessions().then(value => {
    const list = value || [];
    setSessions(list);
    // Re-sync the selected thread to its persisted entry (proper title/meta)
    // once the daemon has saved it, without losing the selection.
    setSelectedSession(current => current ? list.find(session => session.id === current.id) || current : current);
  }).catch(() => {}), []);
  const refreshUsage = useCallback(() => getUsageStats(selectedSession?.id || '', currentModel).then(value => { setUsageStats(value); setLiveUsage(null); }).catch(() => {}), [currentModel, selectedSession?.id]);
  const usageTimer = useRef<number | undefined>(undefined);
  const refreshUsageSoon = useCallback(() => {
    if (usageTimer.current !== undefined) window.clearTimeout(usageTimer.current);
    usageTimer.current = window.setTimeout(() => { refreshUsage(); }, 1500);
  }, [refreshUsage]);
  const patchConfig = useCallback((patch: Partial<DesktopConfig>) => {
    if (!desktopConfig) return;
    const next = { ...desktopConfig, ...patch };
    setDesktopConfig(next);
    if (patch.theme) {
      applyTheme(patch.theme);
      if (patch.theme !== 'light') lastDarkTheme = patch.theme;
    }
    updateConfig(next).catch(cause => setError(cause instanceof Error ? cause.message : 'Failed to save settings'));
  }, [desktopConfig]);

  useEffect(() => {
    Promise.all([getProviders().catch(() => []), getSessions().catch(() => []), getDefaultModel().catch(() => ''), getCommandCatalog().catch(() => []), getConfig().catch(() => null)])
      .then(([providerValue, sessionValue, modelValue, commandValue, config]) => {
        setProviders(providerValue || []);
        setSessions(sessionValue || []);
        setCurrentModel(modelValue || '');
        setCommandCatalog(commandValue || []);
        if (config) {
          setDesktopConfig(config);
          setShowReasoning(config.show_reasoning);
          applyTheme(config.theme);
          if (config.theme !== 'light') lastDarkTheme = config.theme;
          getUsageStats('', modelValue || '').then(setUsageStats).catch(() => {});
        }
        setInitStatus('ready');
      })
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : 'Failed to initialize Rick Desktop'); setInitStatus('error'); });
  }, []);

  useEffect(() => {
    if (initStatus === 'ready') refreshUsage();
  }, [initStatus, refreshUsage]);

  // Rick CLI availability drives the setup screen; the single startup update
  // check drives the manual update button in the header. Both also refresh
  // via backend events.
  useEffect(() => {
    getRickStatus().then(setRickStatus).catch(() => {});
    getUpdateStatus().then(setUpdateInfo).catch(() => {});
    const unsubscribeStatus = onRickStatus(setRickStatus);
    const unsubscribeUpdate = onUpdateAvailable(setUpdateInfo);
    return () => { unsubscribeStatus(); unsubscribeUpdate(); };
  }, []);

  const handleInstallRick = useCallback(async () => {
    setInstallingRick(true);
    try {
      setRickStatus(await installRick());
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Failed to install Rick');
    } finally {
      setInstallingRick(false);
    }
  }, []);

  const handleInstallUpdate = useCallback(async () => {
    setUpdating(true);
    try {
      await installUpdate();
      // The backend quits and relaunches the app once the swap is scheduled.
    } catch (cause: unknown) {
      setUpdating(false);
      setError(cause instanceof Error ? cause.message : 'Failed to install update');
    }
  }, []);

  // Cache hydrated messages per session so switching threads paints instantly
  // from memory and refreshes from disk in the background. Capped so long
  // sessions visited over a workday do not accumulate forever in memory.
  const sessionMessagesCache = useRef<Map<string, TimelineMessage[]>>(new Map());
  const applyHistory = useCallback((sessionId: string, hydrated: TimelineMessage[]) => {
    const cache = sessionMessagesCache.current;
    cache.delete(sessionId);
    cache.set(sessionId, hydrated);
    if (cache.size > 20) {
      const oldestSession = cache.keys().next().value;
      if (oldestSession !== undefined) cache.delete(oldestSession);
    }
    setTimeline(current => (current.loading && current.messages.length > 0 ? current : { ...initialTimelineState, messages: hydrated }));
  }, []);

  useEffect(() => {
    const unsubscribeEvent = onRickEvent((event) => {
      const sid = event.session_id || '';
      const kind = event.kind || event.event || event.type;
      const isTerminal = kind === 'run.completed' || kind === 'run.cancelled' || event.type === 'done';
      if (event.type === 'agents') {
        // The daemon reports live agent state on request; the desktop UI has
        // no live-agents frame, so these events carry nothing to render.
        return;
      }
      // Route events to the timeline of the session being viewed. A run in
      // any other thread must never bleed into the thread on screen.
      if (sid && sid !== viewedSessionIdRef.current) {
        const current = backgroundTimelinesRef.current.get(sid) || initialTimelineState;
        backgroundTimelinesRef.current.set(sid, reduceRickEvent(current, event));
      } else {
        setTimeline(current => reduceRickEvent(current, event));
        if (kind === 'usage') {
          // Usage events are per-call deltas: accumulate them into the live
          // display and only re-read persisted totals when the run completes,
          // so the numbers never bounce between stale disk state and live sums.
          setLiveUsage(current => accumulateUsage(current ?? undefined, event.usage || parseUsage(event.data)) ?? null);
        }
      }
      if (isTerminal) {
        if (sid) {
          // Update the ref synchronously so the focus handler can never
          // clobber the live timeline while a run is still winding down.
          const next = { ...runningSessionsRef.current };
          delete next[sid];
          runningSessionsRef.current = next;
          setRunningSessions(next);
        }
        refreshSessions();
        if (!sid || sid === viewedSessionIdRef.current) refreshUsageSoon();
      }
    });
    const unsubscribeError = onRickError((event) => setError(event.error || 'Rick reported an error'));
    return () => { unsubscribeEvent(); unsubscribeError(); };
  }, [refreshSessions, refreshUsageSoon]);

  // Refocusing the window pulls in sessions/messages created by the Rick CLI
  // in the same shared session store, so history stays in sync both ways.
  useEffect(() => {
    const onFocus = () => {
      refreshSessions();
      const current = selectedSessionRef.current;
      if (current?.id && !runningSessionsRef.current[current.id] && !backgroundTimelinesRef.current.has(current.id)) {
        getSessionMessages(current.id).then(history => applyHistory(current.id, hydrateMessages(history || []))).catch(() => {});
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshSessions, selectedSession?.id, applyHistory]);

  const handleApprove = useCallback(async (permission: PermissionRequest, decision: 'accept' | 'reject' | 'always') => {
    setTimeline(current => resolvePermission(current, permission.request_id, decision === 'accept' ? 'approved' : decision === 'always' ? 'always' : 'rejected'));
    try {
      await respondPermission(permission.request_id, decision);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Failed to send approval');
      setTimeline(current => resolvePermission(current, permission.request_id, 'pending'));
    }
  }, []);

  const handleUndoRedo = useCallback(async (action: 'undo' | 'redo') => {
    try {
      const result = await requestSnapshot(action);
      if (result && (result as { error?: string }).error) {
        setError((result as { error: string }).error);
      } else if (result) {
        refreshSessions();
      }
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : `Failed to ${action}`);
    }
  }, [refreshSessions]);

  const handleStop = useCallback(async () => {
    // Optimistically stop the UI immediately; the daemon reports the
    // definitive cancelled/done state on the stream.
    setTimeline(current => reduceRickEvent(current, { type: 'cancelled' }));
    try { await stopRun(viewedSessionIdRef.current || ''); } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'Failed to stop Rick'); }
  }, []);

  const handleNewChat = useCallback(() => {
    // Reset the view only: each thread owns its own timeline now, so runs in
    // other sessions keep streaming and can be resumed from the sidebar.
    viewedSessionIdRef.current = '';
    setSelectedSession(null);
    setTimeline(initialTimelineState);
    setLiveUsage(null);
    setError(undefined);
  }, []);

  const handleSend = useCallback(async (text: string, attachments: Attachment[] = []) => {
    if (timeline.loading) return;
    const slashMatch = text.match(/^\/([^\s]+)/);
    const command = slashMatch?.[1]?.toLowerCase();
    const rest = slashMatch ? text.slice(slashMatch[0].length).trim() : text;

    // Native commands are handled entirely inside the desktop.
    const native: Record<string, () => Promise<void> | void> = {
      new: () => handleNewChat(),
      clear: () => handleNewChat(),
      help: () => { setTimeline(current => addSystemMessage(current, 'Available commands: ' + commandCatalog.map(spec => `/${spec.name}`).join(', '))); },
      settings: () => setShowSettings(true),
      stop: () => handleStop(),
      undo: () => handleUndoRedo('undo'),
      redo: () => handleUndoRedo('redo'),
      snapshot: async () => {
        const action = (rest.split(/\s+/)[0] || 'list') as 'list' | 'snapshot' | 'undo' | 'redo';
        if (action === 'undo' || action === 'redo') await handleUndoRedo(action);
        else {
          const result = await requestSnapshot(action);
          setTimeline(current => addSystemMessage(current, `snapshot: ${JSON.stringify(result)}`));
        }
      },
      compact: async () => {
        if (!selectedSession) { setTimeline(current => addSystemMessage(current, 'compact: no session selected')); return; }
        const result = await requestCompact(selectedSession.id);
        setTimeline(current => addSystemMessage(current, result ? `context compacted\n\n${String((result as Record<string, unknown>).summary || '')}` : 'compact produced no summary'));
      },
      goal: async () => {
        if (!rest) { const result = await requestGoals('list'); setTimeline(current => addSystemMessage(current, `goals: ${JSON.stringify(result)}`)); return; }
        const result = await requestGoals('create', { title: rest, status: 'active' });
        setTimeline(current => addSystemMessage(current, `goal created: ${rest}`));
      },
      models: async () => { setProviders(await getProviders().catch(() => [])); },
      model: () => setTimeline(current => addSystemMessage(current, `model: ${currentModel}`)),
      agent: () => { const value = rest.split(/\s+/)[0]; if (['build', 'general', 'explore'].includes(value)) setAgentType(value); },
      thinking: () => { const value = rest.split(/\s+/)[0]; if (['auto', 'off', 'low', 'medium', 'high'].includes(value)) patchConfig({ thinking_mode: value as DesktopConfig['thinking_mode'] }); },
      permissions: () => { const value = rest.split(/\s+/)[0]; if (['readonly', 'standard', 'trusted', 'ci'].includes(value)) patchConfig({ permission_profile: value as DesktopConfig['permission_profile'] }); },
      permission: () => { const value = rest.split(/\s+/)[0]; if (['readonly', 'standard', 'trusted', 'ci'].includes(value)) patchConfig({ permission_profile: value as DesktopConfig['permission_profile'] }); },
      sandbox: () => { const value = rest.split(/\s+/)[0]; if (['read-only', 'workspace-write', 'trusted', 'off'].includes(value)) patchConfig({ sandbox: value as DesktopConfig['sandbox'] }); },
      yolo: () => patchConfig({ yolo: !(desktopConfig?.yolo || false) }),
      theme: () => { const value = rest.split(/\s+/)[0]; if (['charcoal', 'graphite', 'midnight', 'dracula', 'nord', 'gruvbox', 'github-dark', 'tokyo-night', 'catppuccin', 'one-dark', 'solarized-dark', 'light', 'system'].includes(value)) { patchConfig({ theme: value as DesktopConfig['theme'] }); applyTheme(value as DesktopConfig['theme']); } },
      tools: () => setShowSettings(true),
      mcp: () => setShowSettings(true),
      plugins: () => setShowSettings(true),
      stats: () => setShowSettings(true),
      sessions: async () => { await refreshSessions(); },
      search: async () => {
        if (!rest) { setTimeline(current => addSystemMessage(current, 'usage: /search <query>')); return; }
        const results = await searchSessions(rest).catch(() => []);
        setTimeline(current => addSystemMessage(current, results.length ? `found ${results.length} session(s):\n${results.map(s => `${s.title} (${s.id})`).join('\n')}` : `no sessions match "${rest}"`));
      },
      fork: async () => {
        const id = rest.split(/\s+/)[0];
        if (!id) { setTimeline(current => addSystemMessage(current, 'usage: /fork <session-id>')); return; }
        const fork = await forkSession(id);
        if (fork) { await refreshSessions(); setSelectedSession(fork); setTimeline(current => addSystemMessage(current, `forked: ${fork.title}`)); }
      },
      rename: async () => {
        const [id, ...titleParts] = rest.split(/\s+/);
        const title = titleParts.join(' ');
        if (!id || !title) { setTimeline(current => addSystemMessage(current, 'usage: /rename <session-id> <title>')); return; }
        await renameSession(id, title); await refreshSessions();
        setTimeline(current => addSystemMessage(current, `renamed ${id} → ${title}`));
      },
      category: async () => {
        const [id, ...categoryParts] = rest.split(/\s+/);
        if (!id) { setTimeline(current => addSystemMessage(current, 'usage: /category <session-id> [category]')); return; }
        await setSessionCategory(id, categoryParts.join(' ')); await refreshSessions();
      },
      favorite: async () => {
        const id = rest.split(/\s+/)[0];
        if (!id) { setTimeline(current => addSystemMessage(current, 'usage: /favorite <session-id>')); return; }
        const target = sessions.find(session => session.id === id);
        await setSessionFavorite(id, !(target?.favorite));
        await refreshSessions();
      },
      run: async () => {
        const prompt = rest || text;
        const existingSession = selectedSession;
        const sessionId = existingSession?.id || `desk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        viewedSessionIdRef.current = sessionId;
        if (!existingSession) {
          const now = new Date().toISOString();
          setSessions(current => [{ id: sessionId, title: prompt.slice(0, 60) || 'New thread', cwd: desktopConfig?.workspace_path || '', model: currentModel, messages: 0, created: now, updated: now }, ...current]);
          setSelectedSession({ id: sessionId, title: prompt.slice(0, 60) || 'New thread', cwd: desktopConfig?.workspace_path || '', model: currentModel, messages: 0, created: now, updated: now });
        }
        setRunningSessions(current => ({ ...current, [sessionId]: true }));
        runningSessionsRef.current = { ...runningSessionsRef.current, [sessionId]: true };
        setError(undefined);
        setTimeline(current => addUserMessage(current, prompt, attachments.map(att => ({ name: att.name, media_type: att.media_type, size: att.size }))));
        await runPrompt(prompt, currentModel, sessionId, buildRunOptions(desktopConfig, agentType, attachments, existingSession?.cwd || desktopConfig?.workspace_path));
      },
    };
    if (native[command!]) {
      try { await native[command!](); } catch (cause: unknown) { setTimeline(current => addSystemMessage(current, cause instanceof Error ? cause.message : 'Command failed')); }
      return;
    }

    const commandSpec = commandCatalog.find(spec => spec.name.toLowerCase() === command || spec.aliases?.some(alias => alias.toLowerCase() === command));
    if (commandSpec?.mode === 'cli') {
      if (commandSpec.dangerous && !(await confirm({ title: `Run dangerous Rick command /${commandSpec.name}?`, message: 'This command can modify files or reach external systems. Only continue if you trust it.', confirmLabel: 'Run command', tone: 'danger' }))) return;
      try {
        const result = await executeRickCommand(text, true);
        const output = result.output || `(exit ${result.exit_code})`;
        setTimeline(current => addSystemMessage(current, `$ rick ${result.command}\n${output}`));
      } catch (cause: unknown) {
        setTimeline(current => addSystemMessage(current, cause instanceof Error ? cause.message : 'Rick command failed'));
      }
      return;
    }
    // Mint the session id up front so the sidebar entry exists the moment the
    // message is sent (the daemon only persists it when the run completes).
    const existingSession = selectedSession;
    const sessionId = existingSession?.id || `desk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Synchronous: the just-dispatched run's first events can arrive before
    // React commits the placeholder selection, so route by this ref.
    viewedSessionIdRef.current = sessionId;
    if (!existingSession) {
      const now = new Date().toISOString();
      const placeholder: Session = {
        id: sessionId,
        title: text.slice(0, 60) || 'New thread',
        cwd: desktopConfig?.workspace_path || '',
        model: currentModel,
        messages: 0,
        created: now,
        updated: now,
      };
      setSessions(current => [placeholder, ...current]);
      setSelectedSession(placeholder);
    }
    setRunningSessions(current => ({ ...current, [sessionId]: true }));
    runningSessionsRef.current = { ...runningSessionsRef.current, [sessionId]: true };
    setError(undefined);
    setTimeline(current => addUserMessage(current, text, attachments.map(att => ({ name: att.name, media_type: att.media_type, size: att.size }))));
    try {
      await runPrompt(text, currentModel, sessionId, buildRunOptions(desktopConfig, agentType, attachments, existingSession?.cwd || desktopConfig?.workspace_path));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Failed to start Rick');
      setTimeline(current => reduceRickEvent(current, { type: 'error', error: cause instanceof Error ? cause.message : 'Failed to start Rick' }));
    }
  }, [agentType, commandCatalog, confirm, currentModel, desktopConfig?.yolo, handleNewChat, handleStop, handleUndoRedo, patchConfig, refreshSessions, selectedSession, sessions, setShowSettings, timeline.loading]);


  const handleSelectSession = useCallback(async (session: Session) => {
    // Stash the currently viewed in-progress timeline before switching so its
    // live tool/swarm blocks are not lost when coming back to it.
    setTimeline(current => {
      const previous = selectedSessionRef.current;
      if (previous && previous.id !== session.id) backgroundTimelinesRef.current.set(previous.id, current);
      return current;
    });
    setSelectedSession(session);
    // Synchronous: route this session's events to the main timeline before
    // React commits the new selection.
    viewedSessionIdRef.current = session.id;
    setLiveUsage(null);
    refreshUsage();
    const live = backgroundTimelinesRef.current.get(session.id);
    if (live) { setTimeline(live); return; }
    const cached = sessionMessagesCache.current.get(session.id);
    setTimeline({ ...initialTimelineState, messages: cached || [] });
    const history = await getSessionMessages(session.id).catch(() => []);
    applyHistory(session.id, hydrateMessages(history || []));
  }, [applyHistory, refreshUsage]);

  const handlePickFolder = useCallback(async () => {
    try {
      const path = await pickFolder();
      if (path) patchConfig({ workspace_path: path });
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Failed to choose folder');
    }
  }, [patchConfig]);

  const applySessionPatch = useCallback((patch: Partial<Session>) => {
    setSelectedSession(current => current ? { ...current, ...patch } : current);
  }, []);

  const handleRenameSession = useCallback(async (session: Session, title: string) => {
    try { await renameSession(session.id, title); applySessionPatch({ title }); await refreshSessions(); }
    catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'Failed to rename session'); }
  }, [applySessionPatch, refreshSessions]);

  const handleSetCategory = useCallback(async (session: Session, category: string) => {
    try { await setSessionCategory(session.id, category); applySessionPatch({ category: category || undefined }); await refreshSessions(); }
    catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'Failed to set category'); }
  }, [applySessionPatch, refreshSessions]);

  const handleSetFavorite = useCallback(async (session: Session, fav: boolean) => {
    try { await setSessionFavorite(session.id, fav); applySessionPatch({ favorite: fav }); await refreshSessions(); }
    catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'Failed to update favorite'); }
  }, [applySessionPatch, refreshSessions]);

  const handleDeleteSession = useCallback(async (session: Session) => {
    if (!(await confirm({ title: `Delete session "${session.title}"?`, message: 'This cannot be undone. The thread and its history will be permanently removed.', confirmLabel: 'Delete', tone: 'danger' }))) return;
    try {
      await deleteSession(session.id);
      toast({ title: 'Session deleted', message: session.title, tone: 'success' });
      if (selectedSession?.id === session.id) { setSelectedSession(null); setTimeline(initialTimelineState); }
      await refreshSessions();
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'Failed to delete session'); }
  }, [confirm, refreshSessions, selectedSession?.id, toast]);

  const handleForkSession = useCallback(async (session: Session) => {
    try {
      const fork = await forkSession(session.id);
      if (fork) { await refreshSessions(); setSelectedSession(fork); }
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'Failed to fork session'); }
  }, [refreshSessions]);

  const handleExportSession = useCallback(async (session: Session) => {
    try {
      const payload = await exportSession(session.id);
      const blob = new Blob([payload], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${session.title.replace(/[^a-z0-9-_ ]/gi, '').trim().replace(/\s+/g, '-') || session.id}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'Failed to export session'); }
  }, []);

  if (initStatus === 'loading') return <div className="flex h-screen w-screen items-center justify-center bg-background"><div className="text-center"><span className="mx-auto flex h-14 w-14 animate-pulse items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary"><Bot size={26} /></span><div className="mt-4 text-base font-medium text-foreground">Opening Rick Desktop</div><div className="mt-1 text-sm text-muted-foreground">Connecting your local workspace…</div></div></div>;
  if (initStatus === 'error') return <div className="flex h-screen w-screen items-center justify-center bg-background p-6"><div className="flat-panel max-w-md rounded-lg p-7 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground"><CircleStop size={22} /></span><h2 className="mt-4 text-lg font-semibold text-foreground">Rick couldn’t start</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{error}</p><p className="mt-4 text-xs text-muted-foreground/70">Check that Rick is installed and rickserve is available on PATH.</p></div></div>;
  if (showSettings) return <SettingsPage onClose={() => setShowSettings(false)} initialConfig={desktopConfig} />;
  if (initStatus === 'ready' && rickStatus && !rickStatus.installed) return <SetupScreen status={rickStatus} busy={installingRick} error={error} onInstall={handleInstallRick} />;

  return <div className="flex h-screen w-screen overflow-hidden bg-background"><Sidebar sessions={sessions} selectedSession={selectedSession} runningSessions={runningSessions} contextFiles={contextFiles} workspacePath={desktopConfig?.workspace_path} onPickFolder={handlePickFolder} onSelectSession={handleSelectSession} onNewChat={handleNewChat} onOpenSettings={() => setShowSettings(true)} onRenameSession={handleRenameSession} onSetCategory={handleSetCategory} onSetFavorite={handleSetFavorite} onDeleteSession={handleDeleteSession} onForkSession={handleForkSession} onExportSession={handleExportSession} /><div className="flex flex-1 flex-col app-shell"><header className="header"><div className="left"><span className="repo">{selectedSession?.cwd || 'rick-desktop'}</span><span className="sep">/</span><span className="branch"><span className="branchGlyph">⑂</span><span className="branchText">{selectedSession?.title || 'New thread'}</span></span></div><div className="right">{updateInfo?.update_available && <button type="button" onClick={handleInstallUpdate} disabled={updating} title={updateInfo.release_notes ? `Update to v${updateInfo.latest_version}\n\n${updateInfo.release_notes}` : `Update to v${updateInfo.latest_version}`} className="update-pill">{updating ? <RefreshCw size={12} className="animate-spin" /> : <ArrowDownToLine size={12} />}{updating ? 'Updating…' : `Update to v${updateInfo.latest_version}`}</button>}<button type="button" onClick={() => handleUndoRedo('undo')} title="Undo last change (snapshot)" className="iconBtn"><Undo2 size={13} /></button><button type="button" onClick={() => handleUndoRedo('redo')} title="Redo change (snapshot)" className="iconBtn"><Redo2 size={13} /></button><button type="button" onClick={refreshSessions} title="Refresh sessions" className="iconBtn"><RefreshCw size={13} /></button></div></header><main className="flex-1 overflow-hidden"><ChatPage messages={visible} loading={timeline.loading} error={error || timeline.error} commandCatalog={commandCatalog} showReasoning={showReasoning} providers={providers} currentModel={currentModel} onModelChange={setCurrentModel} thinkingMode={desktopConfig?.thinking_mode || 'auto'} onThinkingModeChange={value => patchConfig({ thinking_mode: value as DesktopConfig['thinking_mode'] })} yolo={desktopConfig?.yolo || false} onYoloChange={value => patchConfig({ yolo: value })} permission={desktopConfig?.permission_profile || 'standard'} onPermissionChange={value => patchConfig({ permission_profile: value as DesktopConfig['permission_profile'] })} onSend={handleSend} onStop={handleStop} onOpenSwarm={setOpenSwarm} agentType={agentType} onAgentTypeChange={setAgentType} onRespondPermission={handleApprove} pendingApprovals={pendingApprovals(timeline.messages)} selectedSession={selectedSession?.id} tokenUsage={sessionTokens} contextUsed={contextUsage.used} contextLimit={contextUsage.limit} /></main></div>{openSwarm && <SwarmInspector swarm={openSwarm} onClose={() => setOpenSwarm(null)} />}</div>;
}

function SetupScreen({ status, busy, error, onInstall }: { status: RickStatus; busy: boolean; error?: string; onInstall: () => void }) {
  return <div className="flex h-screen w-screen items-center justify-center bg-background p-6"><div className="flat-panel w-full max-w-md rounded-lg p-8 text-center"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary"><Bot size={26} /></span><h1 className="mt-5 text-xl font-semibold text-foreground">Welcome to Rick Desktop</h1><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Rick Desktop drives the <span className="font-mono text-foreground">rick</span> CLI in a visual workspace. The CLI and its <span className="font-mono text-foreground">rickserve</span> daemon are required and will be installed automatically.</p><div className="mt-6 space-y-2 text-left">{!status.rick_path ? <div className="flex items-center justify-between rounded-lg border border-border bg-muted px-3 py-2 text-xs"><span className="text-foreground">rick CLI</span><span className="text-muted-foreground">Not found</span></div> : <div className="flex items-center justify-between rounded-lg border border-border bg-muted px-3 py-2 text-xs"><span className="text-foreground">rick CLI</span><span className="font-mono text-foreground">{status.rick_version}</span></div>}<div className="flex items-center justify-between rounded-lg border border-border bg-muted px-3 py-2 text-xs"><span className="text-foreground">rickserve daemon</span><span className="text-muted-foreground">{status.rickserve_path ? 'Found' : 'Not found'}</span></div><div className="flex items-center justify-between rounded-lg border border-border bg-muted px-3 py-2 text-xs"><span className="text-foreground">Installs to</span><span className="font-mono text-muted-foreground">{status.install_dir}</span></div></div>{error && <div className="mt-4 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-foreground">{error}</div>}<button type="button" disabled={busy} onClick={onInstall} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/85 disabled:opacity-60">{busy ? <><RefreshCw size={14} className="animate-spin" />Installing Rick…</> : <><ArrowDownToLine size={14} />Install Rick</>}</button><p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">Installing downloads the official binaries from GitHub. Existing rick installations are left untouched.</p></div></div>;
}

function SwarmInspector({ swarm, onClose }: { swarm: SwarmActivity; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center overlay-scrim p-6" onMouseDown={onClose}><div className="flat-panel max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg p-5" onMouseDown={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') onClose(); }} role="dialog" aria-modal="true" aria-label="Swarm team activity"><div className="flex items-center justify-between"><div><h2 className="text-lg font-semibold text-foreground">{swarm.title || 'Swarm team'}</h2><p className="text-xs text-muted-foreground">{swarm.status} · {swarm.agents.length} agents</p></div><button autoFocus type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-muted-foreground hover:bg-surface-2">Close</button></div><div className="mt-5 space-y-2">{swarm.agents.map(agent => <div key={agent.id} className="rounded-xl border border-border bg-surface-2 p-3"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${agent.status === 'completed' ? 'bg-foreground/70' : agent.status === 'failed' ? 'bg-muted-foreground/70' : 'animate-pulse bg-primary'}`} /><span className="font-medium text-foreground">{agent.name || agent.id}</span><span className="ml-auto text-xs text-muted-foreground">{agent.status}</span></div><div className="mt-1 text-xs text-muted-foreground">{agent.action || agent.current_tool || agent.task || agent.result || agent.error || 'Waiting for activity'}</div></div>)}</div>{swarm.final_result && <div className="mt-4 rounded-xl border border-border bg-muted p-3 text-sm text-foreground">{swarm.final_result}</div>}</div></div>;
}

function OptionDropdown({ icon, label, value, options, onChange }: { icon: React.ReactNode; label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = options.find(option => option.value === value);
  return <div className="codex-dropdown relative">
    {open && <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />}
    <button type="button" onClick={() => setOpen(current => !current)} aria-expanded={open} aria-haspopup="listbox" aria-label={`${label}: ${selected?.label || value}`} className={`control-trigger flex items-center gap-1.5 ${open ? 'is-open' : ''}`}>
      {icon}
      <span className="hidden text-[10px] text-muted-foreground lg:inline">{label}</span>
      <span className="text-[11px] text-foreground">{selected?.label ?? value}</span>
      <ChevronDown size={11} className={`text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && <div className="dropdown-popover absolute z-40 w-44 overflow-hidden rounded-lg p-1.5" role="listbox" aria-label={label}>
      {options.map(option => <button type="button" role="option" aria-selected={value === option.value} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }} className={`dropdown-option flex w-full items-center justify-between ${value === option.value ? 'is-selected' : ''}`}><span>{option.label}</span>{value === option.value && <Check size={12} />}</button>)}
    </div>}
  </div>;
}

function ThinkingSelector({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <OptionDropdown icon={<BrainCircuit size={13} className="text-muted-foreground" />} label="Thinking" value={value} onChange={onChange} options={[{ value: 'auto', label: 'Auto' }, { value: 'off', label: 'Off' }, { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} />;
}

function PermissionSelector({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <OptionDropdown icon={<ShieldCheck size={13} className="text-muted-foreground" />} label="Permissions" value={value} onChange={onChange} options={[{ value: 'readonly', label: 'Read only' }, { value: 'standard', label: 'Standard' }, { value: 'trusted', label: 'Trusted' }, { value: 'ci', label: 'CI' }]} />;
}

const AGENT_TYPES = [
  { value: 'build', label: 'Build' },
  { value: 'general', label: 'General' },
  { value: 'explore', label: 'Explore' },
];

function AgentSelector({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <OptionDropdown icon={<Bot size={13} className="text-muted-foreground" />} label="Agent" value={value} onChange={onChange} options={AGENT_TYPES.map(type => ({ value: type.value, label: type.label }))} />;
}

function YoloToggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return <button type="button" onClick={() => onChange(!value)} title={value ? 'YOLO mode on — approvals are auto-approved' : 'YOLO mode off'} aria-pressed={value} className={`control-trigger yolo-toggle flex items-center gap-1.5 ${value ? 'is-on' : ''}`}>
    <Zap size={13} className={value ? 'text-foreground' : 'text-muted-foreground'} />
    <span className="hidden text-[10px] lg:inline">YOLO</span>
    <span className="yolo-switch" />
  </button>;
}

function formatModelLabel(value: string) {
  return value.replace(/[-_]+/g, ' ').replace(/\b\w/g, character => character.toUpperCase()).replace(/Deepseek/gi, 'DeepSeek').replace(/Gpt/g, 'GPT');
}

function ModelSelector({ providers, currentModel, onModelChange }: { providers: Provider[]; currentModel: string; onModelChange: (model: string) => void }) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<string>();
  const [query, setQuery] = useState('');
  const models = (providers.find(value => value.name === provider)?.models || []).filter(value => !query || `${value.name} ${value.id}`.toLowerCase().includes(query.toLowerCase()));
  const selectedModel = providers.flatMap(value => value.models.map(model => ({ ...model, key: `${value.name}/${model.id}` }))).find(model => model.key === currentModel);
  const selectedLabel = formatModelLabel(selectedModel?.name || currentModel.split('/').pop() || 'Select model');
  return <div className="relative"><button type="button" onClick={() => { setOpen(value => !value); setProvider(undefined); }} className={`control-trigger flex max-w-[300px] items-center gap-1.5 ${open ? 'is-open' : ''}`}><Cpu size={13} className="shrink-0 text-muted-foreground" /><span className="max-w-44 truncate text-[11px] text-foreground">{selectedLabel}</span><ChevronDown size={11} className={`text-muted-foreground transition ${open ? 'rotate-180' : ''}`} /></button>{open && <div className="dropdown-popover absolute right-0 top-full z-40 mt-1 w-80 overflow-hidden rounded-lg p-1.5">{!provider ? <><div className="px-2 pb-1 pt-1 text-[9px] font-medium uppercase tracking-[.1em] text-muted-foreground">Choose provider</div>{providers.map(value => <button type="button" key={value.name} onClick={() => setProvider(value.name)} className="dropdown-option flex w-full items-center justify-between"><span>{value.label}</span><span className="text-[9px] text-muted-foreground">{value.models.length}</span></button>)}</> : <><button type="button" onClick={() => { setProvider(undefined); setQuery(''); }} className="mb-1 inline-flex items-center gap-1 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"><ArrowLeft size={11} />Providers</button><label className="relative mb-1 block"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" size={12} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search models…" className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-xs text-foreground outline-none focus:border-primary" /></label><div className="max-h-80 overflow-y-auto">{models.slice(0, 80).map(model => { const modelKey = `${provider}/${model.id}`; return <button type="button" key={model.id} onClick={() => { onModelChange(modelKey); setOpen(false); setProvider(undefined); setQuery(''); }} className={`dropdown-option flex w-full items-center justify-between ${currentModel === modelKey ? 'bg-surface-2' : ''}`}><span className="truncate">{model.name}</span><span className="ml-3 shrink-0 text-[9px] text-muted-foreground">{model.context_window ? `${Math.round(model.context_window / 1000)}k` : ''}</span></button>; })}</div></>}</div>}</div>;
}



interface ChatPageProps {
  messages: TimelineMessage[];
  loading: boolean;
  error?: string;
  commandCatalog: CommandSpec[];
  showReasoning: boolean;
  providers: Provider[];
  currentModel: string;
  onModelChange: (model: string) => void;
  thinkingMode: string;
  onThinkingModeChange: (value: string) => void;
  onSend: (text: string, attachments?: Attachment[]) => void;
  onStop: () => void;
  onOpenSwarm?: (swarm: SwarmActivity) => void;
  yolo: boolean;
  onYoloChange: (value: boolean) => void;
  permission: string;
  onPermissionChange: (value: string) => void;
  agentType: string;
  onAgentTypeChange: (value: string) => void;
  onRespondPermission: (permission: PermissionRequest, decision: 'accept' | 'reject' | 'always') => void;
  pendingApprovals: PermissionRequest[];
  selectedSession?: string;
  tokenUsage: SessionTokens;
  contextUsed: number;
  contextLimit: number;
}

export function ChatPage({ messages, loading, error, commandCatalog, showReasoning, providers, currentModel, onModelChange, thinkingMode, onThinkingModeChange, onSend, onStop, onOpenSwarm, yolo, onYoloChange, permission, onPermissionChange, agentType, onAgentTypeChange, onRespondPermission, pendingApprovals, selectedSession, tokenUsage, contextUsed, contextLimit }: ChatPageProps) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | undefined>();
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const suggestions = useMemo(() => commandSuggestions(input, commandCatalog), [input, commandCatalog]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => setSuggestionIndex(0), [input]);

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setAttachmentError(undefined);
    const next: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 10 * 1024 * 1024) {
        setAttachmentError(`${file.name} is larger than 10 MB and cannot be attached.`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const data = (reader.result as string).split(',')[1] || '';
        const mediaType = file.type || mediaTypeFor(file.name);
        setAttachments(current => [...current, { name: file.name, media_type: mediaType, data, size: file.size }]);
      };
      reader.onerror = () => setAttachmentError(`Could not read ${file.name}.`);
      reader.readAsDataURL(file);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(current => current.filter((_, i) => i !== index));
  };

  const submit = () => {
    if ((!input.trim() && attachments.length === 0) || loading) return;
    onSend(input.trim(), attachments);
    setInput('');
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setSuggestionIndex(current => (current + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
      return;
    }
    if (suggestions.length > 0 && event.key === 'Tab') {
      event.preventDefault();
      setInput(applySuggestion(input, suggestions[suggestionIndex]));
      return;
    }
    if (event.key === 'Escape' && suggestions.length > 0) {
      event.preventDefault();
      setInput('');
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="reference-chat flex-1 overflow-y-auto chat-scroll-fade">
        <div className="mx-auto w-full max-w-[760px]">
          {messages.length === 0 && !error && <Welcome onPick={onSend} />}
          {messages.length > 0 && <Timeline messages={messages} loading={loading} showReasoning={showReasoning} modelLabel={currentModel} onOpenSwarm={onOpenSwarm} onRespondPermission={onRespondPermission} />}
          {pendingApprovals.length > 0 && <div className="codex-approval-banner mt-3 flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-[11px] text-muted-foreground"><ShieldCheck size={13} />{pendingApprovals.length} approval{pendingApprovals.length === 1 ? '' : 's'} waiting in the timeline above</div>}
          {error && <div className="codex-error">{error}</div>}
          <div ref={messagesEndRef} />
        </div>
      </div>
      <div className="codex-composer-shell">
        <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="mx-auto w-full max-w-[760px]">
          <div className="relative">
            {suggestions.length > 0 && <CommandMenu suggestions={suggestions} selected={suggestionIndex} onSelect={(suggestion) => { setInput(applySuggestion(input, suggestion)); textareaRef.current?.focus(); }} />}
            <div className="reference-composer">
              <div className="flex items-start gap-2.5">
                <button type="button" onClick={() => fileInputRef.current?.click()} title="Attach a file (images go to vision-capable models)" className="codex-attach-button" aria-label="Attach a file">
                  <Paperclip size={15} />
                </button>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={event => { addFiles(event.target.files); event.target.value = ''; }} />
                <textarea ref={textareaRef} value={input} aria-label="Message Rick" onChange={(event) => { setInput(event.target.value); event.target.style.height = 'auto'; event.target.style.height = `${Math.min(event.target.scrollHeight, 160)}px`; }} onKeyDown={handleKeyDown} placeholder="Describe a task, ask a question, or paste code…" rows={2} className="min-w-0 flex-1 resize-none bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none" style={{ maxHeight: '160px' }} />
                <div className="flex shrink-0 items-center gap-2 self-center">
                  {loading ? <button type="button" onClick={onStop} className="codex-stop-button">Stop</button> : <button type="submit" disabled={!input.trim() && attachments.length === 0} className="codex-send-button" aria-label="Send"><ArrowUp size={15} strokeWidth={2.2} /></button>}
                </div>
              </div>
              {attachments.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">
                {attachments.map((att, index) => <span key={`${att.name}-${index}`} className="codex-attachment-chip">
                  <FileText size={11} className="shrink-0" />
                  <span className="max-w-[180px] truncate">{att.name}</span>
                  <span className="text-[9px] opacity-60">{formatBytes(att.size)}</span>
                  <button type="button" onClick={() => removeAttachment(index)} className="codex-attachment-remove" aria-label={`Remove ${att.name}`}><X size={11} /></button>
                </span>)}
              </div>}
              {attachmentError && <div className="mt-2 text-[11px] text-foreground">{attachmentError}</div>}
              <div className="codex-composer-toolbar">
                <div className="flex min-w-0 items-center gap-1.5 overflow-visible">
                  <div className="codex-composer-model"><ModelSelector providers={providers} currentModel={currentModel} onModelChange={onModelChange} /></div>
                  <AgentSelector value={agentType} onChange={onAgentTypeChange} />
                  <ThinkingSelector value={thinkingMode} onChange={onThinkingModeChange} />
                  <YoloToggle value={yolo} onChange={onYoloChange} />
                  <PermissionSelector value={permission} onChange={onPermissionChange} />
                </div>
              </div>
            </div>
          </div>
          <div className="hint">Rick can make mistakes. Review changes before applying.</div>
        </form>
        <div className="composer-statusbar">
          <div className="composer-statusbar-left"><span>Local · {permission === 'readonly' ? 'Read only' : permission.charAt(0).toUpperCase() + permission.slice(1)}</span>{yolo && <span className="text-foreground">YOLO enabled</span>}</div>
          <UsageStatus tokens={tokenUsage} contextUsed={contextUsed} contextLimit={contextLimit} />
        </div>
      </div>
    </div>
  );
}

function Welcome({ onPick }: { onPick: (text: string, attachments?: Attachment[]) => void }) {
  const tiles = [
    { tag: '~/', prompt: 'Explain the structure of this project and how the main flow works.' },
    { tag: '+', prompt: 'Find and fix the most obvious bug in this codebase.' },
    { tag: '!', prompt: 'Suggest and implement a small feature that fits this project.' },
    { tag: '?', prompt: 'Review my recent changes for correctness and style.' },
  ];
  return (
    <div className="codex-welcome">
      <span className="codex-welcome-mark"><Bot size={24} strokeWidth={1.8} /></span>
      <h2 className="heading">What should we build?</h2>
      <p className="subtext">Describe a task and Rick will plan, edit, and test across your repository.</p>
      <div className="chips">
        {tiles.map(tile => (
          <button type="button" key={tile.tag} onClick={() => onPick(tile.prompt, [])} className="chip">
            <span className="chipTag">{tile.tag}</span>
            <span className="chipText">{tile.prompt}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value || 0);
}

function mediaTypeFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const image = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff', 'tif', 'ico'];
  if (image.includes(ext)) return `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  return 'text/plain';
}

function formatBytes(value?: number): string {
  if (!value) return '';
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function CommandMenu({ suggestions, selected, onSelect }: { suggestions: CommandSuggestion[]; selected: number; onSelect: (suggestion: CommandSuggestion) => void }) { return <div className="dropdown-popover absolute bottom-full left-0 z-30 mb-2 w-full overflow-hidden rounded-lg p-1">{suggestions.slice(0, 8).map((suggestion, index) => <button type="button" key={`${suggestion.spec.name}-${suggestion.argument || ''}`} onMouseDown={(event) => { event.preventDefault(); onSelect(suggestion); }} className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] ${index === selected ? 'bg-surface-2 text-foreground' : 'text-foreground hover:bg-surface-2'}`}><Command size={12} className="text-muted-foreground" /><span className="font-mono text-foreground">/{suggestion.matchedAlias || suggestion.spec.name}</span><span className="truncate text-[10px] text-muted-foreground">{suggestion.argument || suggestion.spec.description}</span>{suggestion.spec.dangerous && <span className="ml-auto text-[9px] uppercase tracking-wider text-muted-foreground">Approval</span>}</button>)}</div>; }

function Timeline({ messages, loading, showReasoning, modelLabel, onOpenSwarm, onRespondPermission }: { messages: TimelineMessage[]; loading: boolean; showReasoning: boolean; modelLabel: string; onOpenSwarm?: (swarm: SwarmActivity) => void; onRespondPermission: (permission: PermissionRequest, decision: 'accept' | 'reject' | 'always') => void }) {
  const shortModel = formatModelLabel(modelLabel.split('/').pop() || modelLabel);
  return <div className="codex-timeline">{messages.map(message => <MessageRow key={message.id} message={message} loading={loading} showReasoning={showReasoning} shortModel={shortModel} onOpenSwarm={onOpenSwarm} onRespondPermission={onRespondPermission} />)}</div>;
}

const MessageRow = memo(function MessageRow({ message, loading, showReasoning, shortModel, onOpenSwarm, onRespondPermission }: { message: TimelineMessage; loading: boolean; showReasoning: boolean; shortModel: string; onOpenSwarm?: (swarm: SwarmActivity) => void; onRespondPermission: (permission: PermissionRequest, decision: 'accept' | 'reject' | 'always') => void }) {
  const isUser = message.role === 'user';
  return (
    <div className="row">
      <div className={isUser ? 'avatarUser' : 'avatarAssistant'} />
      <div className="body">
        <div className="name">{isUser ? 'You' : 'Rick'}{!isUser && shortModel && <span className="modelBadge">{shortModel}</span>}</div>
        {message.blocks.map(block => <BlockView key={block.id} block={block} showReasoning={showReasoning} onOpenSwarm={onOpenSwarm} onRespondPermission={onRespondPermission} />)}
        {!isUser && loading && !message.done && <span className="caret" />}
      </div>
    </div>
  );
});

function toolFilePath(args: Record<string, unknown>): string {
  return String(args.file_path || args.file || args.path || '');
}

function langFor(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = { ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', go: 'go', py: 'py', rs: 'rs', css: 'css', json: 'json', md: 'md', html: 'html', yaml: 'yaml', yml: 'yaml', luau: 'luau', lua: 'lua', toml: 'toml' };
  return map[ext] || ext || 'txt';
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*') || trimmed.startsWith('--') || trimmed.startsWith('<!--');
}

function CodeCard({ filePath, content, lang }: { filePath: string; content: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  const lines = content.split('\n');
  const copy = async () => {
    try { await navigator.clipboard.writeText(content); } catch { /* clipboard unavailable */ }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  return <div className="codeCard"><div className="codeHeader"><span className="codeSquare" /><span className="fileName">{filePath || 'file'}</span><span className="langBadge">{lang}</span><button type="button" onClick={copy} className={`copyButton ${copied ? 'copied' : ''}`}>{copied ? 'Copied' : 'Copy'}</button></div><div className="codeBody">{lines.map((line, index) => <div key={index} className="codeLine"><span className="gutter">{index + 1}</span><span className={`codeText${isCommentLine(line) ? ' codeComment' : ''}`}>{line}</span></div>)}</div></div>;
}

function DiffCard({ filePath, lines }: { filePath: string; lines: Array<{ sign: string; type: 'add' | 'del' | 'ctx'; text: string }> }) {
  const added = lines.filter(line => line.type === 'add').length;
  const removed = lines.filter(line => line.type === 'del').length;
  return <div className="diffCard"><div className="diffHeader"><span className="fileName">{filePath || 'edit'}</span><span className="diffAdded">+{added}</span><span className="diffRemoved">−{removed}</span></div><div className="diffBody">{lines.map((line, index) => <div key={index} className={`diffLine diffLine${line.type === 'add' ? 'Add' : line.type === 'del' ? 'Del' : 'Ctx'}`}><span className={`diffSign diffSign${line.type === 'add' ? 'Add' : line.type === 'del' ? 'Del' : 'Ctx'}`}>{line.sign}</span><span className={`diffText diffText${line.type === 'add' ? 'Add' : line.type === 'del' ? 'Del' : 'Ctx'}`}>{line.text}</span></div>)}</div></div>;
}

function ToolCard({ tool }: { tool: NonNullable<TimelineBlock['tool']> }) {
  const args = (tool.arguments && typeof tool.arguments === 'object' ? tool.arguments : {}) as Record<string, unknown>;
  const name = tool.name || '';
  const filePath = toolFilePath(args);

  // edit / apply_patch produce a visual diff, matching the design's diff card.
  if (name === 'edit' || name === 'apply_patch' || name === 'apply_diff' || name === 'multiedit') {
    const patches = Array.isArray(args.patches) ? args.patches as Array<Record<string, unknown>> : [{ old_string: args.old_string, new_string: args.new_string }];
    const diffLines: Array<{ sign: string; type: 'add' | 'del' | 'ctx'; text: string }> = [];
    for (const patch of patches) {
      const oldText = typeof patch.old_string === 'string' ? patch.old_string : '';
      const newText = typeof patch.new_string === 'string' ? patch.new_string : '';
      for (const line of oldText.split('\n')) diffLines.push({ sign: '-', type: 'del', text: line });
      for (const line of newText.split('\n')) diffLines.push({ sign: '+', type: 'add', text: line });
    }
    return <DiffCard filePath={filePath} lines={diffLines} />;
  }

  // write / create show the produced file as a code card.
  if (name === 'write' || name === 'create') {
    const content = Array.isArray(args.content) ? (args.content as string[]).join('\n') : typeof args.content === 'string' ? args.content : '';
    if (content) return <CodeCard filePath={filePath} content={content} lang={langFor(filePath)} />;
  }

  return <details className="codex-tool" open={tool.status === 'running' || tool.status === 'approval_required'}><summary><span className={`codex-tool-dot ${tool.status}`} /><span>{tool.name}</span><span className="ml-auto text-[10px] text-muted-foreground">{tool.status.replace('_', ' ')}</span></summary><div className="codex-tool-detail"><pre>{tool.error || tool.result || (tool.arguments ? JSON.stringify(tool.arguments, null, 2) : 'Waiting for output…')}</pre></div></details>;
}

function BlockView({ block, showReasoning, onOpenSwarm, onRespondPermission }: { block: TimelineBlock; showReasoning: boolean; onOpenSwarm?: (swarm: SwarmActivity) => void; onRespondPermission: (permission: PermissionRequest, decision: 'accept' | 'reject' | 'always') => void }) {
  if (block.kind === 'text') return <p className="text">{block.text}</p>;
  if (block.kind === 'reasoning') return showReasoning ? <details open={block.expanded ?? true} className="codex-reasoning"><summary>Thinking</summary><p className="mt-1.5 whitespace-pre-wrap leading-relaxed">{block.text}</p></details> : null;
  if (block.kind === 'permission' && block.permission) return <ApprovalCard permission={block.permission} onRespond={onRespondPermission} />;
  if (block.kind === 'tool' && block.tool) return <ToolCard tool={block.tool} />;
  if (block.kind === 'swarm' && block.swarm) { const swarm = block.swarm; const completed = swarm.agents.filter(agent => agent.status === 'completed').length; return <button type="button" onClick={() => onOpenSwarm?.(swarm)} className="codex-change-row"><UsersRound size={13} className="text-muted-foreground" /><span>{swarm.title || 'Swarm team'}</span><span className="ml-auto text-[10px] text-muted-foreground">{completed}/{swarm.agents.length || '—'} · {swarm.status}</span></button>; }
  if (block.kind === 'error') return <div className="codex-error">{block.error}</div>;
  if (block.kind === 'status') return <div className="mb-3 border-l border-[var(--border-10)] px-2.5 py-1 text-[10px] text-muted-foreground">{block.text}</div>;
  if (block.kind === 'attachment' && block.attachment) return <div className="codex-attachment-chip mb-2 inline-flex"><FileText size={11} className="shrink-0" /><span className="max-w-[220px] truncate">{block.attachment.name}</span>{block.attachment.size ? <span className="text-[9px] opacity-60">{formatBytes(block.attachment.size)}</span> : null}</div>;
  return null;
}

function ApprovalCard({ permission, onRespond }: { permission: PermissionRequest; onRespond: (permission: PermissionRequest, decision: 'accept' | 'reject' | 'always') => void }) {
  const pending = permission.status === 'pending';
  const detail = [permission.command, permission.path, permission.host, permission.tool].filter(Boolean).join(' · ');
  return <div className={`mb-3 rounded-xl border p-3 text-[12px] ${pending ? 'border-border bg-muted' : 'border-border bg-muted/50'}`}><div className="flex items-center gap-2"><ShieldCheck size={14} className="text-muted-foreground" /><span className="font-medium text-foreground">{permission.title || 'Permission requested'}</span>{!pending && <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">{permission.status}</span>}</div>{permission.body && <p className="mt-1.5 whitespace-pre-wrap leading-relaxed text-muted-foreground">{permission.body}</p>}{detail && <code className="mt-1.5 block break-all rounded bg-background px-2 py-1 text-[10px] text-foreground">{detail}</code>}{pending && <div className="mt-2.5 flex items-center gap-1.5"><button type="button" onClick={() => onRespond(permission, 'accept')} className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition hover:bg-primary/85">Allow</button><button type="button" onClick={() => onRespond(permission, 'reject')} className="rounded-md border border-border px-2.5 py-1 text-[11px] text-foreground hover:bg-surface-2">Deny</button><button type="button" onClick={() => onRespond(permission, 'always')} className="rounded-md border border-border px-2.5 py-1 text-[11px] text-foreground hover:bg-surface-2">Always allow</button></div>}</div>;
}



interface SettingsPageProps { onClose: () => void; initialConfig?: DesktopConfig | null; }
type Section = 'appearance' | 'providers' | 'model' | 'execution' | 'goals' | 'tools' | 'swarms' | 'sessions' | 'stats' | 'diagnostics' | 'advanced';

const sections = [
  { id: 'appearance' as const, label: 'Appearance', icon: Palette },
  { id: 'providers' as const, label: 'Providers', icon: Cpu },
  { id: 'model' as const, label: 'Models', icon: BrainCircuit },
  { id: 'execution' as const, label: 'Execution', icon: ShieldCheck },
  { id: 'goals' as const, label: 'Goals', icon: Target },
  { id: 'tools' as const, label: 'Tools, Plugins & MCP', icon: Wrench },
  { id: 'swarms' as const, label: 'Swarms', icon: UsersRound },
  { id: 'sessions' as const, label: 'Sessions & data', icon: FileText },
  { id: 'stats' as const, label: 'Stats', icon: ChartColumnBig },
  { id: 'diagnostics' as const, label: 'Diagnostics', icon: Activity },
  { id: 'advanced' as const, label: 'Advanced', icon: Settings2 },
];

export function SettingsPage({ onClose, initialConfig }: SettingsPageProps) {
  const [active, setActive] = useState<Section>('appearance');
  const [config, setConfig] = useState<DesktopConfig | null>(initialConfig || null);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [dailyUsage, setDailyUsage] = useState<DailyUsage[]>([]);
  const [status, setStatus] = useState('');
  const [importText, setImportText] = useState('');

  const reload = async () => {
    const [nextConfig, nextRuntime] = await Promise.all([getConfig(), getRuntimeInfo()]);
    const [nextStats, nextDaily] = await Promise.all([
      getUsageStats('', nextConfig.model || '').catch(() => null),
      getUsageDaily(14).catch(() => []),
    ]);
    setConfig(nextConfig);
    setRuntime(nextRuntime);
    setStats(nextStats);
    setDailyUsage(nextDaily);
    applyTheme(nextConfig.theme);
  };

  useEffect(() => { reload().catch(error => setStatus(error instanceof Error ? error.message : 'Failed to load settings')); }, []);

  const save = async (patch: Partial<DesktopConfig>) => {
    if (!config) return;
    const next = { ...config, ...patch };
    try {
      await updateConfig(next);
      setConfig(next);
      applyTheme(next.theme);
      if (next.theme !== 'light') lastDarkTheme = next.theme;
      if (patch.model) setStats(await getUsageStats('', next.model || '').catch(() => stats));
      setStatus('Saved');
      window.setTimeout(() => setStatus(''), 1800);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save failed');
    }
  };

  if (!config) return <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground"><div className="flex items-center gap-3"><span className="flex h-8 w-8 animate-pulse items-center justify-center rounded-xl bg-primary/15 text-primary"><Settings2 size={16} /></span>Loading settings…</div></div>;

  const activeSection = sections.find(section => section.id === active);
  return <div className="flex h-screen w-screen overflow-hidden bg-background">
    <aside className="reference-sidebar flex w-[272px] shrink-0 flex-col">
      <div className="flex h-[48px] items-center px-4"><div className="min-w-0"><div className="text-[10px] font-medium text-sidebar-foreground">Rick Desktop</div><div className="text-[8px] text-muted-foreground">Settings</div></div></div>
      <nav className="flex-1 overflow-y-auto px-2 py-2">{sections.map(section => { const Icon = section.icon; return <button type="button" key={section.id} onClick={() => setActive(section.id)} className={`settings-nav-item flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] ${active === section.id ? 'is-active' : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'}`}><span className="settings-nav-icon"><Icon size={13} strokeWidth={1.8} /></span><span className="truncate">{section.label}</span></button>; })}</nav>
      <div className="border-t border-border p-2"><div className="flex items-center gap-2 px-2 py-1 text-[10px] text-muted-foreground"><span className={`h-1.5 w-1.5 rounded-full ${runtime?.running ? 'bg-foreground/70' : 'bg-muted-foreground/50'}`} />{runtime?.running ? 'Runtime connected' : 'Runtime offline'}</div><button type="button" onClick={onClose} className="mt-1 flex h-8 w-full items-center gap-2 rounded-md px-2 text-[11px] text-foreground hover:bg-surface-2"><ArrowLeft size={13} />Back to chat</button></div>
    </aside>
    <main className="app-shell flex-1 overflow-y-auto"><div className="mx-auto w-full max-w-[900px] p-6 lg:p-8"><header className="mb-5 flex items-center justify-between gap-4"><div><div className="eyebrow">Settings</div><h1 className="mt-1 text-lg font-medium tracking-tight text-foreground">{activeSection?.label}</h1></div><div className={`text-[10px] ${status ? 'text-primary' : 'text-muted-foreground'}`}>{status || 'Changes save automatically'}</div></header>{active === 'appearance' && <Appearance config={config} save={save} />}{active === 'providers' && <ProvidersPanel setStatus={setStatus} />}{active === 'model' && <Model config={config} save={save} runtime={runtime} />}{active === 'execution' && <Execution config={config} save={save} />}{active === 'goals' && <Goals />}{active === 'tools' && <ToolsMCPPanel setStatus={setStatus} />}{active === 'swarms' && <Swarms config={config} save={save} />}{active === 'sessions' && <Sessions runtime={runtime} importText={importText} setImportText={setImportText} setStatus={setStatus} reload={reload} />}{active === 'stats' && <Stats stats={stats} daily={dailyUsage} reload={reload} />}{active === 'diagnostics' && <Diagnostics runtime={runtime} reload={reload} />}{active === 'advanced' && <Advanced config={config} save={save} runtime={runtime} />}</div></main>
  </div>;
}

function Card({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) { return <section className="flat-panel mb-3 rounded-lg p-4"><h2 className="text-xs font-medium text-foreground">{title}</h2>{description && <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{description}</p>}<div className="mt-3">{children}</div></section>; }
function Select({ value, onChange, children }: { value: string; onChange: (value: string) => void; children: React.ReactNode }) { return <select value={value} onChange={event => onChange(event.target.value)} className="themed-select w-full rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-foreground outline-none">{children}</select>; }
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) { return <label className="flex cursor-pointer items-center justify-between gap-4 rounded-md border border-border px-2.5 py-2 text-xs text-foreground"><span>{label}</span><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="h-3.5 w-3.5 accent-primary" /></label>; }

function Appearance({ config, save }: { config: DesktopConfig; save: (patch: Partial<DesktopConfig>) => Promise<void> }) { return <><Card title="Theme" description="Choose a complete desktop palette. Graphite is the default flat workspace theme."><Select value={config.theme === 'dark' ? 'graphite' : config.theme} onChange={value => save({ theme: value as DesktopConfig['theme'] })}><option value="graphite">Graphite (default)</option><option value="dracula">Dracula</option><option value="charcoal">Charcoal</option><option value="midnight">Midnight</option><option value="nord">Nord</option><option value="gruvbox">Gruvbox</option><option value="github-dark">GitHub Dark</option><option value="tokyo-night">Tokyo Night</option><option value="catppuccin">Catppuccin</option><option value="one-dark">One Dark</option><option value="solarized-dark">Solarized Dark</option><option value="system">Follow system</option><option value="light">Light</option></Select></Card><Card title="Typography"><Select value={config.font_size} onChange={value => save({ font_size: value as DesktopConfig['font_size'] })}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></Select></Card><Card title="Runtime display" description="Reasoning is kept separate from answer text and can be collapsed without deleting the event stream."><div className="space-y-4"><Toggle checked={config.show_reasoning} onChange={value => save({ show_reasoning: value })} label="Show Thinking blocks" /><Toggle checked={config.reasoning_expanded} onChange={value => save({ reasoning_expanded: value })} label="Expand Thinking blocks by default" /></div></Card></>; }

function Model({ config, save, runtime }: { config: DesktopConfig; save: (patch: Partial<DesktopConfig>) => Promise<void>; runtime: RuntimeInfo | null }) {
  const [resolved, setResolved] = useState<ResolvedConfig | null>(null);
  const [resolvedError, setResolvedError] = useState('');
  const reloadResolved = useCallback(() => { getResolvedConfig('').then(setResolved).catch(cause => setResolvedError(cause instanceof Error ? cause.message : 'Failed to load resolved config')); }, []);
  useEffect(() => { reloadResolved(); }, [reloadResolved]);
  return <><Card title="Default model" description="This is also mirrored to Rick's model setting without touching provider credentials."><input value={config.model || ''} onChange={event => save({ model: event.target.value })} placeholder="provider/model-id" className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary" /></Card><Card title="Resolved rick config" description="What rickserve actually resolves for this project: sources, merged config keys, and paths. Read-only view of the canonical files."><button type="button" onClick={reloadResolved} className="mb-3 rounded-lg border border-border px-2.5 py-1.5 text-[10px] text-foreground hover:bg-surface-2">Refresh</button>{resolvedError ? <p className="text-xs text-foreground">{resolvedError}</p> : !resolved ? <p className="text-xs text-muted-foreground">Loading…</p> : <div className="space-y-2"><PathValue label="Project root" value={resolved.project_root || ''} /><PathValue label="Global dir" value={resolved.global_dir || ''} /><PathValue label="Data dir" value={resolved.data_dir || ''} />{(resolved.sources || []).length > 0 && <div className="rounded-lg border border-border bg-surface-2 p-2.5"><div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Sources</div>{(resolved.sources || []).map(source => <div key={source} className="mt-1 text-[11px] text-foreground">{source}</div>)}</div>}<details className="rounded-lg border border-border bg-surface-2 p-2.5"><summary className="cursor-pointer text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Merged config keys</summary><pre className="mt-2 max-h-64 overflow-y-auto text-[10px] leading-relaxed text-foreground">{JSON.stringify(resolved.config || {}, null, 2)}</pre></details></div>}</Card><Card title="Provider source" description="Provider credentials and model catalogs remain canonical in Rick's existing auth/config files. Desktop only reads configured model metadata."><div className="rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted-foreground">{runtime?.version || 'Rick version unavailable'} · {runtime?.running ? 'rickserve running' : 'rickserve not running'}</div></Card></>;
}

function Goals() {
  const { confirm } = useNotifications();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [title, setTitle] = useState('');
  const [goalError, setGoalError] = useState('');
  const load = useCallback(async () => {
    setGoalError('');
    try {
      const value = await requestGoals('list');
      setGoals(Array.isArray(value) ? value as Goal[] : []);
    } catch (cause) { setGoalError(cause instanceof Error ? cause.message : 'Failed to load goals'); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const create = async () => {
    if (!title.trim()) return;
    try { await requestGoals('create', { title: title.trim(), status: 'active' }); setTitle(''); await load(); }
    catch (cause) { setGoalError(cause instanceof Error ? cause.message : 'Failed to create goal'); }
  };
  const setStatus = async (goal: Goal, status: string) => {
    try { await requestGoals('update', { goalId: goal.id, status }); await load(); }
    catch (cause) { setGoalError(cause instanceof Error ? cause.message : 'Failed to update goal'); }
  };
  const remove = async (goal: Goal) => {
    if (!(await confirm({ title: `Delete goal "${goal.title}"?`, message: 'This removes the goal and its step history.', confirmLabel: 'Delete', tone: 'danger' }))) return;
    try { await requestGoals('delete', { goalId: goal.id }); await load(); }
    catch (cause) { setGoalError(cause instanceof Error ? cause.message : 'Failed to delete goal'); }
  };
  const stepCount = (goal: Goal) => (goal.steps || []).filter(step => step.status === 'done' || step.status === 'skipped').length;
  return <><Card title="Create a goal" description="Goals are stored in Rick's canonical goal store and honoured by agent runs."><div className="flex gap-2"><input value={title} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') create(); }} placeholder="What should I work on?" className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary" /><button type="button" onClick={create} disabled={!title.trim()} className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition hover:bg-primary/85 disabled:opacity-40">Create</button></div>{goalError && <p className="mt-2 text-[11px] text-foreground">{goalError}</p>}</Card><Card title={`Active goals (${goals.length})`} description="Track progress and token spend per goal. Active goals feed the agent's /goal workflow.">{goals.length === 0 ? <p className="text-xs text-muted-foreground">No goals yet.</p> : <div className="space-y-2">{goals.map(goal => <div key={goal.id} className="rounded-xl border border-border bg-surface-2 p-3"><div className="flex items-center gap-2"><ListChecks size={13} className="text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">{goal.title}</span><span className="text-[10px] text-muted-foreground">{goal.status}</span></div><div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground"><span>{stepCount(goal)}/{goal.steps?.length || 0} steps</span><span>·</span><span>{(goal.tokens_used || 0) >= 1000 ? `${Math.round((goal.tokens_used || 0) / 1000)}k` : goal.tokens_used || 0} tokens</span></div>{(goal.steps || []).length > 0 && <div className="mt-2 space-y-1">{goal.steps!.map(step => <div key={step.id} className="flex items-center gap-2 text-[11px]"><span className={`h-1.5 w-1.5 rounded-full ${step.status === 'done' ? 'bg-foreground/70' : step.status === 'in_progress' ? 'animate-pulse bg-primary' : step.status === 'skipped' ? 'bg-muted-foreground/30' : 'bg-muted-foreground/50'}`} /><span className="min-w-0 flex-1 truncate text-foreground/80">{step.content}</span><span className="text-[9px] uppercase text-muted-foreground">{step.status}</span></div>)}</div>}<div className="mt-2.5 flex gap-1.5">{goal.status === 'active' ? <button type="button" onClick={() => setStatus(goal, 'completed')} className="rounded-md border border-border px-2 py-1 text-[10px] text-foreground hover:bg-muted">Mark done</button> : <button type="button" onClick={() => setStatus(goal, 'active')} className="rounded-md border border-border px-2 py-1 text-[10px] text-foreground hover:bg-surface-2">Reopen</button>}<button type="button" onClick={() => setStatus(goal, 'aborted')} className="rounded-md border border-border px-2 py-1 text-[10px] text-foreground hover:bg-muted">Abort</button><button type="button" onClick={() => remove(goal)} className="rounded-md border border-border px-2 py-1 text-[10px] text-foreground hover:bg-muted">Delete</button></div></div>)}</div>}</Card></>;
}

function Execution({ config, save }: { config: DesktopConfig; save: (patch: Partial<DesktopConfig>) => Promise<void> }) { return <><Card title="Permission profile" description="The selected profile is sent with new runs; approvals remain visible as first-class timeline events."><Select value={config.permission_profile} onChange={value => save({ permission_profile: value as DesktopConfig['permission_profile'] })}><option value="readonly">Read only</option><option value="standard">Standard</option><option value="trusted">Trusted</option><option value="ci">CI</option></Select></Card><Card title="Thinking mode" description="This mirrors Rick's /thinking setting for new runs."><Select value={config.thinking_mode || 'auto'} onChange={value => save({ thinking_mode: value as DesktopConfig['thinking_mode'] })}><option value="auto">Auto</option><option value="off">Off</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></Select></Card><Card title="YOLO mode" description="YOLO is sent to the canonical Rick runtime for new runs. Keep it off unless you explicitly want approvals bypassed."><Toggle checked={config.yolo} onChange={value => save({ yolo: value })} label="Enable YOLO mode" /></Card><Card title="Sandbox"><Select value={config.sandbox} onChange={value => save({ sandbox: value as DesktopConfig['sandbox'] })}><option value="read-only">Read only</option><option value="workspace-write">Workspace write</option><option value="trusted">Trusted</option><option value="off">Off</option></Select></Card></>; }

function Swarms({ config, save }: { config: DesktopConfig; save: (patch: Partial<DesktopConfig>) => Promise<void> }) { return <><Card title="Team execution" description="Live swarm cards aggregate agent status and open a per-agent inspector. Concurrency is persisted as a Desktop preference and passed to future swarm-capable runs."><label className="text-xs text-muted-foreground">Maximum concurrent agents</label><input type="number" min={1} max={32} value={config.max_swarm_concurrency} onChange={event => save({ max_swarm_concurrency: Math.max(1, Math.min(32, Number(event.target.value) || 1)) })} className="mt-2 w-32 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary" /></Card><Card title="Visibility"><p className="text-xs leading-relaxed text-muted-foreground">Swarm and team events are preserved even when a provider emits an event name the Desktop has not seen before; unknown payloads are retained for diagnostics rather than discarded.</p></Card></>; }

function SessionTools() {
  const { prompt } = useNotifications();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [exported, setExported] = useState('');
  useEffect(() => { getSessions().then(value => { setSessions(value || []); if (value?.[0]) setSelected(value[0].id); }).catch(() => {}); }, []);
  const active = sessions.find(session => session.id === selected);
  const rename = async () => { if (!active) return; const title = await prompt({ title: 'Rename session', initialValue: active.title, placeholder: 'New session title' }); if (!title?.trim()) return; await renameSession(active.id, title.trim()); setSessions(await getSessions()); };
  const fork = async () => { if (!active) return; const copy = await forkSession(active.id); if (copy) { setSessions(await getSessions()); setSelected(copy.id); } };
  const exportCurrent = async () => { if (!active) return; setExported(await exportSession(active.id)); };
  return <Card title="Session tools" description="Search, rename, fork, and export sessions using the same operations as Rick CLI."><div className="flex gap-2"><input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') searchSessions(query).then(value => setSessions(value || [])).catch(() => {}); }} placeholder="Search title or message…" className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground outline-none" /><button type="button" onClick={() => searchSessions(query).then(value => setSessions(value || [])).catch(() => {})} className="rounded-lg border border-border px-3 py-2 text-xs text-foreground">Search</button></div><div className="mt-3 flex gap-2"><select value={selected} onChange={event => setSelected(event.target.value)} className="themed-select min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-foreground"><option value="">Select a session…</option>{sessions.map(session => <option key={session.id} value={session.id}>{session.title} · {session.messages} messages</option>)}</select><button type="button" disabled={!active} onClick={rename} className="rounded-lg border border-border px-2.5 py-2 text-xs text-foreground disabled:opacity-40">Rename</button><button type="button" disabled={!active} onClick={fork} className="rounded-lg border border-border px-2.5 py-2 text-xs text-foreground disabled:opacity-40">Fork</button><button type="button" disabled={!active} onClick={exportCurrent} className="rounded-lg border border-border px-2.5 py-2 text-xs text-foreground disabled:opacity-40">Export</button></div>{exported && <textarea readOnly value={exported} className="mt-3 h-36 w-full rounded-lg border border-border bg-background p-3 font-mono text-[10px] text-foreground outline-none" />}</Card>;
}

function Sessions({ runtime, importText, setImportText, setStatus, reload }: { runtime: RuntimeInfo | null; importText: string; setImportText: (value: string) => void; setStatus: (value: string) => void; reload: () => Promise<void> }) { const { confirm, toast } = useNotifications(); const [busy, setBusy] = useState(false); const doExport = async () => { setBusy(true); try { const payload = await exportSettings(); setImportText(payload); setStatus('Export copied into the safe text area'); } finally { setBusy(false); } }; const doImport = async () => { setBusy(true); try { await importSettings(importText); setStatus('Imported and validated'); await reload(); } catch (error) { setStatus(error instanceof Error ? error.message : 'Import failed'); } finally { setBusy(false); } }; const doReset = async () => { if (!(await confirm({ title: 'Reset Desktop settings to defaults?', message: 'Your provider credentials and session history are not touched, but every Desktop preference will be restored to its default value.', confirmLabel: 'Reset', tone: 'danger' }))) return; setBusy(true); try { await resetSettings(); toast({ title: 'Settings reset', tone: 'success' }); setStatus('Reset complete'); await reload(); } catch (error) { setStatus(error instanceof Error ? error.message : 'Reset failed'); } finally { setBusy(false); } }; return <><SessionTools /><Card title="Rick session store" description="Session history is read from Rick's canonical local session directory."><PathValue label="Sessions" value={runtime?.sessions_path || 'Unavailable'} /></Card><Card title="Desktop settings export"><div className="flex gap-2"><button type="button" disabled={busy} onClick={doExport} className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition hover:bg-primary/85 active:scale-[.98]">Export safe settings</button><button type="button" disabled={busy} onClick={doImport} className="rounded-lg border border-border px-3 py-2 text-xs text-foreground">Import text</button><button type="button" disabled={busy} onClick={doReset} className="rounded-lg border border-border px-3 py-2 text-xs text-foreground hover:bg-muted">Reset</button></div><textarea value={importText} onChange={event => setImportText(event.target.value)} placeholder="Exported Desktop settings JSON (credentials are rejected)" className="mt-3 h-40 w-full rounded-lg border border-border bg-background p-3 font-mono text-xs text-foreground outline-none" /></Card></>; }
function PathValue({ label, value }: { label: string; value: string }) { return <div className="flex items-start justify-between gap-4 text-xs"><span className="text-muted-foreground">{label}</span><code className="break-all text-right text-foreground">{value}</code></div>; }

function Stats({ stats, daily, reload }: { stats: UsageStats | null; daily: DailyUsage[]; reload: () => Promise<void> }) {
  const total = stats?.total || { input: 0, output: 0, cache_read: 0, cache_write: 0, cached: 0, total: 0 };
  const session = stats?.session || { input: 0, output: 0, cache_read: 0, cache_write: 0, cached: 0, total: 0 };
  return <div className="space-y-3"><section className="flat-panel rounded-lg p-4 sm:p-5"><div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><div className="eyebrow"><ChartColumnBig size={12} /> Rick usage</div><h2 className="mt-1 text-sm font-medium text-foreground">Token activity</h2><p className="mt-1 text-[11px] text-muted-foreground">Hover a day to inspect model-level input, output, and cache use.</p></div><button type="button" onClick={() => reload()} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-[10px] text-foreground hover:bg-surface-2"><Activity size={12} />Refresh</button></div><div className="grid grid-cols-2 gap-2 lg:grid-cols-4"><StatValue icon={<ArrowDownToLine size={14} />} tone="sky" label="Input" value={formatTokens(total.input)} /><StatValue icon={<ArrowUpFromLine size={14} />} tone="emerald" label="Output" value={formatTokens(total.output)} /><StatValue icon={<Database size={14} />} tone="violet" label="Cached" value={formatTokens(total.cached)} /><StatValue icon={<Layers3 size={14} />} tone="mint" label="Total usage" value={formatTokens(total.total)} /></div><div className="mt-4"><UsageInsights daily={daily} total={total} /></div></section><section className="flat-panel rounded-lg p-4 sm:p-5"><div className="mb-3 flex items-center gap-2"><Gauge size={14} className="text-muted-foreground" /><div><h2 className="text-xs font-medium text-foreground">Current session</h2><p className="text-[10px] text-muted-foreground">Live totals for the active conversation.</p></div></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><StatValue icon={<ArrowDownToLine size={14} />} tone="sky" label="Input" value={formatTokens(session.input)} /><StatValue icon={<ArrowUpFromLine size={14} />} tone="emerald" label="Output" value={formatTokens(session.output)} /><StatValue icon={<Database size={14} />} tone="violet" label="Cached" value={formatTokens(session.cached)} /><StatValue icon={<Layers3 size={14} />} tone="mint" label="Total" value={formatTokens(session.total)} /></div><div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-border pt-2 text-[10px] text-muted-foreground"><span>Cache read <strong className="ml-1 font-medium text-foreground">{formatTokens(total.cache_read)}</strong></span><span>Cache write <strong className="ml-1 font-medium text-foreground">{formatTokens(total.cache_write)}</strong></span><span className="ml-auto">Rick usage.json</span></div></section></div>;
}

function StatValue({ icon, tone, label, value }: { icon: React.ReactNode; tone: 'sky' | 'emerald' | 'violet' | 'mint'; label: string; value: string }) { return <div data-tone={tone} className="rounded-md border border-border p-2.5"><div className="flex items-center justify-between text-muted-foreground"><span>{icon}</span><span className="text-[9px] uppercase tracking-[.08em]">{label}</span></div><div className="mt-2 text-base font-medium tracking-tight text-foreground tabular-nums">{value}</div></div>; }

function Diagnostics({ runtime, reload }: { runtime: RuntimeInfo | null; reload: () => Promise<void> }) { return <><Card title="Runtime health" description="Machine-readable paths and process status, useful when a package is launched from a stale shell alias."><div className="space-y-3"><PathValue label="Rick version" value={runtime?.version || 'unknown'} /><PathValue label="rickserve" value={runtime?.rickserve_path || 'not found'} /><PathValue label="settings" value={runtime?.settings_path || 'unknown'} /><PathValue label="sessions" value={runtime?.sessions_path || 'unknown'} /><div className="flex items-center justify-between border-t border-border pt-3 text-sm"><span>Process</span><span className="text-muted-foreground">{runtime?.running ? 'running' : 'not running'}</span></div></div><button type="button" onClick={() => reload()} className="mt-4 rounded-lg border border-border px-3 py-2 text-xs text-foreground hover:bg-surface-2">Refresh diagnostics</button></Card><Card title="Troubleshooting"><p className="text-xs leading-relaxed text-muted-foreground">Use the exact resolved paths above when checking a stale deployment. Provider secrets are intentionally never returned by these diagnostics.</p></Card></>; }

function Advanced({ config, save, runtime }: { config: DesktopConfig; save: (patch: Partial<DesktopConfig>) => Promise<void>; runtime: RuntimeInfo | null }) { return <><Card title="rickserve path override" description="Leave empty to resolve rickserve from Rick's normal PATH and the user's bin directory."><input value={config.rickserve_path || ''} onChange={event => save({ rickserve_path: event.target.value })} placeholder={runtime?.rickserve_path || 'Automatic resolution'} className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-foreground outline-none focus:ring-1 focus:ring-primary" /></Card><Card title="Compatibility"><p className="text-xs leading-relaxed text-muted-foreground">Desktop settings use a versioned file separate from Rick's provider/auth files. Unknown protocol events remain available in the event payload and do not break the timeline.</p></Card></>; }
