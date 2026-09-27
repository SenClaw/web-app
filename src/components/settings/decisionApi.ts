// Types and HTTP helpers for Settings → Decision (Laya). Shapes mirror
// `src/decision/*` and `src/gateway/ui_server/decision.rs`.

import { ApiError } from '../../lib/runtimeApi';
export { ApiError };

export type JobStatus =
  | 'queued'
  | 'listing'
  | 'downloading'
  | 'verifying'
  | 'copying'
  | 'done'
  | 'error'
  | 'cancelled';

export interface JobState {
  kind: 'download' | 'import';
  status: JobStatus;
  total_bytes: number;
  done_bytes: number;
  current_file: string | null;
  files_total: number;
  files_done: number;
  error: string | null;
  started_at: number;
}

export type Kind = 'english' | 'multilingual';

export interface LoadedInfo {
  kind: Kind;
  load_ms: number;
  loaded_at: number;
  batch: 'dynamic' | 'fixed-1';
  act_output: string;
  max_len: number;
  head_max_len: number;
  threads: number;
  asks: number;
  idle_secs: number;
  /** A request loaded it (hot-load), not a person. */
  on_demand: boolean;
}

export interface ModelRow {
  id: string;
  label: string;
  description: string;
  kind: Kind | null;
  catalog: boolean;
  source: { type?: string; repo?: string; revision?: string; path?: string } | null;
  approx_size_mb: number | null;
  size_bytes: number;
  installed: boolean;
  path: string;
  job: JobState | null;
  loading: boolean;
  loaded: LoadedInfo | null;
}

export type Backend = 'local' | 'online';
export type Provider = 'typesafe' | 'cloudflare' | 'custom';

export interface LocalSettings {
  defaultModel?: string | null;
  threads?: number | null;
  autoLoad: boolean;
  /** 0 = never. */
  idleUnloadMinutes: number;
}

export interface OnlineSettings {
  provider: Provider;
  url: string;
  /** Always empty from the daemon; see `hasApiKey`. */
  apiKey: string;
  hasApiKey?: boolean;
  model: string;
  accountId: string;
  timeoutSecs: number;
}

export interface RunSettings {
  backend: Backend;
  local: LocalSettings;
  online: OnlineSettings;
}

export interface SettingsView {
  compiled: boolean;
  settings: RunSettings;
  providers: Provider[];
  defaults: {
    threads: number;
    maxThreads: number;
    idleUnloadMinutes: number;
    typesafeUrl: string;
    typesafeModel: string;
    cloudflareModel: string;
  };
}

export interface ListResponse {
  compiled: boolean;
  root: string;
  models: ModelRow[];
  backend: Backend;
  local: LocalSettings;
}

export interface Action {
  act_probability: number;
}

export type Answer =
  | {
      type: 'choice';
      choice: string;
      probabilities: Record<string, number>;
      confidence?: number;
      answer_confidence?: number;
      action?: Action;
    }
  | {
      type: 'score';
      score: number;
      legend?: Record<string, unknown>;
      probabilities: Record<string, number>;
      confidence?: number;
      answer_confidence?: number;
      action?: Action;
    }
  | { type: 'noul'; noul: number; confidence?: number; action?: Action };

export interface AskResponse {
  model: string;
  /** `laya-onnx`, or `online:<provider>`. */
  engine: string;
  /** Local answers are `Answer`s; an online backend's are passed through as it sent them. */
  answers: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens: number };
  latency_ms: number;
  runs: number;
  routing: { model: string; reason: string };
}

/**
 * An answer as the cards can draw it, or `null` for a shape they do not know.
 * Online backends send their own fields, so the type is inferred when absent.
 */
export function asAnswer(raw: unknown): Answer | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, any>;
  const type = a.type ?? ('choice' in a ? 'choice' : 'score' in a ? 'score' : 'noul' in a ? 'noul' : null);
  if (type === 'choice' && typeof a.choice === 'string' && a.probabilities && typeof a.probabilities === 'object') {
    return { ...a, type } as Answer;
  }
  if (type === 'score' && typeof a.score === 'number' && a.probabilities && typeof a.probabilities === 'object') {
    return { ...a, type } as Answer;
  }
  if (type === 'noul' && typeof a.noul === 'number') return { ...a, type } as Answer;
  return null;
}

export const ACTIVE: JobStatus[] = ['queued', 'listing', 'downloading', 'verifying', 'copying'];
export const percent = new Intl.NumberFormat('vi-VN', { style: 'percent', maximumFractionDigits: 1 });
export const decimal = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

export function fmtBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${decimal.format(n / 1024 ** i)} ${units[i]}`;
}

/**
 * JSON body or a readable error: the daemon answers failures as
 * `{"error": "..."}`, thrown as the shared `ApiError` above (re-exported from
 * `lib/runtimeApi`) so `runtimeMissingFromError` recognizes a Decision 503 the
 * same way it does for OCR/TTS/Whisper — Laya now runs as the `sen-sysone`
 * runtime, so `/api/decision/*` model management can 503 with the same
 * runtime-missing shape while `/api/decision/gate` and `/skills` stay native
 * to the daemon.
 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON (a proxy error page, an axum extractor rejection) — use the text.
  }
  if (!res.ok) throw new ApiError(body?.error ?? (text || `HTTP ${res.status}`), res.status, body?.code, body?.slot);
  return body as T;
}

function send<T>(method: 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
  return api<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const post = <T>(path: string, body?: unknown) => send<T>('POST', path, body);
export const put = <T>(path: string, body?: unknown) => send<T>('PUT', path, body);

// ---- Tool-call gate (src/decision/gate) ----

export type GateMode = 'off' | 'shadow' | 'on';
export type GateQuestions = 'auto' | 'laya' | 'cookbook';
export type QuestionSet = 'laya' | 'cookbook';

export interface GateSettings {
  mode: GateMode;
  approveAt: number;
  questions: GateQuestions;
}

export interface GateStats {
  total: number;
  wouldAllow: number;
  applied: number;
  risky: number;
  errors: number;
  answered: number;
  allowAgreed: number;
  allowRefused: number;
  askApproved: number;
  askRefused: number;
}

export interface GateLogRow {
  id: number;
  at: number;
  chatJid: string;
  tool: string;
  command: string;
  mode: 'shadow' | 'on';
  outcome: 'allow' | 'ask';
  applied: boolean;
  stage: 'risky' | 'engine' | 'error';
  reason: string;
  p: number | null;
  choice: string | null;
  questions: string;
  model: string | null;
  engine: string | null;
  latencyMs: number | null;
  human: string | null;
  humanAt: number | null;
}

export interface GateView {
  gate: GateSettings;
  questionSet: QuestionSet;
  timeoutSecs: number;
  samples: string[];
  stats: GateStats | null;
  log: GateLogRow[];
}

export interface GateVerdict {
  command: string;
  outcome: 'allow' | 'ask';
  stage: 'risky' | 'engine' | 'error';
  reason: string;
  risky: { part: string; pattern: string; why: string } | null;
  questions: QuestionSet;
  checks: { name: string; p: number; how: string }[];
  choice: string | null;
  model: string | null;
  engine: string | null;
  latencyMs: number | null;
  state: unknown;
  asked: unknown;
  answers: unknown;
}

// ---- Pre-skill router (src/decision/skill_route) ----

export interface SkillRoute {
  name: string;
  force: boolean;
}

export interface ScoredSkill {
  name: string;
  score: number;
  phraseHit: boolean;
}

export interface RouteReport {
  legacy: SkillRoute | null;
  route: SkillRoute | null;
  reason: string;
  candidates: ScoredSkill[];
  enginePick: string | null;
  engineP: number | null;
  model: string | null;
  latencyMs: number | null;
  fallback: string | null;
}

export interface SkillRouteRow {
  id: number;
  at: number;
  chatJid: string;
  prompt: string;
  mode: 'shadow' | 'on';
  preTrigger: boolean;
  legacyName: string | null;
  legacyForce: boolean;
  routeName: string | null;
  routeForce: boolean;
  reason: string;
  enginePick: string | null;
  engineP: number | null;
  model: string | null;
  latencyMs: number | null;
  fallback: string | null;
  candidates: ScoredSkill[];
}

export interface SkillsView {
  skills: { mode: GateMode };
  preTriggerSkill: boolean;
  timeoutMs: number;
  candidates: number;
  stats: {
    total: number;
    same: number;
    legacyLoads: number;
    routeLoads: number;
    loadsWithheld: number;
    fallbacks: number;
  } | null;
  log: SkillRouteRow[];
}
