import { describe, expect, it } from 'vitest';
import { nextChatScroll } from './chatScroll';

describe('chat scroll policy', () => {
  it('keeps a session switch pending until its history has rendered, then jumps instantly', () => {
    const previous = { sessionId: 'old', pendingSwitch: false };

    const emptyPaint = nextChatScroll(previous, 'new', 0, true);
    expect(emptyPaint.behavior).toBeUndefined();
    expect(emptyPaint.state.pendingSwitch).toBe(true);

    const historyPaint = nextChatScroll(emptyPaint.state, 'new', 80, true);
    expect(historyPaint.behavior).toBe('auto');
    expect(historyPaint.state.pendingSwitch).toBe(false);
  });

  it('follows streamed updates immediately while the user is at the bottom', () => {
    const update = nextChatScroll({ sessionId: 'same', pendingSwitch: false }, 'same', 12, true);
    expect(update.behavior).toBe('auto');
  });

  it('does not force the user back to the bottom after they scroll upward', () => {
    const update = nextChatScroll({ sessionId: 'same', pendingSwitch: false }, 'same', 13, false);
    expect(update.behavior).toBeUndefined();
  });
});
