import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button, Drawer, Empty, Form, Input, InputNumber, Layout, Modal, Select, Space, Spin,
  Switch, Table, Tag, Tooltip, Typography, message, theme,
} from 'antd';
import {
  CaretRightOutlined, DeleteOutlined, EditOutlined, PauseOutlined, PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';

import { AppLayout } from '../components/AppLayout';
import { useLang } from '../i18n';

const { Content } = Layout;
const { Title, Text, Paragraph } = Typography;

/**
 * Background tasks: autonomous work that runs on a schedule with **no chat
 * session**, which is what separates it from Settings → Schedules. Both
 * Flutter clients have had this screen; the web had no way to see, let alone
 * pause, a task running on the user's own machine.
 */

interface BackgroundTask {
  id: string;
  title: string;
  description?: string | null;
  prompt?: string | null;
  trigger_type: string;
  trigger_value?: string | null;
  next_run?: string | null;
  last_run?: string | null;
  status: string;
  consecutive_failures: number;
  max_failures: number;
  notify: boolean;
  owner_kind: string;
  owner_id: string;
}

interface BackgroundRun {
  id: string;
  task_id: string;
  status: string;
  started_at: string;
  finished_at?: string | null;
  duration_ms?: number | null;
  result?: string | null;
  error?: string | null;
}

const TASK_STATUS_COLOR: Record<string, string> = {
  active: 'green',
  paused: 'default',
  completed: 'blue',
  failed: 'red',
  cancelled: 'default',
};

const RUN_STATUS_COLOR: Record<string, string> = {
  running: 'processing',
  success: 'green',
  error: 'red',
  timeout: 'orange',
  cancelled: 'default',
  skipped: 'default',
};

const TRIGGERS = ['cron', 'interval', 'once', 'manual'] as const;

// Statuses reach `t()` through a variable, so they are declared for the
// coverage check rather than left to look like orphaned translations.
// i18n-dynamic: active, paused, completed, failed, cancelled, running, success, error, timeout, skipped

function fmtTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function fmtDuration(ms?: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!r.ok) {
    // The daemon answers a rejected request with a readable reason; showing
    // "request failed" instead would throw that away.
    const body = await r.text().catch(() => '');
    throw new Error(body || `HTTP ${r.status}`);
  }
  return (await r.json()) as T;
}

export function BackgroundPage() {
  const { token } = theme.useToken();
  const { t } = useLang();

  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<BackgroundTask | null>(null);
  const [runs, setRuns] = useState<BackgroundRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [editing, setEditing] = useState<BackgroundTask | 'new' | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // `include_internal` stays off: tasks an app created for itself are
      // noise in a list meant for tasks a person set up.
      const body = await api<{ tasks: BackgroundTask[] }>('/api/background/tasks?limit=200');
      setTasks(body.tasks ?? []);
    } catch (e) {
      message.error(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openRuns = useCallback(async (task: BackgroundTask) => {
    setSelected(task);
    setRunsLoading(true);
    try {
      const body = await api<{ runs: BackgroundRun[] }>(
        `/api/background/tasks/${encodeURIComponent(task.id)}/runs?limit=50`,
      );
      setRuns(body.runs ?? []);
    } catch (e) {
      message.error(String(e instanceof Error ? e.message : e));
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }, []);

  const setStatus = async (task: BackgroundTask, status: 'active' | 'paused') => {
    try {
      await api(`/api/background/tasks/${encodeURIComponent(task.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (e) {
      message.error(String(e instanceof Error ? e.message : e));
    }
  };

  const runNow = async (task: BackgroundTask) => {
    try {
      await api(`/api/background/tasks/${encodeURIComponent(task.id)}/run-now`, { method: 'POST' });
      message.success(t('Started'));
      // A run takes time; refresh the list so `last_run` catches up shortly.
      window.setTimeout(() => void load(), 1500);
    } catch (e) {
      message.error(String(e instanceof Error ? e.message : e));
    }
  };

  const remove = (task: BackgroundTask) => {
    Modal.confirm({
      title: t('Delete this task?'),
      content: task.title,
      okButtonProps: { danger: true },
      onOk: async () => {
        await api(`/api/background/tasks/${encodeURIComponent(task.id)}`, { method: 'DELETE' });
        if (selected?.id === task.id) setSelected(null);
        await load();
      },
    });
  };

  const openEditor = (task: BackgroundTask | 'new') => {
    setEditing(task);
    form.setFieldsValue(
      task === 'new'
        ? { trigger_type: 'cron', notify: false, catch_up: false }
        : {
            title: task.title,
            description: task.description ?? undefined,
            prompt: task.prompt ?? undefined,
            trigger_type: task.trigger_type,
            trigger_value: task.trigger_value ?? undefined,
            max_failures: task.max_failures,
            notify: task.notify,
          },
    );
  };

  const submit = async () => {
    const values = await form.validateFields();
    try {
      if (editing === 'new') {
        await api('/api/background/tasks', { method: 'POST', body: JSON.stringify(values) });
      } else if (editing) {
        await api(`/api/background/tasks/${encodeURIComponent(editing.id)}`, {
          method: 'PATCH',
          body: JSON.stringify(values),
        });
      }
      setEditing(null);
      await load();
    } catch (e) {
      message.error(String(e instanceof Error ? e.message : e));
    }
  };

  const columns = useMemo(
    () => [
      {
        title: t('Task'),
        dataIndex: 'title',
        render: (_: unknown, task: BackgroundTask) => (
          <div>
            <Text strong>{task.title}</Text>
            {task.notify && (
              <Tag style={{ marginLeft: 8 }}>{t('Notification only')}</Tag>
            )}
            {task.description && (
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>{task.description}</Text>
              </div>
            )}
          </div>
        ),
      },
      {
        title: t('Trigger'),
        dataIndex: 'trigger_type',
        width: 190,
        render: (_: unknown, task: BackgroundTask) => (
          <Text style={{ fontSize: 12 }} code>
            {task.trigger_type}
            {task.trigger_value ? ` ${task.trigger_value}` : ''}
          </Text>
        ),
      },
      {
        title: t('Status'),
        dataIndex: 'status',
        width: 150,
        render: (_: unknown, task: BackgroundTask) => (
          <Space size={4}>
            <Tag color={TASK_STATUS_COLOR[task.status] ?? 'default'}>{t(task.status)}</Tag>
            {/* Nobody is watching a background task, so it pauses itself after
                repeated failures. Showing the streak is how a person finds out. */}
            {task.consecutive_failures > 0 && (
              <Tooltip title={t('Consecutive failures')}>
                <Tag color="red">{task.consecutive_failures}</Tag>
              </Tooltip>
            )}
          </Space>
        ),
      },
      {
        title: t('Next run'),
        dataIndex: 'next_run',
        width: 190,
        render: (v: string | null) => <Text style={{ fontSize: 12 }}>{fmtTime(v)}</Text>,
      },
      {
        title: t('Last run'),
        dataIndex: 'last_run',
        width: 190,
        render: (v: string | null) => <Text style={{ fontSize: 12 }}>{fmtTime(v)}</Text>,
      },
      {
        title: '',
        width: 170,
        render: (_: unknown, task: BackgroundTask) => (
          <Space size={2}>
            <Tooltip title={t('Run now')}>
              <Button size="small" type="text" icon={<CaretRightOutlined />} onClick={() => runNow(task)} />
            </Tooltip>
            <Tooltip title={task.status === 'paused' ? t('Resume') : t('Pause')}>
              <Button
                size="small"
                type="text"
                icon={task.status === 'paused' ? <CaretRightOutlined /> : <PauseOutlined />}
                onClick={() => setStatus(task, task.status === 'paused' ? 'active' : 'paused')}
              />
            </Tooltip>
            <Tooltip title={t('Edit')}>
              <Button size="small" type="text" icon={<EditOutlined />} onClick={() => openEditor(task)} />
            </Tooltip>
            <Tooltip title={t('Delete')}>
              <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(task)} />
            </Tooltip>
          </Space>
        ),
      },
    ],
    [t],
  );

  return (
    <AppLayout sidebar={null}>
      <Layout style={{ background: 'transparent', height: '100%', padding: 24, overflowY: 'auto' }}>
        <Content style={{ maxWidth: 1280, margin: '0 auto', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20 }}>
            <div style={{ flex: 1 }}>
              <Title level={2} style={{ margin: 0 }}>{t('Background tasks')}</Title>
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                {t('Work that runs on its own schedule with no chat session. Nothing replies to you here — a task reports through its run history, or an OS notification.')}
              </Paragraph>
            </div>
            <Space>
              <Button icon={<ReloadOutlined />} onClick={() => void load()}>{t('Reload')}</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor('new')}>
                {t('New task')}
              </Button>
            </Space>
          </div>

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
              <Spin size="large" />
            </div>
          ) : tasks.length === 0 ? (
            <Empty description={t('No background tasks yet')} />
          ) : (
            <Table<BackgroundTask>
              rowKey="id"
              dataSource={tasks}
              columns={columns}
              size="small"
              pagination={false}
              onRow={task => ({ onClick: () => void openRuns(task) })}
              style={{ background: token.colorBgContainer, borderRadius: 12 }}
            />
          )}
        </Content>
      </Layout>

      <Drawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        width={560}
        title={selected?.title ?? ''}
      >
        {runsLoading ? (
          <Spin />
        ) : runs.length === 0 ? (
          <Empty description={t('This task has not run yet')} />
        ) : (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {runs.map(run => (
              <div
                key={run.id}
                style={{
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <Space size={8} style={{ marginBottom: 6 }}>
                  <Tag color={RUN_STATUS_COLOR[run.status] ?? 'default'}>{t(run.status)}</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>{fmtTime(run.started_at)}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{fmtDuration(run.duration_ms)}</Text>
                </Space>
                {run.error && (
                  <Paragraph type="danger" style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
                    {run.error}
                  </Paragraph>
                )}
                {run.result && (
                  <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{run.result}</Paragraph>
                )}
              </div>
            ))}
          </Space>
        )}
      </Drawer>

      <Modal
        open={editing !== null}
        onCancel={() => setEditing(null)}
        onOk={() => void submit()}
        title={editing === 'new' ? t('New task') : t('Edit task')}
        okText={t('Save')}
        cancelText={t('Cancel')}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="title"
            label={t('Title')}
            rules={[{ required: true, message: t('Title is required') }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="description" label={t('Description')}>
            <Input />
          </Form.Item>
          <Form.Item
            name="prompt"
            label={t('Prompt')}
            rules={[{ required: editing === 'new', message: t('Prompt is required') }]}
          >
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="trigger_type" label={t('Trigger')}>
            <Select options={TRIGGERS.map(v => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(a, b) => a.trigger_type !== b.trigger_type}
          >
            {({ getFieldValue }) =>
              getFieldValue('trigger_type') === 'manual' ? null : (
                <Form.Item
                  name="trigger_value"
                  label={t('Trigger value')}
                  // Every trigger but `manual` needs one, and the daemon
                  // refuses without it — better to say so here than to submit.
                  rules={[{ required: true, message: t('This trigger needs a value') }]}
                  extra={t('cron: "0 7 * * *" · interval: milliseconds · once: an RFC3339 timestamp')}
                >
                  <Input />
                </Form.Item>
              )
            }
          </Form.Item>
          <Form.Item
            name="max_failures"
            label={t('Pause after this many failures in a row')}
            extra={t('0 never pauses. A task nobody is watching should stop itself.')}
          >
            <InputNumber min={0} max={100} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="notify"
            label={t('Notification only')}
            valuePropName="checked"
            extra={t('Push the title and prompt as an OS notification instead of running an agent.')}
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </AppLayout>
  );
}
