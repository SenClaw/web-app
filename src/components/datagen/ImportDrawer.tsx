import { useEffect, useState } from 'react';
import {
  AutoComplete, Alert, Button, Drawer, Form, Input, InputNumber, Segmented, Select, Space, Table, Tag, Typography, Upload, message,
} from 'antd';
import { InboxOutlined, ReloadOutlined } from '@ant-design/icons';

import { useLang } from '../../i18n';
import {
  KIND_FIELDS, RECORD_KINDS, previewImport, startJob, type ImportSource, type PreviewResult, type RecordKind,
} from '../../lib/datagenApi';

const { Text } = Typography;

type Tab = 'file' | 'url' | 'hf';

/** The daemon reads an inline file of at most 8 MB; bigger goes by URL. */
const MAX_FILE_BYTES = 8 * 1024 * 1024;

const LICENSES = ['MIT', 'Apache-2.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'CC0-1.0', 'private', 'unknown'];

/**
 * Import a dataset that is not in the catalog: a file, a URL, or any public
 * Hugging Face dataset. Nothing is written until Import: Preview asks the
 * daemon (`POST /api/datagen/import/preview`) for the columns, a guessed
 * kind and mapping, and the first rows as the records they would become —
 * or the reason each would be dropped. The license is required because it
 * travels with the records.
 */
export function ImportDrawer({ open, onClose, onStarted }: { open: boolean; onClose: () => void; onStarted: () => void }) {
  const { t, tArgs } = useLang();
  const [tab, setTab] = useState<Tab>('file');
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [url, setUrl] = useState('');
  const [hf, setHf] = useState({ dataset: '', config: '', split: '' });
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [stale, setStale] = useState(false);
  const [kind, setKind] = useState<RecordKind | undefined>();
  const [mapping, setMapping] = useState<Record<string, string | undefined>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();

  useEffect(() => {
    if (open) return;
    setPreview(null);
    setKind(undefined);
    setMapping({});
    setFile(null);
    form.resetFields();
  }, [open, form]);

  const source = (): ImportSource | null => {
    if (tab === 'file') return file ? { file } : null;
    if (tab === 'url') return url.trim() ? { url: url.trim() } : null;
    if (!hf.dataset.trim()) return null;
    return { hf: { dataset: hf.dataset.trim(), ...(hf.config ? { config: hf.config } : {}), ...(hf.split ? { split: hf.split } : {}) } };
  };

  const cleanMapping = (m: Record<string, string | undefined>) =>
    Object.fromEntries(Object.entries(m).filter(([, v]) => v)) as Record<string, string>;

  /** Ask for a preview. A new kind drops the mapping so the daemon guesses one for it. */
  const runPreview = async (nextKind = kind, nextMapping: Record<string, string | undefined> | null = mapping) => {
    const src = source();
    if (!src) {
      message.warning(t('Choose a file, a URL or a dataset first'));
      return;
    }
    setLoading(true);
    try {
      const body = { source: src, ...(nextKind ? { kind: nextKind } : {}), ...(nextMapping ? { mapping: cleanMapping(nextMapping) } : {}) };
      const p = await previewImport(body);
      setPreview(p);
      setStale(false);
      const k = nextKind ?? p.suggested?.kind;
      setKind(k);
      if (!nextMapping || Object.keys(cleanMapping(nextMapping)).length === 0) setMapping(p.suggested?.mapping ?? {});
      if (p.config && p.split) setHf((h) => ({ ...h, config: p.config!, split: p.split! }));
      if (!form.getFieldValue('license') && p.license) form.setFieldValue('license', p.license);
      if (!form.getFieldValue('name')) {
        const n = tab === 'file' ? file?.name.replace(/\.[^.]+$/, '') : tab === 'hf' ? hf.dataset.split('/').pop() : '';
        if (n) form.setFieldValue('name', n);
      }
    } catch (e) {
      setPreview(null);
      message.error(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    const src = source();
    if (!src || !kind) return;
    const v = await form.validateFields();
    setSubmitting(true);
    try {
      await startJob({
        pipeline: 'import',
        source: src,
        kind,
        mapping: cleanMapping(mapping),
        ...(v.name ? { name: v.name } : {}),
        ...(v.maxRecords ? { maxRecords: v.maxRecords } : {}),
        license: v.license,
        ...(v.attribution ? { attribution: v.attribution } : {}),
      });
      message.success(t('Started'));
      onStarted();
      onClose();
    } catch (e) {
      message.error(String(e instanceof Error ? e.message : e));
    } finally {
      setSubmitting(false);
    }
  };

  const fields = kind ? KIND_FIELDS[kind] : [];
  const columnOptions = (preview?.columns ?? []).map((c) => ({ value: c, label: c }));
  const missingRequired = fields.some((f) => f.required && !mapping[f.field]);

  const recordColumns = [
    ...fields.map((f) => ({
      title: f.field,
      render: (_: unknown, r: NonNullable<PreviewResult['records']>[number]) => {
        if ('rejected' in r) return null;
        const rec = r.record as Record<string, unknown>;
        const v = kind === 'chat'
          ? (rec.messages as { role: string; content: string }[] | undefined)?.find((m) => m.role === f.field)?.content
          : rec[f.field];
        return <Text style={{ fontSize: 12 }} ellipsis={{ tooltip: String(v ?? '') }}>{v === undefined ? '' : String(v)}</Text>;
      },
    })),
    {
      title: '',
      width: 130,
      render: (_: unknown, r: NonNullable<PreviewResult['records']>[number]) =>
        'rejected' in r ? <Tag color="red">{r.rejected}</Tag> : <Tag color="green">{t('kept')}</Tag>,
    },
  ];

  return (
    <Drawer
      title={t('Import dataset')}
      open={open}
      width={760}
      onClose={onClose}
      extra={
        <Button type="primary" loading={submitting} disabled={!preview || !kind || missingRequired} onClick={() => void submit()}>
          {t('Import')}
        </Button>
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Segmented
          value={tab}
          onChange={(v) => {
            setTab(v as Tab);
            setPreview(null);
            setKind(undefined);
            setMapping({});
          }}
          options={[
            { value: 'file', label: t('File') },
            { value: 'url', label: 'URL' },
            { value: 'hf', label: 'Hugging Face' },
          ]}
        />

        {tab === 'file' && (
          <Upload.Dragger
            accept=".jsonl,.ndjson,.json,.csv,.tsv"
            maxCount={1}
            showUploadList={false}
            beforeUpload={(f) => {
              if (f.size > MAX_FILE_BYTES) {
                message.error(t('The file is larger than 8 MB — import it from a URL instead'));
                return Upload.LIST_IGNORE;
              }
              void f.text().then((content) => {
                setFile({ name: f.name, content });
                setPreview(null);
              });
              return false;
            }}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">{file ? file.name : t('Drop a .jsonl, .json, .csv or .tsv file here')}</p>
            <p className="ant-upload-hint">{t('UTF-8 only. In Excel: Save As → CSV UTF-8.')}</p>
          </Upload.Dragger>
        )}
        {tab === 'url' && (
          <Input
            placeholder="https://…/data.jsonl"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onPressEnter={() => void runPreview(undefined, null)}
          />
        )}
        {tab === 'hf' && (
          <Space wrap>
            <Input
              style={{ width: 300 }}
              placeholder="owner/dataset"
              value={hf.dataset}
              onChange={(e) => setHf({ dataset: e.target.value, config: '', split: '' })}
              onPressEnter={() => void runPreview(undefined, null)}
            />
            {preview?.splits && preview.splits.length > 0 && (
              <Select
                style={{ width: 240 }}
                value={`${hf.config}/${hf.split}`}
                options={preview.splits.map((s) => ({ value: `${s.config}/${s.split}`, label: `${s.config} · ${s.split}` }))}
                onChange={(v: string) => {
                  const [config, split] = v.split('/');
                  setHf((h) => ({ ...h, config, split }));
                  setStale(true);
                }}
              />
            )}
          </Space>
        )}

        <Space>
          <Button loading={loading} icon={<ReloadOutlined />} onClick={() => void runPreview(kind, preview ? mapping : null)}>
            {preview ? t('Refresh preview') : t('Preview')}
          </Button>
          {preview?.total !== undefined && (
            <Text type="secondary">{tArgs('{n} rows', { n: preview.total.toLocaleString() })}{preview.format ? ` · ${preview.format}` : ''}</Text>
          )}
          {stale && <Text type="warning">{t('Changed — refresh the preview')}</Text>}
        </Space>

        {preview && (
          <>
            <Space wrap align="start">
              <Form.Item label={t('Kind')} style={{ marginBottom: 0 }}>
                <Select
                  style={{ width: 180 }}
                  value={kind}
                  options={RECORD_KINDS.map((k) => ({ value: k, label: t(k) }))}
                  onChange={(k: RecordKind) => {
                    setKind(k);
                    void runPreview(k, null);
                  }}
                />
              </Form.Item>
              {fields.map((f) => (
                <Form.Item key={f.field} label={f.required ? `${f.field} *` : f.field} style={{ marginBottom: 0 }}>
                  <Select
                    style={{ width: 170 }}
                    allowClear
                    value={mapping[f.field]}
                    options={columnOptions}
                    placeholder={t('column')}
                    onChange={(c?: string) => {
                      setMapping((m) => ({ ...m, [f.field]: c }));
                      setStale(true);
                    }}
                  />
                </Form.Item>
              ))}
            </Space>
            {preview.mappingError && <Alert type="warning" showIcon message={preview.mappingError} />}
            {preview.partial && <Alert type="info" showIcon message={t('The dataset viewer serves only the first part of this split.')} />}
            {preview.records && (
              <Table
                size="small"
                rowKey={(_, i) => String(i)}
                columns={recordColumns}
                dataSource={preview.records}
                pagination={false}
                scroll={{ x: true }}
              />
            )}
            <Form form={form} layout="vertical">
              <Space wrap align="start">
                <Form.Item name="name" label={t('Dataset name')} style={{ width: 220 }}>
                  <Input />
                </Form.Item>
                <Form.Item name="maxRecords" label={t('Max records')} extra={t('Empty: 20,000')}>
                  <InputNumber min={1} max={100000} />
                </Form.Item>
                <Form.Item
                  name="license"
                  label={t('License')}
                  rules={[{ required: true, message: t('Say the license, or private / unknown') }]}
                  style={{ width: 200 }}
                >
                  <AutoComplete options={LICENSES.map((l) => ({ value: l }))} />
                </Form.Item>
                <Form.Item name="attribution" label={t('Attribution')} style={{ width: 240 }}>
                  <Input placeholder={t('Author, source')} />
                </Form.Item>
              </Space>
            </Form>
          </>
        )}
      </Space>
    </Drawer>
  );
}
