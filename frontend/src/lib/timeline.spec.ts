import { describe, expect, it } from 'vitest';
import { addUserMessage, hydrateMessages, initialTimelineState, reduceRickEvent, visibleMessages } from './timeline';

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

  it('retains failed-run details', () => {
    const state = reduceRickEvent(initialTimelineState, event({ type: 'error', run_id: 'r', error: 'denied' }));
    expect(state.error).toBe('denied');
    expect(state.messages[0].blocks[0].error).toBe('denied');
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

  it('derives completion status from legacy tool result events', () => {
    const state = reduceRickEvent(initialTimelineState, event({
      type: 'event',
      event: 'ToolResult',
      run_id: 'r',
      data: { id: 'tool-1', name: 'shell', result: 'done' },
    }));

    expect(state.messages[0].blocks[0].tool?.status).toBe('completed');
  });
});
