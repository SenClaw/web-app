// Wire shapes of the daemon's skill history and usage ledger
// (`GET /api/skills/:name/history`, `POST /api/skills/:name/rollback/:rev`,
// `GET /api/skill-usage/summary`; the `senclaw` repo's `docs/skill-history.md`).
//
// A revision is one change to a skill directory: an API write, a hub install,
// a rollback, a removal, or an edit found on disk. The ledger counts how often
// a skill was loaded into a chat and how the turn ended.

export type RevisionOrigin = 'MANUAL' | 'IMPORTED' | 'ROLLBACK' | 'REMOVED' | 'DETECTED' | 'BASELINE';

export type ScanVerdict = 'allow' | 'warn' | 'block';

export interface ScanFinding {
  rule: string;
  severity: string;
  title: string;
  file: string;
  line: number | null;
}

/** What the security scan said about a revision. Never carries the matched text. */
export interface ScanSummary {
  verdict: ScanVerdict;
  maxSeverity: string | null;
  riskScore: number;
  filesScanned: number;
  truncated: boolean;
  findings: ScanFinding[];
}

export interface SkillRevision {
  id: string;
  /** The skill's directory name, which history is keyed by. */
  skillKey: string;
  skillName: string;
  source: string;
  parentId: string | null;
  generation: number;
  origin: RevisionOrigin;
  actor: string;
  contentHash: string;
  fileCount: number;
  bytes: number;
  /** A size cap left something out: the revision cannot be restored. */
  truncated: boolean;
  /** False for a removal, and once the content is older than the newest 30. */
  hasSnapshot: boolean;
  restoredFrom: string | null;
  changeSummary: string;
  /** The lower-precedence source this skill replaces, when it does. */
  shadows: string | null;
  scan: ScanSummary | null;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Unified diff against the parent; only on a single-revision fetch. */
  diff?: string;
}

export interface SkillHistory {
  skill: string;
  source: string;
  key: string;
  revisions: SkillRevision[];
}

export interface UsageCounts {
  loads: number;
  completed: number;
  errored: number;
  interrupted: number;
  unfinished: number;
  withToolFailures: number;
  loopStopped: number;
  /** Of the loads whose turn ended, the share that errored or was interrupted. Null until one has ended. */
  fallbackRate: number | null;
  toolFailureRate: number | null;
}

export interface UsageVersion extends UsageCounts {
  contentHash: string | null;
  revision: { id: string; origin: RevisionOrigin; generation: number } | null;
  byTool: number;
  forced: number;
  firstAt: number;
  lastAt: number;
}

export interface SkillUsage extends UsageCounts {
  source: string;
  key: string;
  name: string;
  versions: UsageVersion[];
}

export interface UsageSummary {
  days: number;
  totals: UsageCounts;
  skills: SkillUsage[];
}

/** A non-2xx answer; `message` is the daemon's `{error}` text when it sent one. */
async function check(r: Response): Promise<Response> {
  if (r.ok) return r;
  const text = await r.text().catch(() => '');
  let message = text;
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === 'string') message = parsed.error;
  } catch {
    /* not JSON: keep the text */
  }
  throw new Error(message || `HTTP ${r.status}`);
}

const enc = encodeURIComponent;

function withSource(path: string, source?: string): string {
  return source ? `${path}?source=${enc(source)}` : path;
}

export async function fetchSkillHistory(name: string, source?: string): Promise<SkillHistory> {
  const r = await check(await fetch(withSource(`/api/skills/${enc(name)}/history`, source)));
  return (await r.json()) as SkillHistory;
}

export async function fetchSkillRevision(name: string, id: string, source?: string): Promise<SkillRevision> {
  const r = await check(await fetch(withSource(`/api/skills/${enc(name)}/history/${enc(id)}`, source)));
  return ((await r.json()) as { revision: SkillRevision }).revision;
}

/** Restore a managed skill to an earlier revision. Resolves with the new revision's id, if one was recorded. */
export async function rollbackSkill(name: string, id: string): Promise<string | null> {
  const r = await check(await fetch(`/api/skills/${enc(name)}/rollback/${enc(id)}`, { method: 'POST' }));
  return ((await r.json()) as { revision: string | null }).revision;
}

export async function fetchSkillUsage(days = 30): Promise<UsageSummary> {
  const r = await check(await fetch(`/api/skill-usage/summary?days=${days}`));
  return (await r.json()) as UsageSummary;
}

/** The scan result a save, create or install answered with, when it has one. */
export function scanFrom(body: unknown): ScanSummary | null {
  if (typeof body !== 'object' || body === null) return null;
  const scan = (body as { scan?: unknown }).scan;
  return typeof scan === 'object' && scan !== null ? (scan as ScanSummary) : null;
}
