import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons';
import { useLang } from '../../i18n';
import {
  claudeCodeApi,
  type ClaudeCodeRun,
  type ClaudeCodeSettings as Settings,
  type ClaudeCodeStatus,
} from '../../lib/coworkApi';

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

const PHASE_COLOR: Record<ClaudeCodeRun['phase'], string> = {
  running: 'processing',
  verifying: 'processing',
  reviewing: 'processing',
  done: 'success',
  blocked: 'warning',
  failed: 'error',
};

const MODES: Settings['permissionMode'][] = ['acceptEdits', 'default', 'plan', 'auto', 'dontAsk', 'bypassPermissions'];

/** Empty text field → null, so an unset optional stays unset in config.json. */
const orNull = (v: string) => (v.trim() === '' ? null : v.trim());

/**
 * Settings → Claude Code: kanban cards assigned to `claude-code` run in the
 * user's own Claude Code CLI, and SenClaw verifies the result before closing
 * the card. Also shows how to connect Claude Code to SenClaw's MCP bridge.
 */
export const ClaudeCodeSettings: React.FC = () => {
  const { t } = useLang();
  const [status, setStatus] = useState<ClaudeCodeStatus | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [runs, setRuns] = useState<ClaudeCodeRun[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [st, s] = await Promise.all([claudeCodeApi.status(), claudeCodeApi.getSettings()]);
      setStatus(st);
      setDraft(s);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      setRuns((await claudeCodeApi.runs()).runs);
    } catch {
      // A daemon without this endpoint already failed `load`; nothing more to say.
    }
  }, []);

  useEffect(() => {
    load();
    loadRuns();
    const id = window.setInterval(loadRuns, 5000);
    return () => window.clearInterval(id);
  }, [load, loadRuns]);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      setDraft(await claudeCodeApi.putSettings(draft));
      message.success(t('Saved'));
    } catch (e) {
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return <Alert type="error" showIcon message={t('Could not load Claude Code settings')} description={loadError} />;
  }
  if (!status || !draft) {
    return <Spin />;
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title={t('Claude Code')}
        extra={
          <Button icon={<ReloadOutlined />} onClick={load}>
            {t('Refresh')}
          </Button>
        }
      >
        {status.installed ? (
          <Alert
            type="success"
            showIcon
            message={`${t('Found')} ${status.binary} — ${status.version ?? ''}`}
            description={t('Assign a kanban card to "claude-code" and move it to Ready: Claude Code does the work, SenClaw verifies it before the card is closed.')}
          />
        ) : (
          <Alert
            type="warning"
            showIcon
            message={t('Claude Code is not installed or cannot run')}
            description={t('Install Claude Code and sign in by running `claude` once, or set the binary path below.')}
          />
        )}
        <Alert
          style={{ marginTop: 12 }}
          type="info"
          showIcon
          message={t('Trust boundary')}
          description={t('The worker runs as you, with the tools allowed below (Bash by default). Its git worktree protects your checkout, not the machine. Only cards you trust should reach Ready.')}
        />
      </Card>

      <Card title={t('Connect Claude Code to SenClaw (MCP)')}>
        <Paragraph type="secondary">
          {t('Run once in a terminal. SENCLAW_TOKEN is the daemon API token from')} <Text code>{status.mcp.tokenFile}</Text>.
        </Paragraph>
        {status.mcp.addCommands.map((c) => (
          <Paragraph key={c} copyable={{ text: c }} code style={{ wordBreak: 'break-all' }}>
            {c}
          </Paragraph>
        ))}
      </Card>

      <Card
        title={t('Worker settings')}
        extra={
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
            {t('Save')}
          </Button>
        }
      >
        <Field label={t('Verify command')} help={t('Must exit 0 before a card may close, e.g. cargo test or npm test. Never read from card text. Without it, and without a worktree diff to review, a finished card waits for a person.')}>
          <Input
            value={draft.verifyCommand ?? ''}
            placeholder="cargo test"
            onChange={(e) => set('verifyCommand', orNull(e.target.value))}
          />
        </Field>
        <Field label={t('Permission mode')}>
          <Select
            style={{ width: 240 }}
            value={draft.permissionMode}
            options={MODES.map((m) => ({ value: m, label: m }))}
            onChange={(v) => set('permissionMode', v)}
          />
        </Field>
        <Field label={t('Allowed tools')} help={t('SenClaw MCP servers are added automatically.')}>
          <Select
            mode="tags"
            style={{ width: '100%' }}
            value={draft.allowedTools}
            onChange={(v) => set('allowedTools', v)}
          />
        </Field>
        <Space wrap size={24}>
          <Field label={t('Max turns')}>
            <InputNumber min={1} value={draft.maxTurns} onChange={(v) => set('maxTurns', v ?? 1)} />
          </Field>
          <Field label={t('Fix rounds')}>
            <InputNumber min={0} max={10} value={draft.maxFixRounds} onChange={(v) => set('maxFixRounds', v ?? 0)} />
          </Field>
          <Field label={t('Stop-hook retries')}>
            <InputNumber min={0} max={10} value={draft.maxStopBlocks} onChange={(v) => set('maxStopBlocks', v ?? 0)} />
          </Field>
          <Field label={t('Verify timeout (s)')}>
            <InputNumber min={1} value={draft.verifyTimeoutSecs} onChange={(v) => set('verifyTimeoutSecs', v ?? 900)} />
          </Field>
          <Field label={t('Budget per session (USD)')}>
            <InputNumber min={0} step={0.5} value={draft.maxBudgetUsd ?? undefined} onChange={(v) => set('maxBudgetUsd', v ?? null)} />
          </Field>
        </Space>
        <Field label={t('Review the diff before closing')}>
          <Switch checked={draft.review} onChange={(v) => set('review', v)} />
        </Field>
        <Space wrap size={24}>
          <Field label={t('Model')} help={t('Empty = your Claude Code default.')}>
            <Input style={{ width: 220 }} value={draft.model ?? ''} onChange={(e) => set('model', orNull(e.target.value))} />
          </Field>
          <Field label={t('Binary')}>
            <Input style={{ width: 220 }} value={draft.binary} onChange={(e) => set('binary', e.target.value)} />
          </Field>
          <Field label={t('Chat for SenClaw tools')} help={t('Chat id (jid) whose schedule, memory and calendar tools Claude Code uses. Empty = the first chat.')}>
            <Input style={{ width: 220 }} value={draft.mcpChatJid ?? ''} onChange={(e) => set('mcpChatJid', orNull(e.target.value))} />
          </Field>
        </Space>
      </Card>

      <Card title={t('Runs')}>
        {runs.length === 0 ? (
          <Empty description={t('No Claude Code runs yet')} />
        ) : (
          <Table<ClaudeCodeRun>
            size="small"
            rowKey="runId"
            dataSource={runs}
            scroll={{ x: 'max-content' }}
            pagination={{ pageSize: 10 }}
            columns={[
              { title: t('Card'), dataIndex: 'itemId', render: (v: string) => `#${v}` },
              {
                title: t('Phase'),
                dataIndex: 'phase',
                render: (p: ClaudeCodeRun['phase']) => <Tag color={PHASE_COLOR[p]}>{p}</Tag>,
              },
              { title: t('Fix round'), dataIndex: 'fixRound' },
              { title: t('Activity'), dataIndex: 'lastActivity', ellipsis: true },
              { title: t('Cost'), dataIndex: 'costUsd', render: (c: number) => `$${c.toFixed(2)}` },
              { title: t('Started'), dataIndex: 'startedAt', render: (s: string) => new Date(s).toLocaleString() },
            ]}
          />
        )}
      </Card>
    </Space>
  );
};
