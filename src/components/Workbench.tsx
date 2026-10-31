import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import type { WorkbenchState, FormMessage } from '../types';
import type { BgTask } from '../lib/bgTasks';
import { isLoopbackUrl } from '../lib/browserUrl';
import { StaticRenderer } from './workbench/StaticRenderer';
import { BrowserView } from './browser/BrowserView';
import { BackendRenderer } from './workbench/BackendRenderer';
import { HistoryList } from './workbench/HistoryList';
import { FormCard } from './FormCard';
import { theme } from 'antd';

// Drag-to-resize width, persisted to localStorage (mirrors AgentConsole).
const WIDTH_KEY = 'senclaw:workbench:width';
const DEFAULT_W = 480;
const MIN_W = 320;
const MAX_W = 960;

function loadWidth(): number {
  try {
    const v = localStorage.getItem(WIDTH_KEY);
    if (v) {
      const n = parseInt(v, 10);
      if (n >= MIN_W && n <= MAX_W) return n;
    }
  } catch {}
  return DEFAULT_W;
}

function saveWidth(w: number) {
  try { localStorage.setItem(WIDTH_KEY, String(w)); } catch {}
}

interface Props {
  /** Workbench state for the currently active jid. */
  state: WorkbenchState | null;
  /** Whether expanded (mutex controlled by the layout). */
  expanded: boolean;
  onCollapse: () => void;
  /** Read a file's content from the backend. */
  readFile: (artifactId: string, path: string) => Promise<{ content?: string; error?: string }>;
  /** Close an artifact. */
  closeArtifact: (artifactId: string) => void;
  /** Promote an artifact to current. */
  selectArtifact: (artifactId: string) => void;
  /** Mark as viewed (updates last_active). */
  markViewed: (artifactId: string) => void;
  /** Active dock form (surface:'dock') — shown above/instead of the artifact. */
  dockForm?: FormMessage | null;
  /** Submit / skip the dock form. */
  onResolveForm?: (requestId: string, values: Record<string, unknown>, submitted: boolean) => void;
  /** What the browser was asked to open (a port chip). */
  browserRequest?: { url: string; seq: number } | null;
  /** Running background tasks, for the browser's "detect dev server" list. */
  bgTasks?: BgTask[];
  /** The active chat jid — keys the browser state and filters dev servers. */
  activeJid?: string | null;
}

export function Workbench({ state, expanded, onCollapse, readFile, closeArtifact, selectArtifact, markViewed, dockForm, onResolveForm, browserRequest, bgTasks, activeJid }: Props) {
  const { token } = theme.useToken();
  const current = state?.current ?? null;
  const history = state?.history ?? [];
  // The browser shows what a click asked for, else the current `web` artifact's
  // URL, unless that is a loopback page: one of those waits for the person's
  // click. `static`/`backend` artifacts render as themselves (below).
  const artifactUrl = current?.mode === 'web' && current.url ? current.url : null;
  const localArtifactUrl = artifactUrl && isLoopbackUrl(artifactUrl) ? artifactUrl : null;
  const browserEffectiveUrl =
    browserRequest?.url ?? (localArtifactUrl ? null : artifactUrl);

  // Notify the backend "viewed" when current changes.
  useEffect(() => {
    if (expanded && current) markViewed(current.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, current?.id]);

  const readFileForCurrent = useMemo(
    () => (path: string) => current ? readFile(current.id, path) : Promise.resolve({ error: 'no_current' }),
    [current?.id, readFile],
  );

  // ===== Resize (drag the left edge), like AgentConsole =====
  const [width, setWidth] = useState(loadWidth);
  const widthRef = useRef(width);
  widthRef.current = width;
  const dragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartW = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    dragStartX.current = e.clientX;
    dragStartW.current = widthRef.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = dragStartX.current - e.clientX; // panel is on the right: drag left → wider
      const next = Math.min(MAX_W, Math.max(MIN_W, dragStartW.current + delta));
      widthRef.current = next;
      setWidth(next);
    };
    const onMouseUp = () => {
      if (dragging.current) {
        dragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        saveWidth(widthRef.current);
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // Render nothing when collapsed (the badge is rendered by DockBadges).
  if (!expanded) return null;

  return (
    <div
      className="relative flex flex-col flex-shrink-0 border-l overflow-hidden"
      style={{
        width,
        background: token.colorBgContainer,
        borderColor: token.colorBorderSecondary,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b flex-shrink-0"
        style={{
          background: token.colorBgElevated,
          borderColor: token.colorBorderSecondary,
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold truncate" style={{ color: token.colorText }}>
            {current && current.mode !== 'web' ? current.title : dockForm ? dockForm.title : 'Browser'}
          </span>
          {current && current.mode !== 'web' && (
            <span className="text-[10px] font-mono" style={{ color: token.colorTextTertiary }}>{current.mode}</span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {current && (
            <button
              onClick={() => closeArtifact(current.id)}
              className="text-xs px-1.5 py-0.5 rounded transition-colors"
              style={{ color: token.colorTextTertiary }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = token.colorError;
                e.currentTarget.style.background = token.colorFillTertiary;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = token.colorTextTertiary;
                e.currentTarget.style.background = 'transparent';
              }}
              title="Close this workbench"
            >
              ✕ close
            </button>
          )}
          <button
            onClick={onCollapse}
            className="text-xs px-1.5 py-0.5 rounded transition-colors"
            style={{ color: token.colorTextTertiary }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = token.colorTextSecondary;
              e.currentTarget.style.background = token.colorFillTertiary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = token.colorTextTertiary;
              e.currentTarget.style.background = 'transparent';
            }}
          >
            Hide ▸
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* Active dock form takes priority (top strip above the browser/artifact) */}
        {dockForm && onResolveForm && (
          <div
            className="overflow-y-auto p-3 border-b max-h-[55%]"
            style={{ borderColor: token.colorBorderSecondary }}
          >
            <FormCard message={dockForm} onResolve={onResolveForm} variant="dock" />
          </div>
        )}
        {/* An agent file/endpoint artifact shows as such; otherwise the browser. */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {current?.mode === 'static' ? (
            <StaticRenderer artifact={current} readFile={readFileForCurrent} />
          ) : current?.mode === 'backend' ? (
            <BackendRenderer artifact={current} />
          ) : (
            <BrowserView
              key={activeJid ?? '_'}
              url={browserEffectiveUrl}
              urlKey={browserRequest?.seq ?? 0}
              localArtifact={
                localArtifactUrl ? { title: current?.title ?? '', url: localArtifactUrl } : null
              }
              bgTasks={bgTasks ?? []}
              activeJid={activeJid ?? null}
            />
          )}
        </div>
      </div>

      {/* History */}
      <HistoryList
        items={history}
        currentId={current?.id ?? null}
        onSelect={selectArtifact}
        onClose={closeArtifact}
        token={token}
      />

      {/* Resize handle (left edge) */}
      <div
        onMouseDown={onMouseDown}
        className="absolute top-0 left-0 h-full"
        style={{ width: '4px', cursor: 'col-resize', zIndex: 30, transition: 'background 0.2s' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(91,191,232,0.4)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      />
    </div>
  );
}
