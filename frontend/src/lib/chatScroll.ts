export interface ChatScrollState {
  sessionId?: string;
  pendingSwitch: boolean;
}

export interface ChatScrollDecision {
  state: ChatScrollState;
  behavior?: ScrollBehavior;
}

export function nextChatScroll(
  previous: ChatScrollState,
  sessionId: string | undefined,
  messageCount: number,
  isFollowing: boolean,
): ChatScrollDecision {
  const pendingSwitch = previous.pendingSwitch || previous.sessionId !== sessionId;
  const state = { sessionId, pendingSwitch };

  if (pendingSwitch && sessionId && messageCount === 0) {
    return { state };
  }

  if (!pendingSwitch && !isFollowing) {
    return { state };
  }

  return {
    state: { sessionId, pendingSwitch: false },
    behavior: 'auto',
  };
}
