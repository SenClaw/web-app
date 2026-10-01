import { useCallback, useEffect, useRef, useState } from 'react';
import { localModelsApi, type LocalModelsSettings, type LocalModelsView } from '../lib/runtimeApi';

// §5.3: `queued | listing | downloading | done | failed | cancelled` — the first three are active.
const ACTIVE_DOWNLOAD_STATES = new Set(['queued', 'listing', 'downloading']);

/** Data + actions for Settings → Local models. Mirrors `useRuntimes` shape so both screens read the same way. */
export function useLocalModels() {
  const [view, setView] = useState<LocalModelsView | null>(null);
  const [settings, setSettings] = useState<LocalModelsSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const refreshView = useCallback(async () => {
    const v = await localModelsApi.list();
    setView(v);
    return v;
  }, []);

  const refreshSettings = useCallback(async () => {
    const s = await localModelsApi.getSettings();
    setSettings(s);
    return s;
  }, []);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      await Promise.all([refreshView(), refreshSettings()]);
    } catch (e: any) {
      setLoadError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [refreshView, refreshSettings]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll while a download is in flight or a model is mid-load/unload.
  useEffect(() => {
    const active =
      (view?.downloads ?? []).some((d) => ACTIVE_DOWNLOAD_STATES.has(d.state)) ||
      (view?.models ?? []).some((m) => m.process?.state === 'starting' || m.process?.state === 'stopping');
    if (active && pollRef.current === null) {
      pollRef.current = window.setInterval(() => refreshView().catch(() => {}), 1200);
    } else if (!active && pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [view, refreshView]);

  const startDownload = useCallback(
    async (body: {
      repo?: string;
      file?: string;
      mmproj?: string;
      revision?: string;
      format?: 'gturbo' | 'gguf' | 'mlx';
      vision?: boolean;
    }) => {
      const r = await localModelsApi.download(body);
      await refreshView();
      return r;
    },
    [refreshView]
  );

  const cancelDownload = useCallback(
    async (id: string) => {
      await localModelsApi.cancelDownload(id);
      await refreshView();
    },
    [refreshView]
  );

  const remove = useCallback(
    async (key: string, force = false) => {
      await localModelsApi.remove(key, force);
      await refreshView();
    },
    [refreshView]
  );

  const load = useCallback(
    async (key: string, contextLength?: number) => {
      const p = await localModelsApi.load(key, contextLength);
      await refreshView();
      return p;
    },
    [refreshView]
  );

  const unload = useCallback(
    async (key: string) => {
      await localModelsApi.unload(key);
      await refreshView();
    },
    [refreshView]
  );

  const saveSettings = useCallback(async (next: LocalModelsSettings) => {
    const saved = await localModelsApi.putSettings(next);
    setSettings(saved);
    return saved;
  }, []);

  return {
    view,
    settings,
    loading,
    loadError,
    refresh,
    startDownload,
    cancelDownload,
    remove,
    load,
    unload,
    saveSettings,
  };
}
