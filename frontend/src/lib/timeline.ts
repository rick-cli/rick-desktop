import { AttachmentBlock, ChatContentBlock, ChatMessage, EventKind, PermissionRequest, RickEvent, SwarmActivity, TimelineBlock, TimelineMessage, TimelineState, ToolActivity, Usage } from './types';

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

function canonicalBlocks(message: ChatMessage): ChatContentBlock[] {
  if (message.blocks?.length) return message.blocks;
  return message.content?.trim() ? [{ type: 'text', text: message.content }] : [];
}

function historyBlock(block: ChatContentBlock, messageIndex: number, blockIndex: number): TimelineBlock | undefined {
  const id = `history-${messageIndex}-${blockIndex}`;
  switch (block.type) {
    case 'text':
      return block.text?.trim() ? { id, kind: 'text', text: block.text } : undefined;
    case 'thinking':
      return block.text?.trim() ? { id, kind: 'reasoning', text: block.text, expanded: true } : undefined;
    case 'tool_use':
      return {
        id,
        kind: 'tool',
        tool: {
          id: block.id || id,
          name: block.name || 'tool',
          status: 'running',
          arguments: block.input,
        },
      };
    case 'image':
      return { id, kind: 'attachment', attachment: { name: 'Image', media_type: block.media_type } };
    default:
      return undefined;
  }
}

function finishHistoryTool(messages: TimelineMessage[], block: ChatContentBlock, fallbackID: string): void {
  const toolUseID = block.tool_use_id || '';
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const target = messages[messageIndex].blocks.find(candidate => candidate.kind === 'tool' && candidate.tool?.id === toolUseID);
    if (!target?.tool) continue;
    target.tool = {
      ...target.tool,
      status: block.is_error ? 'failed' : 'completed',
      result: block.is_error ? undefined : block.content,
      error: block.is_error ? block.content : undefined,
    };
    return;
  }
  messages.push({
    id: `${fallbackID}-message`,
    role: 'assistant',
    blocks: [{
      id: fallbackID,
      kind: 'tool',
      tool: {
        id: toolUseID || fallbackID,
        name: 'tool',
        status: block.is_error ? 'failed' : 'completed',
        result: block.is_error ? undefined : block.content,
        error: block.is_error ? block.content : undefined,
      },
    }],
    done: true,
  });
}

// Rebuild the complete TUI-like transcript from rick's canonical provider
// messages. Tool-result user turns are folded back into their tool cards rather
// than rendered as fake user prompts.
export function hydrateMessages(messages: ChatMessage[]): TimelineMessage[] {
  const hydrated: TimelineMessage[] = [];
  messages.forEach((message, messageIndex) => {
    const canonical = canonicalBlocks(message);
    const results = canonical.filter(block => block.type === 'tool_result');
    results.forEach((block, blockIndex) => finishHistoryTool(hydrated, block, `history-${messageIndex}-result-${blockIndex}`));

    const blocks = canonical
      .filter(block => block.type !== 'tool_result')
      .map((block, blockIndex) => historyBlock(block, messageIndex, blockIndex))
      .filter((block): block is TimelineBlock => Boolean(block));
    if (blocks.length === 0) return;
    hydrated.push({
      id: message.id || `history-${messageIndex}`,
      role: message.role === 'user' ? 'user' : message.role === 'system' ? 'system' : 'assistant',
      blocks,
      done: message.done ?? true,
      timestamp: message.timestamp,
    });
  });
  return hydrated.filter(isRenderableMessage);
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
      return { ...next, usage: accumulateUsage(next.usage, event.usage || parseUsage(event.data)) };
    case 'run.completed':
      return finishAssistant(next, runId, false);
    case 'run.cancelled':
      return finishAssistant({ ...next, error: undefined }, runId, true);
    case 'run.failed':
      return reduceFailedRun(next, runId, event);
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
    const blockIndex = message.blocks.length - 1;
    const lastBlock = message.blocks[blockIndex];
    if (!lastBlock || lastBlock.kind !== kind) {
      message.blocks.push({ id: `${message.id}-${kind}-${message.blocks.length}`, kind, text, expanded: kind === 'reasoning' });
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
  const nested = asObject(data.tool || data.call || data);
  const hasExplicitId = Boolean(nested.id || nested.tool_id || nested.call_id);
  let blockIndex = hasExplicitId
    ? message.blocks.findIndex(block => block.kind === 'tool' && block.tool?.id === tool.id)
    : -1;
  // Legacy daemon results have no call id, so pair them with the latest
  // running card by name. Every new invocation remains a distinct card.
  if (blockIndex < 0 && (tool.status === 'completed' || tool.status === 'failed')) {
    for (let i = message.blocks.length - 1; i >= 0; i -= 1) {
      const block = message.blocks[i];
      if (block.kind === 'tool' && block.tool?.name === tool.name && block.tool?.status === 'running') {
        blockIndex = i;
        break;
      }
    }
  }
  const block: TimelineBlock = { id: `${message.id}-tool-${tool.id}`, kind: 'tool', tool };
  if (blockIndex >= 0) message.blocks[blockIndex] = { ...message.blocks[blockIndex], tool };
  else message.blocks.push(block);
  message.done = false;
  if (index < 0) messages.push(message); else messages[index] = message;
  return { ...state, messages, loading: true };
}

function updateSwarm(state: TimelineState, runId: string | undefined, event: RickEvent, kind: EventKind): TimelineState {
  const data = asObject(event.data);
  const nested = asObject(data.swarm || data.team || data);
  const hasExplicitID = Boolean(nested.id || nested.swarm_id || event.swarm_id);
  const swarm = normalizeSwarm(data, event, kind);
  const previous = resolveSwarm(state.swarms, swarm, hasExplicitID, kind);
  const id = hasExplicitID ? swarm.id : previous?.id || swarm.id;
  const merged: SwarmActivity = {
    ...(previous || { id, agents: [] }),
    ...swarm,
    id,
    title: previous?.title || swarm.title || 'Swarm team',
    status: swarm.status || previous?.status || (kind === 'swarm.completed' ? 'completed' : 'running'),
    final_result: swarm.final_result || previous?.final_result,
    error: swarm.error || previous?.error,
    agents: mergeAgents(previous?.agents || [], swarm.agents || []),
  };
  const swarms = { ...state.swarms };
  if (previous && previous.id !== merged.id) delete swarms[previous.id];
  swarms[merged.id] = merged;
  const index = findAssistant(state.messages, runId, event.message_id);
  const messages = [...state.messages];
  const messageId = index >= 0 ? messages[index].id : event.message_id || `assistant-${runId || 'current'}`;
  const message = index >= 0 ? { ...messages[index], blocks: [...messages[index].blocks] } : { id: messageId, role: 'assistant' as const, runId, blocks: [], done: false };
  const blockIndex = message.blocks.findIndex(block => block.kind === 'swarm' && (block.swarm?.id === merged.id || block.swarm?.id === previous?.id));
  if (blockIndex >= 0) message.blocks[blockIndex] = { ...message.blocks[blockIndex], swarm: merged };
  else message.blocks.push({ id: `${message.id}-swarm-${merged.id}`, kind: 'swarm', swarm: merged });
  if (index < 0) messages.push(message); else messages[index] = message;
  return { ...state, messages, swarms, loading: kind === 'swarm.completed' ? state.loading : true };
}

// resolveSwarm finds the swarm record an event belongs to. Team tool events
// only carry an agent id (task_id / "completed <agent>"), so match those by
// agent before falling back to the most recently created swarm.
function resolveSwarm(
  swarms: Record<string, SwarmActivity>,
  candidate: SwarmActivity,
  hasExplicitID: boolean,
  kind: EventKind,
): SwarmActivity | undefined {
  if (candidate.id && swarms[candidate.id]) return swarms[candidate.id];
  const existing = Object.values(swarms);
  if (hasExplicitID) {
    if (kind !== 'swarm.started' || !candidate.title) return undefined;
    for (let index = existing.length - 1; index >= 0; index -= 1) {
      if (existing[index].title === candidate.title) return existing[index];
    }
    return undefined;
  }
  if (candidate.title) {
    for (let index = existing.length - 1; index >= 0; index -= 1) {
      if (existing[index].title === candidate.title) return existing[index];
    }
  }
  for (const agent of candidate.agents) {
    for (let index = existing.length - 1; index >= 0; index -= 1) {
      if (existing[index].agents.some(current => current.id === agent.id)) return existing[index];
    }
  }
  return existing[existing.length - 1];
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
    let target = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'assistant' && (!runId || messages[index].runId === runId)) {
        target = index;
        break;
      }
    }
    if (target >= 0) {
      const duplicate = messages[target].blocks.some(block => block.kind === 'error' && block.error === error);
      if (!duplicate) {
        messages[target] = { ...messages[target], blocks: [...messages[target].blocks, { id: `${messages[target].id}-error`, kind: 'error', error }] };
      }
    } else {
      messages.push({ id: `assistant-${runId || 'error'}`, role: 'assistant', runId, blocks: [{ id: `assistant-${runId || 'error'}-error`, kind: 'error', error }], done: true });
    }
  }
  return { ...state, messages, loading: false, activeRunId: undefined, error: cancelled ? undefined : error || state.error };
}

function humanizeProviderHalt(error: string): string | undefined {
  const lower = error.toLowerCase();
  if (lower.includes('reasoning_content') && /http.{0,4}400/.test(lower)) {
    return "Stopped: this provider rejected the saved reasoning state required to continue after a tool call. Start a fresh task or switch provider.";
  }
  if (lower.includes('request is full') || (lower.includes('503') && lower.includes('full'))) {
    return 'Provider at capacity (503 “the request is full”). Retry later or switch model/provider.';
  }
  return undefined;
}

function reduceFailedRun(state: TimelineState, runId: string | undefined, event: RickEvent): TimelineState {
  const message = event.error || eventText(event) || 'Rick reported an error';
  return finishAssistant(state, runId, false, humanizeProviderHalt(message) || message);
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
  const name = (event.event || '').toLowerCase().replace(/[_-]/g, '.').replace(/^event\./, '');
  // Tool events carry the tool name in data.name; swarm/team tool calls must
  // surface as swarm activity even when the transport kind says tool.started.
  if (name.includes('tool')) {
    const toolName = String(asObject(event.data).name || '').toLowerCase();
    if (toolName === 'swarm') return name.includes('result') ? 'swarm.completed' : 'swarm.started';
    if (toolName === 'team') return 'agent.updated';
  }
  if (event.kind && event.kind !== 'unknown') return event.kind as EventKind;
  if (event.type === 'done') return 'run.completed';
  if (event.type === 'cancelled') return 'run.cancelled';
  if (event.type === 'error') return 'run.failed';
  if (name === 'agentupdate' || name.startsWith('agent.')) return 'agent.updated';
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
    id: String(nested.id || nested.tool_id || nested.call_id || event.message_id || `tool-${event.sequence || Date.now()}`),
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
  const input = asObject(nested.input || data.input);
  const name = swarmName(data, nested);
  const rawAgents = Array.isArray(nested.agents) ? nested.agents : Array.isArray(input.agents) ? input.agents : [];
  const agents: SwarmActivity['agents'] = [];
  for (const agent of rawAgents) {
    const value = asObject(agent);
    const agentName = typeof value.name === 'string' ? value.name : typeof value.task_id === 'string' ? value.task_id : 'agent';
    agents.push({
      id: String(value.id || value.agent_id || agentName),
      name: typeof value.name === 'string' ? value.name : undefined,
      task: typeof value.role === 'string' ? value.role : typeof value.task === 'string' ? value.task : undefined,
      status: String(value.status || 'running'),
      current_tool: value.current_tool as string | undefined,
      action: value.action as string | undefined,
      result: value.result as string | undefined,
      error: value.error as string | undefined,
    });
  }
  // team tool calls report one agent finishing: input.task_id + result, or a
  // ToolResult title shaped "completed <agent>".
  if (typeof input.task_id === 'string') {
    agents.push({
      id: input.task_id,
      name: input.task_id,
      status: 'completed',
      result: typeof input.result === 'string' ? input.result : undefined,
    });
  }
  const completionTitle = typeof data.title === 'string' ? data.title : '';
  if (/^completed\s+/.test(completionTitle)) {
    agents.push({ id: completionTitle.replace(/^completed\s+/, ''), name: completionTitle.replace(/^completed\s+/, ''), status: 'completed' });
  }
  // the swarm completion result lists per-agent output as "[name] result".
  if (kind === 'swarm.completed' && typeof data.output === 'string') {
    for (const line of data.output.split('\n')) {
      const match = /^\[([^\]]+)\]\s*(.*)$/.exec(line.trim());
      if (match) agents.push({ id: match[1], name: match[1], status: 'completed', result: match[2] });
    }
  }
  return {
    id: String(nested.id || nested.swarm_id || event.swarm_id || (name ? `swarm-${name}` : `swarm-${event.sequence || Date.now()}`)),
    title: name ? name : undefined,
    status: String(nested.status || (kind === 'swarm.completed' ? 'completed' : kind === 'swarm.started' ? 'running' : '')),
    agents,
    final_result: typeof nested.final_result === 'string' ? nested.final_result : kind === 'swarm.completed' && typeof data.output === 'string' ? data.output : undefined,
    error: typeof nested.error === 'string' ? nested.error : event.error,
  };
}

// swarmName derives the stable swarm name from the payload shapes rickserve
// emits: SwarmStart carries it in data.name, the spawn call in input.name, and
// the completion result embeds it in the output text.
function swarmName(data: Record<string, unknown>, nested: Record<string, unknown>): string {
  const input = asObject(nested.input || data.input);
  if (typeof input.name === 'string' && input.name.trim()) return input.name.trim();
  const toolName = typeof data.name === 'string' ? data.name : '';
  if (toolName && toolName !== 'swarm' && toolName !== 'team') return toolName;
  if (typeof data.output === 'string') {
    const match = /Swarm\s+"([^"]+)"/.exec(data.output);
    if (match) return match[1];
  }
  return '';
}

function mergeAgents(previous: SwarmActivity['agents'], incoming: SwarmActivity['agents']): SwarmActivity['agents'] {
  const result = [...previous];
  for (const agent of incoming) {
    const index = result.findIndex(value => value.id === agent.id);
    if (index < 0) result.push(agent); else result[index] = { ...result[index], ...agent };
  }
  return result;
}

export function parseUsage(value: unknown): Usage | undefined {
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

// accumulateUsage sums rickserve's per-usage-event deltas into session totals
// while keeping the last-seen context figures.
export function accumulateUsage(previous: Usage | undefined, delta: Usage | undefined): Usage | undefined {
  if (!delta) return previous;
  const prev = previous || {};
  const input = delta.input_tokens || 0;
  const output = delta.output_tokens || 0;
  const cacheRead = delta.cache_read_tokens || 0;
  const cacheWrite = delta.cache_write_tokens || 0;
  return {
    input_tokens: (prev.input_tokens || 0) + input,
    output_tokens: (prev.output_tokens || 0) + output,
    cache_read_tokens: (prev.cache_read_tokens || 0) + cacheRead,
    cache_write_tokens: (prev.cache_write_tokens || 0) + cacheWrite,
    cached_tokens: (prev.cached_tokens || 0) + cacheRead + cacheWrite,
    total_tokens: (prev.total_tokens || 0) + input + output + cacheRead + cacheWrite,
    context_tokens: delta.context_tokens || prev.context_tokens,
    context_limit: delta.context_limit || prev.context_limit,
  };
}

function numberValue(value: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    if (typeof value[key] === 'number' && Number.isFinite(value[key])) return value[key] as number;
  }
  return 0;
}
