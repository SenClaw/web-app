// Wire shapes of the daemon's browser engine (`/api/browser-agent/*`, the
// `senclaw` repo's `src/browser_agent/rest.rs`). The engine itself runs in the
// daemon (the decision loop) and in the `sen-browser` runtime (Chrome); this
// is what Settings → Browser reads and changes.

import { apiDelete, apiGet, apiPost, apiPut } from './runtimeApi';

export type BrowserEngine = 'auto' | 'v2' | 'legacy';
export type BrowserDriver = 'managed' | 'extension';
export type DecisionBackend = 'auto' | 'local' | 'hosted' | 'llm-only';

export interface ConfidenceBands {
  /** Act on the decision model's answer at or above this joint confidence. */
  act: number;
  /** Between this and `act` the LLM chooses; below it the step waits for the person. */
  fallback: number;
}

/** `config.json` → `browserAgent`, with every default filled in by the daemon. */
export interface BrowserSettings {
  engine: BrowserEngine;
  defaultDriver: BrowserDriver;
  decisionBackend: DecisionBackend;
  localModel: string;
  hostedModel: string | null;
  hostedDomains: string[];
  sensitiveDomains: string[];
  domainDrivers: Record<string, BrowserDriver>;
  /** LLM config id; null = the active chat model. */
  textModel: string | null;
  fallbackModel: string | null;
  bandsLocal: ConfidenceBands;
  bandsHosted: ConfidenceBands;
  maxSteps: number;
  headless: boolean;
  profile: string;
  startUrl: string;
}

export interface BrowserSettingsView {
  settings: BrowserSettings;
  /** What `engine: auto` resolves to right now. */
  engine: 'v2' | 'legacy';
  runtimeInstalled: boolean;
}

export interface ExtensionStatus {
  connected: { ext_id: string; version?: string; chrome?: string; piped: boolean } | null;
  pending: { code: string; ext_id: string; age_secs: number }[];
  paired: { ext_id: string; paired_at: string }[];
}

export interface BrowserTab {
  id: string;
  owner: string | null;
  driver: BrowserDriver;
  url: string | null;
  hold: 'none' | 'handover' | 'user_active' | 'detached';
  closed: boolean;
}

/** An action a browser task paused on, waiting for the person. */
export interface PendingApproval {
  approval_id: string;
  task_id: string;
  /** The chat whose agent started the task. */
  chat: string;
  goal: string;
  /** The control's label, as the page shows it. */
  action: string;
  /** `CLICK`, `KEY_ENTER`, `DIALOG_ACCEPT`, `TYPE_TEXT`, … */
  operation: string;
  text: string | null;
  driver: BrowserDriver;
  url: string | null;
  waiting_secs: number | null;
}

/** What a task did once answered: it went on until it paused or ended again. */
export interface TaskOutcome {
  task_id: string;
  /** `done`, `unverified`, `blocked`, `needs_approval`, `needs_user`, `needs_input`, `budget`, `cancelled`, `error`. */
  status: string;
  message: string;
}

export interface BrowserSession {
  id: string;
  driver: BrowserDriver;
  profile: string | null;
  headless: boolean | null;
  tabs: BrowserTab[];
}

export const browserAgentApi = {
  settings: () => apiGet<BrowserSettingsView>('/api/browser-agent/settings'),
  /** A partial update: only the fields sent change. A refusal is a 422 whose message is meant for a person. */
  saveSettings: (patch: Partial<BrowserSettings>) => apiPut<BrowserSettingsView>('/api/browser-agent/settings', patch),
  extension: () => apiGet<ExtensionStatus>('/api/browser-agent/extension'),
  approvePairing: (code: string) =>
    apiPost<{ paired: string }>(`/api/browser-agent/extension/pairings/${encodeURIComponent(code)}/approve`),
  removePaired: (extId: string) =>
    apiDelete<{ revoked: boolean }>(`/api/browser-agent/extension/paired/${encodeURIComponent(extId)}`),
  /** Starts the browser runtime if it is not running: call on request, never on a timer. */
  tabs: () => apiGet<{ sessions: BrowserSession[] | null }>('/api/browser-agent/tabs'),
  /** Reads the daemon's memory only; safe to poll. */
  approvals: () => apiGet<{ approvals: PendingApproval[] }>('/api/browser-agent/approvals'),
  /** The task continues inside this call, so it can take minutes. 404: already answered elsewhere. */
  answerApproval: (id: string, approve: boolean) =>
    apiPost<TaskOutcome>(`/api/browser-agent/approvals/${encodeURIComponent(id)}`, { approve }),
};

/** The fields of `next` that differ from `saved` — what a Save sends. */
export function changedFields(saved: BrowserSettings, next: BrowserSettings): Partial<BrowserSettings> {
  const patch: Partial<BrowserSettings> = {};
  for (const key of Object.keys(next) as (keyof BrowserSettings)[]) {
    if (JSON.stringify(next[key]) !== JSON.stringify(saved[key])) {
      (patch as Record<string, unknown>)[key] = next[key];
    }
  }
  return patch;
}
