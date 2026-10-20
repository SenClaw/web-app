// Wire shapes of the daemon's sen-link A2A peering (`/api/sen-link/*`) — the
// `senclaw` repo's `src/sen_link/api.rs`. (Claude Code lives in the app-claude
// Space App, which ships its own page.)

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from './runtimeApi';

// ---- SLink (code name sen-link) ----

/** `config.json` → `senLink`. PUT replaces the whole block. */
export interface SenLinkSettings {
  enabled: boolean;
  name: string;
  description: string;
  /** IP address the LAN listener binds; `0.0.0.0` is every interface. */
  listenHost: string;
  listenPort: number;
  /** Off: no Agent Card, so a check or scan finds nothing; pairing by typed address still works. */
  discoverable: boolean;
  boardTitle: string;
  workspaceDir: string | null;
  defaultAssignee: string | null;
}

export interface SenLinkPeer {
  id: string;
  name: string;
  /** `host:port` as it was typed (an IP or a DNS name). */
  addr: string | null;
  /** We hold an address and a token for it, so tasks can be sent. */
  canSend: boolean;
  /** Its tasks skip Triage and go straight to Ready. */
  autoRun: boolean;
  assignee: string | null;
  /** Paired by an earlier version: pair again over the LAN. */
  legacy: boolean;
  createdAt: string;
}

export interface SenLinkStatus {
  settings: SenLinkSettings;
  agentCard: Record<string, unknown>;
  daemonId: string;
  peerCount: number;
  /** Address the LAN listener is bound to, `null` while it is not. */
  listening: string | null;
  listenError: string | null;
  /** This machine's LAN addresses. */
  addresses: string[];
  /** Peers dropped at startup because only a hub reached them. */
  migrated: string[];
}

export interface SenLinkInvite {
  code: string;
  expiresAt: number;
  port: number;
  addresses: string[];
  listening: boolean;
  listenError: string | null;
}

/** What `POST /api/sen-link/probe` finds at a typed address. */
export interface SenLinkProbe {
  ok: boolean;
  code: 'ok' | 'bad_address' | 'unresolved' | 'not_lan' | 'unreachable' | 'not_slink';
  addr: string;
  resolved: string[];
  reachable: boolean;
  /** A SLink that does not show its card (`discoverable` off). */
  hidden: boolean;
  card: { name: string; version: string; daemonId: string; pairable: boolean } | null;
  error: string | null;
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
  status: () => apiGet<SenLinkStatus>('/api/sen-link/status'),
  putSettings: (s: SenLinkSettings) => apiPut<SenLinkSettings>('/api/sen-link/settings', s),
  peers: () => apiGet<{ peers: SenLinkPeer[] }>('/api/sen-link/peers'),
  invite: () => apiPost<SenLinkInvite>('/api/sen-link/invites'),
  /** Where a typed IP or name lands and whether a SLink answers there. Never throws for a bad address: read `code`. */
  probe: (addr: string) => apiPost<SenLinkProbe>('/api/sen-link/probe', { addr }),
  pair: (addr: string, code: string) => apiPost<SenLinkPeer>('/api/sen-link/peers/pair', { addr, code }),
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
