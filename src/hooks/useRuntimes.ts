import { useCallback, useEffect, useRef, useState } from 'react';
import {
  runtimeApi,
  type InstallJob,
  type RuntimeCatalog,
  type RuntimesView,
  type SlotId,
  type UpdateChannel,
} from '../lib/runtimeApi';

const ACTIVE_JOB_STATES = new Set(['queued', 'downloading', 'verifying', 'extracting']);

/**
 * Data + actions for Settings → Runtime. One hook backs the whole screen so
 * `RuntimeSettings.tsx` stays a thin composition of cards — each card gets
 * exactly the slice of state and the callbacks it renders, nothing more.
 *
 * Install jobs are tracked client-side by version key (`id@version`) so a row
 * mid-install survives a `refresh()` triggered by something else (selecting a
 * different slot, the process list changing), and polled independently at
 * ~1s while active per phase spec.
 */
export function useRuntimes() {
  const [view, setView] = useState<RuntimesView | null>(null);
  const [catalog, setCatalog] = useState<RuntimeCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Record<string, InstallJob>>({});
  const jobPollRef = useRef<number | null>(null);

  const refreshView = useCallback(async () => {
    const v = await runtimeApi.get();
    setView(v);
    return v;
  }, []);

  const refreshCatalog = useCallback(async (refresh = false) => {
    const c = await runtimeApi.catalog(refresh);
    setCatalog(c);
    return c;
  }, []);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      await Promise.all([refreshView(), refreshCatalog()]);
    } catch (e: any) {
      setLoadError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [refreshView, refreshCatalog]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll while any process is starting, so the Running list and the slot
  // selection status catch up once the health gate passes (§3.2/§5.1: a
  // process is visible as `starting` from the moment it is launched).
  const processPollRef = useRef<number | null>(null);
  useEffect(() => {
    const anyStarting = (view?.processes ?? []).some((p) => p.state === 'starting');
    if (anyStarting && processPollRef.current === null) {
      processPollRef.current = window.setInterval(() => refreshView().catch(() => {}), 1000);
    } else if (!anyStarting && processPollRef.current !== null) {
      window.clearInterval(processPollRef.current);
      processPollRef.current = null;
    }
    return () => {
      if (processPollRef.current !== null) {
        window.clearInterval(processPollRef.current);
        processPollRef.current = null;
      }
    };
  }, [view, refreshView]);

  // Poll every active install job at ~1s until it lands on a terminal state,
  // then refresh the view/catalog once so the row picks up the new version.
  useEffect(() => {
    const activeIds = Object.values(jobs)
      .filter((j) => ACTIVE_JOB_STATES.has(j.state))
      .map((j) => j.jobId);
    if (activeIds.length === 0) {
      if (jobPollRef.current !== null) {
        window.clearInterval(jobPollRef.current);
        jobPollRef.current = null;
      }
      return;
    }
    if (jobPollRef.current !== null) return;
    jobPollRef.current = window.setInterval(async () => {
      const current = Object.values(jobs).filter((j) => ACTIVE_JOB_STATES.has(j.state));
      let anyLanded = false;
      for (const j of current) {
        try {
          const updated = await runtimeApi.job(j.jobId);
          setJobs((prev) => ({ ...prev, [versionKey(updated.id, updated.version)]: updated }));
          if (!ACTIVE_JOB_STATES.has(updated.state)) anyLanded = true;
        } catch {
          // A job that vanished from the daemon (restart) is as good as done — stop polling it.
          anyLanded = true;
        }
      }
      if (anyLanded) {
        refreshView().catch(() => {});
        refreshCatalog().catch(() => {});
      }
    }, 1000);
    return () => {
      if (jobPollRef.current !== null) {
        window.clearInterval(jobPollRef.current);
        jobPollRef.current = null;
      }
    };
  }, [jobs, refreshView, refreshCatalog]);

  const install = useCallback(async (id: string, version?: string) => {
    const job = await runtimeApi.install(id, version);
    const full = await runtimeApi.job(job.jobId).catch(
      (): InstallJob => ({
        jobId: job.jobId,
        id: job.id,
        version: job.version,
        state: 'queued',
        receivedBytes: 0,
        totalBytes: null,
        percent: null,
        error: null,
        startedAt: Date.now(),
        finishedAt: null,
      })
    );
    setJobs((prev) => ({ ...prev, [versionKey(full.id, full.version)]: full }));
    return full;
  }, []);

  const installLocal = useCallback(
    async (path: string) => {
      const r = await runtimeApi.installLocal(path);
      await refresh();
      return r;
    },
    [refresh]
  );

  const uninstall = useCallback(
    async (id: string, version: string, force = false) => {
      await runtimeApi.uninstall(id, version, force);
      await refresh();
    },
    [refresh]
  );

  const selectSlot = useCallback(
    async (slot: SlotId, id: string | null, version: string | null) => {
      const v = await runtimeApi.select(slot, id, version);
      setView(v);
      return v;
    },
    []
  );

  const saveSettings = useCallback(async (patch: Partial<RuntimesView['settings']>) => {
    // §5.1: PUT is a partial merge — send only what changed, never a locally
    // reconstructed full object, or a field this hook doesn't know about
    // (changed elsewhere between fetch and save) would be silently reverted.
    const saved = await runtimeApi.putSettings(patch);
    setView((prev) => (prev ? { ...prev, settings: saved } : prev));
    return saved;
  }, []);

  const setAutoUpdate = useCallback((autoUpdate: boolean) => saveSettings({ autoUpdate }), [saveSettings]);
  const setChannel = useCallback(
    (channel: UpdateChannel) => saveSettings({ channel }).then(() => refreshCatalog(true)),
    [saveSettings, refreshCatalog]
  );

  const checkUpdates = useCallback(async () => {
    await runtimeApi.checkUpdates();
    await Promise.all([refreshView(), refreshCatalog(true)]);
  }, [refreshView, refreshCatalog]);

  const stopProcess = useCallback(
    async (key: string) => {
      await runtimeApi.stopProcess(key);
      await refreshView();
    },
    [refreshView]
  );

  const startSlot = useCallback(
    async (slot: SlotId) => {
      await runtimeApi.startSlot(slot);
      await refreshView();
    },
    [refreshView]
  );

  return {
    view,
    catalog,
    loading,
    loadError,
    jobs,
    refresh,
    install,
    installLocal,
    uninstall,
    selectSlot,
    setAutoUpdate,
    setChannel,
    checkUpdates,
    stopProcess,
    startSlot,
  };
}

export function versionKey(id: string, version: string): string {
  return `${id}@${version}`;
}
