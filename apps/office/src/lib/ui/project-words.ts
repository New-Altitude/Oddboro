import type { ProjectAgent, ProjectStatus } from '@oddboro/ledger';

export const PROJECT_TOOLS: Record<ProjectAgent, string> = {
  claude: 'Claude Code',
  codex: 'Codex'
};
export const PROJECT_STATUS: Record<ProjectStatus, string> = {
  working: 'Working',
  waiting: 'Waiting for you',
  idle: 'Idle',
  done: 'Done'
};
