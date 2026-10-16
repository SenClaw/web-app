import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Button, Drawer, Empty, Form, Input, InputNumber, Layout, Modal, Pagination, Progress, Segmented, Select, Space, Spin,
  Switch, Table, Tag, Tooltip, Typography, message,
} from 'antd';
import { DeleteOutlined, EyeOutlined, ImportOutlined, PlusOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';

import { AppLayout } from '../components/AppLayout';
import { ImportDrawer } from '../components/datagen/ImportDrawer';
import { SourceCatalog } from '../components/datagen/SourceCatalog';
import { useLang } from '../i18n';
import {
  datagenApi as api, feeds, fetchCatalog, sourceLabel, type CatalogEntry, type JobStatus, type PipelineName,
} from '../lib/datagenApi';

const { Content } = Layout;
const { Title, Text, Paragraph } = Typography;

/**
 * Datagen: the daemon's dataset-generation jobs (`/api/datagen/*`, guide
 * `senclaw/docs/datagen.md`). Start a job for any of the generating
 * pipelines, watch it fill, cancel it, read the records it wrote, delete a
 * dataset — and, on the "Source datasets" tab, install a dataset people
 * wrote from the catalog or import one from a file, a URL or Hugging Face,
 * then use it as seeds or problems for a new job.
 * Everything here is visible regardless of which chat started it — the
 * per-chat scoping applies to the agent's tools, not to the person.
 */

type GeneratingPipeline = Exclude<PipelineName, 'import'>;

const PIPELINES: GeneratingPipeline[] = ['expand_seeds', 'doc_qa', 'reasoning_traces', 'executable_qa', 'export_logs'];

const STATE_COLOR: Record<string, string> = {
  running: 'processing',
  done: 'green',
  failed: 'red',
  cancelled: 'default',
  interrupted: 'orange',
};

// States, pipeline names and record kinds reach `t()` through a variable.
// i18n-dynamic: running, done, failed, cancelled, interrupted, expand_seeds, doc_qa, reasoning_traces, executable_qa, export_logs, import, labeled_text, qa_context, problem_answer, chat

const errText = (e: unknown) => String(e instanceof Error ? e.message : e);

function fmtTime(ms?: number | null): string {
  return ms ? new Date(ms).toLocaleString() : '—';
}

/** Non-empty trimmed lines. */
const lines = (s?: string) => (s ?? '').split('\n').map((l) => l.trim()).filter(Boolean);

/** `left || right` → [left, right]; a line without the separator has no right side. */
function split2(line: string, sep: string): [string, string | undefined] {
  const i = line.indexOf(sep);
  return i < 0 ? [line, undefined] : [line.slice(0, i).trim(), line.slice(i + sep.length).trim()];
}

/** A dataset picked instead of typed lines: `{dataset, perLabel?}`. */
function datasetRef(v: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const name = v[key];
  if (typeof name !== 'string' || !name) return null;
  return { dataset: name, ...(v.perLabel ? { perLabel: v.perLabel } : {}) };
}

/** Form values → the daemon's camelCase job body for one pipeline. */
function buildBody(pipeline: GeneratingPipeline, v: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = { pipeline };
  const put = (k: string, val: unknown) => {
    if (val !== undefined && val !== null && val !== '') body[k] = val;
  };
  put('name', v.name);
  if (pipeline !== 'export_logs') {
    put('language', v.language);
    put('maxLlmCalls', v.maxLlmCalls);
    put('profile', v.profile);
  }
  switch (pipeline) {
    case 'expand_seeds': {
      // `label | request` per line, or just the request — or a dataset.
      const from = datasetRef(v, 'seedsFrom');
      if (from) body.seedsFrom = from;
      else body.seeds = lines(v.seeds as string).map((l) => {
        const [a, b] = split2(l, ' | ');
        return b === undefined ? a : { label: a, text: b };
      });
      const labels = Object.fromEntries(lines(v.labels as string).map((l) => split2(l, ':')).filter(([, d]) => d));
      if (Object.keys(labels).length) body.labels = labels;
      put('mode', v.mode);
      put('target', v.target);
      if (v.checkLabel === 'on' || v.checkLabel === 'off') body.checkLabel = v.checkLabel === 'on';
      break;
    }
    case 'doc_qa':
      // Documents separated by a line holding only `---`.
      body.texts = String(v.texts ?? '').split(/\n-{3,}\n/).map((t) => t.trim()).filter(Boolean);
      body.paths = lines(v.paths as string);
      put('target', v.target);
      put('perPassage', v.perPassage);
      put('multiHop', v.multiHop);
      put('verify', v.verify);
      break;
    case 'reasoning_traces': {
      const from = datasetRef(v, 'problemsFrom');
      if (from) body.problemsFrom = from;
      else body.problems = lines(v.problems as string).map((l) => {
        const [problem, answer] = split2(l, ' || ');
        return answer === undefined ? problem : { problem, answer };
      });
      put('target', v.target);
      put('maxIterations', v.maxIterations);
      put('threshold', v.threshold);
      break;
    }
    case 'executable_qa': {
      const from = datasetRef(v, 'seedsFrom');
      if (from) body.seedsFrom = from;
      else body.seeds = lines(v.seeds as string).map((l) => {
        const [question, answer] = split2(l, ' || ');
        return answer === undefined ? question : { question, answer };
      });
      put('target', v.target);
      put('timeoutMs', v.timeoutMs);
      break;
    }
    case 'export_logs':
      body.chats = lines(v.chats as string);
      put('format', v.format);
      put('maxRecords', v.maxRecords);
      break;
  }
  return body;
}

export function DatagenPage() {
  const { t } = useLang();
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const [datasets, setDatasets] = useState<JobStatus[]>([]);
  const [root, setRoot] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pipeline, setPipeline] = useState<GeneratingPipeline>('expand_seeds');
  const [view, setView] = useState<'jobs' | 'sources'>('jobs');
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [importing, setImporting] = useState(false);
  // A dataset chosen with "Use as seeds / problems", put in the new job's form.
  const [prefill, setPrefill] = useState<string | undefined>();
  const [viewing, setViewing] = useState<string | null>(null);
  const [records, setRecords] = useState<unknown[]>([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordsPage, setRecordsPage] = useState(1);
  const [form] = Form.useForm();
  // Paging requests can come back out of order; only the latest one lands.
  const recordsReq = useRef(0);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [j, d, c] = await Promise.all([
        api<{ jobs: JobStatus[] }>('/api/datagen/jobs'),
        api<{ datasets: JobStatus[]; root: string }>('/api/datagen/datasets'),
        fetchCatalog(),
      ]);
      setJobs(j.jobs ?? []);
      setDatasets(d.datasets ?? []);
      setRoot(d.root ?? '');
      setCatalog(c.entries ?? []);
    } catch (e) {
      if (!quiet) message.error(errText(e));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll only while something is running; an idle page makes no requests.
  const anyRunning = jobs.some((j) => j.state === 'running');
  useEffect(() => {
    if (!anyRunning) return;
    const id = window.setInterval(() => void load(true), 2500);
    return () => window.clearInterval(id);
  }, [anyRunning, load]);

  const loadRecords = useCallback(async (name: string, page: number) => {
    const req = ++recordsReq.current;
    try {
      const body = await api<{ records: unknown[]; total: number }>(
        `/api/datagen/datasets/${encodeURIComponent(name)}/records?offset=${(page - 1) * 10}&limit=10`,
      );
      if (req !== recordsReq.current) return;
      setRecords(body.records ?? []);
      setRecordsTotal(body.total ?? 0);
      setRecordsPage(page);
    } catch (e) {
      message.error(errText(e));
    }
  }, []);

  const openRecords = (name: string) => {
    setViewing(name);
    setRecords([]);
    void loadRecords(name, 1);
  };

  /** Open the new-job drawer for `p`, fed from dataset `name`. */
  const useDataset = (name: string, p: GeneratingPipeline) => {
    form.resetFields();
    setPrefill(name);
    setPipeline(p);
    setCreating(true);
  };

  const cancel = async (job: JobStatus) => {
    try {
      await api(`/api/datagen/jobs/${encodeURIComponent(job.jobId)}/cancel`, { method: 'POST' });
      await load(true);
    } catch (e) {
      message.error(errText(e));
    }
  };

  const remove = (ds: JobStatus) => {
    Modal.confirm({
      title: t('Delete this dataset?'),
      content: ds.name,
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api(`/api/datagen/datasets/${encodeURIComponent(ds.name)}`, { method: 'DELETE' });
          if (viewing === ds.name) setViewing(null);
          await load(true);
        } catch (e) {
          message.error(errText(e));
        }
      },
    });
  };

  const submit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      await api('/api/datagen/jobs', { method: 'POST', body: JSON.stringify(buildBody(pipeline, values)) });
      message.success(t('Started'));
      setCreating(false);
      setPrefill(undefined);
      form.resetFields();
      await load(true);
    } catch (e) {
      message.error(errText(e));
    } finally {
      setSubmitting(false);
    }
  };

  const rejectedText = (r: Record<string, number>) =>
    Object.entries(r ?? {}).map(([k, v]) => `${v} ${k}`).join(', ') || '—';

  const progressCol = {
    title: t('Progress'),
    width: 200,
    render: (_: unknown, j: JobStatus) => {
      // An import's target is a ceiling, not a goal: progress is rows read
      // out of the rows the source has.
      const sourceRows = Number((j.provenance as { sourceRows?: number } | null | undefined)?.sourceRows ?? 0);
      const isImport = j.pipeline === 'import';
      const of = isImport ? Math.min(j.target, sourceRows || j.target) : j.target;
      const done = isImport ? (j.state === 'running' ? j.attempts : of) : j.accepted;
      return (
      <div>
        <Progress
          percent={of ? Math.min(100, Math.round((done / of) * 100)) : 0}
          size="small"
          status={j.state === 'failed' ? 'exception' : j.state === 'running' ? 'active' : undefined}
          format={() => (isImport ? `${j.accepted}` : `${j.accepted}/${j.target}`)}
        />
        {j.maxLlmCalls > 0 && (
          <Text type="secondary" style={{ fontSize: 11 }}>
            {t('LLM calls')}: {j.llmCalls}/{j.maxLlmCalls}
          </Text>
        )}
      </div>
      );
    },
  };

  const stateCol = {
    title: t('Status'),
    width: 130,
    render: (_: unknown, j: JobStatus) => (
      <Tooltip title={j.error || j.note || undefined}>
        <Tag color={STATE_COLOR[j.state] ?? 'default'}>{t(j.state)}</Tag>
      </Tooltip>
    ),
  };

  const nameCol = {
    title: t('Name'),
    render: (_: unknown, j: JobStatus) => (
      <div>
        <Text strong>{j.name}</Text> <Tag>{t(j.pipeline)}</Tag>
        {(j.error || j.note) && (
          <div>
            <Text type={j.error ? 'danger' : 'secondary'} style={{ fontSize: 12 }}>{j.error || j.note}</Text>
          </div>
        )}
      </div>
    ),
  };

  const jobColumns = useMemo(
    () => [
      nameCol,
      stateCol,
      progressCol,
      {
        title: t('Rejected'),
        render: (_: unknown, j: JobStatus) => <Text style={{ fontSize: 12 }}>{rejectedText(j.rejected)}</Text>,
      },
      {
        title: '',
        width: 60,
        render: (_: unknown, j: JobStatus) =>
          j.state === 'running' ? (
            <Tooltip title={t('Cancel')}>
              <Button size="small" type="text" danger icon={<StopOutlined />} onClick={() => cancel(j)} />
            </Tooltip>
          ) : null,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );

  const datasetColumns = useMemo(
    () => [
      nameCol,
      stateCol,
      progressCol,
      {
        title: t('Source'),
        width: 200,
        render: (_: unknown, d: JobStatus) => {
          const src = sourceLabel(d.provenance);
          if (!src) return <Text style={{ fontSize: 12 }}>{d.model || '—'}</Text>;
          return (
            <Space size={4} wrap>
              <Text style={{ fontSize: 12 }}>{src}</Text>
              {d.provenance?.license && <Tag style={{ fontSize: 11 }}>{d.provenance.license}</Tag>}
            </Space>
          );
        },
      },
      { title: t('Started at'), width: 170, render: (_: unknown, d: JobStatus) => <Text style={{ fontSize: 12 }}>{fmtTime(d.startedAt)}</Text> },
      {
        title: '',
        width: 210,
        render: (_: unknown, d: JobStatus) => (
          <Space size={2} wrap>
            {d.state !== 'running' && feeds(d).seeds && (
              <Button size="small" type="link" onClick={() => useDataset(d.name, 'expand_seeds')}>{t('Use as seeds')}</Button>
            )}
            {d.state !== 'running' && feeds(d).problems && (
              <Button size="small" type="link" onClick={() => useDataset(d.name, 'reasoning_traces')}>{t('Use as problems')}</Button>
            )}
            <Tooltip title={t('View records')}>
              <Button size="small" type="text" icon={<EyeOutlined />} onClick={() => openRecords(d.name)} />
            </Tooltip>
            <Tooltip title={t('Delete')}>
              <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(d)} />
            </Tooltip>
          </Space>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, viewing, form],
  );

  // Datasets a new job can read from, finished ones only.
  const datasetOptions = datasets
    .filter((d) => d.state !== 'running' && d.state !== 'failed')
    .map((d) => ({ value: d.name, label: d.name }));

  /** "Or take them from a dataset", shared by the three pipelines that can. */
  const fromDatasetFields = (key: 'seedsFrom' | 'problemsFrom') => (
    <Space wrap>
      <Form.Item name={key} label={key === 'seedsFrom' ? t('Or seeds from a dataset') : t('Or problems from a dataset')}
        initialValue={prefill} style={{ minWidth: 260 }}>
        <Select allowClear showSearch options={datasetOptions} placeholder={t('dataset')} />
      </Form.Item>
      <Form.Item name="perLabel" label={t('Per label')} tooltip={t('At most this many records of each label, spread across the dataset.')}>
        <InputNumber min={1} max={1000} />
      </Form.Item>
    </Space>
  );

  /** A line field that is required only when no dataset was picked instead. */
  const unlessFrom = (key: 'seedsFrom' | 'problemsFrom', msg: string) => [
    ({ getFieldValue }: { getFieldValue: (n: string) => unknown }) => ({
      validator(_: unknown, value: unknown) {
        return value || getFieldValue(key) ? Promise.resolve() : Promise.reject(new Error(msg));
      },
    }),
  ];

  const commonModelFields = (
    <>
      <Form.Item name="language" label={t('Language')} extra={t('Leave empty to write in the language of the input.')}>
        <Input placeholder="Vietnamese" />
      </Form.Item>
      <Form.Item name="maxLlmCalls" label={t('Max LLM calls')} extra={t('Hard cap for the whole job. Empty uses the default.')}>
        <InputNumber min={1} max={2000} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item name="profile" label={t('Model profile')} extra={t('LLM config id or label. Empty uses the active model.')}>
        <Input />
      </Form.Item>
    </>
  );

  const pipelineFields: Record<GeneratingPipeline, ReactNode> = {
    expand_seeds: (
      <>
        <Form.Item name="seeds" label={t('Example requests')} rules={unlessFrom('seedsFrom', t('Give example requests or pick a dataset'))}
          dependencies={['seedsFrom']}
          extra={t('One per line. Prefix a label with " | " to make a labelled set, e.g. "browser | find a cheap flight".')}>
          <Input.TextArea rows={6} />
        </Form.Item>
        {fromDatasetFields('seedsFrom')}
        <Form.Item name="labels" label={t('Label descriptions')} extra={t('Optional, one per line: "label: what it means".')}>
          <Input.TextArea rows={3} />
        </Form.Item>
        <Space wrap>
          <Form.Item name="mode" label={t('Mode')} initialValue="new">
            <Select style={{ width: 140 }} options={[{ value: 'new', label: t('New requests') }, { value: 'evolve', label: t('Evolve seeds') }]} />
          </Form.Item>
          <Form.Item name="target" label={t('Target')} initialValue={50}>
            <InputNumber min={1} max={2000} />
          </Form.Item>
          <Form.Item name="checkLabel" label={t('Check labels')} initialValue="auto"
            tooltip={t('Auto: on when the seeds carry two or more labels.')}>
            <Select style={{ width: 120 }} options={[
              { value: 'auto', label: t('Auto') },
              { value: 'on', label: t('On') },
              { value: 'off', label: t('Off') },
            ]} />
          </Form.Item>
        </Space>
      </>
    ),
    doc_qa: (
      <>
        <Form.Item name="texts" label={t('Documents')} extra={t('Paste text; separate documents with a line holding only ---.')}>
          <Input.TextArea rows={6} />
        </Form.Item>
        <Form.Item name="paths" label={t('Files or folders')} extra={t('Absolute paths of .md/.txt files or folders, one per line.')}>
          <Input.TextArea rows={2} />
        </Form.Item>
        <Space wrap>
          <Form.Item name="target" label={t('Target')} initialValue={50}>
            <InputNumber min={1} max={2000} />
          </Form.Item>
          <Form.Item name="perPassage" label={t('Pairs per passage')} initialValue={3}>
            <InputNumber min={1} max={6} />
          </Form.Item>
          <Form.Item name="multiHop" label={t('Multi-hop')} valuePropName="checked" initialValue>
            <Switch />
          </Form.Item>
          <Form.Item name="verify" label={t('Verify grounding')} valuePropName="checked" initialValue>
            <Switch />
          </Form.Item>
        </Space>
      </>
    ),
    reasoning_traces: (
      <>
        <Form.Item name="problems" label={t('Problems')} rules={unlessFrom('problemsFrom', t('Give problems or pick a dataset'))}
          dependencies={['problemsFrom']}
          extra={t('One per line. Add the known answer after " || " to have it checked.')}>
          <Input.TextArea rows={6} />
        </Form.Item>
        {fromDatasetFields('problemsFrom')}
        <Space wrap>
          <Form.Item name="target" label={t('Target')}>
            <InputNumber min={1} />
          </Form.Item>
          <Form.Item name="maxIterations" label={t('Improvement rounds')} initialValue={3}>
            <InputNumber min={0} max={5} />
          </Form.Item>
          <Form.Item name="threshold" label={t('Score threshold')} initialValue={0.7}>
            <InputNumber min={0} max={1} step={0.05} />
          </Form.Item>
        </Space>
      </>
    ),
    executable_qa: (
      <>
        <Form.Item name="seeds" label={t('Example problems')} rules={unlessFrom('seedsFrom', t('Give example problems or pick a dataset'))}
          dependencies={['seedsFrom']}
          extra={t('One per line, optionally "question || answer". Generated programs run in the sandbox; the job refuses to start without an enforced one.')}>
          <Input.TextArea rows={6} />
        </Form.Item>
        {fromDatasetFields('seedsFrom')}
        <Space wrap>
          <Form.Item name="target" label={t('Target')} initialValue={50}>
            <InputNumber min={1} max={1000} />
          </Form.Item>
          <Form.Item name="timeoutMs" label={t('Program timeout (ms)')} initialValue={10000}>
            <InputNumber min={1000} max={60000} step={1000} />
          </Form.Item>
        </Space>
      </>
    ),
    export_logs: (
      <>
        <Form.Item name="chats" label={t('Chats')} rules={[{ required: true }]}
          extra={t('Chat ids, one per line, or * for every chat with recorded turns. Only chats with the trajectory turned on have any.')}>
          <Input.TextArea rows={3} />
        </Form.Item>
        <Space wrap>
          <Form.Item name="format" label={t('Format')} initialValue="sharegpt">
            <Select style={{ width: 140 }} options={['sharegpt', 'alpaca', 'messages'].map((f) => ({ value: f, label: f }))} />
          </Form.Item>
          <Form.Item name="maxRecords" label={t('Max records')}>
            <InputNumber min={1} max={100000} />
          </Form.Item>
        </Space>
      </>
    ),
  };

  return (
    <AppLayout sidebar={null}>
      <Layout style={{ background: 'transparent', height: '100%', padding: 24, overflowY: 'auto' }}>
        <Content style={{ maxWidth: 1280, margin: '0 auto', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20 }}>
            <div style={{ flex: 1 }}>
              <Title level={2} style={{ margin: 0 }}>{t('Datagen')}</Title>
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                {t('Build datasets in the background: labelled eval sets, Q&A from documents, checked reasoning traces, computable problems, or your own chat logs — or import datasets people wrote.')}
                {root && <> <Text code style={{ fontSize: 12 }}>{root}</Text></>}
              </Paragraph>
            </div>
            <Space>
              <Button icon={<ReloadOutlined />} onClick={() => void load()}>{t('Reload')}</Button>
              <Button icon={<ImportOutlined />} onClick={() => setImporting(true)}>{t('Import file / URL…')}</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => { setPrefill(undefined); setCreating(true); }}>{t('New job')}</Button>
            </Space>
          </div>
          <Segmented
            style={{ marginBottom: 16 }}
            value={view}
            onChange={(v) => setView(v as 'jobs' | 'sources')}
            options={[
              { value: 'jobs', label: t('Jobs & datasets') },
              { value: 'sources', label: t('Source datasets') },
            ]}
          />

          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
              <Spin size="large" />
            </div>
          ) : view === 'sources' ? (
            <>
              <Paragraph type="secondary">
                {t('Datasets written and labelled by people, ready to use as seeds or to measure with. Bundled ones install offline; the others download from Hugging Face when you install them.')}
              </Paragraph>
              <SourceCatalog
                entries={catalog}
                jobs={jobs}
                onChanged={() => void load(true)}
                onView={openRecords}
                onUseAsSeeds={(n) => useDataset(n, 'expand_seeds')}
                onUseAsProblems={(n) => useDataset(n, 'reasoning_traces')}
              />
            </>
          ) : (
            <>
              {jobs.length > 0 && (
                <>
                  <Title level={4}>{t('Jobs in this daemon run')}</Title>
                  <Table rowKey="jobId" size="small" columns={jobColumns} dataSource={jobs} pagination={false} style={{ marginBottom: 24 }} />
                </>
              )}
              <Title level={4}>{t('Datasets')}</Title>
              {datasets.length === 0 ? (
                <Empty description={t('No datasets yet')} />
              ) : (
                <Table rowKey="name" size="small" columns={datasetColumns} dataSource={datasets} pagination={{ pageSize: 20 }} />
              )}
            </>
          )}
        </Content>
      </Layout>

      <ImportDrawer open={importing} onClose={() => setImporting(false)} onStarted={() => { setView('jobs'); void load(true); }} />

      <Drawer
        title={t('New datagen job')}
        open={creating}
        width={560}
        onClose={() => { setCreating(false); setPrefill(undefined); }}
        extra={<Button type="primary" loading={submitting} onClick={() => void submit()}>{t('Start')}</Button>}
      >
        {/* `preserve={false}` plus a remount per pipeline: a field the new
            pipeline also has (Target) starts from its own default instead of
            carrying the last pipeline's value into a job it was never shown for. */}
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item label={t('Pipeline')}>
            <Select
              value={pipeline}
              onChange={(v: GeneratingPipeline) => setPipeline(v)}
              options={PIPELINES.map((p) => ({ value: p, label: t(p) }))}
            />
          </Form.Item>
          <Form.Item name="name" label={t('Dataset name')} extra={t('Empty uses the pipeline and the date.')}>
            <Input />
          </Form.Item>
          <div key={pipeline}>
            {pipelineFields[pipeline]}
            {pipeline !== 'export_logs' && commonModelFields}
          </div>
        </Form>
      </Drawer>

      <Drawer title={viewing ?? ''} open={viewing !== null} width={720} onClose={() => setViewing(null)}>
        {records.length === 0 ? (
          <Empty description={t('No records')} />
        ) : (
          <Space direction="vertical" style={{ width: '100%' }}>
            {records.map((r, i) => (
              <pre key={i} style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, padding: 8, borderRadius: 6, background: 'rgba(127,127,127,0.08)' }}>
                {JSON.stringify(r, null, 2)}
              </pre>
            ))}
            <Pagination
              current={recordsPage}
              total={recordsTotal}
              pageSize={10}
              showSizeChanger={false}
              onChange={(p) => viewing && void loadRecords(viewing, p)}
            />
          </Space>
        )}
      </Drawer>
    </AppLayout>
  );
}
