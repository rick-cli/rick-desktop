import { describe, expect, it } from 'vitest';
import { accumulateUsage, addUserMessage, hydrateMessages, initialTimelineState, reduceRickEvent, visibleMessages } from './timeline';

function event(overrides: Record<string, unknown>) {
  return overrides as any;
}

describe('timeline normalization', () => {
  it('joins legacy Content chunks and completes the assistant message', () => {
    let state = addUserMessage(initialTimelineState, 'hello', 'user-1');
    state = reduceRickEvent(state, event({ type: 'event', event: 'Content', run_id: 'run-1', data: { text: 'Hel' } }));
    state = reduceRickEvent(state, event({ type: 'event', event: 'Content', run_id: 'run-1', data: { text: 'lo' } }));
    state = reduceRickEvent(state, event({ type: 'done', run_id: 'run-1' }));
    expect(state.messages[1].blocks[0].text).toBe('Hello');
    expect(state.messages[1].done).toBe(true);
    expect(state.loading).toBe(false);
  });

  it('keeps reasoning and tool activity as explicit blocks', () => {
    let state = reduceRickEvent(initialTimelineState, event({ type: 'event', event: 'Thinking', run_id: 'r', data: { text: 'plan' } }));
    state = reduceRickEvent(state, event({ type: 'event', event: 'ToolStart', run_id: 'r', data: { id: 't', name: 'shell', status: 'running' } }));
    expect(state.messages[0].blocks.map(block => block.kind)).toEqual(['reasoning', 'tool']);
  });

  it('removes empty history messages at the render boundary', () => {
    const hydrated = hydrateMessages([{ role: 'assistant', content: '' }, { role: 'user', content: 'visible' }]);
    expect(visibleMessages(hydrated)).toHaveLength(1);
    expect(visibleMessages(hydrated)[0].blocks[0].text).toBe('visible');
  });

  it('restores canonical thinking and completed tools when a chat is revisited', () => {
    const hydrated = hydrateMessages([
      { role: 'user', blocks: [{ type: 'text', text: 'Inspect the project' }] },
      { role: 'assistant', blocks: [
        { type: 'thinking', text: 'I should read the entry point.' },
        { type: 'tool_use', id: 'tool-1', name: 'read', input: { path: 'main.go' } },
        { type: 'text', text: 'The entry point is clean.' },
      ] },
      { role: 'user', blocks: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'package main' }] },
    ]);

    expect(hydrated).toHaveLength(2);
    expect(hydrated[1].blocks.map(block => block.kind)).toEqual(['reasoning', 'tool', 'text']);
    expect(hydrated[1].blocks[0].text).toContain('read the entry point');
    expect(hydrated[1].blocks[1].tool).toMatchObject({
      id: 'tool-1', name: 'read', status: 'completed', result: 'package main',
    });
  });

  it('does not render persisted tool results as user prompts', () => {
    const hydrated = hydrateMessages([
      { role: 'user', blocks: [{ type: 'tool_result', tool_use_id: 'missing', content: 'result' }] },
    ]);

    expect(hydrated).toHaveLength(1);
    expect(hydrated[0].role).toBe('assistant');
    expect(hydrated[0].blocks[0].kind).toBe('tool');
  });

  it('retains failed-run details', () => {
    const state = reduceRickEvent(initialTimelineState, event({ type: 'error', run_id: 'r', error: 'denied' }));
    expect(state.error).toBe('denied');
    expect(state.messages[0].blocks[0].error).toBe('denied');
  });

  it('finishes a run when the provider rejects the continuation after a tool result', () => {
    let state = addUserMessage(initialTimelineState, 'hi', 'user-1');
    state = reduceRickEvent(state, event({ type: 'event', event: 'ToolUse', run_id: 'r', data: { name: 'read', input: { path: 'a' } } }));
    state = reduceRickEvent(state, event({ type: 'event', event: 'ToolResult', run_id: 'r', data: { name: 'read', output: 'file contents' } }));
    state = reduceRickEvent(state, event({ type: 'error', run_id: 'r', error: 'opencode-zen: http 503: the request is full' }));
    // rickserve emits both the terminal agent event and the command response,
    // followed by done. They must collapse into one terminal error.
    state = reduceRickEvent(state, event({ type: 'error', run_id: 'r', error: 'opencode-zen: http 503: the request is full' }));
    state = reduceRickEvent(state, event({ type: 'done', run_id: 'r' }));

    expect(state.loading).toBe(false);
    expect(state.error).toContain('503');
    expect(state.messages[1].done).toBe(true);
    expect(state.messages[1].blocks.some(block => block.kind === 'tool')).toBe(true);
    expect(state.messages[1].blocks.filter(block => block.kind === 'error')).toHaveLength(1);
  });

  it('renders a standalone permission request so it can be answered', () => {
    const state = reduceRickEvent(initialTimelineState, event({
      kind: 'permission.requested',
      run_id: 'r',
      data: { request_id: 'permission-1', command: 'rm file.txt' },
    }));

    expect(visibleMessages(state.messages)).toHaveLength(1);
    expect(visibleMessages(state.messages)[0].blocks[0].permission?.request_id).toBe('permission-1');
  });

  it('keeps the enclosing run loading after a swarm completes', () => {
    let state = reduceRickEvent(initialTimelineState, event({ kind: 'run.started', run_id: 'r' }));
    state = reduceRickEvent(state, event({ kind: 'swarm.completed', run_id: 'r', data: { id: 'swarm-1' } }));

    expect(state.loading).toBe(true);
  });

  it('renders a completed swarm from the swarm tool events', () => {
    let state = reduceRickEvent(initialTimelineState, event({ kind: 'run.started', run_id: 'r' }));
    state = reduceRickEvent(state, event({ type: 'event', event: 'SwarmStart', run_id: 'r', data: { agents: 2, goal: 'g', name: 'moon-facts' } }));
    state = reduceRickEvent(state, event({
      type: 'event', event: 'ToolUse', run_id: 'r',
      data: { name: 'swarm', input: { action: 'spawn', name: 'moon-facts', agents: [{ name: 'fact-agent-1', role: 'r1' }, { name: 'fact-agent-2', role: 'r2' }] } },
    }));
    state = reduceRickEvent(state, event({ type: 'event', event: 'ToolUse', run_id: 'r', data: { name: 'team', input: { action: 'complete_task', task_id: 'fact-agent-1', result: 'fact one' } } }));
    state = reduceRickEvent(state, event({ type: 'event', event: 'ToolResult', run_id: 'r', data: { name: 'team', output: 'task completed', title: 'completed fact-agent-1' } }));
    state = reduceRickEvent(state, event({ type: 'event', event: 'ToolResult', run_id: 'r', data: { name: 'swarm', output: 'Swarm "moon-facts" completed. Goal: g\n[fact-agent-1] fact one\n[fact-agent-2] fact two', title: 'agent team completed' } }));
    state = reduceRickEvent(state, event({ type: 'done', run_id: 'r' }));

    const swarms = Object.values(state.swarms);
    expect(swarms).toHaveLength(1);
    expect(swarms[0].title).toBe('moon-facts');
    expect(swarms[0].status).toBe('completed');
    expect(swarms[0].agents).toHaveLength(2);
    expect(swarms[0].agents.every(agent => agent.status === 'completed')).toBe(true);
    expect(swarms[0].agents.map(agent => agent.result)).toEqual(['fact one', 'fact two']);
    expect(swarms[0].final_result).toContain('[fact-agent-2] fact two');
    expect(state.messages[0].blocks.some(block => block.kind === 'tool')).toBe(false);
    expect(state.messages[0].blocks.some(block => block.kind === 'swarm')).toBe(true);
    expect(state.loading).toBe(false);
  });

  it('renders swarm activity when the bridge reports transport-level tool kinds', () => {
    // The Go bridge classifies ToolUse/ToolResult by transport name, so the
    // live app delivers these with kind tool.started/tool.completed/unknown.
    let state = reduceRickEvent(initialTimelineState, event({ type: 'event', event: 'SwarmStart', kind: 'unknown', run_id: 'r', data: { agents: 2, goal: 'g', name: 'moon-facts' } }));
    state = reduceRickEvent(state, event({ type: 'event', event: 'ToolUse', kind: 'tool.started', run_id: 'r', data: { name: 'swarm', input: { action: 'spawn', name: 'moon-facts', agents: [{ name: 'fact-agent-1', role: 'r1' }, { name: 'fact-agent-2', role: 'r2' }] } } }));
    state = reduceRickEvent(state, event({ type: 'event', event: 'ToolUse', kind: 'tool.started', run_id: 'r', data: { name: 'team', input: { action: 'complete_task', task_id: 'fact-agent-1', result: 'fact one' } } }));
    state = reduceRickEvent(state, event({ type: 'event', event: 'ToolResult', kind: 'tool.completed', run_id: 'r', data: { name: 'team', output: 'task completed', title: 'completed fact-agent-1' } }));
    state = reduceRickEvent(state, event({ type: 'event', event: 'ToolResult', kind: 'tool.completed', run_id: 'r', data: { name: 'swarm', output: 'Swarm "moon-facts" completed. Goal: g\n[fact-agent-1] fact one\n[fact-agent-2] fact two', title: 'agent team completed' } }));
    state = reduceRickEvent(state, event({ type: 'done', kind: 'run.completed', run_id: 'r' }));

    const swarms = Object.values(state.swarms);
    expect(swarms).toHaveLength(1);
    expect(swarms[0].title).toBe('moon-facts');
    expect(swarms[0].status).toBe('completed');
    expect(swarms[0].agents.map(agent => agent.result)).toEqual(['fact one', 'fact two']);
    expect(state.messages[0].blocks.some(block => block.kind === 'tool')).toBe(false);
    expect(state.messages[0].blocks.some(block => block.kind === 'swarm')).toBe(true);
    expect(state.loading).toBe(false);
  });

  it('keeps swarm worker websearch updates inside one swarm card', () => {
    let state = reduceRickEvent(initialTimelineState, event({
      type: 'event', event: 'ToolUse', kind: 'swarm.started', run_id: 'r',
      data: { name: 'swarm', input: { name: 'research', agents: [{ name: 'early-life', role: 'research' }, { name: 'business', role: 'research' }] } },
    }));
    state = reduceRickEvent(state, event({
      type: 'event', event: 'AgentUpdate', kind: 'agent.updated', run_id: 'r',
      data: { agents: [{ id: 'business', name: 'business', status: 'working', current_tool: 'websearch', action: 'websearch completed' }] },
    }));

    expect(Object.values(state.swarms)).toHaveLength(1);
    expect(state.messages[0].blocks.filter(block => block.kind === 'swarm')).toHaveLength(1);
    expect(state.messages[0].blocks.some(block => block.kind === 'tool')).toBe(false);
    expect(Object.values(state.swarms)[0].agents.find(agent => agent.id === 'business')?.action).toBe('websearch completed');
  });

  it('recognizes the legacy AgentUpdate transport spelling', () => {
    let state = reduceRickEvent(initialTimelineState, event({
      type: 'event', event: 'SwarmStart', kind: 'swarm.started', run_id: 'r',
      data: { swarm_id: 'swarm-1', name: 'research', agents: [{ id: 'business', name: 'business' }] },
    }));
    state = reduceRickEvent(state, event({
      type: 'event', event: 'AgentUpdate', kind: 'unknown', run_id: 'r',
      data: { swarm_id: 'swarm-1', agents: [{ id: 'business', status: 'working', action: 'websearch completed' }] },
    }));

    expect(state.messages[0].blocks.filter(block => block.kind === 'swarm')).toHaveLength(1);
    expect(Object.values(state.swarms)[0].agents[0].action).toBe('websearch completed');
  });

  it('routes agent updates by swarm identity when agent names are reused', () => {
    let state = reduceRickEvent(initialTimelineState, event({
      kind: 'swarm.started', run_id: 'r', data: { swarm_id: 'swarm-old', name: 'old', agents: [{ id: 'researcher' }] },
    }));
    state = reduceRickEvent(state, event({
      kind: 'swarm.started', run_id: 'r', data: { swarm_id: 'swarm-new', name: 'new', agents: [{ id: 'researcher' }] },
    }));
    state = reduceRickEvent(state, event({
      kind: 'agent.updated', run_id: 'r', data: { swarm_id: 'swarm-new', agents: [{ id: 'researcher', action: 'new swarm update' }] },
    }));

    expect(state.swarms['swarm-old'].agents[0].action).toBeUndefined();
    expect(state.swarms['swarm-new'].agents[0].action).toBe('new swarm update');
  });

  it('migrates the optimistic swarm card to the runtime swarm identity', () => {
    let state = reduceRickEvent(initialTimelineState, event({
      type: 'event', event: 'ToolUse', kind: 'swarm.started', run_id: 'r',
      data: { name: 'swarm', input: { name: 'research', agents: [{ name: 'business' }] } },
    }));
    state = reduceRickEvent(state, event({
      type: 'event', event: 'SwarmStart', kind: 'swarm.started', run_id: 'r',
      data: { swarm_id: 'swarm-runtime-1', name: 'research', agents: 1 },
    }));

    expect(Object.keys(state.swarms)).toEqual(['swarm-runtime-1']);
    expect(state.messages[0].blocks.filter(block => block.kind === 'swarm')).toHaveLength(1);
    expect(state.messages[0].blocks[0].swarm?.id).toBe('swarm-runtime-1');
  });

  it('derives completion status from legacy tool result events', () => {
    const state = reduceRickEvent(initialTimelineState, event({
      type: 'event',
      event: 'ToolResult',
      run_id: 'r',
      data: { id: 'tool-1', name: 'shell', result: 'done' },
    }));

    expect(state.messages[0].blocks[0].tool?.status).toBe('completed');
  });

  it('merges a tool result into its running card instead of duplicating it', () => {
    let state = reduceRickEvent(initialTimelineState, event({ type: 'event', event: 'ToolUse', run_id: 'r', sequence: 1, data: { name: 'websearch', input: { query: 'x' } } }));
    state = reduceRickEvent(state, event({ type: 'event', event: 'ToolUse', run_id: 'r', sequence: 2, data: { name: 'websearch', input: { query: 'y' } } }));
    state = reduceRickEvent(state, event({ type: 'event', event: 'ToolResult', run_id: 'r', sequence: 3, data: { name: 'websearch', output: 'results' } }));

    const tools = state.messages[0].blocks.filter(block => block.kind === 'tool').map(block => block.tool);
    expect(tools).toHaveLength(2);
    expect(tools[0].status).toBe('running');
    expect(tools[1].status).toBe('completed');
    expect(tools[1].result).toBe('results');
  });

  it('preserves text-tool-text chronology instead of merging across a tool', () => {
    let state = reduceRickEvent(initialTimelineState, event({ type: 'event', event: 'Content', run_id: 'r', data: { text: 'before' } }));
    state = reduceRickEvent(state, event({ type: 'event', event: 'ToolUse', run_id: 'r', data: { call_id: 'call-1', name: 'read', input: { path: 'a' } } }));
    state = reduceRickEvent(state, event({ type: 'event', event: 'Content', run_id: 'r', data: { text: 'after' } }));

    expect(state.messages[0].blocks.map(block => block.kind)).toEqual(['text', 'tool', 'text']);
    expect(state.messages[0].blocks[0].text).toBe('before');
    expect(state.messages[0].blocks[2].text).toBe('after');
  });

  it('keeps sequential completed calls to the same tool distinct by call id', () => {
    let state = reduceRickEvent(initialTimelineState, event({ type: 'event', event: 'ToolUse', run_id: 'r', data: { call_id: 'call-1', name: 'read', input: { path: 'a' } } }));
    state = reduceRickEvent(state, event({ type: 'event', event: 'ToolResult', run_id: 'r', data: { call_id: 'call-1', name: 'read', output: 'A' } }));
    state = reduceRickEvent(state, event({ type: 'event', event: 'ToolUse', run_id: 'r', data: { call_id: 'call-2', name: 'read', input: { path: 'b' } } }));
    state = reduceRickEvent(state, event({ type: 'event', event: 'ToolResult', run_id: 'r', data: { call_id: 'call-2', name: 'read', output: 'B' } }));

    const tools = state.messages[0].blocks.filter(block => block.kind === 'tool').map(block => block.tool);
    expect(tools).toHaveLength(2);
    expect(tools.map(tool => [tool?.id, tool?.result])).toEqual([['call-1', 'A'], ['call-2', 'B']]);
  });

  it('accumulates per-call usage deltas into session totals', () => {
    const first = accumulateUsage(undefined, event({ input_tokens: 100, output_tokens: 50, cache_read_tokens: 30, cache_write_tokens: 10 }));
    const second = accumulateUsage(first, event({ input_tokens: 40, output_tokens: 60, cache_read_tokens: 20 }));
    expect(second?.input_tokens).toBe(140);
    expect(second?.output_tokens).toBe(110);
    expect(second?.cache_read_tokens).toBe(50);
    expect(second?.cache_write_tokens).toBe(10);
    expect(second?.cached_tokens).toBe(60);
    expect(second?.total_tokens).toBe(310);
  });

  it('keeps the last-seen context figures across usage deltas', () => {
    const first = accumulateUsage(undefined, event({ input_tokens: 10, context_tokens: 512, context_limit: 128000 }));
    const second = accumulateUsage(first, event({ output_tokens: 5 }));
    expect(second?.context_tokens).toBe(512);
    expect(second?.context_limit).toBe(128000);
  });

  it('reduces usage events through accumulation', () => {
    let state = reduceRickEvent(initialTimelineState, event({ kind: 'usage', data: { input_tokens: 10, output_tokens: 2 } }));
    state = reduceRickEvent(state, event({ kind: 'usage', data: { input_tokens: 8, output_tokens: 3 } }));
    expect(state.usage?.input_tokens).toBe(18);
    expect(state.usage?.output_tokens).toBe(5);
  });
});
