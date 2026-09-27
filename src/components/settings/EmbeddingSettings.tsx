import React, { useState, useEffect } from 'react';
import {
  Typography,
  Form,
  Select,
  Input,
  InputNumber,
  Button,
  Alert,
  Spin,
  Divider,
  Card,
  Space,
  Tag,
  message,
} from 'antd';
import {
  SaveOutlined,
  DatabaseOutlined,
  ExportOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { useLang } from '../../i18n';
import { localModelsApi, type LocalModel } from '../../lib/runtimeApi';

const { Title, Text } = Typography;
const { Option } = Select;

interface EmbeddingConfig {
  provider: string;
  apiKey: string;
  baseURL: string;
  modelName: string;
  modelPath: string;
  dimensions: number | null;
}

const PROVIDER_DEFAULTS: Record<string, Partial<EmbeddingConfig>> = {
  none: { apiKey: '', baseURL: '', modelName: '', modelPath: '' },
  openai: {
    baseURL: 'https://api.openai.com/v1',
    modelName: 'text-embedding-3-small',
    modelPath: '',
  },
  openrouter: {
    baseURL: 'https://openrouter.ai/api/v1',
    modelName: 'openai/text-embedding-3-small',
    modelPath: '',
  },
  ollama: {
    baseURL: 'http://localhost:11434',
    modelName: 'nomic-embed-text',
    apiKey: '',
    modelPath: '',
  },
  local: {
    baseURL: '',
    apiKey: '',
    // Empty on purpose — the old candle preset name passed the `required`
    // validator and then 404'd, since no GGUF model with that key exists in
    // Local models. Leaving it blank forces an explicit pick.
    modelName: '',
    modelPath: '',
  },
};

const PROVIDER_LABELS: Record<string, string> = {
  none: 'None (FTS only)',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  ollama: 'Ollama (local server)',
  local: 'Local (GGUF / on-device)',
};

const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  none: 'Full-text search only — no vector embeddings.',
  openai: 'Remote API. Requires an OpenAI API key.',
  openrouter: 'Route through OpenRouter. Requires an OpenRouter API key.',
  ollama: 'Self-hosted Ollama server running locally.',
  local: 'A GGUF embedding model from Local models, served by the runtime selected for GGUF. No network required once downloaded.',
};

interface Props {
  onOpenLocalModels?: () => void;
  onOpenRuntimeSettings?: () => void;
}

export const EmbeddingSettings: React.FC<Props> = ({ onOpenLocalModels, onOpenRuntimeSettings }) => {
  const { t } = useLang();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState<string>('none');
  const [status, setStatus] = useState<{ msg: string; type: 'success' | 'error' | 'info' | '' }>({ msg: '', type: '' });
  /**
   * GGUF models tagged `embedding: true` in the shared Local models library —
   * the daemon has no in-process embedding engine any more (candle left with
   * the rest of the runtime split), so "local" now means picking one of these
   * and letting the runtime selected for GGUF serve it.
   */
  const [localModels, setLocalModels] = useState<LocalModel[]>([]);
  const [localModelsLoading, setLocalModelsLoading] = useState(false);
  const [localModelsError, setLocalModelsError] = useState<string | null>(null);
  // Watch the modelName field so the runtime-missing hint re-renders when the
  // user picks a different local model. Without this, `form.getFieldValue`
  // reads stale at render time.
  const watchedModelName: string | undefined = Form.useWatch('modelName', form);

  const fetchLocalModels = async () => {
    setLocalModelsLoading(true);
    setLocalModelsError(null);
    try {
      const r = await localModelsApi.list();
      setLocalModels(r.models.filter((m) => m.embedding));
    } catch (e: any) {
      setLocalModelsError(e?.message ?? String(e));
    } finally {
      setLocalModelsLoading(false);
    }
  };

  function fmtBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/embedding-config');
      const d: EmbeddingConfig = await r.json();
      form.setFieldsValue(d);
      setProvider(d.provider ?? 'none');
    } catch {
      setStatus({ msg: 'Failed to load embedding configuration', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
    fetchLocalModels();
  }, []);

  const handleProviderChange = (p: string) => {
    setProvider(p);
    const defaults = PROVIDER_DEFAULTS[p] ?? {};
    form.setFieldsValue({ provider: p, ...defaults, dimensions: null });
    setStatus({ msg: '', type: '' });
  };

  const onFinish = async (values: EmbeddingConfig) => {
    setSaving(true);
    try {
      const r = await fetch('/api/embedding-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!r.ok) throw new Error('Save failed');
      setStatus({ msg: 'Configuration saved. Restart the daemon to apply changes.', type: 'success' });
    } catch {
      setStatus({ msg: 'Failed to save configuration', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 40 }}><Spin size="large" /></div>;
  }

  const needsKey = provider === 'openai' || provider === 'openrouter';
  const needsUrl = provider === 'openai' || provider === 'openrouter' || provider === 'ollama';
  const isLocal = provider === 'local';
  const isNone = provider === 'none';

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 28 }}>
        <Title level={4} style={{ margin: 0 }}>Embedding Provider</Title>
        <Text type="secondary">
          Configure vector embeddings for semantic memory search. Changes take effect on restart.
        </Text>
      </div>

      {provider !== 'none' && (
        <Card
          style={{ borderRadius: 12, marginBottom: 20, background: 'rgba(91,191,232,0.06)', border: '1px solid rgba(91,191,232,0.2)' }}
          styles={{ body: { padding: '12px 18px' } }}
        >
          <Space>
            <DatabaseOutlined style={{ color: '#5BBFE8' }} />
            <Text style={{ fontSize: 13 }}>{PROVIDER_DESCRIPTIONS[provider]}</Text>
            {isLocal && <Tag color="green" style={{ fontSize: 10 }}>On-device</Tag>}
          </Space>
        </Card>
      )}

      <Form form={form} layout="vertical" onFinish={onFinish} initialValues={{ provider: 'none' }}>
        <Form.Item name="provider" label="Provider" rules={[{ required: true }]}>
          <Select onChange={handleProviderChange} style={{ width: '100%' }}>
            {Object.entries(PROVIDER_LABELS).map(([k, v]) => (
              <Option key={k} value={k}>{v}</Option>
            ))}
          </Select>
        </Form.Item>

        {!isNone && (
          <>
            {needsUrl && (
              <Form.Item name="baseURL" label="Base URL" rules={[{ required: true }]}>
                <Input placeholder={provider === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1'} />
              </Form.Item>
            )}

            {needsKey && (
              <Form.Item name="apiKey" label="API Key" rules={[{ required: true }]}>
                <Input.Password placeholder="Enter your API key" />
              </Form.Item>
            )}

            {isLocal ? (
              <>
                <Form.Item
                  name="modelName"
                  label={t('Model')}
                  rules={[{ required: true, message: t('Pick a local embedding model') }]}
                >
                  {localModelsLoading ? (
                    <Spin size="small" />
                  ) : localModels.length === 0 ? (
                    <Alert
                      type="info"
                      showIcon
                      message={t('No GGUF embedding model has been downloaded yet.')}
                      description={
                        onOpenLocalModels && (
                          <Button size="small" icon={<ExportOutlined />} onClick={onOpenLocalModels}>
                            {t('Go to Local models')}
                          </Button>
                        )
                      }
                    />
                  ) : (
                    <Select
                      placeholder={t('Select a downloaded embedding model')}
                      showSearch
                      filterOption={(input, opt) => String(opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                      options={localModels.map((m) => ({
                        value: m.key,
                        label: `${m.name} (${fmtBytes(m.sizeBytes)})`,
                      }))}
                    />
                  )}
                </Form.Item>
                {localModelsError && <Alert type="error" showIcon message={localModelsError} style={{ marginBottom: 16 }} />}

                {(() => {
                  const selected = localModels.find((m) => m.key === watchedModelName);
                  if (!selected || selected.runtime.selected) return null;
                  return (
                    <Alert
                      type="warning"
                      showIcon
                      icon={<WarningOutlined />}
                      style={{ marginBottom: 16 }}
                      message={t('No runtime is selected for GGUF yet — embeddings will fail until one is.')}
                      action={
                        onOpenRuntimeSettings && (
                          <Button size="small" onClick={onOpenRuntimeSettings}>
                            {t('Open Runtime settings')}
                          </Button>
                        )
                      }
                    />
                  );
                })()}
              </>
            ) : (
              <Form.Item name="modelName" label="Model name" rules={[{ required: true }]}>
                <Input placeholder={
                  provider === 'openai' ? 'text-embedding-3-small' :
                  provider === 'openrouter' ? 'openai/text-embedding-3-small' :
                  'nomic-embed-text'
                } />
              </Form.Item>
            )}

            <Form.Item
              name="dimensions"
              label="Dimensions (optional)"
              help="Leave blank to use the provider default. Only set if using a custom model."
            >
              <InputNumber style={{ width: 160 }} min={64} max={4096} placeholder="auto" />
            </Form.Item>
          </>
        )}

        {status.msg && (
          <Alert message={status.msg} type={status.type as any} showIcon style={{ marginBottom: 20 }} />
        )}

        <Divider />

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            type="primary"
            htmlType="submit"
            icon={<SaveOutlined />}
            loading={saving}
            style={{ borderRadius: 8, height: 40, paddingInline: 24 }}
          >
            Save
          </Button>
        </div>
      </Form>
    </div>
  );
};
