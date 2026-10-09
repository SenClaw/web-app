// Wire shapes of the daemon's Claude Code cowork (`/api/claude-code/*`) and
// sen-link A2A peering (`/api/sen-link/*`) — the `senclaw` repo's
// `src/claude_code/api.rs` and `src/sen_link/api.rs`.

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from './runtimeApi';

// ---- Claude Code ----

/** `config.json` → `claudeCode`. PUT replaces the whole block, so send every field. */
export interface ClaudeCodeSettings {
  binary: string;
  model: string | null;
  permissionMode: 'default' | 'acceptEdits' | 'plan' | 'auto' | 'dontAsk' | 'bypassPermissions';
  allowedTools: string[];
  maxTurns: number;
  maxBudgetUsd: number | null;
  verifyCommand: string | null;
  verifyTimeoutSecs: number;
  maxStopBlocks: number;
  review: boolean;
  maxFixRounds: number;
  mcpChatJid: string | null;
}

export interface ClaudeCodeStatus {
  binary: string;
  installed: boolean;
  version: string | null;
  assignee: string;
  mcp: { endpoints: string[]; tokenFile: string; addCommands: string[] };
}

export interface ClaudeCodeRun {
  runId: string;
  itemId: string;
  sessionId: string | null;
  cwd: string;
  phase: 'running' | 'verifying' | 'reviewing' | 'done' | 'blocked' | 'failed';
  verifyCommand: string | null;
  stopBlocks: number;
  fixRound: number;
  lastActivity: string;
  costUsd: number;
  startedAt: string;
  finishedAt: string | null;
}

export const claudeCodeApi = {
  status: () => apiGet<ClaudeCodeStatus>('/api/claude-code/status'),
  runs: () => apiGet<{ runs: ClaudeCodeRun[] }>('/api/claude-code/runs'),
  getSettings: () => apiGet<ClaudeCodeSettings>('/api/claude-code/settings'),
  putSettings: (s: ClaudeCodeSettings) => apiPut<ClaudeCodeSettings>('/api/claude-code/settings', s),
};

// ---- sen-link ----

/** `config.json` → `senLink`. PUT replaces the whole block. */
export interface SenLinkSettings {
  enabled: boolean;
  name: string;
  description: string;
  publicUrl: string | null;
  boardTitle: string;
  workspaceDir: string | null;
  defaultAssignee: string | null;
  /** SenClaw hub for peers behind NAT; when set, every invite mints a hub channel. */
  hubUrl: string | null;
}

export interface SenLinkPeer {
  id: string;
  name: string;
  url: string | null;
  /** Reached through its own hub channel. */
  viaRelay: boolean;
  /** We hold a URL or hub channel and a token for it, so tasks can be sent. */
  canSend: boolean;
  /** Its tasks skip Triage and go straight to Ready. */
  autoRun: boolean;
  assignee: string | null;
  createdAt: string;
}

/** An A2A v1.0 `Task` as the peer reports it. */
export interface A2ATask {
  id: string;
  contextId: string;
  status: { state: string; timestamp?: string | null; message?: { parts: { text?: string }[] } };
  artifacts: { artifactId: string; name: string; parts: { text?: string }[] }[];
  metadata?: { title?: string; assignee?: string | null; column?: string };
}

export const senLinkApi = {
  status: () =>
    apiGet<{ settings: SenLinkSettings; agentCard: Record<string, unknown>; peerCount: number; hubChannels: number }>(
      '/api/sen-link/status',
    ),
  putSettings: (s: SenLinkSettings) => apiPut<SenLinkSettings>('/api/sen-link/settings', s),
  peers: () => apiGet<{ peers: SenLinkPeer[] }>('/api/sen-link/peers'),
  /** `connect` is set when the daemon has a hub: a `senlink:` string the other side pairs with. */
  invite: () =>
    apiPost<{ code: string; expiresAt: number; url: string | null; connect: string | null; warning?: string | null }>(
      '/api/sen-link/invites',
    ),
  pair: (url: string, code: string) => apiPost<SenLinkPeer>('/api/sen-link/peers/pair', { url, code }),
  pairConnect: (connect: string) => apiPost<SenLinkPeer>('/api/sen-link/peers/pair', { connect }),
  patchPeer: (id: string, p: { name?: string; autoRun?: boolean; assignee?: string }) =>
    apiPatch<SenLinkPeer>(`/api/sen-link/peers/${encodeURIComponent(id)}`, p),
  removePeer: (id: string) => apiDelete<void>(`/api/sen-link/peers/${encodeURIComponent(id)}`),
  send: (id: string, text: string, opts: { taskId?: string; worktree?: boolean } = {}) =>
    apiPost<{ task: A2ATask }>(`/api/sen-link/peers/${encodeURIComponent(id)}/messages`, { text, ...opts }),
  tasks: (id: string) => apiGet<{ tasks: A2ATask[] }>(`/api/sen-link/peers/${encodeURIComponent(id)}/tasks`),
  cancel: (id: string, taskId: string) =>
    apiPost<A2ATask>(`/api/sen-link/peers/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/cancel`),
};

/** Short label for an A2A task state (`TASK_STATE_WORKING` → `working`). */
export const taskStateLabel = (state: string) => state.replace(/^TASK_STATE_/, '').toLowerCase().replace(/_/g, ' ');
