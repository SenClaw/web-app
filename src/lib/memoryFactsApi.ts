// Wire shapes of the daemon's fact store (`/api/memory/facts*`, the `senclaw`
// repo's `src/gateway/ui_server/memory_facts.rs`; guide `docs/memory-engine.md`).
//
// A fact is a one-or-two sentence statement the agent extracted from a
// conversation, with the date it happened (when it has one) and the entities
// it mentions. Facts belong to a *bank*, which is an agent folder.

export type FactKind = 'world' | 'experience';

export interface MemoryFact {
  id: string;
  kind: FactKind;
  text: string;
  /** Calendar span the fact is about, epoch seconds at UTC midnight; `end` is exclusive. */
  occurredStart: number | null;
  occurredEnd: number | null;
  /** When the fact was last said, epoch seconds. */
  mentionedAt: number;
  entities: string[];
  /** How many times it was said again; 1 = once. */
  proofCount: number;
  /** Set on a fact that was replaced because the person changed their mind. */
  supersededBy: string | null;
  /**
   * The chat it was said in. Only that chat recalls it; empty means the whole
   * agent (a fact from before chats were told apart).
   */
  origin: string;
}

export interface FactBank {
  bank: string;
  current: number;
  replaced: number;
  lastMentionedAt: number;
}

/** The daemon answers 503 until the fact store has started (early boot). */
export class FactStoreNotStarted extends Error {
  constructor() {
    super('fact store not started');
  }
}

async function check(r: Response): Promise<Response> {
  if (r.status === 503) throw new FactStoreNotStarted();
  if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
  return r;
}

export async function listFactBanks(): Promise<FactBank[]> {
  const r = await check(await fetch('/api/memory/facts/banks'));
  return ((await r.json()) as { banks: FactBank[] }).banks;
}

export async function listFacts(opts: {
  bank: string;
  q?: string;
  history?: boolean;
  limit?: number;
}): Promise<MemoryFact[]> {
  const p = new URLSearchParams({ bank: opts.bank, limit: String(opts.limit ?? 100) });
  if (opts.q?.trim()) p.set('q', opts.q.trim());
  if (opts.history) p.set('history', 'true');
  const r = await check(await fetch(`/api/memory/facts?${p.toString()}`));
  return ((await r.json()) as { facts: MemoryFact[] }).facts;
}

export async function forgetFact(bank: string, id: string): Promise<void> {
  const p = new URLSearchParams({ bank });
  await check(await fetch(`/api/memory/facts/${encodeURIComponent(id)}?${p.toString()}`, { method: 'DELETE' }));
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/**
 * The precision a stored span was said at: `2026`, `2026-03` or `2026-03-09`.
 * Mirrors `extract::span_label` in the daemon, so a fact reads the same here
 * as in the agent's own tool output. Spans are UTC midnights, so read them in
 * UTC — local time would show 2026-03-08 in a timezone west of Greenwich.
 */
export function spanLabel(start: number, end: number | null): string {
  const s = new Date(start * 1000);
  const e = end == null ? null : new Date(end * 1000);
  const sameDay = (a: Date, y: number, m: number, d: number) =>
    a.getUTCFullYear() === y && a.getUTCMonth() === m && a.getUTCDate() === d;
  const wholeYear =
    s.getUTCMonth() === 0 && s.getUTCDate() === 1 && e != null && sameDay(e, s.getUTCFullYear() + 1, 0, 1);
  const nextMonthYear = s.getUTCMonth() === 11 ? s.getUTCFullYear() + 1 : s.getUTCFullYear();
  const nextMonth = (s.getUTCMonth() + 1) % 12;
  const wholeMonth = s.getUTCDate() === 1 && e != null && sameDay(e, nextMonthYear, nextMonth, 1);
  if (wholeYear) return String(s.getUTCFullYear());
  if (wholeMonth) return `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}`;
  return isoDay(s);
}

/** `occurred` span when the fact has one, otherwise the day it was said. */
export function factWhen(f: MemoryFact): { label: string; dated: boolean } {
  if (f.occurredStart != null) {
    return { label: spanLabel(f.occurredStart, f.occurredEnd ?? f.occurredStart + 86400), dated: true };
  }
  return { label: new Date(f.mentionedAt * 1000).toLocaleDateString(), dated: false };
}
