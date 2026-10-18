import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listProjects, type Project } from '../lib/projectsApi';

export interface UseProjects {
  /** Every project asked for, newest first as the daemon lists them. */
  projects: Project[];
  /** `null` until the first answer. */
  loaded: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  byId: (id: string | null | undefined) => Project | undefined;
}

/**
 * The projects, kept fresh the only two ways the daemon allows: the caller
 * runs `refresh` after what it did itself, and this hook runs it when the
 * window gets focus back. There is no push event for a project, so a second
 * window shows an older list until its next refresh.
 *
 * `archived`: `'false'` active only (to pick one), `'all'` both (to name the
 * project of a chat or a fact bank, which may be archived).
 */
export function useProjects(archived: 'false' | 'true' | 'all' = 'false'): UseProjects {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A slow answer to an older call must not overwrite a newer one.
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const list = await listProjects(archived);
      if (mine !== seq.current) return;
      setProjects(list);
      setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      setError((e as Error).message);
    } finally {
      if (mine === seq.current) setLoaded(true);
    }
  }, [archived]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  const index = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects]);
  const byId = useCallback((id: string | null | undefined) => (id ? index.get(id) : undefined), [index]);

  return { projects, loaded, error, refresh, byId };
}
