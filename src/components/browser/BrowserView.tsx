import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Tooltip, message, theme } from 'antd';
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ExportOutlined,
  GlobalOutlined,
  HomeOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';

import { useLang } from '../../i18n';
import { portUrl, type BgTask } from '../../lib/bgTasks';
import { browserUrlFrom } from '../../lib/browserUrl';

interface Props {
  /** URL requested from outside the pane (a web artifact, a dev server, a port
   * chip). A change here navigates the pane; internal navigation does not. */
  url: string | null;
  bgTasks: BgTask[];
  activeJid: string | null;
}

/**
 * A browser inside the right dock: address bar, back/forward/reload/home and an
 * <iframe> viewport. Navigation history is app-managed because a cross-origin
 * iframe exposes no navigation events. External sites that send
 * `X-Frame-Options`/`frame-ancestors` render blank — the ⇱ button opens the
 * current page in a real tab as the escape hatch.
 */
export function BrowserView({ url, bgTasks, activeJid }: Props) {
  const { token } = theme.useToken();
  const { t } = useLang();

  const [nav, setNav] = useState<{ stack: string[]; idx: number }>(() => {
    const first = url ? browserUrlFrom(url) : null;
    return first ? { stack: [first], idx: 0 } : { stack: [], idx: -1 };
  });
  const [input, setInput] = useState(url ?? '');
  const [reloadKey, setReloadKey] = useState(0);
  const current = nav.idx >= 0 ? nav.stack[nav.idx] : null;

  // Every URL enters the pane here, whoever asked for it.
  const go = useCallback((raw: string) => {
    if (!raw.trim()) return;
    const u = browserUrlFrom(raw);
    if (!u) {
      message.warning(t('Only http and https pages open here.'));
      return;
    }
    setNav(n => {
      const stack = n.stack.slice(0, n.idx + 1);
      stack.push(u);
      return { stack, idx: stack.length - 1 };
    });
    setInput(u);
  }, [t]);

  // React only to a NEW url *prop* (external open). Internal navigation leaves
  // the prop unchanged, so this never fights the address bar or back/forward.
  const extRef = useRef<string | null>(url);
  useEffect(() => {
    if (url && url !== extRef.current) go(url);
    extRef.current = url;
  }, [url, go]);

  // Keep the address bar reflecting the page we're on (incl. back/forward),
  // and clear it on Home (current === null → the empty state).
  useEffect(() => {
    setInput(current ?? '');
  }, [current]);

  const canBack = nav.idx > 0;
  const canForward = nav.idx < nav.stack.length - 1;

  const openExternal = () => {
    const u = current ?? browserUrlFrom(input);
    if (u) window.open(u, '_blank', 'noopener');
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div
        className="flex items-center gap-1 px-2 py-1.5 border-b flex-shrink-0"
        style={{
          borderColor: token.colorBorderSecondary,
          background: token.colorBgElevated,
        }}
      >
        <Button
          type="text"
          size="small"
          icon={<ArrowLeftOutlined />}
          disabled={!canBack}
          title={t('Back')}
          onClick={() => setNav(n => (n.idx > 0 ? { ...n, idx: n.idx - 1 } : n))}
        />
        <Button
          type="text"
          size="small"
          icon={<ArrowRightOutlined />}
          disabled={!canForward}
          title={t('Forward')}
          onClick={() =>
            setNav(n => (n.idx < n.stack.length - 1 ? { ...n, idx: n.idx + 1 } : n))
          }
        />
        <Button
          type="text"
          size="small"
          icon={<ReloadOutlined />}
          disabled={!current}
          title={t('Reload')}
          onClick={() => setReloadKey(k => k + 1)}
        />
        <Button
          type="text"
          size="small"
          icon={<HomeOutlined />}
          disabled={!current}
          title={t('Home')}
          onClick={() => setNav({ stack: [], idx: -1 })}
        />
        <Input
          size="small"
          value={input}
          onChange={e => setInput(e.target.value)}
          onPressEnter={() => go(input)}
          placeholder={t('Type a URL')}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
        <Tooltip title={t('Open externally')}>
          <Button
            type="text"
            size="small"
            icon={<ExportOutlined />}
            disabled={!current && !input.trim()}
            onClick={openExternal}
          />
        </Tooltip>
      </div>

      <div className="flex-1 min-h-0">
        {current ? (
          // White only behind the page — the empty state must keep the pane's
          // theme background or its light text is invisible on white.
          <div className="w-full h-full" style={{ background: '#fff' }}>
            <iframe
              key={`${current}|${reloadKey}`}
              title={current}
              src={current}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
              className="w-full h-full border-0"
            />
          </div>
        ) : (
          <BrowserEmptyState bgTasks={bgTasks} activeJid={activeJid} onOpen={go} />
        )}
      </div>
    </div>
  );
}

function BrowserEmptyState({
  bgTasks,
  activeJid,
  onOpen,
}: {
  bgTasks: BgTask[];
  activeJid: string | null;
  onOpen: (url: string) => void;
}) {
  const { token } = theme.useToken();
  const { t } = useLang();
  const running = bgTasks.filter(x => x.status === 'running' && x.ports.length > 0);
  // This chat's servers first, then the rest.
  const servers = [
    ...running.filter(x => x.chatJid === activeJid),
    ...running.filter(x => x.chatJid !== activeJid),
  ];

  return (
    <div
      className="h-full overflow-y-auto flex flex-col items-center justify-center text-center px-6 py-8"
      style={{ color: token.colorTextTertiary }}
    >
      <GlobalOutlined style={{ fontSize: 40, color: token.colorTextTertiary }} />
      <div className="mt-3 text-base font-semibold" style={{ color: token.colorText }}>
        {t('Browse the web')}
      </div>
      <div className="mt-1 text-xs">
        {t('Type a URL above, or open a running dev server below.')}
      </div>
      {servers.length > 0 && (
        <div className="mt-5 w-full max-w-xs text-left">
          <div
            className="text-[11px] font-semibold mb-2"
            style={{ color: token.colorTextSecondary }}
          >
            {t('Dev servers')}
          </div>
          {servers.map(task =>
            task.ports.map(p => (
              <Button
                key={`${task.id}-${p}`}
                block
                size="small"
                icon={<PlayCircleOutlined />}
                className="mb-1.5"
                style={{
                  textAlign: 'left',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                onClick={() => onOpen(portUrl(p))}
              >
                :{p} · {task.description || task.command}
              </Button>
            )),
          )}
        </div>
      )}
    </div>
  );
}
