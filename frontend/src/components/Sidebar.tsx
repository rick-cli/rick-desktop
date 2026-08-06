import { useEffect, useMemo, useState } from 'react';
import { ArrowUpFromLine, ChevronDown, ChevronLeft, ChevronRight, CircleUserRound, Copy, Cpu, FileText, FolderInput, FolderTree, MessageSquare, Pencil, Search, Settings2, Star, Trash2 } from 'lucide-react';
import { BrowserOpenURL } from '../../wailsjs/runtime/runtime';
import { Session } from '../lib/types';

interface SidebarProps {
  sessions: Session[];
  selectedSession: Session | null;
  runningSessions: Record<string, boolean>;
  contextFiles: string[];
  workspacePath?: string;
  onPickFolder: () => void;
  onSelectSession: (session: Session) => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onCollapse: () => void;
  onRenameSession: (session: Session, title: string) => void;
  onSetCategory: (session: Session, category: string) => void;
  onSetFavorite: (session: Session, fav: boolean) => void;
  onDeleteSession: (session: Session) => void;
  onForkSession: (session: Session) => void;
  onExportSession: (session: Session) => void;
}

const CATEGORY_ORDER = ['Favorites', 'Today', 'Yesterday', 'This week', 'This month', 'Older'];

function categoryKey(session: Session): string {
  if (session.favorite) return 'Favorites';
  return session.category || 'Older';
}

export function Sidebar({ sessions, selectedSession, runningSessions, contextFiles, workspacePath, onPickFolder, onSelectSession, onNewChat, onOpenSettings, onCollapse, onRenameSession, onSetCategory, onSetFavorite, onDeleteSession, onForkSession, onExportSession }: SidebarProps) {
  const [query, setQuery] = useState('');
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [actionFor, setActionFor] = useState<Session | null>(null);
  const [editing, setEditing] = useState<Session | null>(null);
  const [editText, setEditText] = useState('');
  const [categorizing, setCategorizing] = useState<Session | null>(null);
  const [categoryText, setCategoryText] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActionFor(null);
        setUserMenuOpen(false);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onNewChat();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNewChat]);

  const groups = useMemo(() => {
    const map = new Map<string, Session[]>();
    const needle = query.trim().toLowerCase();
    for (const session of sessions) {
      if (needle && !`${session.title} ${session.cwd} ${session.category || ''}`.toLowerCase().includes(needle)) continue;
      const key = categoryKey(session);
      const list = map.get(key) || [];
      list.push(session);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a[0]);
      const bi = CATEGORY_ORDER.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  }, [query, sessions]);

  const workspace = useMemo(() => {
    if (!selectedSession) return null;
    const cwd = selectedSession.cwd.trim();
    const parts = cwd.split(/[\\/]/).filter(Boolean);
    return {
      name: parts[parts.length - 1] || cwd || 'Workspace not set',
      path: cwd || 'No workspace path',
      model: selectedSession.model || 'Default model',
      messages: selectedSession.messages,
    };
  }, [selectedSession]);

  const startRename = (session: Session) => {
    setActionFor(null);
    setEditing(session);
    setEditText(session.title);
  };
  const commitRename = () => {
    if (editing && editText.trim()) onRenameSession(editing, editText.trim());
    setEditing(null);
  };
  const startCategory = (session: Session) => {
    setActionFor(null);
    setCategorizing(session);
    setCategoryText(session.category || '');
  };
  const commitCategory = () => {
    if (categorizing) onSetCategory(categorizing, categoryText.trim());
    setCategorizing(null);
  };

  const actionMenu = (session: Session) => actionFor?.id === session.id ? (
    <>
      <div className="fixed inset-0 z-40" onClick={() => setActionFor(null)} />
      <div className="dropdown-popover absolute right-0 top-full z-50 mt-0.5 w-48 overflow-hidden rounded-lg p-1">
        <button type="button" onClick={() => startRename(session)} className="dropdown-option flex w-full items-center gap-2"><Pencil size={11} />Rename</button>
        <button type="button" onClick={() => startCategory(session)} className="dropdown-option flex w-full items-center gap-2"><FolderInput size={11} />Set category</button>
        <button type="button" onClick={() => { setActionFor(null); onSetFavorite(session, !session.favorite); }} className="dropdown-option flex w-full items-center gap-2"><Star size={11} />{session.favorite ? 'Unfavorite' : 'Favorite'}</button>
        <button type="button" onClick={() => { setActionFor(null); onForkSession(session); }} className="dropdown-option flex w-full items-center gap-2"><Copy size={11} />Fork</button>
        <button type="button" onClick={() => { setActionFor(null); onExportSession(session); }} className="dropdown-option flex w-full items-center gap-2"><ArrowUpFromLine size={11} />Export</button>
        <div className="my-1 border-t border-border" />
        <button type="button" onClick={() => { setActionFor(null); onDeleteSession(session); }} className="dropdown-option flex w-full items-center gap-2 text-foreground"><Trash2 size={11} />Delete</button>
      </div>
    </>
  ) : null;

  const sessionRow = (session: Session) => {
    if (editing?.id === session.id) {
      return <div className="px-1 py-0.5"><input autoFocus value={editText} onChange={event => setEditText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') commitRename(); if (event.key === 'Escape') setEditing(null); }} onBlur={commitRename} className="w-full rounded-md border border-border bg-surface-search px-1.5 py-1 text-[11px] text-foreground outline-none" /></div>;
    }
    if (categorizing?.id === session.id) {
      return <div className="px-1 py-0.5"><input autoFocus value={categoryText} onChange={event => setCategoryText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') commitCategory(); if (event.key === 'Escape') setCategorizing(null); }} onBlur={commitCategory} placeholder="category (blank = auto)" className="w-full rounded-md border border-border bg-surface-search px-1.5 py-1 text-[11px] text-foreground outline-none" /></div>;
    }
    const active = selectedSession?.id === session.id;
    const running = Boolean(runningSessions[session.id]);
    return (
      <div key={session.id} className="group relative">
        <button type="button" onClick={() => onSelectSession(session)} className={`item ${active ? 'itemActive' : ''}`}>
          <span className="itemBody">
            <span className="itemTitle" style={{ color: active ? 'var(--foreground)' : session.favorite ? 'var(--title-warning)' : 'var(--muted-foreground)' }}>{session.title || 'Untitled thread'}</span>
            <span className="itemRepo">{session.cwd || 'local workspace'}</span>
          </span>
          {running && <span className="session-running-dot" title="Run in progress" />}
        </button>
        <button type="button" onClick={event => { event.stopPropagation(); setActionFor(session); }} className="absolute right-1 top-1/2 z-10 hidden h-[22px] w-[22px] -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground group-focus-within:flex group-hover:flex" aria-label="Session actions" aria-expanded={actionFor?.id === session.id}>
          <Settings2 size={11} />
        </button>
        {actionMenu(session)}
      </div>
    );
  };

  return <aside className="reference-sidebar flex w-[264px] shrink-0 flex-col">
    <div className="brand">
      <span className="wordmark">Rick</span>
      <span className="version">v0.1</span>
      <button type="button" onClick={onCollapse} className="sidebar-collapse" aria-label="Hide sidebar" title="Hide sidebar"><ChevronLeft size={15} /></button>
    </div>

    <div className="newTaskWrap">
      <button type="button" onClick={onNewChat} className="newTask" aria-keyshortcuts="Control+K Meta+K">
        <span className="newTaskPlus">+</span> New thread <span className="newTaskShortcut">Ctrl K</span>
      </button>
    </div>

    <div className="workspace-picker">
      <span className="workspace-picker-path" title={workspacePath || 'No folder selected'}>{workspacePath || 'No folder selected'}</span>
      <button type="button" onClick={onPickFolder} className="sidebar-icon-button" title="Choose workspace folder" aria-label="Choose workspace folder">
        <FolderInput size={13} />
      </button>
    </div>

    <div className="searchWrap">
      <div className="search">
        <Search className="searchGlyph" size={12} aria-hidden="true" />
        <input className="searchInput" aria-label="Search threads" placeholder="Search threads" value={query} onChange={event => setQuery(event.target.value)} />
      </div>
    </div>

    <section className="workspace-context" aria-label="Active workspace context">
      <div className="workspace-context-label">
        <span>Workspace context</span>
        <span className="workspace-context-state">{workspace ? 'Active' : 'Idle'}</span>
      </div>
      {workspace ? <>
        <div className="workspace-context-row">
          <FolderTree className="workspace-context-icon" size={13} aria-hidden="true" />
          <span className="workspace-context-body">
            <span className="workspace-context-title" title={workspace.name}>{workspace.name}</span>
            <span className="workspace-context-path" title={workspace.path}>{workspace.path}</span>
          </span>
        </div>
        <div className="workspace-context-meta">
          <span className="inline-flex items-center gap-1"><MessageSquare size={10} aria-hidden="true" />{workspace.messages} messages</span>
          <span className="inline-flex min-w-0 items-center gap-1"><Cpu size={10} aria-hidden="true" /><span className="truncate" title={workspace.model}>{workspace.model}</span></span>
        </div>
        {contextFiles.length > 0 && <div className="workspace-context-files">
          <span className="workspace-context-files-label">Files in context</span>
          {contextFiles.map(filePath => {
            const parts = filePath.split(/[\\/]/).filter(Boolean);
            const fileName = parts[parts.length - 1] || filePath;
            return <span key={filePath.toLowerCase()} className="workspace-context-file" title={filePath}>
              <FileText size={10} aria-hidden="true" />
              <span>{fileName}</span>
            </span>;
          })}
        </div>}
      </> : <div className="workspace-context-empty">Select a thread to inspect its workspace path and active context.</div>}
    </section>

    <div className="list">
      {groups.length === 0 ? <p className="noResults">{sessions.length === 0 ? 'Your threads will appear here.' : 'No threads found'}</p> : groups.map(([category, list]) => {
        const collapsed = collapsedCategories.has(category);
        return <div key={category}>
          <button type="button" className="groupLabel" onClick={() => setCollapsedCategories(current => { const next = new Set(current); if (next.has(category)) next.delete(category); else next.add(category); return next; })} aria-expanded={!collapsed}>
            <ChevronRight size={11} className={`groupChevron ${collapsed ? '' : 'is-open'}`} aria-hidden="true" />
            <span>{category}</span>
          </button>
          {!collapsed && <div className="space-y-px">{list.map(sessionRow)}</div>}
        </div>;
      })}
    </div>

    <div className="footer">
      <div className="relative min-w-0 flex-1">
        {userMenuOpen && <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />}
        {userMenuOpen && <div className="dropdown-popover absolute bottom-full left-0 z-50 mb-2 w-56 overflow-hidden rounded-lg p-1.5">
          <div className="px-2 py-2">
            <div className="text-xs font-medium text-foreground">Personal</div>
            <div className="truncate text-[10px] text-muted-foreground" title={workspace?.path}>{workspace?.path || 'No workspace selected'}</div>
          </div>
          <div className="my-1 border-t border-border" />
          <button type="button" onClick={() => { setUserMenuOpen(false); onOpenSettings(); }} className="dropdown-option flex w-full items-center gap-2">
            <Settings2 size={12} />Open Settings
          </button>
          <button type="button" onClick={() => { setUserMenuOpen(false); BrowserOpenURL('https://discord.gg/2HyXK4YfXZ'); }} className="dropdown-option flex w-full items-center gap-2">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M20.317 4.3698a19.7913 19.7913 0 0 0-4.8851-1.5152.0741.0741 0 0 0-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 0 0-.0785-.037 19.7363 19.7363 0 0 0-4.8852 1.515.0699.0699 0 0 0-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 0 0 .0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 0 0 .0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 0 0-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 0 1-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 0 1 .0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 0 1 .0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 0 1-.0066.1276 12.2986 12.2986 0 0 1-1.873.8914.0766.0766 0 0 0-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 0 0 .0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 0 0 .0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 0 0-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z" /></svg>Discord
          </button>
          <div className="my-1 border-t border-border" />
          <div className="px-2 py-1 text-[9px] text-muted-foreground">Rick Desktop v0.1.0</div>
        </div>}
        <button type="button" onClick={() => setUserMenuOpen(value => !value)} className={`control-trigger flex w-full min-w-0 items-center gap-2.5 ${userMenuOpen ? 'is-open' : ''}`}>
          <span className="avatar"><CircleUserRound size={14} strokeWidth={2} /></span>
          <span className="footerBody">
            <span className="block truncate text-xs text-sidebar-foreground">Personal</span>
            <span className="block truncate text-[10px] text-muted-foreground" title={workspace?.path}>{workspace?.name || 'No workspace selected'}</span>
          </span>
          <ChevronDown size={11} className={`shrink-0 text-muted-foreground transition-transform duration-200 ${userMenuOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>
      <button type="button" onClick={onOpenSettings} className="sidebar-icon-button" aria-label="Settings" title="Settings">
        <Settings2 size={14} />
      </button>
    </div>
  </aside>;
}
