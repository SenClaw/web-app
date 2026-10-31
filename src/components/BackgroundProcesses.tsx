import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Empty, Popconfirm, Space, Switch, Tag, Tooltip, Typography, message, theme } from 'antd';
import {
  CodeOutlined, DeleteOutlined, ExportOutlined, LoadingOutlined, LockOutlined, StopOutlined,
} from '@ant-design/icons';

import { useLang } from '../i18n';
import { useAppContext } from '../contexts/AppContext';
import { openInBrowserPane } from '../lib/browserPane';
import {
  BG_POLL_MS, clearFinishedBgTasks, commandLine, dismissBgTask, fetchBgTaskOutput, fmtUptime,
  portUrl, stopBgTask, useBgTasks,
  type BgTask,
} from '../lib/bgTasks';

const { Text } = Typography;

// Statuses reach `t()` through a variable, so they are declared for the
// coverage check rather than left to look like orphaned translations.
// i18n-dynamic: Running, Done, Failed, Stopped

const STATUS_LABEL: Record<BgTask['status'], string> = {
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
};
const STATUS_COLOR: Record<BgTask['status'], string> = {
  running: 'processing',
  done: 'green',
  failed: 'red',
  stopped: 'default',
};

/** The title a person recognises: what the agent said it was doing, else the command. */
function titleOf(task: BgTask): string {
  return task.description || commandLine(task.command, 70);
}

/** The log of one task, re-read while it is open. */
function TaskLog({ task }: { task: BgTask }) {
  const { token } = theme.useToken();
  const { t } = useLang();
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const read = () =>
      fetchBgTaskOutput(task.id)
        .then(o => live && setText(o))
        .catch(() => {});
    void read();
    // A finished task's log does not change; only a running one is followed.
    const timer = task.status === 'running' ? setInterval(read, BG_POLL_MS) : undefined;
    return () => {
      live = false;
      if (timer) clearInterval(timer);
    };
  }, [task.id, task.status]);

  return (
    <pre
      style={{
        margin: '6px 0 0',
        padding: '6px 8px',
        maxHeight: 200,
        overflow: 'auto',
        fontSize: 11,
        lineHeight: 1.45,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        borderRadius: 6,
        background: token.colorFillTertiary,
        color: token.colorTextSecondary,
      }}
    >
      {text === null
        ? '…'
        : text ||
          t('Nothing printed yet. If the command sent its output to a file, it is not shown here.')}
    </pre>
  );
}

/** One task: what it is, where it listens, how long it has run, and the buttons. */
export function BgTaskRow({
  task,
  onChanged,
  showChat,
  onOpenInPane,
}: {
  task: BgTask;
  onChanged: () => void;
  showChat?: boolean;
  /** When set (chat strip only), a `:port` chip opens in the Browser pane; a
   * small icon beside it still opens the system browser. */
  onOpenInPane?: (port: number) => void;
}) {
  const { token } = theme.useToken();
  const { t, tArgs } = useLang();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const running = task.status === 'running';

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      onChanged();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        padding: '6px 10px',
        borderRadius: 8,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorFillQuaternary,
        opacity: running ? 1 : 0.75,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <CodeOutlined style={{ color: running ? token.colorPrimary : token.colorTextTertiary, fontSize: 13 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 12, display: 'block' }} ellipsis={{ tooltip: task.command }}>
            <strong>{titleOf(task)}</strong>
          </Text>
          <Text type="secondary" style={{ fontSize: 11 }} ellipsis>
            {task.description ? <code>{commandLine(task.command, 60)}</code> : null}
            {task.description ? ' · ' : ''}
            {running ? fmtUptime(task.uptimeSecs) : t(STATUS_LABEL[task.status])}
            {!running && task.exitCode !== null && ` (${task.exitCode})`}
            {task.pids.length > 1 && ` · ${task.pids.length} pids`}
            {task.pid ? ` · pid ${task.pid}` : ''}
            {showChat && task.chatJid && (
              <>
                {' · '}
                <a onClick={() => navigate(`/chat/${encodeURIComponent(task.chatJid)}`)}>{task.chatJid}</a>
              </>
            )}
          </Text>
        </div>
        {task.isolation && (
          <Tooltip title={tArgs('Runs inside the OS sandbox ({name})', { name: task.isolation })}>
            <LockOutlined style={{ fontSize: 12, color: token.colorTextTertiary }} />
          </Tooltip>
        )}
        {task.origin === 'restored' && (
          <Tooltip title={t('Found after the daemon restarted; its output was not kept.')}>
            <Tag style={{ marginInlineEnd: 0 }}>{t('Restored')}</Tag>
          </Tooltip>
        )}
        {running &&
          task.ports.map(p => (
            <span key={p} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              <Tooltip
                title={
                  onOpenInPane
                    ? tArgs('Open port {port} in the browser pane', { port: p })
                    : tArgs('Open port {port} in a new tab', { port: p })
                }
              >
                <Tag
                  color="blue"
                  style={{ cursor: 'pointer', marginInlineEnd: 0 }}
                  onClick={() =>
                    onOpenInPane ? onOpenInPane(p) : window.open(portUrl(p), '_blank', 'noopener')
                  }
                >
                  :{p}
                </Tag>
              </Tooltip>
              {onOpenInPane && (
                <Tooltip title={t('Open externally')}>
                  <Button
                    size="small"
                    type="text"
                    icon={<ExportOutlined />}
                    onClick={() => window.open(portUrl(p), '_blank', 'noopener')}
                    style={{ width: 20, height: 20, minWidth: 20, padding: 0 }}
                  />
                </Tooltip>
              )}
            </span>
          ))}
        {!running && <Tag color={STATUS_COLOR[task.status]} style={{ marginInlineEnd: 0 }}>{t(STATUS_LABEL[task.status])}</Tag>}
        <Button size="small" type="text" onClick={() => setOpen(o => !o)} style={{ fontSize: 11 }}>
          {t('Log')}
        </Button>
        {running ? (
          <Button
            size="small"
            type="text"
            danger
            icon={busy ? <LoadingOutlined /> : <StopOutlined />}
            disabled={busy}
            onClick={() => void run(() => stopBgTask(task.id))}
            style={{ fontSize: 11 }}
          >
            {t('Stop')}
          </Button>
        ) : (
          <Tooltip title={t('Remove from the list')}>
            <Button
              size="small"
              type="text"
              icon={<DeleteOutlined />}
              disabled={busy}
              onClick={() => void run(() => dismissBgTask(task.id))}
            />
          </Tooltip>
        )}
      </div>
      {open && <TaskLog task={task} />}
    </div>
  );
}

/**
 * What this chat's agent left running, above the composer.
 *
 * A dev server started from a chat used to outlive the turn with nothing to
 * show it and nothing to end it. Polled (the chat socket carries no task
 * events), and it also says when *other* chats have processes running, since
 * the one you forgot is rarely in the chat that is open.
 */
export function BackgroundProcessStrip({ jid }: { jid: string }) {
  const { t, tArgs } = useLang();
  const navigate = useNavigate();
  const { embed } = useAppContext();
  const { tasks, reload } = useBgTasks();
  const mine = tasks.filter(x => x.chatJid === jid);
  const others = tasks.length - mine.length;
  if (mine.length === 0 && others === 0) return null;

  // Open a port in the right-dock Browser pane — only where that dock exists
  // (not the compact ?embed=1 chat window, which has no dock).
  const onOpenInPane = embed ? undefined : (port: number) => openInBrowserPane(portUrl(port));

  return (
    <div style={{ padding: '0 24px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {mine.map(task => (
        <BgTaskRow key={task.id} task={task} onChanged={() => void reload()} onOpenInPane={onOpenInPane} />
      ))}
      {others > 0 && (
        <Text type="secondary" style={{ fontSize: 11 }}>
          {tArgs('{n} more running in other chats', { n: others })} ·{' '}
          <a onClick={() => navigate('/background?tab=processes')}>{t('Manage')}</a>
        </Text>
      )}
    </div>
  );
}

/** Every process of every chat — the Processes tab of the Background page. */
export function BackgroundProcessesPanel() {
  const { t } = useLang();
  const [finished, setFinished] = useState(false);
  const { tasks, loaded, reload } = useBgTasks({ includeFinished: finished });
  const running = tasks.filter(x => x.status === 'running');

  const stopAll = async () => {
    try {
      const r = await fetch('/api/bg-tasks/stop-all', { method: 'POST' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      void reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Text type="secondary" style={{ flex: 1, fontSize: 13 }}>
          {t('Servers and other programs an agent started and left running on this machine.')}
        </Text>
        <Space size={6}>
          <Text type="secondary" style={{ fontSize: 12 }}>{t('Show finished')}</Text>
          <Switch size="small" checked={finished} onChange={setFinished} />
        </Space>
        {finished && tasks.some(x => x.status !== 'running') && (
          <Button
            size="small"
            onClick={() =>
              void clearFinishedBgTasks()
                .then(reload)
                .catch(e => message.error(String(e.message ?? e)))
            }
          >
            {t('Clear finished')}
          </Button>
        )}
        {running.length > 1 && (
          <Popconfirm
            title={t('Stop every running process?')}
            okText={t('Stop all')}
            cancelText={t('Cancel')}
            onConfirm={() => void stopAll()}
          >
            <Button size="small" danger icon={<StopOutlined />}>
              {t('Stop all')}
            </Button>
          </Popconfirm>
        )}
      </div>
      {loaded && tasks.length === 0 ? (
        <Empty description={t('Nothing is running in the background')} style={{ padding: 32 }} />
      ) : (
        tasks.map(task => <BgTaskRow key={task.id} task={task} showChat onChanged={() => void reload()} />)
      )}
    </div>
  );
}

/** How many processes are running, for a badge on the sidebar button. */
export function useRunningProcessCount(): number {
  const { tasks } = useBgTasks();
  return tasks.length;
}
