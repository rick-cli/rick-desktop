import { describe, expect, it } from 'vitest';
import { addUserMessage, initialTimelineState, reduceRickEvent } from './timeline';
import {
  isEventForActiveRun,
  isEventForViewedSession,
  restoreLiveSession,
  shouldHydrateCompletedRun,
  shouldPublishHistory,
  shouldPublishUsage,
  shouldStashViewedTimeline,
  normalizePersistedTimeline,
  shouldUsePersistedTimeline,
} from './sessionSwitch';

describe('run correlation', () => {
  it('rejects delayed events from an obsolete run generation', () => {
    expect(isEventForActiveRun('run-new', 'run-new')).toBe(true);
    expect(isEventForActiveRun('run-old', 'run-new')).toBe(false);
    expect(isEventForActiveRun(undefined, 'run-new')).toBe(true);
  });
});

describe('restoreLiveSession', () => {
  it('restores a prompt plus background text, thinking, and tool activity as still running', () => {
    let timeline = {
      ...addUserMessage(initialTimelineState, 'latest prompt'),
      activeRunId: 'run-a',
      loading: true,
    };
    timeline = reduceRickEvent(timeline, { type: 'event', event: 'Thinking', session_id: 'session-a', run_id: 'run-a', data: { text: 'reasoning' } });
    timeline = reduceRickEvent(timeline, { type: 'event', event: 'Content', session_id: 'session-a', run_id: 'run-a', data: { text: 'answer' } });
    timeline = reduceRickEvent(timeline, { type: 'event', event: 'ToolCall', session_id: 'session-a', run_id: 'run-a', data: { id: 'tool-a', name: 'read', input: { path: 'file.txt' } } });
    const restored = restoreLiveSession(new Map([['session-a', timeline]]), 'session-a');

    expect(restored?.timeline.loading).toBe(true);
    expect(restored?.timeline.activeRunId).toBe('run-a');
    expect(restored?.timeline.messages[0].blocks[0].text).toBe('latest prompt');
    expect(restored?.timeline.messages.flatMap(message => message.blocks).map(block => block.kind)).toEqual(['text', 'reasoning', 'text', 'tool']);
  });

  it('restores both the background timeline and its live usage', () => {
    const timeline = {
      ...initialTimelineState,
      loading: true,
      usage: { input_tokens: 12, output_tokens: 5, cached_tokens: 80 },
    };
    const background = new Map([['running-session', timeline]]);

    expect(restoreLiveSession(background, 'running-session')).toEqual({
      timeline,
      usage: timeline.usage,
    });
  });

  it('returns undefined for a session without live state', () => {
    expect(restoreLiveSession(new Map(), 'historical-session')).toBeUndefined();
  });

  it('publishes loaded history only for the still-viewed inactive session', () => {
    expect(shouldPublishHistory('session-a', 'session-b', false)).toBe(false);
    expect(shouldPublishHistory('session-a', 'session-a', true)).toBe(false);
    expect(shouldPublishHistory('session-a', 'session-a', false)).toBe(true);
  });

  it('routes events only to their exact viewed session', () => {
    expect(isEventForViewedSession('', 'session-a')).toBe(true);
    expect(isEventForViewedSession('session-a', 'session-a')).toBe(true);
    expect(isEventForViewedSession('session-b', 'session-a')).toBe(false);
  });

  it('hydrates the persisted clean transcript only after successful done', () => {
    expect(shouldHydrateCompletedRun('done', false)).toBe(true);
    expect(shouldHydrateCompletedRun('done', true)).toBe(false);
    expect(shouldHydrateCompletedRun('error', false)).toBe(false);
  });

  it('stashes only running or deliberately preserved terminal timelines', () => {
    expect(shouldStashViewedTimeline('session-a', 'session-b', true, false)).toBe(true);
    expect(shouldStashViewedTimeline('session-a', 'session-b', false, true)).toBe(true);
    expect(shouldStashViewedTimeline('session-a', 'session-b', false, false)).toBe(false);
    expect(shouldStashViewedTimeline('session-a', 'session-a', true, false)).toBe(false);
  });

  it('publishes usage only for the session still being viewed', () => {
    expect(shouldPublishUsage('session-a', 'session-a')).toBe(true);
    expect(shouldPublishUsage('session-a', 'session-b')).toBe(false);
    expect(shouldPublishUsage('', '')).toBe(true);
  });

  it('keeps persisted live state running only when the daemon run is known', () => {
    const persisted = { ...initialTimelineState, loading: true, activeRunId: 'run-1' };
    expect(normalizePersistedTimeline(persisted, true)).toEqual(persisted);
    expect(normalizePersistedTimeline(persisted, false)).toMatchObject({ loading: false, activeRunId: undefined });
  });

  it('prefers the Desktop sidecar for live or not-yet-canonical sessions', () => {
    const persisted = { ...initialTimelineState, messages: [{ id: 'prompt', role: 'user' as const, blocks: [{ id: 'text', kind: 'text' as const, text: 'latest prompt' }], done: true }] };
    expect(shouldUsePersistedTimeline(persisted, 2, true)).toBe(true);
    expect(shouldUsePersistedTimeline(persisted, 0, false)).toBe(true);
    expect(shouldUsePersistedTimeline(persisted, 2, false)).toBe(false);
    expect(shouldUsePersistedTimeline(persisted, 2, false, true)).toBe(true);
    expect(shouldUsePersistedTimeline({ ...persisted, error: 'provider failed' }, 2, false)).toBe(true);
  });
});
