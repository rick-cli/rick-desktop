import type { TimelineMessage } from './types';

const DIRECT_FILE_KEYS = new Set(['file', 'file_path', 'filepath', 'filename']);
const WINDOWS_FILE_PATTERN = /\b[A-Za-z]:[\\/][^\r\n"'<>|?*]*?\.[A-Za-z0-9_-]{1,12}\b/g;
const UNIX_FILE_PATTERN = /(?:^|\s)(\/(?:[^\s/'"<>]+\/)*[^\s/'"<>]+\.[A-Za-z0-9_-]{1,12})\b/gm;

function collectTextFiles(content: string, candidates: string[]): void {
  candidates.push(...content.match(WINDOWS_FILE_PATTERN) || []);
  for (const match of content.matchAll(UNIX_FILE_PATTERN)) candidates.push(match[1]);
}

function collectArgumentFiles(value: unknown, candidates: string[], allowPath = false): void {
  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (const item of value) collectArgumentFiles(item, candidates, allowPath);
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (typeof nestedValue === 'string' && (DIRECT_FILE_KEYS.has(key) || (allowPath && key === 'path'))) {
      if (nestedValue.trim()) candidates.push(nestedValue.trim());
      continue;
    }

    collectArgumentFiles(nestedValue, candidates, allowPath || key === 'patches');
  }
}

export function collectContextFiles(messages: TimelineMessage[], maxFiles = 5): string[] {
  const recentFiles = new Map<string, string>();

  for (const message of messages) {
    for (const block of message.blocks) {
      const candidates: string[] = [];
      if (block.text) collectTextFiles(block.text, candidates);
      if (block.attachment?.name) candidates.push(block.attachment.name);
      if (block.tool?.arguments) collectArgumentFiles(block.tool.arguments, candidates);

      for (const candidate of candidates) {
        const normalized = candidate.toLowerCase();
        recentFiles.delete(normalized);
        recentFiles.set(normalized, candidate);
      }
    }
  }

  return [...recentFiles.values()].reverse().slice(0, Math.max(0, maxFiles));
}
