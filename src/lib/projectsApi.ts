// Wire shapes of the daemon's projects (`/api/projects*`, the `senclaw` repo's
// `src/gateway/ui_server/projects.rs`).
//
// A project is a folder (its root) that chats and kanban boards can be created
// in. It has a context text the agent reads on every turn, facts of its own,
// and keeps reading the agent's common facts unless told not to.
//
// The daemon pushes no event when a project changes, so a screen refreshes
// after what it did itself and when the window gets focus back (`useProjects`).

export type FactsWrite = 'project' | 'chat' | 'off';

export interface Project {
  /** `prj_` + 8 hex digits; also names the fact bank `project:<id>`. */
  id: string;
  name: string;
  /** Absolute, canonical, unique across projects. */
  root: string;
  description: string;
  factsWrite: FactsWrite;
  inheritCommon: boolean;
  createdAt: number;
  updatedAt: number;
  /** Set on an archived project: hidden, takes no new chat or board. */
  archivedAt: number | null;
  chatCount: number;
  /** The folder can be renamed or deleted after the project was saved. */
  rootExists: boolean;
  hasClaudeMd: boolean;
  isGit: boolean;
}

export interface RootReason {
  code: string;
  message: string;
}

export interface RootCheck {
  ok: boolean;
  canonical: string | null;
  reasons: RootReason[];
  hasClaudeMd: boolean;
  isGit: boolean;
  /** The project that already has this root. */
  inUseBy: { id: string; name: string } | null;
}

export interface ProjectContext {
  content: string;
  /** Epoch milliseconds of the stored copy; 0 while there is no file. */
  updatedAt: number;
  chars: number;
  maxChars: number;
}

export interface ProjectChat {
  jid: string;
  name: string;
  folder: string;
  groupType: string;
  lastActive: string | null;
  addedAt: string;
}

/** A kanban board as `GET /api/kanban/boards` shows it. */
export interface ProjectBoard {
  id: number;
  title: string;
  description: string;
  workspace_dir: string | null;
  project_id: string | null;
  /** Where its workers run: its own folder inside the root, else the root. */
  effective_workspace_dir: string | null;
  column_count: number;
  card_count: number;
}

export type ProjectFactKind = 'world' | 'experience';

export interface ProjectFact {
  id: string;
  kind: ProjectFactKind;
  text: string;
  occurredStart: number | null;
  occurredEnd: number | null;
  mentionedAt: number;
  entities: string[];
  proofCount: number;
  supersededBy: string | null;
  origin: string;
  /** `manual` for a fact a person typed; otherwise what extracted it. */
  source: string;
}

export interface ProjectFactList {
  bank: string;
  total: number;
  count: number;
  facts: ProjectFact[];
}

export interface PurgeResult {
  deleted: string;
  deletedFacts: number;
  detachedChats: string[];
}

export interface NewProject {
  name: string;
  root: string;
  description?: string;
  factsWrite?: FactsWrite;
  inheritCommon?: boolean;
}

export type ProjectPatch = Partial<{
  name: string;
  root: string;
  description: string;
  factsWrite: FactsWrite;
  inheritCommon: boolean;
  archived: boolean;
}>;

export const CONTEXT_MAX_CHARS = 8000;
export const CONTEXT_WARN_CHARS = 5000;
/** Facts are 8–600 characters (the extractor's own limits). */
export const FACT_MIN_CHARS = 8;
export const FACT_MAX_CHARS = 600;

/**
 * Removing a project deletes its fact bank a slice at a time, and the daemon
 * answers only when the bank is gone: 20,000 facts took about 23 s. Give the
 * call far longer than that rather than abandon a delete half-way.
 */
export const PURGE_TIMEOUT_MS = 10 * 60 * 1000;

/** The kinds of chat that can be created in a project. */
export function kindCanJoinProject(kind: string): boolean {
  return kind === 'chat' || kind === 'code';
}

/** A non-2xx answer: the daemon's `error` code plus the rest of its body. */
export class ProjectApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    const code = typeof body.error === 'string' ? body.error : `http_${status}`;
    const detail = typeof body.message === 'string' ? body.message : code;
    super(detail);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/** `PUT .../context` with a copy older than the stored one: 409 and the stored text. */
export class ContextChangedError extends ProjectApiError {
  readonly current: ProjectContext;
  constructor(status: number, body: Record<string, unknown>) {
    super(status, body);
    this.current = {
      content: typeof body.content === 'string' ? body.content : '',
      updatedAt: typeof body.updatedAt === 'number' ? body.updatedAt : 0,
      chars: typeof body.chars === 'number' ? body.chars : 0,
      maxChars: typeof body.maxChars === 'number' ? body.maxChars : CONTEXT_MAX_CHARS,
    };
  }
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs?: number,
): Promise<T> {
  const ctl = timeoutMs ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const r = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl?.signal,
    });
    const text = await r.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      parsed = { error: text.trim().slice(0, 200) || `http_${r.status}` };
    }
    if (!r.ok) {
      if (r.status === 409 && parsed.error === 'context_changed') {
        throw new ContextChangedError(r.status, parsed);
      }
      throw new ProjectApiError(r.status, parsed);
    }
    return parsed as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const enc = encodeURIComponent;

export async function listProjects(archived: 'false' | 'true' | 'all' = 'false'): Promise<Project[]> {
  const r = await call<{ projects: Project[] }>('GET', `/api/projects?archived=${archived}`);
  return r.projects;
}

export const getProject = (id: string) => call<Project>('GET', `/api/projects/${enc(id)}`);

export const createProject = (p: NewProject) => call<Project>('POST', '/api/projects', p);

export const updateProject = (id: string, patch: ProjectPatch) =>
  call<Project>('PATCH', `/api/projects/${enc(id)}`, patch);

/** `DELETE` without `purge` archives. */
export const archiveProject = (id: string) => call<Project>('DELETE', `/api/projects/${enc(id)}`);

export const restoreProject = (id: string) => updateProject(id, { archived: false });

/** Remove the project for good: its facts, its context, the link of every chat and board. */
export const purgeProject = (id: string) =>
  call<PurgeResult>('DELETE', `/api/projects/${enc(id)}?purge=true`, undefined, PURGE_TIMEOUT_MS);

/** Run the checks a create runs, without creating anything. */
export const validateRoot = (path: string, projectId?: string) =>
  call<RootCheck>('POST', '/api/projects/validate-root', projectId ? { path, projectId } : { path });

export const getContext = (id: string) => call<ProjectContext>('GET', `/api/projects/${enc(id)}/context`);

/** `updatedAt` is the one of the copy being edited; a stale one is a `ContextChangedError`. */
export const putContext = (id: string, content: string, updatedAt: number) =>
  call<ProjectContext>('PUT', `/api/projects/${enc(id)}/context`, { content, updatedAt });

export async function listProjectChats(id: string): Promise<ProjectChat[]> {
  return (await call<{ chats: ProjectChat[] }>('GET', `/api/projects/${enc(id)}/chats`)).chats;
}

export async function listProjectBoards(id: string): Promise<ProjectBoard[]> {
  return (await call<{ boards: ProjectBoard[] }>('GET', `/api/projects/${enc(id)}/boards`)).boards;
}

export function listProjectFacts(
  id: string,
  opts: { q?: string; history?: boolean; limit?: number } = {},
): Promise<ProjectFactList> {
  const p = new URLSearchParams({ limit: String(opts.limit ?? 100) });
  if (opts.q?.trim()) p.set('q', opts.q.trim());
  if (opts.history) p.set('history', 'true');
  return call<ProjectFactList>('GET', `/api/projects/${enc(id)}/facts?${p.toString()}`);
}

export async function addProjectFact(
  id: string,
  fact: { text: string; kind?: ProjectFactKind; when?: string },
): Promise<{ fact: ProjectFact; existing: boolean }> {
  return call('POST', `/api/projects/${enc(id)}/facts`, fact);
}

export async function forgetProjectFact(id: string, factId: string): Promise<void> {
  await call('DELETE', `/api/projects/${enc(id)}/facts/${enc(factId)}`);
}

// ----- Pure helpers -----

const BANK_PREFIX = 'project:';

/** The project a fact bank belongs to (`project:prj_1a2b3c4d`), else `null`. */
export function projectIdOfBank(bank: string): string | null {
  return bank.startsWith(BANK_PREFIX) ? bank.slice(BANK_PREFIX.length) : null;
}

/**
 * Characters the way the daemon counts a context: its trimmed text, by Unicode
 * code point — not UTF-16 units, which would count an emoji twice.
 */
export function contextChars(text: string): number {
  let n = 0;
  for (const _ of text.trim()) n++;
  return n;
}

export type ContextLevel = 'ok' | 'warn' | 'over';

export function contextLevel(chars: number): ContextLevel {
  if (chars > CONTEXT_MAX_CHARS) return 'over';
  if (chars >= CONTEXT_WARN_CHARS) return 'warn';
  return 'ok';
}

/** Last path segment, for a short label next to the full root. */
export function rootLabel(root: string): string {
  return root.split('/').filter(Boolean).pop() || root;
}
