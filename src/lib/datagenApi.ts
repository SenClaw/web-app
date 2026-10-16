// Wire shapes of the daemon's dataset jobs (`/api/datagen/*`, the `senclaw`
// repo's `src/gateway/ui_server/datagen.rs`; guide `docs/datagen.md`): jobs,
// the datasets they wrote, and the catalog and preview behind importing a
// dataset people wrote.

export type PipelineName =
  | 'expand_seeds'
  | 'doc_qa'
  | 'reasoning_traces'
  | 'executable_qa'
  | 'export_logs'
  | 'import';

/** The record shape an imported dataset is normalised to. */
export type RecordKind = 'labeled_text' | 'qa_context' | 'problem_answer' | 'chat';

export const RECORD_KINDS: RecordKind[] = ['labeled_text', 'qa_context', 'problem_answer', 'chat'];

/** Each kind's fields, required first — the daemon's `mapping::Kind::fields`. */
export const KIND_FIELDS: Record<RecordKind, { field: string; required: boolean }[]> = {
  labeled_text: [{ field: 'text', required: true }, { field: 'label', required: false }],
  qa_context: [
    { field: 'question', required: true },
    { field: 'answer', required: true },
    { field: 'context', required: true },
  ],
  problem_answer: [{ field: 'problem', required: true }, { field: 'answer', required: false }],
  chat: [
    { field: 'user', required: true },
    { field: 'assistant', required: true },
    { field: 'system', required: false },
  ],
};

/** Where an imported dataset came from, kept in its manifest. */
export interface Provenance {
  kind?: RecordKind;
  license?: string;
  attribution?: string | null;
  flags?: { shareAlike?: boolean; nonCommercial?: boolean; researchOnly?: boolean; noTraining?: boolean };
  source?: {
    type: 'bundled' | 'hf' | 'url' | 'file';
    catalog?: string | null;
    dataset?: string;
    config?: string;
    split?: string;
    url?: string;
    name?: string;
    revision?: string | null;
  };
  mapping?: Record<string, unknown>;
  dataSha256?: string;
}

export interface JobStatus {
  jobId: string;
  name: string;
  pipeline: string;
  owner?: string | null;
  state: string;
  target: number;
  accepted: number;
  attempts: number;
  llmCalls: number;
  maxLlmCalls: number;
  rejected: Record<string, number>;
  model?: string | null;
  note?: string | null;
  error?: string | null;
  dir: string;
  startedAt: number;
  finishedAt?: number | null;
  provenance?: Provenance | null;
}

export interface CatalogEntry {
  id: string;
  title: string;
  description: string;
  kind: RecordKind;
  lang: string;
  rows: number;
  license: string;
  attribution: string;
  homepage?: string;
  source: { bundled?: string; url?: string; hf?: { dataset: string; config: string; split: string; revision: string } };
  labelMap?: string;
  flags: NonNullable<Provenance['flags']>;
  notice?: string;
  uses: string[];
  needsConsent: boolean;
  bundled: boolean;
  /** The Zen Kit that registered this entry; absent for SenClaw's own. */
  kit?: string | null;
  installed: boolean;
  /** The dataset an install wrote, when installed. */
  dataset?: string | null;
}

export type ImportSource =
  | { catalog: string }
  | { hf: { dataset: string; config?: string; split?: string } }
  | { url: string }
  | { file: { name: string; content: string } };

export interface PreviewResult {
  columns: string[];
  rows: Record<string, unknown>[];
  total?: number;
  format?: string;
  suggested?: { kind: RecordKind; mapping: Record<string, string> };
  /** Each preview row as the record it would become, or why it would be dropped. */
  records?: ({ record: Record<string, unknown> } | { rejected: string })[];
  mappingError?: string;
  splits?: { config: string; split: string }[];
  config?: string;
  split?: string;
  license?: string | null;
  partial?: boolean;
}

/** fetch + JSON, throwing the daemon's own `error` sentence on a non-2xx. */
export async function datagenApi<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    let reason = body;
    try {
      reason = (JSON.parse(body) as { error?: string }).error ?? body;
    } catch {
      // not JSON: keep the text
    }
    throw new Error(reason || `HTTP ${r.status}`);
  }
  return (await r.json()) as T;
}

/** Start a job; `body` is `{pipeline, ...params}`. */
export const startJob = (body: Record<string, unknown>) =>
  datagenApi<{ job: JobStatus }>('/api/datagen/jobs', { method: 'POST', body: JSON.stringify(body) });

export const fetchCatalog = () => datagenApi<{ entries: CatalogEntry[] }>('/api/datagen/catalog');

export const previewImport = (body: { source: ImportSource; kind?: RecordKind; mapping?: Record<string, string> }) =>
  datagenApi<PreviewResult>('/api/datagen/import/preview', { method: 'POST', body: JSON.stringify(body) });

/** Short "where it came from" text for a dataset row. */
export function sourceLabel(p?: Provenance | null): string | null {
  const s = p?.source;
  if (!s) return null;
  if (s.catalog) return s.catalog;
  if (s.type === 'hf') return [s.dataset, s.config, s.split].filter(Boolean).join(' · ');
  if (s.type === 'url') {
    try {
      return new URL(s.url ?? '').host;
    } catch {
      return s.url ?? 'url';
    }
  }
  return s.name ?? s.type;
}

/** Which pipelines a dataset can feed, from its kind or the pipeline that wrote it. */
export function feeds(d: JobStatus): { seeds: boolean; problems: boolean } {
  const kind = d.provenance?.kind;
  return {
    seeds: kind === 'labeled_text' || d.pipeline === 'expand_seeds',
    problems: kind === 'problem_answer' || d.pipeline === 'reasoning_traces' || d.pipeline === 'executable_qa',
  };
}
