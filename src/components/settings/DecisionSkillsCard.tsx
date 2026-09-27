import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Radio, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import { AimOutlined, ExperimentOutlined, SaveOutlined } from '@ant-design/icons';
import {
  api,
  decimal,
  post,
  put,
  type GateMode,
  type RouteReport,
  type SkillRoute,
  type SkillRouteRow,
  type SkillsView,
} from './decisionApi';

const { Text, Paragraph } = Typography;

/** A routing decision as a tag: load, hint, or nothing. */
const RouteTag: React.FC<{ route: SkillRoute | null; name?: string | null; force?: boolean }> = ({ route, name, force }) => {
  const n = route?.name ?? name;
  const f = route ? route.force : force;
  if (!n) return <Text type="secondary">—</Text>;
  return (
    <Tag color={f ? 'green' : undefined} style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
      {f ? 'nạp' : 'gợi ý'} · {n}
    </Tag>
  );
};

const time = (ms: number) => new Date(ms).toLocaleString('vi-VN', { hour12: false });

/** Settings → Decision: the pre-turn skill router. */
export const DecisionSkillsCard: React.FC = () => {
  const [view, setView] = useState<SkillsView | null>(null);
  const [mode, setMode] = useState<GateMode | null>(null);
  const [saving, setSaving] = useState(false);
  const [prompt, setPrompt] = useState('đặt hẹn giờ 10 phút giúp tôi');
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<RouteReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const v = await api<SkillsView>('/api/decision/skills?limit=30');
      setView(v);
      setMode((m) => m ?? v.skills.mode);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!view || !mode) {
    return (
      <Card title="Chọn skill trước lượt" loading={!error} style={{ marginBottom: 24 }}>
        {error}
      </Card>
    );
  }

  const save = async () => {
    setSaving(true);
    try {
      const v = await put<SkillsView>('/api/decision/skills', { mode });
      setView(v);
      setMode(v.skills.mode);
      message.success('Đã lưu chế độ chọn skill');
    } catch (e: any) {
      message.error(e.message, 8);
    } finally {
      setSaving(false);
    }
  };

  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      setReport(await post<RouteReport>('/api/decision/skills/check', { prompt }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setChecking(false);
    }
  };

  const s = view.stats;
  const columns = [
    { title: 'Lúc', key: 'at', width: 140, render: (_: unknown, r: SkillRouteRow) => <Text type="secondary">{time(r.at)}</Text> },
    {
      title: 'Câu hỏi',
      key: 'prompt',
      render: (_: unknown, r: SkillRouteRow) => (
        <Tooltip title={r.reason}>
          <Text ellipsis style={{ maxWidth: 320 }}>
            {r.prompt}
          </Text>
        </Tooltip>
      ),
    },
    {
      title: 'Cũ (từ khoá)',
      key: 'legacy',
      width: 190,
      render: (_: unknown, r: SkillRouteRow) => <RouteTag route={null} name={r.legacyName} force={r.legacyForce} />,
    },
    {
      title: 'Mới',
      key: 'route',
      width: 190,
      render: (_: unknown, r: SkillRouteRow) => <RouteTag route={null} name={r.routeName} force={r.routeForce} />,
    },
    {
      title: 'Bộ quyết định',
      key: 'engine',
      width: 170,
      render: (_: unknown, r: SkillRouteRow) =>
        r.fallback ? (
          <Tooltip title={r.fallback}>
            <Tag color="orange">không trả lời</Tag>
          </Tooltip>
        ) : (
          <Text type="secondary">
            {r.enginePick ?? 'none'} {r.engineP != null && decimal.format(r.engineP)}
          </Text>
        ),
    },
  ];

  return (
    <Card
      title={
        <Space>
          <AimOutlined /> Chọn skill trước lượt (pre-skill)
        </Space>
      }
      style={{ marginBottom: 24 }}
      extra={
        <Button type="primary" icon={<SaveOutlined />} disabled={mode === view.skills.mode} loading={saving} onClick={save}>
          Lưu
        </Button>
      }
    >
      <Paragraph type="secondary" style={{ marginTop: 0 }}>
        Trước mỗi lượt chat, SenClaw đoán skill nào hợp với câu hỏi. Cách cũ chỉ đọc <Text code>triggers</Text> và{' '}
        <Text code>when-to-use</Text>; cách mới đọc thêm các câu mẫu trong ngoặc kép ở <Text code>description</Text>, rồi
        hỏi bộ quyết định (Laya / Jev) chọn trong {view.candidates} ứng viên. Chỉ <Text strong>nạp thẳng</Text> skill khi từ
        khoá và bộ quyết định cùng chọn, hoặc khớp nguyên một câu trigger và lựa chọn nằm trong top-3; còn lại chỉ{' '}
        <Text strong>gợi ý</Text>. Đo trên 32 câu thật với 224 skill: cách cũ nạp sai 10 lần, cách mới nạp sai 2 lần.
      </Paragraph>
      <Space wrap size={16} style={{ marginBottom: 8 }}>
        <Radio.Group
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          optionType="button"
          buttonStyle="solid"
          options={[
            { value: 'off', label: 'Tắt' },
            { value: 'shadow', label: 'Chạy bóng' },
            { value: 'on', label: 'Bật' },
          ]}
        />
        <Text type="secondary" style={{ fontSize: 12 }}>
          {mode === 'off'
            ? 'Dùng cách cũ, không ghi gì.'
            : mode === 'shadow'
              ? 'Vẫn dùng cách cũ; cách mới chạy nền và ghi lại để so — không làm chậm lượt nào.'
              : `Dùng cách mới (chờ bộ quyết định tối đa ${view.timeoutMs} ms; quá giờ thì chỉ nạp khi khớp nguyên câu trigger).`}
        </Text>
      </Space>
      {!view.preTriggerSkill && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="“Pre-trigger skill” đang tắt (Agent Behavior): cả cách cũ lẫn cách mới chỉ gợi ý, không nạp thẳng skill."
        />
      )}

      {s && s.total > 0 && (
        <Space wrap size={16} style={{ marginBottom: 12 }}>
          <Text>
            Đã xét <Text strong>{s.total}</Text> lượt
          </Text>
          <Text>
            giống nhau <Text strong>{s.same}</Text>
          </Text>
          <Text>
            cũ nạp <Text strong>{s.legacyLoads}</Text> · mới nạp <Text strong>{s.routeLoads}</Text>
          </Text>
          <Tooltip title="Cách cũ nạp thẳng mà cách mới chỉ gợi ý hoặc bỏ — nơi cần xem ai đúng.">
            <Text>
              mới giữ lại <Text strong>{s.loadsWithheld}</Text> lần nạp
            </Text>
          </Tooltip>
          <Text type="secondary">bộ quyết định không trả lời {s.fallbacks}</Text>
        </Space>
      )}
      <Table
        rowKey="id"
        size="small"
        dataSource={view.log}
        columns={columns as any}
        pagination={false}
        scroll={{ x: 760 }}
        locale={{ emptyText: 'Chưa có lượt nào được ghi — bật Chạy bóng rồi chat như thường.' }}
        style={{ marginBottom: 16 }}
      />

      <Text strong style={{ display: 'block', marginBottom: 6 }}>
        <ExperimentOutlined /> Thử một câu
      </Text>
      <Space.Compact style={{ width: '100%', maxWidth: 720 }}>
        <Input value={prompt} onChange={(e) => setPrompt(e.target.value)} onPressEnter={check} />
        <Button loading={checking} onClick={check}>
          Chọn skill
        </Button>
      </Space.Compact>
      {error && <Alert type="error" showIcon style={{ marginTop: 12 }} message={error} />}
      {report && (
        <Card size="small" style={{ marginTop: 12 }}>
          <Space wrap size={12}>
            <Text>Cũ:</Text>
            <RouteTag route={report.legacy} />
            <Text>Mới:</Text>
            <RouteTag route={report.route} />
            <Text type="secondary">
              bộ quyết định: {report.fallback ? `không trả lời (${report.fallback})` : `${report.enginePick ?? 'none'} ${report.engineP != null ? decimal.format(report.engineP) : ''}`}
            </Text>
            {report.latencyMs != null && <Text type="secondary">{decimal.format(report.latencyMs)} ms</Text>}
          </Space>
          <Paragraph type="secondary" style={{ margin: '8px 0' }}>
            {report.reason}
          </Paragraph>
          <Space wrap size={6}>
            {report.candidates.map((c) => (
              <Tag key={c.name} color={c.phraseHit ? 'blue' : undefined}>
                {c.name} {c.score}
              </Tag>
            ))}
          </Space>
        </Card>
      )}
    </Card>
  );
};
