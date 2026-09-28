// Types and HTTP helpers for Settings → Runtime and Settings → Local models.
//
// Shapes mirror `docs/runtime-protocol.md` §5 in the senclaw repo: every
// inference engine (MLX, llama.cpp, Laya, OCR, Whisper, TTS) runs as a
// separate runtime the daemon installs and supervises, the way LM Studio runs
// its engines. This module is the one place that speaks the wire shape so the
// Runtime screen, the Local models screen, and the runtime-missing banners
// elsewhere in Settings do not each re-guess it.

export type SlotId = 'gguf' | 'mlx' | 'gturbo' | 'decision' | 'ocr' | 'asr' | 'tts' | 'browser';
export type SlotKind = 'format' | 'capability';
export type RuntimeType = 'llm-engine' | 'decision' | 'ocr' | 'asr' | 'tts' | 'browser';
export type RuntimeMode = 'service' | 'model';
export type RuntimeSource = 'index' | 'local' | 'bundled';
export type ProcessState = 'starting' | 'ready' | 'stopping' | 'failed';
export type UpdateChannel = 'stable' | 'beta';

export interface SlotCandidate {
  id: string;
  version: string;
  name: string;
}

export interface RuntimeSlot {
  slot: SlotId;
  label: string;
  kind: SlotKind;
  selected: SlotCandidate | null;
  candidates: SlotCandidate[];
}

export interface RuntimeSettings {
  autoUpdate: boolean;
  channel: UpdateChannel;
  idleTimeoutSecs: { service: number; model: number };
}

export interface InstalledRuntime {
  id: string;
  name: string;
  version: string;
  versions: string[];
  type: RuntimeType;
  slots: SlotId[];
  formats: string[];
  capabilities: string[];
  platforms: string[];
  accelerator?: string | null;
  mode: RuntimeMode;
  compatible: boolean;
  source: RuntimeSource;
  description?: string;
  releaseNotesUrl?: string | null;
  warnings: string[];
}

export interface RuntimeProcess {
  key: string;
  runtimeId: string;
  version: string;
  /** Null on a runtime whose response predates the unified process shape (§5.1) — e.g. today's `slots/:slot/start`. */
  slot: SlotId | null;
  modelKey?: string | null;
  pid: number;
  port: number;
  state: ProcessState;
  startedAt: number;
  lastUsedAt: number;
  launches: number;
  error?: string | null;
}

export interface RuntimesView {
  platform: string;
  settings: RuntimeSettings;
  slots: RuntimeSlot[];
  installed: InstalledRuntime[];
  processes: RuntimeProcess[];
}

export interface CatalogEntry {
  id: string;
  name: string;
  description?: string;
  type: RuntimeType;
  slots: SlotId[];
  formats: string[];
  capabilities: string[];
  accelerator?: string | null;
  platforms: string[];
  compatible: boolean;
  /** `false` = listed but no package published for this platform/channel yet. */
  available: boolean;
  /** Null when no release exists yet for the current channel. */
  latestVersion: string | null;
  installedVersion: string | null;
  updateAvailable: boolean;
  releaseNotesUrl?: string | null;
  downloadSize?: number | null;
}

export interface RuntimeCatalog {
  channel: UpdateChannel;
  fetchedAt: number;
  source: string;
  error: string | null;
  entries: CatalogEntry[];
}

export interface CheckUpdatesResult {
  checkedAt: number;
  channel: UpdateChannel;
  updates: { id: string; from: string; to: string }[];
  started: { jobId: string; id: string; version: string }[];
  error: string | null;
}

export type InstallJobState =
  | 'queued'
  | 'downloading'
  | 'verifying'
  | 'extracting'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface InstallJob {
  jobId: string;
  id: string;
  version: string;
  state: InstallJobState;
  receivedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

// ---- Local models (§5.3) ----

export type LocalModelFormat = 'gguf' | 'mlx' | 'gturbo';

export interface LocalModelRuntimeRef {
  slot: SlotId;
  selected: SlotCandidate | null;
}

export interface LocalModel {
  key: string;
  name: string;
  format: LocalModelFormat;
  path: string;
  sizeBytes: number;
  capabilities: string[];
  vision: boolean;
  embedding: boolean;
  mmprojPath?: string | null;
  quant?: string | null;
  repo?: string | null;
  contextLength?: number | null;
  runtime: LocalModelRuntimeRef;
  process: RuntimeProcess | null;
}

export interface LocalDownload {
  downloadId: string;
  repo: string;
  files: string[];
  format: LocalModelFormat | 'unknown';
  /** Pinned by §5.3: `queued`, `listing` and `downloading` are the active states. */
  state: 'queued' | 'listing' | 'downloading' | 'done' | 'failed' | 'cancelled' | (string & {});
  receivedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

export interface LocalModelsView {
  root: string;
  models: LocalModel[];
  downloads: LocalDownload[];
}

export interface HfFile {
  name: string;
  size: number;
  quant: string | null;
  mmproj: boolean;
}

export interface HfFilesResponse {
  repo: string;
  format: LocalModelFormat | 'unknown';
  files: HfFile[];
}

/**
 * The shared `<local-models>/settings.json` shape — snake_case, written by
 * `local-model-core` and read by every engine runtime. Kept as an open
 * dictionary (not a fixed interface) because it must round-trip untouched:
 * a UI that only knows a subset of fields must never drop the rest on save.
 */
export type LocalModelEngineSettings = Record<string, unknown>;

export interface LocalModelsSettings {
  defaultContextLength: number | null;
  engine: LocalModelEngineSettings;
}

// ---- HTTP plumbing ----

/**
 * Thrown by every call below on a non-2xx response. Carries the daemon's
 * `code`/`slot` fields (when present) so callers can special-case the
 * runtime-missing 503 shape (§5.2) without re-parsing the body themselves.
 */
export class ApiError extends Error {
  status: number;
  code?: string;
  slot?: string;

  constructor(message: string, status: number, code?: string, slot?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.slot = slot;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON (a proxy error page, an axum extractor rejection) — use the raw text.
  }
  if (!res.ok) {
    throw new ApiError(body?.error ?? (text || `HTTP ${res.status}`), res.status, body?.code, body?.slot);
  }
  return body as T;
}

function send<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const apiGet = <T>(path: string) => request<T>(path);
export const apiPost = <T>(path: string, body?: unknown) => send<T>('POST', path, body);
export const apiPut = <T>(path: string, body?: unknown) => send<T>('PUT', path, body);
export const apiDelete = <T>(path: string) => send<T>('DELETE', path);

// ---- Runtime-missing detection (§5.2) ----

export type RuntimeMissingCode = 'runtime_not_installed' | 'runtime_not_selected' | 'runtime_start_failed';

const RUNTIME_MISSING_CODES = new Set<string>([
  'runtime_not_installed',
  'runtime_not_selected',
  'runtime_start_failed',
]);

export interface RuntimeMissingInfo {
  message: string;
  code: RuntimeMissingCode;
  slot?: string;
}

export function isRuntimeMissingCode(code: unknown): code is RuntimeMissingCode {
  return typeof code === 'string' && RUNTIME_MISSING_CODES.has(code);
}

/** Read a `RuntimeMissingInfo` off an `ApiError` thrown by `request`/`apiGet` and friends, or null when the failure is unrelated to a missing runtime. */
export function runtimeMissingFromError(e: unknown): RuntimeMissingInfo | null {
  if (e instanceof ApiError && e.status === 503 && isRuntimeMissingCode(e.code)) {
    return { message: e.message, code: e.code, slot: e.slot };
  }
  return null;
}

/**
 * Same detection for a raw `fetch` Response, for the settings screens that
 * predate this module and fetch directly (Ocr/Tts/Whisper settings issue a
 * `Promise.all` of plain `fetch()` calls). Clones the response so its body is
 * still readable by the caller afterwards.
 */
export async function parseRuntimeMissing(res: Response): Promise<RuntimeMissingInfo | null> {
  if (res.status !== 503) return null;
  try {
    const body = await res.clone().json();
    if (body && isRuntimeMissingCode(body.code)) {
      return { message: String(body.error ?? ''), code: body.code, slot: body.slot };
    }
  } catch {
    // Not JSON — not the runtime-missing shape.
  }
  return null;
}

export function fmtBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(1)} ${units[i]}`;
}

// ---- Runtime management (§5.1) ----

export const runtimeApi = {
  get: () => apiGet<RuntimesView>('/api/runtimes'),
  catalog: (refresh = false) => apiGet<RuntimeCatalog>(`/api/runtimes/catalog${refresh ? '?refresh=1' : ''}`),
  /** Refreshes the index and, with autoUpdate on, starts installs for selected slots' updates. */
  checkUpdates: () => apiPost<CheckUpdatesResult>('/api/runtimes/check-updates'),
  install: (id: string, version?: string) =>
    apiPost<{ jobId: string; id: string; version: string }>('/api/runtimes/install', { id, version }),
  installLocal: (path: string) => apiPost<InstalledRuntime>('/api/runtimes/install-local', { path }),
  jobs: () => apiGet<{ jobs: InstallJob[] }>('/api/runtimes/jobs'),
  job: (jobId: string) => apiGet<InstallJob>(`/api/runtimes/jobs/${encodeURIComponent(jobId)}`),
  cancelJob: (jobId: string) =>
    apiPost<{ ok: boolean; cancelled: boolean }>(`/api/runtimes/jobs/${encodeURIComponent(jobId)}/cancel`),
  uninstall: (id: string, version: string, force = false) =>
    apiDelete<{ ok?: boolean }>(
      `/api/runtimes/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}${force ? '?force=1' : ''}`
    ),
  select: (slot: SlotId, id: string | null, version: string | null) =>
    apiPut<RuntimesView>('/api/runtimes/selections', { slot, id, version }),
  getSettings: () => apiGet<RuntimeSettings>('/api/runtimes/settings'),
  /** Partial merge (§5.1) — send only the fields that changed; the daemon answers the full settings object. */
  putSettings: (patch: Partial<RuntimeSettings>) => apiPut<RuntimeSettings>('/api/runtimes/settings', patch),
  startSlot: (slot: SlotId) => apiPost<RuntimeProcess>(`/api/runtimes/slots/${encodeURIComponent(slot)}/start`),
  stopProcess: (key: string) => apiPost<{ ok?: boolean }>(`/api/runtimes/processes/${encodeURIComponent(key)}/stop`),
  logs: (id: string, lines = 200) =>
    apiGet<{ path: string; lines: string[] }>(`/api/runtimes/${encodeURIComponent(id)}/logs?lines=${lines}`),
};

// ---- Local models (§5.3) ----

export const localModelsApi = {
  list: () => apiGet<LocalModelsView>('/api/local-models'),
  hfFiles: (repo: string, revision?: string) =>
    apiGet<HfFilesResponse>(
      `/api/local-models/hf-files?repo=${encodeURIComponent(repo)}${revision ? `&revision=${encodeURIComponent(revision)}` : ''}`
    ),
  download: (body: { repo: string; file?: string; mmproj?: string; revision?: string }) =>
    apiPost<{ downloadId: string }>('/api/local-models/download', body),
  downloads: () => apiGet<{ downloads: LocalDownload[] }>('/api/local-models/downloads'),
  downloadStatus: (id: string) => apiGet<LocalDownload>(`/api/local-models/downloads/${encodeURIComponent(id)}`),
  cancelDownload: (id: string) =>
    apiPost<{ ok: boolean; cancelled: boolean }>(`/api/local-models/downloads/${encodeURIComponent(id)}/cancel`),
  remove: (key: string, force = false) =>
    apiDelete<{ ok?: boolean }>(`/api/local-models/${encodeURIComponent(key)}${force ? '?force=1' : ''}`),
  /** The body is optional per §5.3 but always sent here — omitting it entirely gets axum's `Json<T>` extractor a
   *  bodyless/no-Content-Type request, which today's daemon (bug being fixed in parallel) answers 415 for. */
  load: (key: string, contextLength?: number) =>
    apiPost<RuntimeProcess>(
      `/api/local-models/${encodeURIComponent(key)}/load`,
      contextLength ? { contextLength } : {}
    ),
  unload: (key: string) => apiPost<{ ok?: boolean }>(`/api/local-models/${encodeURIComponent(key)}/unload`),
  getSettings: () => apiGet<LocalModelsSettings>('/api/local-models/settings'),
  /** Partial merge (§5.3) — send only the fields that changed; unnamed ones are kept. */
  putSettings: (patch: Partial<LocalModelsSettings>) => apiPut<LocalModelsSettings>('/api/local-models/settings', patch),
};
