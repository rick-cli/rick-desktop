import { describe, expect, it } from 'vitest';
import { applySuggestion, commandSuggestions, parseSlashContext, tokenizeQuoted } from './commands';
import { CommandSpec } from './types';

const catalog: CommandSpec[] = [
  { name: 'sessions', aliases: ['s'], description: 'List sessions', mode: 'native' },
  { name: 'models', description: 'List models', mode: 'native' },
  { name: 'exec', description: 'Run a command', mode: 'cli', arguments: [{ name: '--format' }] },
];

describe('slash command autocomplete', () => {
  it('recognizes a slash prefix and aliases', () => {
    expect(parseSlashContext('/s')).toMatchObject({ active: true, query: 's' });
    expect(commandSuggestions('/s', catalog)[0].spec.name).toBe('sessions');
  });

  it('applies a command without changing surrounding text', () => {
    expect(applySuggestion('/s', commandSuggestions('/s', catalog)[0])).toBe('/s ');
    expect(applySuggestion('/mo', commandSuggestions('/mo', catalog)[0])).toBe('/models ');
  });

  it('tokenizes quoted arguments', () => {
    expect(tokenizeQuoted('exec "hello world" --format json')).toEqual(['exec', 'hello world', '--format', 'json']);
  });
});
