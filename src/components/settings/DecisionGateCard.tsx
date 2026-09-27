import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { ExperimentOutlined, SafetyOutlined, SaveOutlined } from '@ant-design/icons';
import {
  api,
  decimal,
  post,
  put,
  type GateLogRow,
  type GateSettings,
  type GateVerdict,
  type GateView,
} from './decisionApi';

const { Text, Paragraph } = Typography;

const MODE_HELP: Record<GateSettings['mode'], string> = {
  off: 'Không hỏi bộ quyết định; mọi lệnh cần duyệt vẫn hiện thẻ hỏi như cũ.',
  shadow:
    'Hỏi bộ quyết định và ghi lại nó định làm gì, nhưng vẫn hiện thẻ hỏi — để so với câu trả lời của bạn trước khi tin nó.',
  on: 'Lệnh được chấm chắc chắn chỉ đọc / chạy test / sửa file (≥ ngưỡng) chạy luôn, một lần, không hỏi. Mọi lệnh khác vẫn hỏi.',
};

const HUMAN: Record<string, { label: string; color?: string }> = {
  agree: { label: 'người duyệt', color: 'green' },
  allow: { label: 'người duyệt + lưu', color: 'green' },
  refuse: { label: 'người từ chối', color: 'red' },
  other: { label: 'người trả lời khác' },
};

/** The verdict as a tag: approve, ask, risk list or engine error. */
export const VerdictTag: React.FC<{ outcome: string; stage: string; applied?: boolean }> = ({ outcome, stage, applied }) => {
  if (stage === 'risky') return <Tag color="volcano">danh sách nguy hiểm</Tag>;
  if (stage === 'error') return <Tag color="orange">lỗi → hỏi</Tag>;
  if (outcome === 'allow') return <Tag color="green">{applied ? 'đã cho chạy' : 'sẽ cho chạy'}</Tag>;
  return <Tag>hỏi người</Tag>;
};

const time = (ms: number) => new Date(ms).toLocaleString('vi-VN', { hour12: false });

const VerdictDetail: React.FC<{ v: GateVerdict }> = ({ v }) => (
  <Card size="small" style={{ marginTop: 12 }}>
    <Space wrap size={10}>
      <Text code>{v.command}</Text>
      <VerdictTag outcome={v.outcome} stage={v.stage} />
      {v.choice && <Tag color="blue">{v.choice}</Tag>}
      {v.checks.map((c) => (
        <Tooltip key={c.name} title={c.how}>
          <Text>
            {c.name} = <Text strong>{decimal.format(c.p)}</Text>
          </Text>
        </Tooltip>
      ))}
      {v.latencyMs != null && <Text type="secondary">{decimal.format(v.latencyMs)} ms</Text>}
      {v.model && <Text type="secondary">{v.model}</Text>}
    </Space>
    <Paragraph type="secondary" style={{ margin: '8px 0 0' }}>
      {v.reason}
    </Paragraph>
    {v.state != null && (
      <Collapse
        size="small"
        style={{ marginTop: 8 }}
        items={[
          {
            key: 'json',
            label: 'Yêu cầu và câu trả lời (JSON)',
            children: (
              <pre style={{ margin: 0, fontSize: 12, maxHeight: 320, overflow: 'auto' }}>
                {JSON.stringify({ state: v.state, questions: v.asked, answers: v.answers }, null, 2)}
              </pre>
            ),
          },
        ]}
      />
    )}
  </Card>
);

/** Settings → Decision: the tool-call gate. */
export const DecisionGateCard: React.FC = () => {
  const [view, setView] = useState<GateView | null>(null);
  const [draft, setDraft] = useState<GateSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [command, setCommand] = useState('bun test src/utils/date.test.ts');
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<GateVerdict | null>(null);
  const [samples, setSamples] = useState<GateVerdict[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const v = await api<GateView>('/api/decision/gate?limit=30');
      setView(v);
      setDraft((d) => d ?? v.gate);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!view || !draft) {
    return <Card title="Cổng tool call" loading={!error} style={{ marginBottom: 24 }}>{error}</Card>;
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(view.gate);
  const effective = draft.questions === 'auto' ? view.questionSet : draft.questions;

  const save = async () => {
    setSaving(true);
    try {
      const v = await put<GateView>('/api/decision/gate', draft);
      setView(v);
      setDraft(v.gate);
      message.success('Đã lưu cổng tool call');
    } catch (e: any) {
      message.error(e.message, 8);
    } finally {
      setSaving(false);
    }
  };

  const check = async (commands: string[]) => {
    setChecking(true);
    setError(null);
    try {
      const r = await post<{ verdicts: GateVerdict[] }>('/api/decision/gate/check', {
        commands,
        approveAt: draft.approveAt,
        questions: draft.questions,
      });
      return r.verdicts;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setChecking(false);
    }
  };

  const s = view.stats;
  const columns = [
    { title: 'Lúc', key: 'at', width: 150, render: (_: unknown, r: GateLogRow) => <Text type="secondary">{time(r.at)}</Text> },
    {
      title: 'Lệnh',
      key: 'command',
      render: (_: unknown, r: GateLogRow) => (
        <Tooltip title={r.reason}>
          <Text code style={{ wordBreak: 'break-all' }}>
            {r.command}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: 'Cổng',
      key: 'verdict',
      width: 150,
      render: (_: unknown, r: GateLogRow) => (
        <Space size={4} wrap>
          <VerdictTag outcome={r.outcome} stage={r.stage} applied={r.applied} />
          {r.p != null && <Text type="secondary">{decimal.format(r.p)}</Text>}
        </Space>
      ),
    },
    {
      title: 'Người',
      key: 'human',
      width: 150,
      render: (_: unknown, r: GateLogRow) =>
        r.human ? <Tag color={HUMAN[r.human]?.color}>{HUMAN[r.human]?.label ?? r.human}</Tag> : <Text type="secondary">—</Text>,
    },
  ];

  return (
    <Card
      title={
        <Space>
          <SafetyOutlined /> Cổng tool call — lệnh shell của agent
        </Space>
      }
      style={{ marginBottom: 24 }}
      extra={
        <Button type="primary" icon={<SaveOutlined />} disabled={!dirty} loading={saving} onClick={save}>
          Lưu
        </Button>
      }
    >
      <Paragraph type="secondary" style={{ marginTop: 0 }}>
        Trước khi agent xin bạn duyệt một lệnh Bash, bộ quyết định ở trên (Laya trên máy hoặc Jev online) được hỏi lệnh đó
        làm gì. Lệnh khớp <Text strong>danh sách nguy hiểm</Text> (sudo, rm -rf, git push, deploy, file bí mật, thay thế
        lệnh…) không bao giờ được gửi đi và luôn hỏi — danh sách, không phải ngưỡng, mới là ranh giới an toàn. Cổng chỉ có
        thể bỏ bớt một lần hỏi, không bao giờ tự từ chối; lỗi hay quá {view.timeoutSecs} s thì vẫn hỏi.
      </Paragraph>

      <Space wrap size={24} align="start" style={{ marginBottom: 12 }}>
        <div>
          <Text strong style={{ display: 'block', marginBottom: 4 }}>
            Chế độ
          </Text>
          <Radio.Group
            value={draft.mode}
            onChange={(e) => setDraft({ ...draft, mode: e.target.value })}
            optionType="button"
            buttonStyle="solid"
            options={[
              { value: 'off', label: 'Tắt' },
              { value: 'shadow', label: 'Chạy bóng' },
              { value: 'on', label: 'Bật' },
            ]}
          />
        </div>
        <div>
          <Text strong style={{ display: 'block', marginBottom: 4 }}>
            Ngưỡng cho chạy
          </Text>
          <InputNumber
            min={0.5}
            max={0.99}
            step={0.01}
            value={draft.approveAt}
            onChange={(v) => setDraft({ ...draft, approveAt: typeof v === 'number' ? v : 0.9 })}
            style={{ width: 110 }}
          />
        </div>
        <div>
          <Text strong style={{ display: 'block', marginBottom: 4 }}>
            Bộ câu hỏi
          </Text>
          <Select
            style={{ width: 330 }}
            value={draft.questions}
            onChange={(v) => setDraft({ ...draft, questions: v })}
            options={[
              { value: 'auto', label: `Theo backend (đang là: ${view.questionSet === 'laya' ? 'Laya' : 'Cookbook'})` },
              { value: 'laya', label: 'Laya: lệnh này làm gì (1 câu chọn 8 nhóm)' },
              { value: 'cookbook', label: 'Cookbook: câu reversible đúng/sai (hợp Jev)' },
            ]}
          />
        </div>
      </Space>
      <Paragraph type="secondary" style={{ fontSize: 12 }}>
        {MODE_HELP[draft.mode]}{' '}
        {effective === 'laya'
          ? 'Laya: xác suất hoàn tác được = P(đọc) + P(chạy test) + P(sửa file trong dự án).'
          : 'Cookbook: xác suất đúng của câu “chỉ đọc hoặc sửa file trong dự án, hoàn tác được”. Laya trên máy trả lời câu này rất kém — hợp với Jev online.'}
      </Paragraph>
      {s && s.total > 0 && (
        <Space wrap size={16} style={{ marginBottom: 12 }}>
          <Text>
            Đã xét <Text strong>{s.total}</Text>
          </Text>
          <Text>
            sẽ cho chạy <Text strong>{s.wouldAllow}</Text>
          </Text>
          <Text>
            đã bỏ qua thẻ hỏi <Text strong>{s.applied}</Text>
          </Text>
          <Text>
            danh sách nguy hiểm <Text strong>{s.risky}</Text>
          </Text>
          <Text>
            lỗi <Text strong>{s.errors}</Text>
          </Text>
          <Tooltip title="Trong các lệnh cổng định cho chạy mà thẻ hỏi vẫn hiện (chạy bóng), bạn đã trả lời thế nào.">
            <Text>
              cổng cho chạy / bạn duyệt <Text strong>{s.allowAgreed}</Text> · bạn từ chối{' '}
              <Text strong type={s.allowRefused > 0 ? 'danger' : undefined}>
                {s.allowRefused}
              </Text>
            </Text>
          </Tooltip>
          <Tooltip title="Cổng để hỏi nhưng bạn vẫn duyệt: lần hỏi mà cổng có thể đã tiết kiệm.">
            <Text type="secondary">cổng hỏi / bạn duyệt {s.askApproved}</Text>
          </Tooltip>
        </Space>
      )}
      {s && s.allowRefused > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={`Có ${s.allowRefused} lệnh cổng định cho chạy mà bạn đã từ chối — xem lại trước khi bật, hoặc nâng ngưỡng.`}
        />
      )}

      <Table
        rowKey="id"
        size="small"
        dataSource={view.log}
        columns={columns as any}
        pagination={false}
        scroll={{ x: 640 }}
        locale={{ emptyText: 'Chưa có lệnh nào qua cổng — bật Chạy bóng để bắt đầu ghi.' }}
        style={{ marginBottom: 16 }}
      />

      <Text strong style={{ display: 'block', marginBottom: 6 }}>
        <ExperimentOutlined /> Thử một lệnh
      </Text>
      <Space.Compact style={{ width: '100%', maxWidth: 720 }}>
        <Input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onPressEnter={async () => {
            const v = await check([command]);
            if (v) setVerdict(v[0]);
          }}
          style={{ fontFamily: 'monospace' }}
        />
        <Button
          loading={checking}
          onClick={async () => {
            const v = await check([command]);
            if (v) setVerdict(v[0]);
          }}
        >
          Kiểm tra
        </Button>
        <Button
          loading={checking}
          onClick={async () => {
            const v = await check(view.samples);
            if (v) setSamples(v);
          }}
        >
          Chạy bộ {view.samples.length} lệnh mẫu
        </Button>
      </Space.Compact>
      <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
        Dùng ngưỡng và bộ câu hỏi đang chỉnh (chưa cần Lưu); không ghi vào nhật ký và không hỏi ai.
      </Text>
      {error && <Alert type="error" showIcon style={{ marginTop: 12 }} message={error} />}
      {verdict && <VerdictDetail v={verdict} />}
      {samples && (
        <Table
          style={{ marginTop: 12 }}
          rowKey="command"
          size="small"
          pagination={false}
          dataSource={samples}
          scroll={{ x: 640 }}
          columns={[
            { title: 'Lệnh', key: 'c', render: (_: unknown, v: GateVerdict) => <Text code>{v.command}</Text> },
            {
              title: 'Cổng',
              key: 'o',
              width: 170,
              render: (_: unknown, v: GateVerdict) => <VerdictTag outcome={v.outcome} stage={v.stage} />,
            },
            {
              title: 'Nhóm / điểm',
              key: 'p',
              width: 150,
              render: (_: unknown, v: GateVerdict) => (
                <Space size={6}>
                  {v.choice && <Tag color="blue">{v.choice}</Tag>}
                  {v.checks[0] && <Text>{decimal.format(v.checks[0].p)}</Text>}
                </Space>
              ),
            },
          ]}
          summary={(rows) => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={3}>
                <Text type="secondary">
                  {rows.filter((r) => r.outcome === 'allow').length} lệnh sẽ được cho chạy ·{' '}
                  {rows.filter((r) => r.stage === 'risky').length} bị danh sách nguy hiểm giữ lại ·{' '}
                  {rows.filter((r) => r.stage === 'error').length} lỗi
                </Text>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          )}
        />
      )}
    </Card>
  );
};
