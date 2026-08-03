import { describe, expect, it } from 'vitest';
import { buildRunOptions } from './runOptions';

const config = {
  schema_version: 1,
  theme: 'charcoal' as const,
  font_size: 'medium' as const,
  permission_profile: 'readonly' as const,
  sandbox: 'read-only' as const,
  show_reasoning: true,
  reasoning_expanded: true,
  max_swarm_concurrency: 4,
  thinking_mode: 'high' as const,
  yolo: true,
};

describe('buildRunOptions', () => {
  it('forwards every active execution safety setting', () => {
    expect(buildRunOptions(config, 'build', [])).toEqual({
      permission_profile: 'readonly',
      sandbox: 'read-only',
      thinking: 'high',
      yolo: true,
      agent: 'build',
      attachments: [],
    });
  });
});
