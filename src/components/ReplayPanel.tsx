import { useCallback, useEffect, useState } from 'react';
import { Button, Empty, List, Select, Space, Spin, Switch, Tag, Tooltip, Typography, message, theme } from 'antd';
import { LeftOutlined, PlayCircleOutlined, ReloadOutlined, RightOutlined } from '@ant-design/icons';

const { Text, Paragraph } = Typography;

interface TurnSummary {
  turnId: string;
  startedAt: number | null;
  lines: number;
  toolCalls: number;
  firstUserLine: string;
  bytes: number;
}

interface TrajLine {
  role: 'user' | 'assistant' | 'tool' | 'meta';
  content?: string;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
  title?: string;
  summary?: string;
  ok?: boolean;
  kind?: string;
  model?: string;
  reasoning?: string;
  truncated?: boolean;
  ts?: number;
}

interface Props {
  jid: string;
}

function roleColor(role: string): string {
  if (role === 'user') return 'blue';
  if (role === 'assistant') return 'green';
  if (role === 'tool') return 'gold';
  return 'default';
}

/**
 * Step-by-step replay of a recorded turn (`/api/chats/:jid/trajectory*`):
 * user → assistant (+ tool calls) → tool results → … Recording is off by
 * default and switched on per chat here.
 */
export function ReplayPanel({ jid }: Props) {
  const { token } = theme.useToken();
  const [enabled, setEnabled] = useState(false);
  const [turns, setTurns] = useState<TurnSummary[]>([]);
  const [turnId, setTurnId] = useState<string | null>(null);
  const [lines, setLines] = useState<TrajLine[] | null>(null);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);

  const base = `/api/chats/${encodeURIComponent(jid)}/trajectory`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(base);
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setEnabled(j.enabled === true);
      setTurns(j.turns ?? []);
      if (!turnId && j.turns?.length) setTurnId(j.turns[0].turnId);
    } catch (e) {
      message.error(`Trajectory: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [base, turnId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!turnId) { setLines(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${base}/${encodeURIComponent(turnId)}`);
        if (!r.ok) throw new Error(await r.text());
        const j = await r.json();
        if (!cancelled) { setLines(j.messages ?? []); setStep(0); }
      } catch (e) {
        if (!cancelled) message.error(`Turn: ${(e as Error).message}`);
      }
    })();
    return () => { cancelled = true; };
  }, [base, turnId]);

  const toggle = async (on: boolean) => {
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

  const visible = lines ? lines.slice(0, step + 1) : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Space style={{ justifyContent: 'space-between', width: '100%' }}>
        <Space size={6}>
          <PlayCircleOutlined />
          <Text strong>Replay</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{turns.length} recorded turn{turns.length === 1 ? '' : 's'}</Text>
        </Space>
        <Space size={8}>
          <Tooltip title="Record every turn of this chat as a trajectory (agentevals JSONL)">
            <Switch size="small" checked={enabled} onChange={(v) => void toggle(v)} />
          </Tooltip>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()} loading={loading} />
        </Space>
      </Space>

      {turns.length === 0 && !loading && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No recorded turns. Switch recording on, then send a message."
        />
      )}

      {turns.length > 0 && (
        <Select
          size="small"
          value={turnId ?? undefined}
          onChange={(v) => setTurnId(v)}
          options={turns.map(t => ({
            value: t.turnId,
            label: `${t.startedAt ? new Date(t.startedAt).toLocaleString() : t.turnId} · ${t.toolCalls} tool call${t.toolCalls === 1 ? '' : 's'} · ${t.firstUserLine || '(no text)'}`,
          }))}
        />
      )}

      {lines && lines.length > 0 && (
        <>
          <Space size={6}>
            <Button size="small" icon={<LeftOutlined />} disabled={step === 0} onClick={() => setStep(s => Math.max(0, s - 1))} />
            <Text style={{ fontSize: 12 }}>step {step + 1} / {lines.length}</Text>
            <Button size="small" icon={<RightOutlined />} disabled={step >= lines.length - 1} onClick={() => setStep(s => Math.min(lines.length - 1, s + 1))} />
            <Button size="small" onClick={() => setStep(lines.length - 1)}>All</Button>
          </Space>
          <List
            size="small"
            dataSource={visible}
            renderItem={(l, i) => (
              <List.Item key={i} style={{ display: 'block', padding: '6px 0', borderBottomColor: token.colorBorderSecondary, opacity: i === step ? 1 : 0.8 }}>
                <Space size={6} wrap>
                  <Tag color={roleColor(l.role)} style={{ margin: 0 }}>{l.role}{l.kind ? ` · ${l.kind}` : ''}</Tag>
                  {l.name && <Text code style={{ fontSize: 11 }}>{l.name}</Text>}
                  {l.title && <Text type="secondary" style={{ fontSize: 11 }}>{l.title}</Text>}
                  {l.ok === false && <Tag color="error" style={{ margin: 0 }}>error</Tag>}
                  {l.truncated && <Tag style={{ margin: 0 }}>truncated</Tag>}
                  {l.model && <Text type="secondary" style={{ fontSize: 11 }}>{l.model}</Text>}
                </Space>
                {l.reasoning && (
                  <Paragraph type="secondary" style={{ fontSize: 11, whiteSpace: 'pre-wrap', marginBottom: 4 }} ellipsis={{ rows: 4, expandable: true }}>
                    {l.reasoning}
                  </Paragraph>
                )}
                {l.content && (
                  <Paragraph style={{ fontSize: 12, whiteSpace: 'pre-wrap', marginBottom: 4 }} ellipsis={{ rows: 8, expandable: true }}>
                    {l.content}
                  </Paragraph>
                )}
                {l.tool_calls?.map(tc => (
                  <div key={tc.id} style={{ fontSize: 11, fontFamily: 'monospace', background: token.colorFillQuaternary, borderRadius: 4, padding: '2px 6px', marginTop: 2 }}>
                    {tc.function.name}({tc.function.arguments.length > 200 ? tc.function.arguments.slice(0, 200) + '…' : tc.function.arguments})
                  </div>
                ))}
              </List.Item>
            )}
          />
        </>
      )}
      {turnId && lines === null && <Spin size="small" />}
    </div>
  );
}
