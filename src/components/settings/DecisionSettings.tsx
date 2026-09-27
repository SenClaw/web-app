import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Form,
  Input,
  Popconfirm,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import {
  CheckCircleOutlined,
  CloudDownloadOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  LoadingOutlined,
  PlayCircleOutlined,
  PoweroffOutlined,
  ReloadOutlined,
  StopOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { DECISION_PRESETS } from './decisionPresets';
import { DecisionGateCard } from './DecisionGateCard';
import { DecisionSkillsCard } from './DecisionSkillsCard';
import { DecisionRunSettings, idleLabel } from './DecisionRunSettings';
import { RuntimeMissingBanner } from './RuntimeMissingBanner';
import { runtimeMissingFromError, type RuntimeMissingInfo } from '../../lib/runtimeApi';
import {
  ACTIVE,
  api,
  asAnswer,
  decimal,
  fmtBytes,
  percent,
  post,
  type Answer,
  type AskResponse,
  type Backend,
  type Kind,
  type ListResponse,
  type LoadedInfo,
  type ModelRow,
  type SettingsView,
} from './decisionApi';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

function pretty(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
}

/**
 * The state as JSON text: an editor holding a JSON string, array or object is
 * sent exactly as typed, anything else as a string. Never through
 * `JSON.parse` → `JSON.stringify`: that moves integer-like keys ("1", "10")
 * to the front, and key order is what the model reads.
 */
function stateJson(text: string): string {
  const t = text.trim();
  try {
    const v = JSON.parse(t);
    if (typeof v === 'string' || Array.isArray(v) || (v && typeof v === 'object')) return t;
  } catch {
    // plain text
  }
  return JSON.stringify(text);
}

const KindTag: React.FC<{ kind: Kind | null }> = ({ kind }) =>
  kind === 'multilingual' ? (
    <Tag color="geekblue">Đa ngữ</Tag>
  ) : kind === 'english' ? (
    <Tag>English</Tag>
  ) : null;

const Bar: React.FC<{ label: React.ReactNode; p: number; strong?: boolean }> = ({ label, p, strong }) => (
  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 140px 64px', gap: 10, alignItems: 'center' }}>
    <Text strong={strong} ellipsis={{ tooltip: true }}>
      {label}
    </Text>
    <Progress percent={Math.round(p * 1000) / 10} showInfo={false} size="small" status={strong ? 'active' : 'normal'} />
    <Text type={strong ? undefined : 'secondary'} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
      {percent.format(p)}
    </Text>
  </div>
);

const Metrics: React.FC<{ answer: Answer }> = ({ answer }) => (
  <Space size={16} wrap style={{ marginTop: 8 }}>
    {typeof answer.confidence === 'number' && (
      <Tooltip title="Độ tập trung của phân phối (1 − entropy chuẩn hoá). Laya nói rõ đây KHÔNG phải xác suất đã hiệu chỉnh.">
        <Text type="secondary" style={{ fontSize: 12 }}>
          confidence {decimal.format(answer.confidence)}
        </Text>
      </Tooltip>
    )}
    {'answer_confidence' in answer && typeof answer.answer_confidence === 'number' && (
      <Tooltip title="max(p) — đại lượng mà temperature scaling của Laya hiệu chỉnh: trong các câu trả lời có mức này, khoảng chừng đó là đúng.">
        <Text type="secondary" style={{ fontSize: 12 }}>
          answer_confidence {decimal.format(answer.answer_confidence)}
        </Text>
      </Tooltip>
    )}
    {answer.action && (
      <Tooltip title="P(hành động) từ đầu act/escalate: model nghĩ nên làm theo câu trả lời này (cao) hay chuyển cho người (thấp).">
        <Text type="secondary" style={{ fontSize: 12 }}>
          act {decimal.format(answer.action.act_probability)}
        </Text>
      </Tooltip>
    )}
  </Space>
);

const AnswerCard: React.FC<{ id: string; raw: unknown }> = ({ id, raw }) => {
  const answer = asAnswer(raw);
  if (!answer) {
    // An online backend's own shape: show it as it came.
    return (
      <Card size="small" title={<Text code>{id}</Text>}>
        <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>{JSON.stringify(raw, null, 2)}</pre>
      </Card>
    );
  }
  let body: React.ReactNode;
  if (answer.type === 'choice') {
    body = (
      <>
        <Paragraph style={{ marginBottom: 8 }}>
          → <Text strong>{answer.choice}</Text>
        </Paragraph>
        {Object.entries(answer.probabilities).map(([label, p]) => (
          <Bar key={label} label={label} p={p} strong={label === answer.choice} />
        ))}
      </>
    );
  } else if (answer.type === 'score') {
    const levels = Object.keys(answer.probabilities).length;
    const best = Object.entries(answer.probabilities).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    body = (
      <>
        <Paragraph style={{ marginBottom: 8 }}>
          điểm <Text strong>{decimal.format(answer.score)}</Text> trên thang 0–{levels - 1}
        </Paragraph>
        {Object.entries(answer.probabilities).map(([level, p]) => {
          const legend = answer.legend?.[level] ?? '';
          const text = typeof legend === 'string' ? legend : JSON.stringify(legend);
          return <Bar key={level} label={`${level} · ${text}`} p={p} strong={level === best} />;
        })}
      </>
    );
  } else {
    body = (
      <>
        <Paragraph style={{ marginBottom: 8 }}>
          → <Text strong>{answer.noul >= 0.5 ? 'có' : 'không'}</Text>
        </Paragraph>
        <Bar label="P(đúng)" p={answer.noul} strong />
      </>
    );
  }
  return (
    <Card
      size="small"
      title={
        <Space size={8}>
          <Text code>{id}</Text>
          <Tag>{answer.type}</Tag>
        </Space>
      }
    >
      {body}
      <Metrics answer={answer} />
    </Card>
  );
};

/** When the sweeper will unload a model, as of the last list refresh. */
function unloadHint(l: LoadedInfo, idleMinutes: number): string {
  const left = idleMinutes * 60 - l.idle_secs;
  if (left <= 30) return 'sắp tự gỡ vì không dùng';
  const mins = Math.ceil(left / 60);
  return `tự gỡ sau ~${mins} phút nếu không dùng (ngưỡng ${idleLabel(idleMinutes)})`;
}

export const DecisionSettings: React.FC<{ onOpenRuntimeSettings?: () => void }> = ({ onOpenRuntimeSettings }) => {
  const [list, setList] = useState<ListResponse | null>(null);
  const [settingsView, setSettingsView] = useState<SettingsView | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [runtimeMissing, setRuntimeMissing] = useState<RuntimeMissingInfo | null>(null);
  const pollRef = useRef<number | null>(null);

  const [modelChoice, setModelChoice] = useState<string>('auto');
  const [backendChoice, setBackendChoice] = useState<'settings' | Backend>('settings');
  const [presetKey, setPresetKey] = useState(DECISION_PRESETS[0].key);
  const [stateText, setStateText] = useState(pretty(DECISION_PRESETS[0].state));
  const [questionsText, setQuestionsText] = useState(pretty(DECISION_PRESETS[0].questions));
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const l = await api<ListResponse>('/api/decision/models');
      setList(l);
      setRuntimeMissing(null);
    } catch (e: any) {
      const missing = runtimeMissingFromError(e);
      if (missing) setRuntimeMissing(missing);
      else message.error(`Không tải được danh sách model: ${e.message}`);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const refreshSettings = useCallback(async () => {
    try {
      setSettingsView(await api<SettingsView>('/api/decision/settings'));
    } catch (e: any) {
      // Model management shares the runtime-missing state set by `refresh()`
      // above — this call hits the same proxied slot, so a banner already
      // covers it; only surface a toast for an unrelated failure.
      if (!runtimeMissingFromError(e)) message.error(`Không tải được cách chạy: ${e.message}`);
    }
  }, []);

  useEffect(() => {
    refresh();
    refreshSettings();
  }, [refresh, refreshSettings]);

  const models = list?.models ?? [];
  const working = models.some((m) => m.loading || (m.job && ACTIVE.includes(m.job.status)));

  // Poll while something is downloading, copying or loading.
  useEffect(() => {
    if (working && pollRef.current === null) {
      pollRef.current = window.setInterval(refresh, 1000);
    } else if (!working && pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [working, refresh]);

  const anyLoaded = models.some((m) => m.loaded);
  useEffect(() => {
    if (!anyLoaded || working) return;
    const t = window.setInterval(refresh, 15000);
    return () => window.clearInterval(t);
  }, [anyLoaded, working, refresh]);

  const act = async (id: string, what: string, run: () => Promise<unknown>, done?: string) => {
    setBusy((b) => ({ ...b, [id]: what }));
    try {
      await run();
      if (done) message.success(done);
    } catch (e: any) {
      message.error(e.message, 8);
    } finally {
      setBusy((b) => {
        const { [id]: _, ...rest } = b;
        return rest;
      });
      refresh();
    }
  };

  const download = (m: ModelRow) =>
    act(m.id, 'download', () => post(`/api/decision/models/${m.id}/download`), `Bắt đầu tải ${m.label}`);
  const cancel = (m: ModelRow) => act(m.id, 'cancel', () => post(`/api/decision/models/${m.id}/cancel`));
  const load = (m: ModelRow) =>
    act(
      m.id,
      'load',
      async () => {
        // The POST answers when the weights are in RAM; poll meanwhile so the row shows it.
        const pending = post<{ loaded: LoadedInfo }>(`/api/decision/models/${m.id}/load`);
        window.setTimeout(refresh, 150);
        const r = await pending;
        message.success(`Đã nạp ${m.label} trong ${decimal.format(r.loaded.load_ms / 1000)} s`);
      },
    );
  const unload = (m: ModelRow) =>
    act(m.id, 'unload', () => post(`/api/decision/models/${m.id}/unload`), `Đã gỡ ${m.label} khỏi RAM`);
  const remove = (m: ModelRow) =>
    act(m.id, 'delete', async () => {
      const r = await api<{ defaultCleared?: boolean }>(`/api/decision/models/${m.id}`, { method: 'DELETE' });
      message.success(r.defaultCleared ? `Đã xoá ${m.label}; model mặc định trở về Tự chọn` : `Đã xoá ${m.label}`);
      if (r.defaultCleared) refreshSettings();
    });

  const importFolder = (values: { path: string; id?: string }) =>
    act(values.id || values.path, 'import', () => post('/api/decision/models/import', values), 'Bắt đầu nhập model');

  const customDownload = (values: { id: string; repo: string; revision?: string }) =>
    act(values.id, 'custom', () => post('/api/decision/models/custom', values), `Bắt đầu tải ${values.repo}`);

  const choosePreset = (key: string) => {
    const p = DECISION_PRESETS.find((x) => x.key === key);
    if (!p) return;
    setPresetKey(key);
    setStateText(pretty(p.state));
    setQuestionsText(pretty(p.questions));
    setResult(null);
    setAskError(null);
  };

  const ask = async () => {
    try {
      JSON.parse(questionsText);
    } catch (e: any) {
      setAskError(`Ô câu hỏi không phải JSON hợp lệ: ${e.message}`);
      return;
    }
    setAsking(true);
    setAskError(null);
    try {
      // Built as text so the questions and the state keep the order typed
      // (see stateJson) — option order is where the model's markers sit.
      const head: string[] = [];
      if (backendChoice !== 'settings') head.push(`"backend":${JSON.stringify(backendChoice)}`);
      if (effectiveBackend === 'local' && modelChoice !== 'auto') head.push(`"model":${JSON.stringify(modelChoice)}`);
      const body = `{${[...head, `"state":${stateJson(stateText)}`, `"questions":${questionsText.trim()}`].join(',')}}`;
      const r = await api<AskResponse>('/api/decision/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      setResult(r);
      refresh();
    } catch (e: any) {
      setResult(null);
      setAskError(e.message);
    } finally {
      setAsking(false);
    }
  };

  const loaded = models.filter((m) => m.loaded);
  const installed = models.filter((m) => m.installed);
  const run = settingsView?.settings;
  const autoLoad = list?.local.autoLoad ?? true;
  const idleMinutes = list?.local.idleUnloadMinutes ?? 0;
  const defaultModel = list?.local.defaultModel ?? null;
  const effectiveBackend: Backend = backendChoice === 'settings' ? (list?.backend ?? 'local') : backendChoice;
  // With hot-load on, any installed model can answer; without it, only loaded ones.
  const askable = autoLoad ? installed : loaded;
  useEffect(() => {
    if (modelChoice !== 'auto' && !askable.some((m) => m.id === modelChoice)) setModelChoice('auto');
  }, [askable, modelChoice]);
  const canAsk = effectiveBackend === 'online' || (!!list?.compiled && askable.length > 0);

  const status = (m: ModelRow): React.ReactNode => {
    const j = m.job;
    if (j && ACTIVE.includes(j.status)) {
      const pct = j.total_bytes ? Math.floor((j.done_bytes / j.total_bytes) * 100) : 0;
      const verb =
        j.status === 'verifying'
          ? 'đang kiểm sha256'
          : j.status === 'copying'
            ? 'đang sao chép'
            : j.status === 'listing'
              ? 'đang lấy danh sách file'
              : 'đang tải';
      return (
        <div>
          <Progress percent={pct} size="small" status="active" />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {verb} {j.current_file ?? ''} · {fmtBytes(j.done_bytes)}
            {j.total_bytes ? ` / ${fmtBytes(j.total_bytes)}` : ''}
          </Text>
        </div>
      );
    }
    if (m.loading || busy[m.id] === 'load') {
      return (
        <Tag icon={<LoadingOutlined />} color="processing">
          Đang nạp vào RAM…
        </Tag>
      );
    }
    if (m.loaded) {
      return (
        <div>
          <Tag icon={<ThunderboltOutlined />} color="green">
            Đã nạp
          </Tag>
          {m.loaded.on_demand && (
            <Tooltip title="Được một lượt hỏi nạp tự động, không phải bấm Nạp.">
              <Tag color="cyan">tự nạp</Tag>
            </Tooltip>
          )}
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            nạp trong {decimal.format(m.loaded.load_ms / 1000)} s · {m.loaded.threads} luồng · batch{' '}
            {m.loaded.batch === 'dynamic' ? 'động' : 'cố định 1'} · {m.loaded.asks} lượt hỏi
          </Text>
          {idleMinutes > 0 && (
            <>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>
                {unloadHint(m.loaded, idleMinutes)}
              </Text>
            </>
          )}
        </div>
      );
    }
    if (m.installed) {
      return (
        <Tag icon={<CheckCircleOutlined />} color="blue">
          Đã cài
        </Tag>
      );
    }
    if (j?.status === 'error') {
      return (
        <Tooltip title={j.error}>
          <Tag color="red" style={{ maxWidth: 260, whiteSpace: 'normal' }}>
            Lỗi: {j.error}
          </Tag>
        </Tooltip>
      );
    }
    if (j?.status === 'cancelled') {
      return <Tag color="orange">Đã huỷ — bấm Tải để tải tiếp</Tag>;
    }
    return <Tag>Chưa cài</Tag>;
  };

  const actions = (m: ModelRow): React.ReactNode => {
    const jobActive = !!(m.job && ACTIVE.includes(m.job.status));
    const pending = busy[m.id];
    return (
      <Space wrap>
        {!m.installed && !jobActive && m.catalog && (
          <Button size="small" type="primary" icon={<CloudDownloadOutlined />} loading={pending === 'download'} onClick={() => download(m)}>
            Tải
          </Button>
        )}
        {jobActive && (
          <Button size="small" danger icon={<StopOutlined />} onClick={() => cancel(m)}>
            Huỷ
          </Button>
        )}
        {m.installed && !m.loaded && (
          <Button
            size="small"
            type="primary"
            icon={<PlayCircleOutlined />}
            loading={m.loading || pending === 'load'}
            disabled={!list?.compiled}
            onClick={() => load(m)}
          >
            Nạp
          </Button>
        )}
        {m.loaded && (
          <Button size="small" icon={<PoweroffOutlined />} loading={pending === 'unload'} onClick={() => unload(m)}>
            Gỡ khỏi RAM
          </Button>
        )}
        {(m.installed || m.size_bytes > 0 || m.job) && !jobActive && (
          <Popconfirm
            title={`Xoá ${m.label}?`}
            description={m.loaded ? 'Model sẽ được gỡ khỏi RAM trước khi xoá.' : 'File trên đĩa sẽ bị xoá.'}
            okText="Xoá"
            cancelText="Thôi"
            onConfirm={() => remove(m)}
          >
            <Button size="small" danger icon={<DeleteOutlined />} disabled={m.loading} loading={pending === 'delete'} />
          </Popconfirm>
        )}
      </Space>
    );
  };

  const columns = [
    {
      title: 'Model',
      key: 'model',
      render: (_: unknown, m: ModelRow) => (
        <div>
          <Space size={6} wrap>
            <Text strong>{m.label}</Text>
            <KindTag kind={m.kind} />
            {!m.catalog && <Tag>tuỳ chỉnh</Tag>}
            {defaultModel === m.id && <Tag color="gold">mặc định</Tag>}
          </Space>
          {m.description && (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {m.description}
              </Text>
            </div>
          )}
          <div>
            <Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>
              {m.id}
              {m.source?.repo && (
                <>
                  {' · '}
                  <a
                    href={`https://huggingface.co/${m.source.repo}/tree/${m.source.revision ?? 'main'}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {m.source.repo}@{(m.source.revision ?? 'main').slice(0, 7)}
                  </a>
                </>
              )}
              {m.source?.path && ` · từ thư mục ${m.source.path}`}
            </Text>
          </div>
        </div>
      ),
    },
    {
      title: 'Dung lượng',
      key: 'size',
      width: 110,
      render: (_: unknown, m: ModelRow) =>
        m.size_bytes > 0 ? (
          <Text>{fmtBytes(m.size_bytes)}</Text>
        ) : m.approx_size_mb ? (
          <Text type="secondary">~{decimal.format(m.approx_size_mb / 1024)} GB</Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    { title: 'Trạng thái', key: 'status', width: 280, render: (_: unknown, m: ModelRow) => status(m) },
    { title: '', key: 'actions', width: 230, render: (_: unknown, m: ModelRow) => actions(m) },
  ];

  const answers = useMemo(() => (result ? Object.entries(result.answers) : []), [result]);

  const intro = (
    <>
      <Title level={3} style={{ marginTop: 0 }}>
        Quyết định (Laya)
      </Title>
      <Paragraph type="secondary">
        Laya là model “System One” mở, tương thích Jev: không sinh chữ, chỉ trả lời câu hỏi có kiểu —{' '}
        <Text code>choice</Text> (chọn một nhãn), <Text code>score</Text> (chấm theo thang),{' '}
        <Text code>noul</Text> (xác suất có/không) — kèm phân phối xác suất. Chạy trong một runtime riêng
        (<Text code>sen-sysone</Text>) mà daemon cài đặt và giám sát; model đã nạp chiếm RAM cỡ dung lượng
        của nó. Nội dung tiếng Việt nên dùng bản{' '}
        <Text strong>Đa ngữ</Text>: bản English đọc tiếng Việt sai mà vẫn tự tin. Cũng có thể trả lời bằng{' '}
        <Text strong>Jev online</Text> (TypeSafe / Cloudflare / endpoint tương thích) — chọn ở Cách chạy.
      </Paragraph>
    </>
  );

  // The gate and skill router stay native to the daemon (control plane, §5.2)
  // even when sen-sysone itself is missing — only model management here is
  // proxied through the runtime, so only that part is replaced by the banner.
  if (runtimeMissing) {
    return (
      <div>
        {intro}
        <RuntimeMissingBanner info={runtimeMissing} onOpenRuntimeSettings={onOpenRuntimeSettings} />
        <DecisionGateCard />
        <DecisionSkillsCard />
      </div>
    );
  }

  return (
    <div>
      {intro}

      {list && !list.compiled && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Bản build này không có engine Laya"
          description={
            <>
              Daemon được build không kèm feature <Text code>decision-laya</Text>: vẫn tải / nhập / xoá model
              được, nhưng không nạp và không hỏi được. Build lại với{' '}
              <Text code>--features decision-laya</Text> (đã có trong <Text code>DAEMON_FEATURES</Text>).
            </>
          }
        />
      )}

      <DecisionRunSettings
        view={settingsView}
        installed={models}
        onSaved={(v) => {
          setSettingsView(v);
          refresh();
        }}
      />

      <Card
        title="Model"
        extra={
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              refresh();
              refreshSettings();
            }}
            loading={refreshing}
          >
            Làm mới
          </Button>
        }
        style={{ marginBottom: 24 }}
      >
        <Table
          rowKey="id"
          dataSource={models}
          columns={columns as any}
          loading={refreshing && !list}
          pagination={false}
          size="small"
          scroll={{ x: 760 }}
        />
        {list && (
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
            Thư mục lưu: <Text code style={{ fontSize: 12 }}>{list.root}</Text>
          </Text>
        )}
      </Card>

      <Card title="Thử hỏi" style={{ marginBottom: 24 }}>
        {effectiveBackend === 'local' && loaded.length === 0 && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message={
              installed.length === 0
                ? 'Chưa cài model nào'
                : autoLoad
                  ? 'Chưa nạp model nào — lượt hỏi đầu sẽ tự nạp (vài giây)'
                  : 'Chưa có model nào được nạp'
            }
            description={
              installed.length === 0
                ? 'Tải hoặc nhập một model ở bảng trên, hoặc chuyển sang Online.'
                : autoLoad
                  ? undefined
                  : 'Bấm Nạp ở bảng trên, hoặc bật “Tự nạp khi cần” trong Cách chạy.'
            }
          />
        )}
        {effectiveBackend === 'online' && run && !run.online.hasApiKey && run.online.provider !== 'custom' && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="Chưa có API key cho online"
            description="Nhập key ở Cách chạy → Online rồi bấm Lưu."
          />
        )}
        <Space wrap style={{ marginBottom: 12 }}>
          <span>
            <Text type="secondary">Trả lời bằng: </Text>
            <Select
              style={{ minWidth: 200 }}
              value={backendChoice}
              onChange={setBackendChoice}
              options={[
                {
                  value: 'settings',
                  label: `Theo cài đặt (${(list?.backend ?? 'local') === 'online' ? 'Online' : 'Trên máy'})`,
                },
                { value: 'local', label: 'Trên máy — Laya' },
                { value: 'online', label: 'Online — Jev API' },
              ]}
            />
          </span>
          {effectiveBackend === 'local' && (
            <span>
              <Text type="secondary">Model: </Text>
              <Select
                style={{ minWidth: 240 }}
                value={modelChoice}
                onChange={setModelChoice}
                options={[
                  {
                    value: 'auto',
                    label: defaultModel ? `Mặc định (${defaultModel})` : 'Tự chọn theo ngôn ngữ',
                  },
                  ...askable.map((m) => ({
                    value: m.id,
                    label: m.loaded ? `${m.label} · đã nạp` : `${m.label} · tự nạp`,
                  })),
                ]}
              />
            </span>
          )}
          <span>
            <Text type="secondary">Mẫu: </Text>
            <Select
              style={{ minWidth: 300 }}
              value={presetKey}
              onChange={choosePreset}
              options={DECISION_PRESETS.map((p) => ({ value: p.key, label: p.label }))}
            />
          </span>
        </Space>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 16 }}>
          <div>
            <Text strong>State</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {' '}
              — chữ thường, hoặc JSON (object / mảng hội thoại)
            </Text>
            <TextArea
              value={stateText}
              onChange={(e) => setStateText(e.target.value)}
              autoSize={{ minRows: 8, maxRows: 20 }}
              style={{ fontFamily: 'monospace', fontSize: 12, marginTop: 6 }}
            />
          </div>
          <div>
            <Text strong>Câu hỏi</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {' '}
              — JSON: id → {'{ type, instructions, criteria?, labels? }'}
            </Text>
            <TextArea
              value={questionsText}
              onChange={(e) => setQuestionsText(e.target.value)}
              autoSize={{ minRows: 8, maxRows: 20 }}
              style={{ fontFamily: 'monospace', fontSize: 12, marginTop: 6 }}
            />
          </div>
        </div>
        <Space style={{ marginTop: 12 }}>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={asking}
            disabled={!canAsk}
            onClick={ask}
          >
            Hỏi
          </Button>
        </Space>

        {askError && <Alert type="error" showIcon style={{ marginTop: 16 }} message={askError} />}

        {result && (
          <div style={{ marginTop: 20 }}>
            <Space size={12} wrap style={{ marginBottom: 12 }}>
              <Tag color={result.engine.startsWith('online') ? 'purple' : 'green'}>{result.model}</Tag>
              <Text type="secondary">{result.engine}</Text>
              <Text type="secondary">định tuyến: {result.routing.reason}</Text>
              <Text type="secondary">{decimal.format(result.latency_ms)} ms</Text>
              <Text type="secondary">{result.usage.input_tokens} token đầu vào</Text>
              {!result.engine.startsWith('online') && (
                <Text type="secondary">{result.runs} lượt chạy đồ thị</Text>
              )}
            </Space>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
              {answers.map(([id, a]) => (
                <AnswerCard key={id} id={id} raw={a} />
              ))}
            </div>
            <Collapse
              size="small"
              style={{ marginTop: 12 }}
              items={[
                {
                  key: 'raw',
                  label: 'JSON trả về',
                  children: (
                    <pre style={{ margin: 0, fontSize: 12, maxHeight: 360, overflow: 'auto' }}>
                      {JSON.stringify(result, null, 2)}
                    </pre>
                  ),
                },
              ]}
            />
          </div>
        )}
      </Card>

      <DecisionGateCard />

      <DecisionSkillsCard />

      <Card
        title={
          <Space>
            <FolderOpenOutlined /> Nhập từ thư mục có sẵn
          </Space>
        }
        style={{ marginBottom: 24 }}
      >
        <Paragraph type="secondary" style={{ marginTop: 0 }}>
          Dùng khi đã có một bản export Laya trên máy (ví dụ từ <Text code>laya</Text> Python). Thư mục phải
          có đồ thị ONNX (<Text code>laya.onnx</Text> hoặc <Text code>onnx/model.onnx</Text>), file config (
          <Text code>rl_agent_config.json</Text> / <Text code>laya_config.json</Text>) và{' '}
          <Text code>tokenizer/</Text>. Cùng ổ APFS thì sao chép gần như tức thì.
        </Paragraph>
        <Form layout="inline" onFinish={importFolder} style={{ rowGap: 8 }}>
          <Form.Item name="path" rules={[{ required: true, message: 'Nhập đường dẫn thư mục' }]} style={{ minWidth: 380 }}>
            <Input placeholder="/Users/ban/Laya-jev/models/multilingual" />
          </Form.Item>
          <Form.Item name="id" rules={[{ pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, message: 'Chỉ chữ, số, . _ -' }]}>
            <Input placeholder="id (mặc định: tên thư mục)" style={{ width: 220 }} />
          </Form.Item>
          <Button htmlType="submit" icon={<FolderOpenOutlined />}>
            Nhập
          </Button>
        </Form>
      </Card>

      <Card
        title={
          <Space>
            <LinkOutlined /> Tải từ repo Hugging Face khác
          </Space>
        }
      >
        <Paragraph type="secondary" style={{ marginTop: 0 }}>
          Mọi bản export có đồ thị, config và tokenizer theo bố cục của Laya đều dùng được. Branch hoặc tag sẽ
          được ghim vào commit lúc bắt đầu tải; file LFS được kiểm sha256.
        </Paragraph>
        <Form layout="inline" onFinish={customDownload} style={{ rowGap: 8 }}>
          <Form.Item name="id" rules={[{ required: true, pattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, message: 'id: chữ, số, . _ -' }]}>
            <Input placeholder="id, vd. laya-int8" style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="repo" rules={[{ required: true, message: 'org/name' }]} style={{ minWidth: 300 }}>
            <Input placeholder="org/name hoặc URL huggingface.co" />
          </Form.Item>
          <Form.Item name="revision">
            <Input placeholder="main" style={{ width: 120 }} />
          </Form.Item>
          <Button htmlType="submit" icon={<CloudDownloadOutlined />}>
            Tải
          </Button>
        </Form>
      </Card>
    </div>
  );
};
