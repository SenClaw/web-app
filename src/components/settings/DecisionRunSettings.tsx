import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Input,
  InputNumber,
  Radio,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import { ApiOutlined, CloudOutlined, DesktopOutlined, SaveOutlined } from '@ant-design/icons';
import { decimal, post, put, type ModelRow, type Provider, type RunSettings, type SettingsView } from './decisionApi';

const { Text, Paragraph } = Typography;

const IDLE_CHOICES = [5, 15, 30, 60, 180, 0];

const PROVIDER_LABEL: Record<Provider, string> = {
  typesafe: 'TypeSafe Jev (api.typesafe.ai)',
  cloudflare: 'Cloudflare Workers AI (typesafe/jev)',
  custom: 'Tuỳ chỉnh — URL /v1/systemone bất kỳ',
};

const Field: React.FC<{ label: string; help?: React.ReactNode; children: React.ReactNode }> = ({
  label,
  help,
  children,
}) => (
  <div style={{ marginBottom: 14 }}>
    <Text strong style={{ display: 'block', marginBottom: 4 }}>
      {label}
    </Text>
    {children}
    {help && (
      <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
        {help}
      </Text>
    )}
  </div>
);

export function idleLabel(minutes: number): string {
  if (minutes === 0) return 'Không bao giờ';
  if (minutes % 60 === 0) return `${minutes / 60} giờ`;
  return `${minutes} phút`;
}

/** Backend, default model, threads, hot-load and idle unload. */
export const DecisionRunSettings: React.FC<{
  view: SettingsView | null;
  installed: ModelRow[];
  onSaved: (v: SettingsView) => void;
}> = ({ view, installed, onSaved }) => {
  const [draft, setDraft] = useState<RunSettings | null>(null);
  const [clearKey, setClearKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = useMemo(
    () => !!view && !!draft && (clearKey || JSON.stringify(view.settings) !== JSON.stringify(draft)),
    [view, draft, clearKey],
  );
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  // A refresh replaces the form, except while someone is editing it: then
  // only the default model follows (deleting the default resets it upstream).
  useEffect(() => {
    if (!view) return;
    if (dirtyRef.current) {
      setDraft((prev) =>
        prev ? { ...prev, local: { ...prev.local, defaultModel: view.settings.local.defaultModel } } : view.settings,
      );
      return;
    }
    setDraft(view.settings);
    setClearKey(false);
  }, [view]);

  if (!view || !draft) return <Card title="Cách chạy" loading style={{ marginBottom: 24 }} />;

  const d = view.defaults;
  const setLocal = (patch: Partial<RunSettings['local']>) => setDraft({ ...draft, local: { ...draft.local, ...patch } });
  const setOnline = (patch: Partial<RunSettings['online']>) =>
    setDraft({ ...draft, online: { ...draft.online, ...patch } });
  const body = () => ({ ...draft, clearApiKey: clearKey });

  const save = async () => {
    setSaving(true);
    try {
      const v = await put<SettingsView>('/api/decision/settings', body());
      onSaved(v);
      message.success('Đã lưu cách chạy');
    } catch (e: any) {
      message.error(e.message, 8);
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await post<{ model: string; latencyMs: number }>('/api/decision/online/test', body());
      setTestResult({ ok: true, text: `Kết nối được: ${r.model} trả lời trong ${decimal.format(r.latencyMs)} ms.` });
    } catch (e: any) {
      setTestResult({ ok: false, text: e.message });
    } finally {
      setTesting(false);
    }
  };

  const online = draft.online;
  // A saved key is only ever sent to the provider (and custom URL) it was
  // saved for — the daemon enforces it; the form says so.
  const saved = view.settings.online;
  const keyApplies =
    !!saved.hasApiKey && saved.provider === online.provider && (online.provider !== 'custom' || saved.url === online.url.trim());
  const modelPlaceholder =
    online.provider === 'typesafe' ? d.typesafeModel : online.provider === 'cloudflare' ? d.cloudflareModel : 'không gửi model';
  const installedOk = installed.filter((m) => m.installed);
  const defaultMissing = !!draft.local.defaultModel && !installedOk.some((m) => m.id === draft.local.defaultModel);
  const defaultEnglish =
    !defaultMissing && installedOk.find((m) => m.id === draft.local.defaultModel)?.kind === 'english';

  return (
    <Card
      title="Cách chạy"
      style={{ marginBottom: 24 }}
      extra={
        <Button type="primary" icon={<SaveOutlined />} disabled={!dirty} loading={saving} onClick={save}>
          Lưu
        </Button>
      }
    >
      <Field
        label="Mặc định trả lời bằng"
        help="Áp dụng cho mọi lượt hỏi không tự chỉ định; ô Thử hỏi bên dưới vẫn chọn riêng được."
      >
        <Radio.Group
          value={draft.backend}
          onChange={(e) => setDraft({ ...draft, backend: e.target.value })}
          optionType="button"
          buttonStyle="solid"
          options={[
            {
              value: 'local',
              label: (
                <Space size={6}>
                  <DesktopOutlined /> Trên máy — Laya
                </Space>
              ),
            },
            {
              value: 'online',
              label: (
                <Space size={6}>
                  <CloudOutlined /> Online — Jev API
                </Space>
              ),
            },
          ]}
        />
      </Field>

      <Row gutter={32}>
        <Col xs={24} lg={12}>
          <Paragraph strong style={{ marginBottom: 10 }}>
            <DesktopOutlined /> Trên máy {draft.backend === 'local' && <Tag color="green">đang dùng</Tag>}
          </Paragraph>
          <Field
            label="Model mặc định"
            help={
              defaultMissing
                ? 'Model này chưa cài — cài nó trước, hoặc chọn model khác.'
                : defaultEnglish
                  ? 'Model này chỉ đọc tiếng Anh: câu có chữ có dấu vẫn được chuyển sang bản Đa ngữ (nếu đã cài).'
                  : 'Lượt hỏi không nêu model sẽ dùng model này. “Tự chọn” = bản Đa ngữ cho chữ có dấu, English cho chữ ASCII.'
            }
          >
            <Select
              style={{ width: '100%' }}
              status={defaultMissing ? 'error' : undefined}
              value={draft.local.defaultModel ?? 'auto'}
              onChange={(v) => setLocal({ defaultModel: v === 'auto' ? undefined : v })}
              options={[
                { value: 'auto', label: 'Tự chọn theo ngôn ngữ' },
                ...installedOk.map((m) => ({ value: m.id, label: `${m.label} (${m.id})` })),
              ]}
            />
          </Field>
          <Field
            label="Số luồng CPU"
            help={`Luồng ONNX Runtime cho mỗi model. Để trống = tự động (${d.threads} trên máy này). Model đang nạp giữ số luồng lúc nạp — gỡ rồi nạp lại để đổi.`}
          >
            <InputNumber
              min={1}
              max={d.maxThreads}
              value={draft.local.threads ?? null}
              placeholder={`tự động (${d.threads})`}
              onChange={(v) => setLocal({ threads: typeof v === 'number' ? v : undefined })}
              style={{ width: 180 }}
            />
          </Field>
          <Field
            label="Tự nạp khi cần"
            help="Bật: lượt hỏi cần một model chưa nạp sẽ tự nạp nó (mất vài giây ở lượt đó). Tắt: phải bấm Nạp trước."
          >
            <Switch checked={draft.local.autoLoad} onChange={(v) => setLocal({ autoLoad: v })} />
          </Field>
          <Field
            label="Tự gỡ khỏi RAM khi không dùng"
            help="Model không được hỏi trong khoảng này sẽ được gỡ để trả bộ nhớ (mỗi model 1,2–1,7 GB). Bật Tự nạp thì lượt hỏi sau tự nạp lại."
          >
            <Select
              style={{ width: 180 }}
              value={draft.local.idleUnloadMinutes}
              onChange={(v) => setLocal({ idleUnloadMinutes: v })}
              options={[...new Set([...IDLE_CHOICES, draft.local.idleUnloadMinutes])]
                .sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b))
                .map((m) => ({ value: m, label: idleLabel(m) }))}
            />
          </Field>
        </Col>

        <Col xs={24} lg={12}>
          <Paragraph strong style={{ marginBottom: 10 }}>
            <CloudOutlined /> Online {draft.backend === 'online' && <Tag color="green">đang dùng</Tag>}
          </Paragraph>
          <Field label="Nhà cung cấp">
            <Select
              style={{ width: '100%' }}
              value={online.provider}
              onChange={(v) => setOnline({ provider: v })}
              options={view.providers.map((p) => ({ value: p, label: PROVIDER_LABEL[p] ?? p }))}
            />
          </Field>
          {online.provider === 'custom' && (
            <Field label="URL" help="Endpoint nói giao thức /v1/systemone — LiteLLM, laya-serve, OpenJev…">
              <Input
                value={online.url}
                placeholder="http://127.0.0.1:8000/v1/systemone"
                onChange={(e) => setOnline({ url: e.target.value })}
              />
            </Field>
          )}
          {online.provider === 'cloudflare' && (
            <Field label="Cloudflare account id">
              <Input value={online.accountId} onChange={(e) => setOnline({ accountId: e.target.value })} />
            </Field>
          )}
          <Field
            label="API key"
            help={
              clearKey
                ? 'Key đã lưu sẽ bị xoá khi bấm Lưu.'
                : keyApplies
                  ? 'Đã lưu một key (không hiển thị lại). Để trống để giữ nguyên.'
                  : saved.hasApiKey
                    ? 'Key đã lưu thuộc nhà cung cấp hoặc URL khác và không được gửi tới đây — nhập key cho lựa chọn này.'
                    : online.provider === 'custom'
                      ? 'Không bắt buộc với endpoint tuỳ chỉnh.'
                      : 'Bắt buộc.'
            }
          >
            <Space.Compact style={{ width: '100%' }}>
              <Input.Password
                value={online.apiKey}
                placeholder={keyApplies && !clearKey ? '•••••••• (đã lưu)' : 'dán key vào đây'}
                autoComplete="off"
                onChange={(e) => {
                  setOnline({ apiKey: e.target.value });
                  if (e.target.value) setClearKey(false);
                }}
              />
              {online.hasApiKey && (
                <Button danger={!clearKey} onClick={() => setClearKey(!clearKey)}>
                  {clearKey ? 'Giữ key' : 'Xoá key'}
                </Button>
              )}
            </Space.Compact>
          </Field>
          <Field label="Model" help="Để trống = mặc định của nhà cung cấp (bản ghim, không dùng alias trôi).">
            <Input value={online.model} placeholder={modelPlaceholder} onChange={(e) => setOnline({ model: e.target.value })} />
          </Field>
          <Field label="Thời gian chờ (giây)">
            <InputNumber
              min={5}
              max={25}
              value={online.timeoutSecs}
              onChange={(v) => setOnline({ timeoutSecs: typeof v === 'number' ? v : 15 })}
              style={{ width: 120 }}
            />
          </Field>
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="Chế độ online gửi nội dung ra ngoài"
            description="State và câu hỏi của mỗi lượt được gửi tới nhà cung cấp đã chọn. Dữ liệu không được rời máy thì dùng Trên máy."
          />
          <Button icon={<ApiOutlined />} loading={testing} onClick={test}>
            Thử kết nối
          </Button>
          <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>
            gửi một câu hỏi có/không rất ngắn, dùng cài đặt đang sửa (chưa cần Lưu)
          </Text>
          {testResult && (
            <Alert
              type={testResult.ok ? 'success' : 'error'}
              showIcon
              style={{ marginTop: 12 }}
              message={testResult.text}
            />
          )}
        </Col>
      </Row>
    </Card>
  );
};
