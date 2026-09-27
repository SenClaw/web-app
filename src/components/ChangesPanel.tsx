import { useCallback, useEffect, useState } from 'react';
import { Button, Empty, List, Modal, Popconfirm, Space, Spin, Switch, Tag, Tooltip, Typography, message, theme } from 'antd';
import { DiffOutlined, HistoryOutlined, ReloadOutlined, RollbackOutlined, BulbOutlined, FileTextOutlined } from '@ant-design/icons';

const { Text, Paragraph } = Typography;

/** One shadow-git commit taken after a tool wrote into the chat's working dir. */
export interface Checkpoint {
  id: number;
  chatJid: string;
  sha: string;
  parentSha: string | null;
  toolName: string;
  summary: string;
  workspace: string;
  filesChanged: number;
  createdAt: string;
}

interface ChangedFile {
  status: string;
  path: string;
}

interface DiffResult {
  checkpoint: Checkpoint;
  fromSha: string;
  files: ChangedFile[];
  diff: string;
  truncated: boolean;
}

interface Props {
  jid: string;
  /** Bumped by the `checkpoint:new` WS event so the list refetches. */
  tick?: number;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return new Date(iso).toLocaleString();
}

function statusColor(status: string): string {
  if (status === 'A') return 'green';
  if (status === 'D') return 'red';
  if (status === 'R') return 'blue';
  return 'gold';
}

/** Minimal unified-diff renderer: one line per row, coloured by prefix. */
function DiffView({ diff }: { diff: string }) {
  const { token } = theme.useToken();
  const lines = diff.split('\n');
  return (
    <pre
      style={{
        margin: 0,
        padding: 8,
        fontSize: 12,
        lineHeight: 1.45,
        overflowX: 'auto',
        maxHeight: 420,
        background: token.colorFillQuaternary,
        borderRadius: 6,
      }}
    >
      {lines.map((l, i) => {
        let color = token.colorText;
        let bg = 'transparent';
        if (l.startsWith('+') && !l.startsWith('+++')) { color = token.colorSuccessText; bg = `${token.colorSuccess}14`; }
        else if (l.startsWith('-') && !l.startsWith('---')) { color = token.colorErrorText; bg = `${token.colorError}14`; }
        else if (l.startsWith('@@')) { color = token.colorTextTertiary; }
        else if (l.startsWith('diff ') || l.startsWith('index ')) { color = token.colorTextSecondary; }
        return (
          <div key={i} style={{ color, background: bg, whiteSpace: 'pre' }}>{l || ' '}</div>
        );
      })}
    </pre>
  );
}

/**
 * Checkpoints for one chat: what the agent changed, step by step, with
 * diff / restore / explain. Backed by `/api/chats/:jid/checkpoints*`
 * (shadow git — the project's own repository is never touched).
 */
export function ChangesPanel({ jid, tick }: Props) {
  const { token } = theme.useToken();
  const [items, setItems] = useState<Checkpoint[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [diffs, setDiffs] = useState<Record<number, DiffResult | 'loading' | 'error'>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [explain, setExplain] = useState<{ id: number; text: string | null } | null>(null);

  const base = `/api/chats/${encodeURIComponent(jid)}/checkpoints`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(base);
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setItems(j.items ?? []);
      setEnabled(j.enabled !== false);
      setWorkspace(j.workspace ?? null);
    } catch (e) {
      message.error(`Checkpoints: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => { void load(); }, [load, tick]);

  const loadDiff = useCallback(async (id: number) => {
    setDiffs(d => ({ ...d, [id]: 'loading' }));
    try {
      const r = await fetch(`${base}/${id}/diff`);
      if (!r.ok) throw new Error(await r.text());
      const j = (await r.json()) as DiffResult;
      setDiffs(d => ({ ...d, [id]: j }));
    } catch {
      setDiffs(d => ({ ...d, [id]: 'error' }));
    }
  }, [base]);

  const toggleOpen = (cp: Checkpoint) => {
    const next = openId === cp.id ? null : cp.id;
    setOpenId(next);
    if (next != null && cp.parentSha && !diffs[cp.id]) void loadDiff(cp.id);
  };

  const restore = async (cp: Checkpoint, files: string[]) => {
    setBusy(cp.id);
    try {
      const r = await fetch(`${base}/${cp.id}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      const n = (j.restored?.length ?? 0) + (j.removed?.length ?? 0);
      message.success(files.length ? `Restored ${files.join(', ')}` : `Restored ${n} file(s) to checkpoint #${cp.id}`);
      await load();
    } catch (e) {
      message.error(`Restore failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  /// Turn this checkpoint into a markdown page under the project's
  /// `docs/changes/`. Same diff as Explain, but with a destination that
  /// survives the conversation.
  const runDocument = async (cp: Checkpoint) => {
    setBusy(cp.id);
    try {
      const r = await fetch(`${base}/${cp.id}/document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      // The path is the whole point of the feature, so it is the message.
      message.success(`Đã ghi ${j.relativePath} — ${j.path}`, 8);
    } catch (e) {
      message.error(`Ghi tài liệu thất bại: ${(e as Error).message}`, 8);
    } finally {
      setBusy(null);
    }
  };

  const runExplain = async (cp: Checkpoint) => {
    setExplain({ id: cp.id, text: null });
    try {
      const r = await fetch(`${base}/${cp.id}/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: navigator.language.startsWith('vi') ? 'vi' : 'en' }),
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setExplain({ id: cp.id, text: j.text || j.note || '(no changes)' });
    } catch (e) {
      setExplain({ id: cp.id, text: `Explain failed: ${(e as Error).message}` });
    }
  };

  const setEnabledRemote = async (on: boolean) => {
    setEnabled(on);
    try {
      const r = await fetch(`${base}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: on }),
      });
      if (!r.ok) throw new Error(await r.text());
    } catch (e) {
      setEnabled(!on);
      message.error(`Could not update: ${(e as Error).message}`);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Space style={{ justifyContent: 'space-between', width: '100%' }}>
        <Space size={6}>
          <HistoryOutlined />
          <Text strong>Checkpoints</Text>
          {workspace && (
            <Text type="secondary" style={{ fontSize: 12 }} ellipsis={{ tooltip: workspace }}>
              {workspace}
            </Text>
          )}
        </Space>
        <Space size={8}>
          <Tooltip title="Record a checkpoint after every edit in this chat">
            <Switch size="small" checked={enabled} onChange={(v) => void setEnabledRemote(v)} />
          </Tooltip>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()} loading={loading} />
        </Space>
      </Space>

      {items.length === 0 && !loading && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No checkpoints yet — they appear after the agent edits a file in a git repository."
        />
      )}

      <List
        size="small"
        dataSource={items}
        renderItem={(cp) => {
          const open = openId === cp.id;
          const d = diffs[cp.id];
          return (
            <List.Item
              key={cp.id}
              style={{ display: 'block', padding: '6px 0', borderBottomColor: token.colorBorderSecondary }}
            >
              <div
                onClick={() => toggleOpen(cp)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
              >
                <Tag style={{ margin: 0 }} color={cp.toolName === 'restore' ? 'purple' : undefined}>
                  {cp.toolName}
                </Tag>
                <Text ellipsis={{ tooltip: cp.summary }} style={{ flex: 1, fontSize: 12 }}>
                  {cp.parentSha ? cp.summary : 'baseline (before the first edit)'}
                </Text>
                <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                  {cp.filesChanged ? `${cp.filesChanged} file${cp.filesChanged > 1 ? 's' : ''} · ` : ''}
                  {timeAgo(cp.createdAt)}
                </Text>
              </div>
              {open && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Space wrap size={6}>
                    <Popconfirm
                      title="Restore the whole working directory to this step?"
                      description="Files the agent added after this step are removed. The restore is recorded as a new checkpoint, so it can be undone."
                      okText="Restore"
                      onConfirm={() => void restore(cp, [])}
                    >
                      <Button size="small" icon={<RollbackOutlined />} loading={busy === cp.id}>Restore all</Button>
                    </Popconfirm>
                    {cp.parentSha && (
                      <>
                        <Button size="small" icon={<DiffOutlined />} onClick={() => void loadDiff(cp.id)}>Reload diff</Button>
                        <Button size="small" icon={<BulbOutlined />} onClick={() => void runExplain(cp)}>Explain</Button>
                        <Tooltip title="Ghi thành một trang .md trong docs/changes của dự án. Không commit.">
                          <Button
                            size="small"
                            icon={<FileTextOutlined />}
                            loading={busy === cp.id}
                            onClick={() => void runDocument(cp)}
                          >
                            Ghi tài liệu
                          </Button>
                        </Tooltip>
                      </>
                    )}
                    <Text type="secondary" style={{ fontSize: 11 }} copyable={{ text: cp.sha }}>{cp.sha.slice(0, 10)}</Text>
                  </Space>
                  {cp.parentSha && d === 'loading' && <Spin size="small" />}
                  {cp.parentSha && d === 'error' && <Text type="danger">Could not load the diff.</Text>}
                  {cp.parentSha && d && d !== 'loading' && d !== 'error' && (
                    <>
                      <Space wrap size={4}>
                        {d.files.map(f => (
                          <Popconfirm
                            key={f.path}
                            title={`Restore ${f.path} to this step?`}
                            okText="Restore"
                            onConfirm={() => void restore(cp, [f.path])}
                          >
                            <Tag color={statusColor(f.status)} style={{ cursor: 'pointer', margin: 0 }}>
                              {f.status} {f.path}
                            </Tag>
                          </Popconfirm>
                        ))}
                      </Space>
                      {d.truncated && <Text type="warning" style={{ fontSize: 11 }}>Diff truncated (200 KB limit).</Text>}
                      <DiffView diff={d.diff} />
                    </>
                  )}
                </div>
              )}
            </List.Item>
          );
        }}
      />

      <Modal
        open={explain != null}
        onCancel={() => setExplain(null)}
        footer={null}
        title={explain ? `Explain checkpoint #${explain.id}` : ''}
        width={640}
      >
        {explain?.text == null ? (
          <Spin />
        ) : (
          <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{explain.text}</Paragraph>
        )}
      </Modal>
    </div>
  );
}
