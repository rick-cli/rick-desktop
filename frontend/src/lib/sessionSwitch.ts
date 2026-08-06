import { TimelineState, Usage } from './types';

export interface RestoredLiveSession {
  timeline: TimelineState;
  usage: Usage | null;
}

export function restoreLiveSession(
  backgroundTimelines: ReadonlyMap<string, TimelineState>,
  sessionId: string,
): RestoredLiveSession | undefined {
  const timeline = backgroundTimelines.get(sessionId);
  if (!timeline) return undefined;
  return { timeline, usage: timeline.usage ?? null };
}

export function shouldPublishHistory(
  requestedSessionId: string,
  viewedSessionId: string,
  isRunning: boolean,
): boolean {
  return requestedSessionId === viewedSessionId && !isRunning;
}

export function isEventForViewedSession(eventSessionId: string, viewedSessionId: string): boolean {
  return eventSessionId === '' || eventSessionId === viewedSessionId;
}

export function isEventForActiveRun(eventRunId?: string, activeRunId?: string): boolean {
  return !eventRunId || !activeRunId || eventRunId === activeRunId;
}

export function shouldHydrateCompletedRun(eventType: string, unsuccessful: boolean): boolean {
  return eventType === 'done' && !unsuccessful;
}

export function shouldStashViewedTimeline(
  viewedSessionId: string,
  nextSessionId: string,
  isRunning: boolean,
  isPreservedTerminal: boolean,
): boolean {
  return viewedSessionId !== '' && viewedSessionId !== nextSessionId && (isRunning || isPreservedTerminal);
}

export function shouldPublishUsage(requestedSessionId: string, viewedSessionId: string): boolean {
  return requestedSessionId === viewedSessionId;
}

export function normalizePersistedTimeline(timeline: TimelineState, knownRunning: boolean): TimelineState {
  if (knownRunning) return timeline;
  return { ...timeline, loading: false, activeRunId: undefined };
}

export function shouldUsePersistedTimeline(
  timeline: TimelineState | null,
  canonicalMessageCount: number,
  knownRunning: boolean,
  persistedIsCurrent = false,
): boolean {
  if (!timeline) return false;
  const hasTerminalError = Boolean(timeline.error) || timeline.messages.some(message =>
    message.blocks.some(block => block.kind === 'error'),
  );
  return knownRunning || persistedIsCurrent || canonicalMessageCount === 0 || hasTerminalError;
}
