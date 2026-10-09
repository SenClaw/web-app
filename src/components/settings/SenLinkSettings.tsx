import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { DeleteOutlined, LinkOutlined, ReloadOutlined, SaveOutlined, SendOutlined } from '@ant-design/icons';
import { useLang } from '../../i18n';
import { senLinkApi, taskStateLabel, type A2ATask, type SenLinkPeer, type SenLinkSettings as Settings } from '../../lib/coworkApi';

const { Text, Paragraph } = Typography;

const Field: React.FC<{ label: string; help?: string; children: React.ReactNode }> = ({ label, help, children }) => (
  <div style={{ marginBottom: 16 }}>
    <Text strong style={{ display: 'block', marginBottom: 6 }}>
      {label}
    </Text>
    {children}
    {help && (
      <Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
        {help}
      </Text>
    )}
  </div>
);

const STATE_COLOR: Record<string, string> = {
  TASK_STATE_SUBMITTED: 'default',
  TASK_STATE_WORKING: 'processing',
  TASK_STATE_INPUT_REQUIRED: 'warning',
  TASK_STATE_COMPLETED: 'success',
  TASK_STATE_FAILED: 'error',
  TASK_STATE_CANCELED: 'default',
};

const orNull = (v: string) => (v.trim() === '' ? null : v.trim());
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Tasks this daemon sent to one peer, read back from the peer over A2A. */
const PeerTasks: React.FC<{ peer: SenLinkPeer }> = ({ peer }) => {
  const { t } = useLang();
  const [tasks, setTasks] = useState<A2ATask[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTasks((await senLinkApi.tasks(peer.id)).tasks);
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, [peer.id]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <Alert type="warning" showIcon message={t('Could not reach this peer')} description={error} />;
  if (!tasks) return <Spin />;
  if (tasks.length === 0) return <Empty description={t('No tasks sent to this peer yet')} />;
  return (
    <Table<A2ATask>
      size="small"
      rowKey="id"
      dataSource={tasks}
      scroll={{ x: 'max-content' }}
      pagination={false}
      expandable={{
        rowExpandable: (r) => r.artifacts.length > 0,
        expandedRowRender: (r) =>
          r.artifacts.map((a) => (
            <Paragraph key={a.artifactId} style={{ whiteSpace: 'pre-wrap', marginBottom: 8 }}>
              <Text strong>{a.name}: </Text>
              {a.parts.map((p) => p.text ?? '').join('\n')}
            </Paragraph>
          )),
      }}
      columns={[
        { title: '#', dataIndex: 'id', width: 60 },
        { title: t('Task'), render: (_, r) => r.metadata?.title ?? '' },
        {
          title: t('State'),
          render: (_, r) => <Tag color={STATE_COLOR[r.status.state] ?? 'default'}>{taskStateLabel(r.status.state)}</Tag>,
        },
        {
          title: '',
          width: 90,
          render: (_, r) =>
            ['TASK_STATE_SUBMITTED', 'TASK_STATE_INPUT_REQUIRED'].includes(r.status.state) ? (
              <Button
                size="small"
                onClick={async () => {
                  try {
                    await senLinkApi.cancel(peer.id, r.id);
                    load();
                  } catch (e) {
                    message.error(errText(e));
                  }
                }}
              >
                {t('Cancel')}
              </Button>
            ) : null,
        },
      ]}
    />
  );
};

/**
 * Settings → sen-link: peer this SenClaw with another one over A2A, delegate
 * tasks to it, and decide how much a peer's own tasks may do here.
 */
export const SenLinkSettings: React.FC = () => {
  const { t } = useLang();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [peers, setPeers] = useState<SenLinkPeer[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [invite, setInvite] = useState<{ code: string; expiresAt: number } | null>(null);
  const [pairUrl, setPairUrl] = useState('');
  const [pairCode, setPairCode] = useState('');
  const [pairing, setPairing] = useState(false);
  const [sendTo, setSendTo] = useState<SenLinkPeer | null>(null);
  const [sendText, setSendText] = useState('');
  const [sendWorktree, setSendWorktree] = useState(true);

  const load = useCallback(async () => {
    try {
      const [st, p] = await Promise.all([senLinkApi.status(), senLinkApi.peers()]);
      setDraft(st.settings);
      setPeers(p.peers);
      setLoadError(null);
    } catch (e) {
      setLoadError(errText(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      setDraft(await senLinkApi.putSettings(draft));
      message.success(t('Saved'));
    } catch (e) {
      message.error(errText(e));
    } finally {
      setSaving(false);
    }
  };

  const patchPeer = async (id: string, p: Parameters<typeof senLinkApi.patchPeer>[1]) => {
    try {
      const updated = await senLinkApi.patchPeer(id, p);
      setPeers((ps) => ps.map((x) => (x.id === id ? updated : x)));
    } catch (e) {
      message.error(errText(e));
    }
  };

  if (loadError) return <Alert type="error" showIcon message={t('Could not load sen-link')} description={loadError} />;
  if (!draft) return <Spin />;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title="sen-link"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={load}>
              {t('Refresh')}
            </Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
              {t('Save')}
            </Button>
          </Space>
        }
      >
        <Paragraph type="secondary">
          {t('Connect this SenClaw to another one (A2A protocol) to hand tasks back and forth. Tasks a peer sends land on a kanban board.')}
        </Paragraph>
        <Field label={t('Enabled')}>
          <Switch checked={draft.enabled} onChange={(v) => set('enabled', v)} />
        </Field>
        <Space wrap size={24}>
          <Field label={t('Name shown to peers')}>
            <Input style={{ width: 240 }} value={draft.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field
            label={t('Public URL')}
            help={t('How peers reach this daemon, e.g. a Tailscale address. The daemon must be bound beyond loopback (Settings → General → Network access).')}
          >
            <Input
              style={{ width: 320 }}
              placeholder="http://100.64.0.2:18788"
              value={draft.publicUrl ?? ''}
              onChange={(e) => set('publicUrl', orNull(e.target.value))}
            />
          </Field>
        </Space>
        <Field label={t('Description')}>
          <Input value={draft.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Space wrap size={24}>
          <Field label={t('Board for incoming tasks')}>
            <Input style={{ width: 200 }} value={draft.boardTitle} onChange={(e) => set('boardTitle', e.target.value)} />
          </Field>
          <Field label={t('Workspace folder')} help={t('Where workers for incoming tasks run.')}>
            <Input style={{ width: 280 }} value={draft.workspaceDir ?? ''} onChange={(e) => set('workspaceDir', orNull(e.target.value))} />
          </Field>
          <Field label={t('Default assignee')}>
            <Input
              style={{ width: 180 }}
              placeholder="claude-code"
              value={draft.defaultAssignee ?? ''}
              onChange={(e) => set('defaultAssignee', orNull(e.target.value))}
            />
          </Field>
        </Space>
      </Card>

      <Card title={t('Pair with another SenClaw')}>
        {!draft.enabled && <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('Enable sen-link and save first.')} />}
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space wrap>
            <Button
              disabled={!draft.enabled}
              onClick={async () => {
                try {
                  setInvite(await senLinkApi.invite());
                } catch (e) {
                  message.error(errText(e));
                }
              }}
            >
              {t('Create invite code')}
            </Button>
            {invite && (
              <Text>
                <Text code copyable style={{ fontSize: 18 }}>
                  {invite.code}
                </Text>{' '}
                <Text type="secondary">
                  {t('valid until')} {new Date(invite.expiresAt * 1000).toLocaleTimeString()} · {t('use it once on the other SenClaw')}
                </Text>
              </Text>
            )}
          </Space>
          <Space wrap>
            <Input
              style={{ width: 300 }}
              placeholder={t('Other SenClaw URL, e.g. http://100.64.0.3:18788')}
              value={pairUrl}
              onChange={(e) => setPairUrl(e.target.value)}
            />
            <Input style={{ width: 160 }} placeholder={t('Invite code')} value={pairCode} onChange={(e) => setPairCode(e.target.value)} />
            <Button
              type="primary"
              icon={<LinkOutlined />}
              loading={pairing}
              disabled={!draft.enabled || !pairUrl.trim() || !pairCode.trim()}
              onClick={async () => {
                setPairing(true);
                try {
                  const p = await senLinkApi.pair(pairUrl.trim(), pairCode.trim());
                  message.success(`${t('Paired with')} ${p.name}`);
                  setPairCode('');
                  load();
                } catch (e) {
                  message.error(errText(e));
                } finally {
                  setPairing(false);
                }
              }}
            >
              {t('Pair')}
            </Button>
          </Space>
        </Space>
      </Card>

      <Card title={t('Peers')}>
        {peers.length === 0 ? (
          <Empty description={t('No peers yet')} />
        ) : (
          <Table<SenLinkPeer>
            rowKey="id"
            dataSource={peers}
            scroll={{ x: 'max-content' }}
            pagination={false}
            expandable={{ expandedRowRender: (p) => <PeerTasks peer={p} />, rowExpandable: (p) => p.canSend }}
            columns={[
              { title: t('Name'), dataIndex: 'name' },
              { title: 'URL', dataIndex: 'url', render: (u: string | null) => u ?? <Text type="secondary">—</Text> },
              {
                title: t('Their tasks run'),
                render: (_, p) => (
                  <Popconfirm
                    disabled={p.autoRun}
                    title={t('Run this peer\'s tasks without review?')}
                    description={t('With assignee claude-code this gives the peer a shell on this machine.')}
                    onConfirm={() => patchPeer(p.id, { autoRun: true })}
                  >
                    <Switch
                      checked={p.autoRun}
                      checkedChildren={t('auto')}
                      unCheckedChildren={t('triage')}
                      onChange={(v) => {
                        if (!v) patchPeer(p.id, { autoRun: false });
                      }}
                    />
                  </Popconfirm>
                ),
              },
              {
                title: t('Assignee'),
                render: (_, p) => (
                  <Input
                    size="small"
                    style={{ width: 140 }}
                    defaultValue={p.assignee ?? ''}
                    placeholder={draft.defaultAssignee ?? t('default')}
                    onBlur={(e) => {
                      if ((e.target.value.trim() || null) !== p.assignee) patchPeer(p.id, { assignee: e.target.value.trim() });
                    }}
                  />
                ),
              },
              {
                title: '',
                render: (_, p) => (
                  <Space>
                    <Button size="small" icon={<SendOutlined />} disabled={!p.canSend} onClick={() => setSendTo(p)}>
                      {t('Send task')}
                    </Button>
                    <Popconfirm
                      title={t('Remove this peer?')}
                      onConfirm={async () => {
                        try {
                          await senLinkApi.removePeer(p.id);
                          load();
                        } catch (e) {
                          message.error(errText(e));
                        }
                      }}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Modal
        open={!!sendTo}
        title={`${t('Send a task to')} ${sendTo?.name ?? ''}`}
        okText={t('Send')}
        okButtonProps={{ disabled: !sendText.trim() }}
        onCancel={() => setSendTo(null)}
        onOk={async () => {
          if (!sendTo) return;
          try {
            const r = await senLinkApi.send(sendTo.id, sendText.trim(), { worktree: sendWorktree });
            message.success(`${t('Task')} #${r.task.id}: ${taskStateLabel(r.task.status.state)}`);
            setSendTo(null);
            setSendText('');
          } catch (e) {
            message.error(errText(e));
          }
        }}
      >
        <Input.TextArea rows={6} value={sendText} onChange={(e) => setSendText(e.target.value)} placeholder={t('What should the other SenClaw do?')} />
        <Checkbox style={{ marginTop: 8 }} checked={sendWorktree} onChange={(e) => setSendWorktree(e.target.checked)}>
          {t('Ask it to work on its own git branch (worktree)')}
        </Checkbox>
      </Modal>
    </Space>
  );
};
