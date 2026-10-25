/**
 * Which senclaw core (daemon) serves this console, from `/api/system/version`.
 * The console's own version is a different number: the web-app is released
 * from its own repository, and a daemon serves whichever dist it downloaded.
 */
export interface CoreBuild {
  version: string;
  /** Short commit hash; absent from a daemon that predates the route. */
  gitHash?: string;
  gitDescribe?: string;
  buildTime?: string;
  buildTarget?: string;
  /** What may update it: the desktop app (`desktop-bundle`), `senclaw update` (`standalone`), nothing (`dev`). */
  installKind?: 'desktop-bundle' | 'standalone' | 'dev';
  exePath?: string | null;
  bundlePath?: string | null;
}

/**
 * The serving core's build. A daemon from before `/api/system/version` (404)
 * still names its version in `/api/config`, which is enough to show.
 */
export async function fetchCoreBuild(): Promise<CoreBuild | null> {
  const r = await fetch('/api/system/version');
  if (r.ok) {
    const j = await r.json();
    return typeof j?.version === 'string' ? (j as CoreBuild) : null;
  }
  if (r.status !== 404) throw new Error(`HTTP ${r.status}`);
  const c = await fetch('/api/config');
  if (!c.ok) throw new Error(`HTTP ${c.status}`);
  const j = await c.json();
  return typeof j?.version === 'string' ? { version: j.version } : null;
}

/** This console's own build: the release version in CI, `git describe` for a local build. */
export const WEB_APP_VERSION: string = __APP_VERSION__;
