import { AttachmentBlock, EventKind, PermissionRequest, RickEvent, SwarmActivity, TimelineBlock, TimelineMessage, TimelineState, ToolActivity, Usage } from './types';

export const initialTimelineState: TimelineState = {
  messages: [],
  loading: false,
  swarms: {},
};

export function hasRenderableBlock(block: TimelineBlock): boolean {
  if (block.kind === 'text' || block.kind === 'reasoning' || block.kind === 'status') {
    return Boolean(block.text?.trim());
  }
  if (block.kind === 'error') return Boolean(block.error?.trim());
  if (block.kind === 'attachment') return Boolean(block.attachment);
  if (block.kind === 'tool') return Boolean(block.tool);
  if (block.kind === 'permission') return Boolean(block.permission);
  if (block.kind === 'swarm') return Boolean(block.swarm);
  return false;
}

export function isRenderableMessage(message: TimelineMessage): boolean {
  if (message.role === 'user') return message.blocks.some(hasRenderableBlock);
  return message.blocks.some(hasRenderableBlock);
}

export function visibleMessages(messages: TimelineMessage[]): TimelineMessage[] {
  return messages.filter(isRenderableMessage);
}

export function addUserMessage(state: TimelineState, text: string, attachmentsOrId: AttachmentBlock[] | string = [], id = `user-${Date.now()}`): TimelineState {
  const attachments = Array.isArray(attachmentsOrId) ? attachmentsOrId : [];
  if (typeof attachmentsOrId === 'string') id = attachmentsOrId;
  const trimmed = text.trim();
  if (!trimmed && attachments.length === 0) return state;
  const blocks: TimelineBlock[] = [
    ...attachments.map((att, index) => ({ id: `${id}-att-${index}`, kind: 'attachment' as const, attachment: att })),
    ...(trimmed ? [{ id: `${id}-text`, kind: 'text' as const, text: trimmed }] : []),
  ];
  return {
    ...state,
    messages: [...state.messages, {
      id,
      role: 'user',
      blocks,
      done: true,
    }],
  };
}

export function addSystemMessage(state: TimelineState, text: string, id = `system-${Date.now()}`): TimelineState {
  if (!text.trim()) return state;
  return { ...state, messages: [...state.messages, { id, role: 'system', blocks: [{ id: `${id}-status`, kind: 'status', text }], done: true }] };
}

export function hydrateMessages(messages: Array<{ id?: string; role?: string; content?: string; timestamp?: string; done?: boolean }>): TimelineMessage[] {
  return messages.map<TimelineMessage>((message, index) => ({
    id: message.id || `history-${index}`,
    role: message.role === 'user' ? 'user' : message.role === 'system' ? 'system' : 'assistant',
    blocks: message.content?.trim() ? [{ id: `history-${index}-text`, kind: 'text', text: message.content }] : [],
    done: message.done ?? true,
    timestamp: message.timestamp,
  })).filter(isRenderableMessage);
}

export function reduceRickEvent(state: TimelineState, event: RickEvent): TimelineState {
  const kind = normalizeKind(event);
  const runId = event.run_id || state.activeRunId;
  let next: TimelineState = { ...state, messages: [...state.messages], swarms: { ...state.swarms } };
  if (runId) next.activeRunId = runId;

  switch (kind) {
    case 'run.started':
      return { ...next, loading: true, error: undefined };
    case 'text.delta':
      return appendAssistantText(next, runId, event.message_id, eventText(event), 'text');
    case 'reasoning.delta':
      return appendAssistantText(next, runId, event.message_id, eventText(event), 'reasoning');
    case 'tool.started':
    case 'tool.progress':
    case 'tool.approval':
    case 'tool.completed':
    case 'tool.failed':
      return updateTool(next, runId, event, kind);
    case 'permission.requested':
      return updatePermission(next, runId, event);
    case 'swarm.started':
    case 'agent.updated':
    case 'swarm.completed':
      return updateSwarm(next, runId, event, kind);
    case 'usage':
      return { ...next, usage: event.usage || parseUsage(event.data) };
    case 'run.completed':
      return finishAssistant(next, runId, false);
    case 'run.cancelled':
      return finishAssistant({ ...next, error: undefined }, runId, true);
    case 'run.failed':
      return finishAssistant(next, runId, false, event.error || eventText(event) || 'Rick reported an error');
    default:
      return captureUnknownEvent(next, runId, event);
  }
}

function appendAssistantText(state: TimelineState, runId: string | undefined, messageId: string | undefined, text: string, kind: 'text' | 'reasoning'): TimelineState {
  if (!text) return { ...state, loading: true };
  const index = findAssistant(state.messages, runId, messageId);
  const messages = [...state.messages];
  if (index < 0) {
    const id = messageId || `assistant-${runId || 'current'}`;
    messages.push({ id, role: 'assistant', runId, blocks: [{ id: `${id}-${kind}`, kind, text, expanded: kind === 'reasoning' }], done: false });
  } else {
    const message = { ...messages[index], blocks: [...messages[index].blocks], done: false };
    const blockIndex = message.blocks.findIndex(block => block.kind === kind);
    if (blockIndex < 0) {
      message.blocks.push({ id: `${message.id}-${kind}`, kind, text, expanded: kind === 'reasoning' });
    } else {
      message.blocks[blockIndex] = { ...message.blocks[blockIndex], text: `${message.blocks[blockIndex].text || ''}${text}` };
    }
    messages[index] = message;
  }
  return { ...state, messages, loading: true };
}

function updateTool(state: TimelineState, runId: string | undefined, event: RickEvent, kind: EventKind): TimelineState {
  const data = asObject(event.data);
  const tool = normalizeTool(data, event, kind);
  const index = findAssistant(state.messages, runId, event.message_id);
  const messages = [...state.messages];
  const messageId = index >= 0 ? messages[index].id : event.message_id || `assistant-${runId || 'current'}`;
  const message = index >= 0 ? { ...messages[index], blocks: [...messages[index].blocks] } : { id: messageId, role: 'assistant' as const, runId, blocks: [], done: false };
  const blockIndex = message.blocks.findIndex(block => block.kind === 'tool' && block.tool?.id === tool.id);
  const block: TimelineBlock = { id: `${message.id}-tool-${tool.id}`, kind: 'tool', tool };
  if (blockIndex >= 0) message.blocks[blockIndex] = { ...message.blocks[blockIndex], tool };
  else message.blocks.push(block);
  message.done = false;
  if (index < 0) messages.push(message); else messages[index] = message;
  return { ...state, messages, loading: true };
}

function updateSwarm(state: TimelineState, runId: string | undefined, event: RickEvent, kind: EventKind): TimelineState {
  const data = asObject(event.data);
  const swarm = normalizeSwarm(data, event, kind);
  const previous = state.swarms[swarm.id];
  const merged: SwarmActivity = {
    ...previous,
    ...swarm,
    agents: mergeAgents(previous?.agents || [], swarm.agents || []),
  };
  const swarms = { ...state.swarms, [merged.id]: merged };
  const index = findAssistant(state.messages, runId, event.message_id);
  const messages = [...state.messages];
  const messageId = index >= 0 ? messages[index].id : event.message_id || `assistant-${runId || 'current'}`;
  const message = index >= 0 ? { ...messages[index], blocks: [...messages[index].blocks] } : { id: messageId, role: 'assistant' as const, runId, blocks: [], done: false };
  const blockIndex = message.blocks.findIndex(block => block.kind === 'swarm' && block.swarm?.id === merged.id);
  if (blockIndex >= 0) message.blocks[blockIndex] = { ...message.blocks[blockIndex], swarm: merged };
  else message.blocks.push({ id: `${message.id}-swarm-${merged.id}`, kind: 'swarm', swarm: merged });
  if (index < 0) messages.push(message); else messages[index] = message;
  return { ...state, messages, swarms, loading: kind === 'swarm.completed' ? state.loading : true };
}

function updatePermission(state: TimelineState, runId: string | undefined, event: RickEvent): TimelineState {
  const data = asObject(event.data);
  const permission: PermissionRequest = {
    request_id: String(data.request_id || event.request_id || `perm-${event.sequence || Date.now()}`),
    tool: typeof data.tool === 'string' ? data.tool : undefined,
    command: typeof data.command === 'string' ? data.command : undefined,
    path: typeof data.path === 'string' ? data.path : undefined,
    paths: Array.isArray(data.paths) ? data.paths.map(String) : undefined,
    host: typeof data.host === 'string' ? data.host : undefined,
    title: typeof data.title === 'string' ? data.title : undefined,
    body: typeof data.body === 'string' ? data.body : undefined,
    status: 'pending',
  };
  const index = findAssistant(state.messages, runId, event.message_id);
  const messages = [...state.messages];
  const messageId = index >= 0 ? messages[index].id : event.message_id || `assistant-${runId || 'current'}`;
  const message = index >= 0 ? { ...messages[index], blocks: [...messages[index].blocks], done: false } : { id: messageId, role: 'assistant' as const, runId, blocks: [], done: false };
  const blockIndex = message.blocks.findIndex(block => block.kind === 'permission' && block.permission?.request_id === permission.request_id);
  if (blockIndex >= 0) message.blocks[blockIndex] = { ...message.blocks[blockIndex], permission };
  else message.blocks.push({ id: `${message.id}-perm-${permission.request_id}`, kind: 'permission', permission });
  if (index < 0) messages.push(message); else messages[index] = message;
  return { ...state, messages, loading: true };
}

export function resolvePermission(state: TimelineState, requestId: string, status: PermissionRequest['status']): TimelineState {
  const messages = state.messages.map(message => ({
    ...message,
    blocks: message.blocks.map(block => block.kind === 'permission' && block.permission?.request_id === requestId
      ? { ...block, permission: { ...block.permission, status } }
      : block),
  }));
  return { ...state, messages };
}

export function pendingApprovals(messages: TimelineMessage[]): PermissionRequest[] {
  const found: PermissionRequest[] = [];
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.kind === 'permission' && block.permission?.status === 'pending') found.push(block.permission);
    }
  }
  return found;
}

function finishAssistant(state: TimelineState, runId: string | undefined, cancelled: boolean, error?: string): TimelineState {
  const messages = state.messages.map(message => message.runId === runId || (!runId && message.role === 'assistant' && !message.done) ? ({ ...message, done: true }) : message);
  if (error) {
    const target = messages.findIndex(message => message.role === 'assistant' && !message.blocks.some(block => block.kind === 'error'));
    if (target >= 0) messages[target] = { ...messages[target], blocks: [...messages[target].blocks, { id: `${messages[target].id}-error`, kind: 'error', error }] };
    else messages.push({ id: `assistant-${runId || 'error'}`, role: 'assistant', runId, blocks: [{ id: `assistant-${runId || 'error'}-error`, kind: 'error', error }], done: true });
  }
  return { ...state, messages, loading: false, activeRunId: undefined, error: cancelled ? undefined : error || state.error };
}

// captureUnknownEvent surfaces protocol events the reducer does not yet know
// about as a status line, so new rickserve payloads stay visible in the
// timeline instead of disappearing silently.
function captureUnknownEvent(state: TimelineState, runId: string | undefined, event: RickEvent): TimelineState {
  const details = eventText(event) || (event.data ? JSON.stringify(event.data) : '');
  if (!details) return state;
  const index = findAssistant(state.messages, runId, event.message_id);
  if (index < 0) return state;
  const messages = [...state.messages];
  messages[index] = { ...messages[index], blocks: [...messages[index].blocks, { id: `${messages[index].id}-status-${event.sequence || Date.now()}`, kind: 'status', text: `${event.event || event.kind || 'event'}: ${details}` }] };
  return { ...state, messages };
}

function findAssistant(messages: TimelineMessage[], runId?: string, messageId?: string): number {
  if (messageId) {
    const byID = messages.findIndex(message => message.id === messageId && message.role === 'assistant');
    if (byID >= 0) return byID;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'assistant' && !messages[index].done && (!runId || messages[index].runId === runId)) return index;
  }
  return -1;
}

function normalizeKind(event: RickEvent): EventKind {
  if (event.kind) return event.kind as EventKind;
  if (event.type === 'done') return 'run.completed';
  if (event.type === 'cancelled') return 'run.cancelled';
  if (event.type === 'error') return 'run.failed';
  const name = (event.event || '').toLowerCase().replace(/[_-]/g, '.').replace(/^event\./, '');
  if (name === 'content' || name === 'text' || name === 'delta') return 'text.delta';
  if (name.includes('reason') || name.includes('think')) return 'reasoning.delta';
  if (name.includes('tool')) {
    if (name.includes('approval')) return 'tool.approval';
    if (name.includes('result') || name.includes('complete')) return 'tool.completed';
    if (name.includes('fail') || name.includes('error')) return 'tool.failed';
    return 'tool.started';
  }
  if (name.includes('permission')) return 'permission.requested';
  if (name.includes('swarm') || name.includes('team')) return name.includes('complete') ? 'swarm.completed' : 'swarm.started';
  return 'unknown';
}

function eventText(event: RickEvent): string {
  if (event.text) return event.text;
  if (typeof event.data === 'string') return event.data;
  const data = asObject(event.data);
  for (const key of ['text', 'content', 'delta', 'message', 'error']) {
    if (typeof data[key] === 'string') return data[key] as string;
  }
  return '';
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function normalizeTool(data: Record<string, unknown>, event: RickEvent, kind: EventKind): ToolActivity {
  const nested = asObject(data.tool || data.call || data);
  const statusByKind: Partial<Record<EventKind, string>> = {
    'tool.completed': 'completed',
    'tool.failed': 'failed',
    'tool.approval': 'approval_required',
    'tool.started': 'running',
    'tool.progress': 'running',
  };
  const status = nested.status || statusByKind[kind] || 'running';
  return {
    id: String(nested.id || nested.tool_id || event.message_id || `tool-${event.sequence || Date.now()}`),
    name: String(nested.name || nested.tool || 'Tool'),
    status: String(status),
    arguments: nested.arguments || nested.args || nested.input,
    result: typeof nested.result === 'string' ? nested.result : typeof nested.output === 'string' ? nested.output : undefined,
    error: typeof nested.error === 'string' ? nested.error : event.error,
    dangerous: Boolean(nested.dangerous),
    duration_ms: typeof nested.duration_ms === 'number' ? nested.duration_ms : undefined,
  };
}

function normalizeSwarm(data: Record<string, unknown>, event: RickEvent, kind: EventKind): SwarmActivity {
  const nested = asObject(data.swarm || data.team || data);
  const rawAgents = Array.isArray(nested.agents) ? nested.agents : [];
  return {
    id: String(nested.id || nested.swarm_id || event.swarm_id || `swarm-${event.sequence || Date.now()}`),
    title: typeof nested.title === 'string' ? nested.title : typeof nested.name === 'string' ? nested.name : 'Swarm team',
    status: String(nested.status || (kind === 'swarm.completed' ? 'completed' : 'running')),
    agents: rawAgents.map(agent => {
      const value = asObject(agent);
      return { id: String(value.id || value.agent_id || 'agent'), name: value.name as string | undefined, task: value.task as string | undefined, status: String(value.status || 'running'), current_tool: value.current_tool as string | undefined, action: value.action as string | undefined, result: value.result as string | undefined, error: value.error as string | undefined };
    }),
    final_result: typeof nested.final_result === 'string' ? nested.final_result : undefined,
    error: typeof nested.error === 'string' ? nested.error : event.error,
  };
}

function mergeAgents(previous: SwarmActivity['agents'], incoming: SwarmActivity['agents']): SwarmActivity['agents'] {
  const result = [...previous];
  for (const agent of incoming) {
    const index = result.findIndex(value => value.id === agent.id);
    if (index < 0) result.push(agent); else result[index] = { ...result[index], ...agent };
  }
  return result;
}

function parseUsage(value: unknown): Usage | undefined {
  const data = asObject(value);
  const nested = asObject(data.usage);
  const source = Object.keys(nested).length ? { ...data, ...nested } : data;
  if (!Object.keys(source).length) return undefined;
  const input = numberValue(source, 'input_tokens', 'input', 'prompt_tokens', 'prompt');
  const output = numberValue(source, 'output_tokens', 'output', 'completion_tokens', 'completion');
  const cacheRead = numberValue(source, 'cache_read_tokens', 'cache_read', 'cached_tokens', 'cached');
  const cacheWrite = numberValue(source, 'cache_write_tokens', 'cache_write');
  const context = numberValue(source, 'context_tokens', 'context_used', 'prompt_tokens') || input;
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    cached_tokens: cacheRead + cacheWrite,
    total_tokens: numberValue(source, 'total_tokens', 'total') || input + output,
    context_tokens: context,
    context_limit: numberValue(source, 'context_limit', 'context_window', 'max_context_tokens'),
  };
}

function numberValue(value: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    if (typeof value[key] === 'number' && Number.isFinite(value[key])) return value[key] as number;
  }
  return 0;
}
