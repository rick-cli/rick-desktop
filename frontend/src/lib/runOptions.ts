import { Attachment, DesktopConfig, RunOptions } from './types';

const DEFAULT_EXECUTION_OPTIONS = {
  permission_profile: 'standard',
  sandbox: 'workspace-write',
  thinking: 'auto',
  yolo: false,
} as const;

export function buildRunOptions(
  config: DesktopConfig | null,
  agent: string,
  attachments: Attachment[],
  cwd?: string,
): RunOptions {
  return {
    permission_profile: config?.permission_profile ?? DEFAULT_EXECUTION_OPTIONS.permission_profile,
    sandbox: config?.sandbox ?? DEFAULT_EXECUTION_OPTIONS.sandbox,
    thinking: config?.thinking_mode ?? DEFAULT_EXECUTION_OPTIONS.thinking,
    yolo: config?.yolo ?? DEFAULT_EXECUTION_OPTIONS.yolo,
    agent,
    cwd,
    attachments,
  };
}
