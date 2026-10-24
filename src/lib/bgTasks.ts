import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Processes an agent left running (`npm run dev`, `python -m http.server`), as
 * the daemon's `/api/bg-tasks` reports them. Not the scheduled "Background
 * tasks" of `BackgroundPage`: those are agent runs on a timer, these are OS
 * processes with a pid, a port and a log.
 */
export interface BgTask {
  id: string;
  chatJid: string;
  /** The agent's own one-line description of the command. */
  description: string;
  command: string;
  cwd: string;
  status: 'running' | 'done' | 'failed' | 'stopped';
  /** `spawned` (run_in_background), `adopted` (left by a foreground command) or `restored` (found after a daemon restart). */
  origin: 'spawned' | 'adopted' | 'restored';
  /** `seatbelt` / `bubblewrap` / … when the command ran in the OS sandbox. */
  isolation: string;
  pid: number | null;
  pids: number[];
  ports: number[];
  startedAt: number;
  endedAt: number | null;
  uptimeSecs: number;
  exitCode: number | null;
  /** Only on the single-task endpoint. */
  output?: string;
}

/** How often the list is re-read. The daemon keeps it in memory, so a read is cheap. */
export const BG_POLL_MS = 3000;

/** The daemon predates `/api/bg-tasks`: there is nothing to poll for. */
export class BgTasksUnsupported extends Error {}

export async function fetchBgTasks(opts: { chatJid?: string; includeFinished?: boolean } = {}): Promise<BgTask[]> {
  const q = new URLSearchParams();
  if (opts.chatJid) q.set('chatJid', opts.chatJid);
  if (opts.includeFinished) q.set('includeFinished', 'true');
  const r = await fetch(`/api/bg-tasks${q.size ? `?${q}` : ''}`);
  if (r.status === 404) throw new BgTasksUnsupported();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body = await r.json();
  return Array.isArray(body?.tasks) ? body.tasks : [];
}

export async function fetchBgTaskOutput(id: string, tail = 8000): Promise<string> {
  const r = await fetch(`/api/bg-tasks/${encodeURIComponent(id)}?tail=${tail}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body = await r.json();
  return String(body?.task?.output ?? '');
}

/** The daemon answers a refusal with `{error}`; showing it beats "request failed". */
async function mutate(url: string, method: string): Promise<void> {
  const r = await fetch(url, { method });
  if (r.ok) return;
  const text = await r.text().catch(() => '');
  let reason = text;
  try {
    reason = JSON.parse(text)?.error ?? text;
  } catch {
    // not JSON: use the text as is
  }
  throw new Error(reason || `HTTP ${r.status}`);
}

export const stopBgTask = (id: string) => mutate(`/api/bg-tasks/${encodeURIComponent(id)}/stop`, 'POST');
export const dismissBgTask = (id: string) => mutate(`/api/bg-tasks/${encodeURIComponent(id)}`, 'DELETE');
export const clearFinishedBgTasks = (chatJid?: string) =>
  mutate(`/api/bg-tasks/clear-finished${chatJid ? `?chatJid=${encodeURIComponent(chatJid)}` : ''}`, 'POST');

/**
 * The task list, re-read every few seconds while mounted. Polled rather than
 * pushed, like the watch strip: the chat socket carries no task events.
 * A failed read keeps the last list — a blip must not blank the strip and
 * make a running server look gone.
 */
export function useBgTasks(opts: { chatJid?: string; includeFinished?: boolean } = {}) {
  const [tasks, setTasks] = useState<BgTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const live = useRef(true);
  const unsupported = useRef(false);
  const { chatJid, includeFinished } = opts;

  const reload = useCallback(async () => {
    if (unsupported.current) return;
    try {
      const next = await fetchBgTasks({ chatJid, includeFinished });
      if (live.current) {
        setTasks(next);
        setLoaded(true);
      }
    } catch (e) {
      // An older daemon has no such route: stop asking. Any other failure keeps the last list.
      if (e instanceof BgTasksUnsupported) unsupported.current = true;
    }
  }, [chatJid, includeFinished]);

  useEffect(() => {
    live.current = true;
    unsupported.current = false;
    setTasks([]); // switching chats must not show the previous one's tasks
    setLoaded(false);
    void reload();
    const timer = setInterval(() => void reload(), BG_POLL_MS);
    return () => {
      live.current = false;
      clearInterval(timer);
    };
  }, [reload]);

  return { tasks, loaded, reload, setTasks };
}

/** `1h 02m`, `3m 05s`, `42s`. */
export function fmtUptime(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m ${String(secs % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** The first non-empty line of a command, cut to `max` characters. */
export function commandLine(command: string, max = 80): string {
  const line = command.split('\n').map(l => l.trim()).find(Boolean) ?? command;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * Where a listening port can be opened from this browser. The process runs on
 * the daemon's machine, so a UI opened from another device needs the daemon's
 * host, not `localhost`.
 */
export function portUrl(port: number): string {
  const host = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : '127.0.0.1';
  return `http://${host}:${port}/`;
}
