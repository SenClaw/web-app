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
  /** The network has seen it lately (an announcement or a scan). */
  online: boolean;
  /** What it may read of this machine's knowledge. Closed until a person opens it. */
  knowledge: SenLinkKnowledgePolicy;
  createdAt: string;
}

/** What one peer may read of this machine's knowledge (`PATCH /peers/:id {knowledge}` replaces it). */
export interface SenLinkKnowledgePolicy {
  /** Facts that belong to the whole agent (not said in one chat). */
  facts: boolean;
  /** Curated notes of the chosen types. */
  notes: boolean;
  /** Profile folders both switches apply to; none = nothing is shared. */
  profiles: string[];
  /** A subset of `project`, `reference`, `feedback`; empty means project + reference. `user` can never be shared. */
  noteTypes: string[];
}

/** What a policy would let out of one profile, counted by the same rules an answer uses. */
export interface SenLinkKnowledgePreviewProfile {
  profile: string;
  exists: boolean;
  facts: number;
  /** Shareable notes by type. */
  notes: Record<string, number>;
  /** Titles of the newest shareable notes. */
  samples: string[];
  /** What stays home, by class. */
  excluded: { dailyLogs: number; conversationSummaries: number; aboutTheOwner: number; writtenInOneChat: number; otherTypes: number };
}

export interface SenLinkKnowledgeView {
  policy: SenLinkKnowledgePolicy;
  preview: { open: boolean; profiles: SenLinkKnowledgePreviewProfile[] };
  /** Profile folders on this machine that a policy may name. */
  profiles: string[];
  /** Note types a person may share. */
  noteTypes: string[];
}

export interface SenLinkRecallHit {
  kind: 'fact' | 'note';
  profile: string;
  title?: string;
  type?: string;
  text: string;
  when: string | null;
}

/** A peer's answer to a question. The words were written on another machine. */
export interface SenLinkRecall {
  v: number;
  hits: SenLinkRecallHit[];
  truncated: boolean;
  from: string;
  untrusted: boolean;
}

/** Another SLink the network showed: announcements and scan hits, folded by daemon. */
export interface SenLinkDiscovered {
  daemonId: string;
  name: string;
  /** LAN addresses, IPv4 first. */
  addrs: string[];
  port: number;
  /** It has a live invite, so a code can be redeemed there now. */
  pairable: boolean;
  sources: ('mdns' | 'scan')[];
  seenSecsAgo: number;
}

/** A network scan, running or finished. */
export interface SenLinkScan {
  scanId: string;
  state: 'running' | 'done' | 'canceled';
  scanned: number;
  total: number;
  port: number;
  /** The subnets being walked, `a.b.c.d/len`. */
  ranges: string[];
  /** Things worth telling the person: a subnet narrowed or skipped. */
  notes: string[];
  found: { daemonId: string; name: string; addrs: string[]; port: number; pairable: boolean }[];
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
  /** Finding other SLinks by announcement: what runs, and why not. */
  discovery: { browsing: boolean; advertising: boolean; error: string | null };
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
  /** What the network has shown. */
  discovered: () =>
    apiGet<{ discovered: SenLinkDiscovered[]; browsing: boolean; advertising: boolean; error: string | null }>('/api/sen-link/discovered'),
  /** Start walking this machine's networks (or `cidr`) for SLinks. One at a time: a second start is a 409. */
  scanStart: (opts: { cidr?: string; port?: number } = {}) => apiPost<SenLinkScan>('/api/sen-link/scan', opts),
  scanGet: (id: string) => apiGet<SenLinkScan>(`/api/sen-link/scan/${encodeURIComponent(id)}`),
  scanCancel: (id: string) => apiPost<SenLinkScan>(`/api/sen-link/scan/${encodeURIComponent(id)}/cancel`),
  patchPeer: (id: string, p: { name?: string; autoRun?: boolean; assignee?: string; knowledge?: SenLinkKnowledgePolicy }) =>
    apiPatch<SenLinkPeer>(`/api/sen-link/peers/${encodeURIComponent(id)}`, p),
  removePeer: (id: string) => apiDelete<void>(`/api/sen-link/peers/${encodeURIComponent(id)}`),
  /** What this peer may read here, what that would expose right now, and the profiles to choose from. */
  knowledge: (id: string) => apiGet<SenLinkKnowledgeView>(`/api/sen-link/peers/${encodeURIComponent(id)}/knowledge`),
  /** Ask the peer what it knows. A 502 carries a sentence for the person (not shared / peer too old / too many questions). */
  recall: (id: string, query: string, opts: { limit?: number; profile?: string } = {}) =>
    apiPost<SenLinkRecall>(`/api/sen-link/peers/${encodeURIComponent(id)}/recall`, { query, ...opts }),
  send: (id: string, text: string, opts: { taskId?: string; worktree?: boolean } = {}) =>
    apiPost<{ task: A2ATask }>(`/api/sen-link/peers/${encodeURIComponent(id)}/messages`, { text, ...opts }),
  tasks: (id: string) => apiGet<{ tasks: A2ATask[] }>(`/api/sen-link/peers/${encodeURIComponent(id)}/tasks`),
  cancel: (id: string, taskId: string) =>
    apiPost<A2ATask>(`/api/sen-link/peers/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/cancel`),
};

/** Short label for an A2A task state (`TASK_STATE_WORKING` → `working`). */
export const taskStateLabel = (state: string) => state.replace(/^TASK_STATE_/, '').toLowerCase().replace(/_/g, ' ');
