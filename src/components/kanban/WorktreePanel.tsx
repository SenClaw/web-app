import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Button, Card, Collapse, Form, Input, Modal, Popconfirm, Space,
  Spin, Tag, Typography, message, theme,
} from 'antd';
import {
  BranchesOutlined, DeleteOutlined, GithubOutlined, ReloadOutlined,
  SyncOutlined,
} from '@ant-design/icons';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

interface WorktreeInfo {
  path: string;
  branch: string;
  base: string;
  repo: string;
  createdAt: string;
  owner: string;
}

interface WorktreeDiff {
  base: string;
  branch: string;
  stat: string;
  files: string[];
  diff: string;
  truncated: boolean;
  commits: number;
  dirty: boolean;
}

interface WorktreePanelProps {
  cardId: number;
  repo: string | null;
  /** Prefills the PR title; the card's own title if the caller has it. */
  cardTitle?: string;
}

async function api<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((j && (j.error || j.message)) || `HTTP ${res.status}`);
  }
  return j as T;
}

/** Renders a unified diff with +/− lines coloured, everything else dimmed. */
function DiffView({ diff }: { diff: string }) {
  const { token } = theme.useToken();
  const lines = useMemo(() => diff.split('\n'), [diff]);
  return (
    <pre
      style={{
        margin: 0,
        padding: 8,
        fontFamily: 'Menlo, Consolas, monospace',
        fontSize: 12,
        lineHeight: '18px',
        maxHeight: 400,
        overflow: 'auto',
        background: token.colorBgLayout,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 4,
        whiteSpace: 'pre',
      }}
    >
      {lines.map((line, i) => {
        let color: string | undefined;
        if (line.startsWith('+') && !line.startsWith('+++')) color = '#22c55e';
        else if (line.startsWith('-') && !line.startsWith('---')) color = '#ef4444';
        else if (line.startsWith('@@')) color = '#0ea5e9';
        else if (line.startsWith('diff --git') || line.startsWith('index ')) color = token.colorTextSecondary;
        return (
          <div key={i} style={{ color }}>
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}

/**
 * A card's isolated git worktree, when the dispatcher ran it that way.
 *
 * A card only gets one when it carried the `worktree` label at dispatch time
 * and its board has a `workspace_dir` — both preconditions the caller
 * resolves and passes down (`repo`). Neither missing precondition is this
 * component's business to explain beyond a one-line nudge; the daemon is the
 * source of truth for whether a worktree actually exists.
 */
export const WorktreePanel: React.FC<WorktreePanelProps> = ({ cardId, repo, cardTitle }) => {
  const { token } = theme.useToken();
  const [loading, setLoading] = useState(true);
  const [worktree, setWorktree] = useState<WorktreeInfo | null>(null);
  const [diff, setDiff] = useState<WorktreeDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [busy, setBusy] = useState<'merge' | 'rebase' | 'pr' | 'discard' | null>(null);
  const [prOpen, setPrOpen] = useState(false);
  const [prForm] = Form.useForm();

  const fetchDiff = useCallback(async (path: string) => {
    setDiffLoading(true);
    try {
      const j = await api<{ worktree: WorktreeInfo; diff: WorktreeDiff }>(
        `/api/worktrees/diff?path=${encodeURIComponent(path)}`,
      );
      setDiff(j.diff);
    } catch (e: any) {
      message.error(e.message || 'Failed to load diff');
      setDiff(null);
    } finally {
      setDiffLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    if (!repo) {
      setWorktree(null);
      setDiff(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const j = await api<{ items: WorktreeInfo[] }>(
        `/api/worktrees?repo=${encodeURIComponent(repo)}&owner=${encodeURIComponent(`kanban:${cardId}`)}`,
      );
      const found = (j.items || [])[0] ?? null;
      setWorktree(found);
      if (found) {
        await fetchDiff(found.path);
      } else {
        setDiff(null);
      }
    } catch (e: any) {
      // A card with no worktree is the common case, not a failure worth a
      // toast — only report it when the fetch itself broke.
      setWorktree(null);
      setDiff(null);
    } finally {
      setLoading(false);
    }
  }, [repo, cardId, fetchDiff]);

  useEffect(() => { load(); }, [load]);

  const runAction = async (
    kind: 'merge' | 'rebase' | 'discard',
    path: string,
    endpoint: string,
    body: Record<string, unknown>,
    successMsg: string,
  ) => {
    setBusy(kind);
    try {
      await api(`/api/worktrees/${endpoint}`, { method: 'POST', body: JSON.stringify(body) });
      message.success(successMsg);
      if (kind === 'discard') {
        setWorktree(null);
        setDiff(null);
      } else {
        await load();
      }
    } catch (e: any) {
      message.error(e.message || 'Request failed');
    } finally {
      setBusy(null);
    }
  };

  const handlePrSubmit = async () => {
    if (!worktree) return;
    try {
      const vals = await prForm.validateFields();
      setBusy('pr');
      const j = await api<{ ok: boolean; url: string }>('/api/worktrees/pr', {
        method: 'POST',
        body: JSON.stringify({ path: worktree.path, title: vals.title, body: vals.body || '' }),
      });
      setPrOpen(false);
      message.success(
        <span>
          PR created:{' '}
          <a href={j.url} target="_blank" rel="noreferrer">{j.url}</a>
        </span>,
      );
    } catch (e: any) {
      if (e?.errorFields) return; // antd form validation error, already shown inline
      message.error(e.message || 'Failed to create PR');
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="mb-4">
        <Spin size="small" />
      </div>
    );
  }

  if (!worktree) {
    if (!repo) return null;
    return (
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 16 }}>
        Add the <Tag style={{ margin: '0 2px' }}>worktree</Tag> label to run this card in an isolated branch.
      </Text>
    );
  }

  return (
    <Card
      size="small"
      className="mb-4"
      title={
        <Space size={6}>
          <BranchesOutlined />
          <Text strong style={{ fontSize: 13, fontFamily: 'monospace' }}>{worktree.branch}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>→ {worktree.base}</Text>
          {diff?.dirty && <Tag color="orange">dirty</Tag>}
        </Space>
      }
      extra={<Button size="small" icon={<ReloadOutlined />} loading={diffLoading} onClick={load} />}
      style={{ marginBottom: 16 }}
    >
      {diffLoading && !diff ? (
        <Spin size="small" />
      ) : diff ? (
        <>
          <Paragraph
            style={{
              fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap',
              marginBottom: 8, color: token.colorTextSecondary,
            }}
          >
            {diff.stat || 'No changes yet.'}
          </Paragraph>

          {diff.files.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {diff.files.map((f, i) => (
                <Tag key={i} style={{ margin: 0, fontSize: 11, fontFamily: 'monospace' }}>{f}</Tag>
              ))}
            </div>
          )}

          {diff.diff ? (
            <Collapse
              size="small"
              items={[
                {
                  key: 'diff',
                  label: `Diff (${diff.commits} commit${diff.commits === 1 ? '' : 's'}${diff.truncated ? ', truncated' : ''})`,
                  children: <DiffView diff={diff.diff} />,
                },
              ]}
              style={{ marginBottom: 12 }}
            />
          ) : (
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
              No diff against base yet.
            </Text>
          )}

          <Space wrap size={8}>
            <Popconfirm
              title={`Merge ${worktree.branch} into the checked-out branch of ${worktree.repo}?`}
              description="Refused if your checkout has uncommitted changes."
              onConfirm={() => runAction('merge', worktree.path, 'merge', { path: worktree.path }, 'Merged')}
            >
              <Button size="small" icon={<BranchesOutlined />} loading={busy === 'merge'}>
                Merge
              </Button>
            </Popconfirm>
            <Button
              size="small"
              icon={<SyncOutlined />}
              loading={busy === 'rebase'}
              onClick={() => runAction('rebase', worktree.path, 'rebase', { path: worktree.path }, 'Rebased')}
            >
              Rebase
            </Button>
            <Button
              size="small"
              icon={<GithubOutlined />}
              onClick={() => {
                prForm.setFieldsValue({ title: cardTitle || worktree.branch, body: '' });
                setPrOpen(true);
              }}
            >
              Create PR
            </Button>
            <Popconfirm
              title="Discard this worktree?"
              description="Removes the worktree and deletes the branch. This cannot be undone."
              onConfirm={() => runAction(
                'discard', worktree.path, 'remove',
                { path: worktree.path, delete_branch: true }, 'Worktree discarded',
              )}
            >
              <Button size="small" icon={<DeleteOutlined />} danger loading={busy === 'discard'}>
                Discard
              </Button>
            </Popconfirm>
          </Space>
        </>
      ) : (
        <Alert type="warning" showIcon message="Could not load the diff for this worktree." />
      )}

      <Modal
        title="Create pull request"
        open={prOpen}
        onCancel={() => setPrOpen(false)}
        onOk={handlePrSubmit}
        confirmLoading={busy === 'pr'}
        destroyOnClose
      >
        <Form form={prForm} layout="vertical" preserve={false}>
          <Form.Item name="title" label="Title" rules={[{ required: true, message: 'Title is required' }]}>
            <Input placeholder="PR title" />
          </Form.Item>
          <Form.Item name="body" label="Description">
            <TextArea rows={4} placeholder="Optional" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};
