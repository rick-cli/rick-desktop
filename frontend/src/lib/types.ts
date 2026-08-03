export interface Model {
  id: string;
  name: string;
  provider: string;
  context_window: number;
  configured: boolean;
  is_default?: boolean;
  free?: boolean;
}

export interface Provider {
  name: string;
  label: string;
  type?: string;
  models: Model[];
}

export interface SessionUsage {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  cached: number;
  total: number;
}

export interface Session {
  id: string;
  title: string;
  cwd: string;
  model: string;
  messages: number;
  created: string;
  updated: string;
  category?: string;
  favorite?: boolean;
  usage?: SessionUsage;
}

export type EventKind =
  | 'run.started'
  | 'text.delta'
  | 'reasoning.delta'
  | 'tool.started'
  | 'tool.progress'
  | 'tool.approval'
  | 'permission.requested'
  | 'tool.completed'
  | 'tool.failed'
  | 'swarm.started'
  | 'agent.updated'
  | 'swarm.completed'
  | 'usage'
  | 'run.completed'
  | 'run.cancelled'
  | 'run.failed'
  | 'unknown';

export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  cached_tokens?: number;
  total_tokens?: number;
  context_tokens?: number;
  context_limit?: number;
}

export interface UsageStats {
  session_id?: string;
  model?: string;
  session: SessionUsage;
  total: SessionUsage;
  context_used?: number;
  context_limit?: number;
  context_known: boolean;
}

export interface ModelUsage extends SessionUsage {
  model: string;
}

export interface DailyUsage {
  date: string;
  input: number;
  output: number;
  cached: number;
  total: number;
  models: ModelUsage[];
}

export interface RickEvent {
  type: string;
  request_id?: string;
  run_id?: string;
  session_id?: string;
  message_id?: string;
  agent_id?: string;
  swarm_id?: string;
  event?: string;
  kind?: EventKind | string;
  sequence?: number;
  text?: string;
  error?: string;
  usage?: Usage;
  data?: Record<string, unknown> | string | null;
  raw_data?: unknown;
  raw?: unknown;
}

export type BlockKind = 'text' | 'reasoning' | 'tool' | 'swarm' | 'error' | 'status' | 'attachment' | 'permission';

export interface AttachmentBlock {
  name: string;
  media_type?: string;
  size?: number;
}

export interface ToolActivity {
  id: string;
  name: string;
  status: string;
  arguments?: unknown;
  result?: string;
  error?: string;
  dangerous?: boolean;
  duration_ms?: number;
}

export interface AgentActivity {
  id: string;
  name?: string;
  task?: string;
  status: string;
  current_tool?: string;
  action?: string;
  result?: string;
  error?: string;
}

export interface SwarmActivity {
  id: string;
  title?: string;
  status: string;
  agents: AgentActivity[];
  final_result?: string;
  error?: string;
}

export interface PermissionRequest {
  request_id: string;
  tool?: string;
  command?: string;
  path?: string;
  paths?: string[];
  host?: string;
  title?: string;
  body?: string;
  status: 'pending' | 'approved' | 'rejected' | 'always';
}

export interface TimelineBlock {
  id: string;
  kind: BlockKind;
  text?: string;
  tool?: ToolActivity;
  swarm?: SwarmActivity;
  permission?: PermissionRequest;
  error?: string;
  status?: string;
  expanded?: boolean;
  attachment?: AttachmentBlock;
}

export interface TimelineMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  blocks: TimelineBlock[];
  done: boolean;
  runId?: string;
  timestamp?: string;
}

export interface TimelineState {
  messages: TimelineMessage[];
  loading: boolean;
  activeRunId?: string;
  error?: string;
  usage?: Usage;
  swarms: Record<string, SwarmActivity>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  done?: boolean;
}

export interface RunOptions {
  max_turns?: number;
  permission_profile?: string;
  sandbox?: string;
  thinking?: string;
  yolo?: boolean;
  agent?: string;
  cwd?: string;
  attachments?: Attachment[];
}

export interface GoalStep {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'done' | 'skipped';
}

export interface Goal {
  id: string;
  title: string;
  description?: string;
  status: 'active' | 'completed' | 'aborted';
  token_budget?: number;
  tokens_used: number;
  steps?: GoalStep[];
  created: string;
  updated: string;
}

export interface AgentInfo {
  id: string;
  name: string;
  parent_id?: string;
  depth: number;
  status: 'idle' | 'running' | 'done' | 'failed' | 'killed';
  description?: string;
  output?: string;
  error?: string;
  children?: string[];
  started?: string;
  finished?: string;
}

export interface MCPStatusEntry {
  name: string;
  status: string;
  tools: Array<{ name: string; description?: string }>;
  error?: string;
}

export interface PluginEntry {
  name: string;
  description?: string;
  enabled: boolean;
  source?: string;
}

export interface ResolvedConfig {
  project_root?: string;
  global_dir?: string;
  data_dir?: string;
  sources?: string[];
  config?: Record<string, unknown>;
  tui?: Record<string, unknown>;
}

export interface Attachment {
  name: string;
  media_type: string;
  data: string; // base64
  size?: number;
}

export interface DesktopConfig {
  schema_version: number;
  model?: string;
  theme: 'charcoal' | 'graphite' | 'midnight' | 'dracula' | 'nord' | 'gruvbox' | 'github-dark' | 'tokyo-night' | 'catppuccin' | 'one-dark' | 'solarized-dark' | 'light' | 'system' | 'dark';
  font_size: 'small' | 'medium' | 'large';
  permission_profile: 'readonly' | 'standard' | 'trusted' | 'ci';
  sandbox: 'read-only' | 'workspace-write' | 'trusted' | 'off';
  show_reasoning: boolean;
  reasoning_expanded: boolean;
  max_swarm_concurrency: number;
  thinking_mode: 'auto' | 'off' | 'low' | 'medium' | 'high';
  yolo: boolean;
  rickserve_path?: string;
  workspace_path?: string;
}

export interface AuthProvider {
  id: string;
  label: string;
  type: string;
  auth: string;
  connected: boolean;
  env_only: boolean;
  custom: boolean;
  env_var?: string;
  base_url?: string;
  detail?: string;
  model_count?: number;
  default_model?: string;
  key_count?: number;
  masked_key?: string;
  key_mode?: string;
  only_free?: boolean;
  disabled?: boolean;
}

export interface RuntimeInfo {
  version: string;
  rickserve_path: string;
  settings_path: string;
  sessions_path: string;
  running: boolean;
}

export interface UpdateInfo {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  asset_name: string;
  download_url: string;
  release_notes?: string;
  checked_at: string;
  error?: string;
}

export interface RickStatus {
  installed: boolean;
  rick_path: string;
  rickserve_path: string;
  rick_version: string;
  install_dir: string;
}

export interface CommandArgument {
  name: string;
  description?: string;
  required?: boolean;
  value_hint?: string;
  suggestions?: string[];
}

export interface CommandSpec {
  name: string;
  aliases?: string[];
  description?: string;
  category?: string;
  arguments?: CommandArgument[];
  mode: 'native' | 'cli' | 'info';
  dangerous?: boolean;
}
