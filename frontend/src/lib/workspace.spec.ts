import { describe, expect, it } from 'vitest';
import { collectContextFiles } from './workspace';
import type { TimelineBlock, TimelineMessage } from './types';

let messageId = 0;

function block(kind: TimelineBlock['kind'], data: Partial<TimelineBlock>): TimelineBlock {
  messageId += 1;
  return { id: `block-${messageId}`, kind, ...data };
}

function message(blocks: TimelineBlock[]): TimelineMessage {
  messageId += 1;
  return { id: `message-${messageId}`, role: 'assistant', blocks, done: true };
}

describe('collectContextFiles', () => {
  it('collects real attachment and tool file paths in most-recent-first order', () => {
    const messages = [
      message([block('attachment', { attachment: { name: 'PLAN.md', size: 10, media_type: 'text/markdown' } })]),
      message([block('tool', { tool: { id: '1', name: 'read_file', status: 'done', arguments: { file_path: 'src/App.tsx' } } })]),
      message([block('tool', { tool: { id: '2', name: 'patch', status: 'done', arguments: { patches: [{ path: 'src/index.css' }] } } })]),
    ];

    expect(collectContextFiles(messages)).toEqual(['src/index.css', 'src/App.tsx', 'PLAN.md']);
  });

  it('extracts file paths mentioned directly in message text', () => {
    const messages = [message([block('text', { text: 'Review G:\\RickDesktop\\PLAN.md and /tmp/report.json before editing.' })])];

    expect(collectContextFiles(messages)).toEqual(['/tmp/report.json', 'G:\\RickDesktop\\PLAN.md']);
  });

  it('deduplicates case-insensitively and applies the display limit', () => {
    const messages = [
      message([block('tool', { tool: { id: '1', name: 'read_file', status: 'done', arguments: { path: 'src/ignored-directory' } } })]),
      message([block('tool', { tool: { id: '2', name: 'write_file', status: 'done', arguments: { file: 'SRC/App.tsx' } } })]),
      message([block('tool', { tool: { id: '3', name: 'write_file', status: 'done', arguments: { file_path: 'src/app.tsx' } } })]),
      message([block('attachment', { attachment: { name: 'notes.txt', size: 5, media_type: 'text/plain' } })]),
    ];

    expect(collectContextFiles(messages, 1)).toEqual(['notes.txt']);
  });
});
