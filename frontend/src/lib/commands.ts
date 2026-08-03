import { CommandSpec } from './types';

export interface SlashContext {
  active: boolean;
  query: string;
  command?: string;
  argumentText: string;
}

export interface CommandSuggestion {
  spec: CommandSpec;
  matchedAlias?: string;
  argument?: string;
  score: number;
}

export function parseSlashContext(input: string): SlashContext {
  const line = input.slice(0, input.lastIndexOf('\n') + 1);
  const current = input.slice(line.length);
  if (!current.startsWith('/')) return { active: false, query: '', argumentText: '' };
  const match = current.match(/^\/([^\s]*)\s?([\s\S]*)$/);
  if (!match) return { active: true, query: current.slice(1), argumentText: '' };
  return { active: true, query: match[1], command: match[1], argumentText: match[2] || '' };
}

export function commandSuggestions(input: string, catalog: CommandSpec[]): CommandSuggestion[] {
  const context = parseSlashContext(input);
  if (!context.active) return [];
  const query = context.query.toLowerCase();
  const hasArguments = Boolean(context.argumentText);
  return catalog.flatMap(spec => {
    const names = [spec.name, ...(spec.aliases || [])];
    const matched = names.find(name => name.toLowerCase() === query) || names.find(name => name.toLowerCase().startsWith(query));
    if (!matched) return [];
    let score = matched === query ? 0 : matched.toLowerCase().startsWith(query) ? 1 : 2;
    if (hasArguments && context.command && matched !== context.command) return [];
    if (hasArguments && spec.arguments?.length) {
      const tokens = context.argumentText.trim().split(/\s+/);
      const argumentQuery = (tokens[tokens.length - 1] || '').toLowerCase();
      const argument = spec.arguments.find(value => value.name.toLowerCase().startsWith(argumentQuery));
      if (argument) score -= 0.25;
      return [{ spec, matchedAlias: matched === spec.name ? undefined : matched, argument: argument?.name, score }];
    }
    return [{ spec, matchedAlias: matched === spec.name ? undefined : matched, score }];
  }).sort((left, right) => left.score - right.score || left.spec.name.localeCompare(right.spec.name));
}

export function applySuggestion(input: string, suggestion: CommandSuggestion): string {
  const context = parseSlashContext(input);
  if (!context.active) return input;
  const lineStart = input.lastIndexOf('\n') + 1;
  const prefix = input.slice(0, lineStart);
  const name = suggestion.matchedAlias || suggestion.spec.name;
  if (suggestion.argument && context.argumentText) {
    const argumentPrefix = context.argumentText.slice(0, Math.max(0, context.argumentText.lastIndexOf(' ') + 1));
    return `${prefix}/${name} ${argumentPrefix}${suggestion.argument} `;
  }
  return `${prefix}/${name}${context.argumentText ? ` ${context.argumentText}` : ' '}`;
}

export function tokenizeQuoted(input: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) tokens.push(match[1] ?? match[2] ?? match[3]);
  return tokens;
}
