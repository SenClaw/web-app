import React, { useState } from 'react';
import { Alert, Button, Popconfirm, Space, Spin, Table, Tag, Tooltip, Typography, message } from 'antd';
import { CloudDownloadOutlined, DeleteOutlined, EyeOutlined, PlayCircleOutlined, PoweroffOutlined } from '@ant-design/icons';
import { useLang } from '../../i18n';
import { useLocalModels } from '../../hooks/useLocalModels';
import {
  fmtBytes,
  runtimeMissingFromError,
  type LocalModel,
  type ProcessState,
  type RuntimeMissingInfo,
} from '../../lib/runtimeApi';
import { LocalModelDownloadDialog } from './LocalModelDownloadDialog';
import { LocalModelEngineSettingsCard } from './LocalModelEngineSettingsCard';
import { RuntimeMissingBanner } from './RuntimeMissingBanner';

const { Title, Paragraph, Text } = Typography;

const STATE_COLOR: Record<ProcessState, string> = {
  starting: 'processing',
  ready: 'success',
  stopping: 'warning',
  failed: 'error',
};

interface Props {
  onOpenRuntimeSettings: () => void;
}

/** Settings → Local models: the shared GGUF/MLX model library the runtimes load from. */
export const LocalModelsSettings: React.FC<Props> = ({ onOpenRuntimeSettings }) => {
  const { t } = useLang();
  const { view, settings, loading, loadError, refresh, startDownload, cancelDownload, remove, load, unload, saveSettings } =
    useLocalModels();
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [busy, setBusy] = useState<Record<string, string>>({});
  // Load answers the same structured 503 (`code`/`slot`) as the proxy (§5.3)
  // when the model's format slot has no usable runtime — shown as the same
  // banner the rest of Settings uses, not a bare toast.
  const [runtimeMissing, setRuntimeMissing] = useState<RuntimeMissingInfo | null>(null);

  const act = async (key: string, what: string, run: () => Promise<unknown>) => {
    setBusy((b) => ({ ...b, [key]: what }));
    try {
      await run();
      setRuntimeMissing(null);
    } catch (e: any) {
      const missing = runtimeMissingFromError(e);
      if (missing) setRuntimeMissing(missing);
      else message.error(e?.message ?? String(e));
    } finally {
      setBusy((b) => {
        const { [key]: _, ...rest } = b;
        return rest;
      });
    }
  };

  const columns = [
    {
      title: t('Model'),
      key: 'model',
      render: (_: unknown, m: LocalModel) => (
        <div>
          <Space size={6} wrap>
            <Text strong>{m.name}</Text>
            <Tag color={m.format === 'gguf' ? 'geekblue' : 'purple'}>{m.format.toUpperCase()}</Tag>
            {m.quant && <Tag>{m.quant}</Tag>}
            {m.vision && <Tag color="cyan">{t('vision')}</Tag>}
            {m.embedding && <Tag color="gold">{t('embedding')}</Tag>}
          </Space>
          <br />
          <Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>
            {m.repo ?? m.key}
          </Text>
        </div>
      ),
    },
    {
      title: t('Size'),
      key: 'size',
      width: 100,
      render: (_: unknown, m: LocalModel) => fmtBytes(m.sizeBytes),
    },
    {
      title: t('State'),
      key: 'state',
      width: 240,
      render: (_: unknown, m: LocalModel) => {
        if (!m.runtime.selected) {
          return (
            <Tooltip title={t('Select a runtime for this format in Settings → Runtime.')}>
              <a onClick={onOpenRuntimeSettings} style={{ cursor: 'pointer' }}>
                <Tag color="warning">{t('No runtime selected for this format')}</Tag>
              </a>
            </Tooltip>
          );
        }
        if (m.process) {
          return (
            <Tag color={STATE_COLOR[m.process.state]}>
              {t(m.process.state)} · :{m.process.port}
            </Tag>
          );
        }
        return <Tag>{t('Not loaded')}</Tag>;
      },
    },
    {
      title: '',
      key: 'actions',
      width: 200,
      render: (_: unknown, m: LocalModel) => {
        const loaded = !!m.process && m.process.state !== 'failed';
        const pending = busy[m.key];
        return (
          <Space>
            {!loaded ? (
              <Button
                size="small"
                type="primary"
                icon={<PlayCircleOutlined />}
                loading={pending === 'load'}
                onClick={() => act(m.key, 'load', () => load(m.key, m.contextLength ?? undefined))}
              >
                {t('Load')}
              </Button>
            ) : (
              <Button
                size="small"
                icon={<PoweroffOutlined />}
                loading={pending === 'unload'}
                onClick={() => act(m.key, 'unload', () => unload(m.key))}
              >
                {t('Unload')}
              </Button>
            )}
            <Popconfirm
              title={t('Delete this model?')}
              description={loaded ? t('It will be unloaded first.') : t('The file on disk will be deleted.')}
              onConfirm={() => act(m.key, 'delete', () => remove(m.key, true))}
            >
              <Button size="small" danger icon={<DeleteOutlined />} loading={pending === 'delete'} />
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }} wrap>
        <Title level={3} style={{ margin: 0 }}>
          {t('Local models')}
        </Title>
        <Button type="primary" icon={<CloudDownloadOutlined />} onClick={() => setDownloadOpen(true)}>
          {t('Download from Hugging Face')}
        </Button>
      </Space>
      <Paragraph type="secondary">
        {t('GGUF and MLX model files on this machine. Loading one starts (or reuses) the runtime selected for its format.')}
      </Paragraph>

      {loadError && <Alert type="error" showIcon message={loadError} style={{ marginBottom: 16 }} />}
      {runtimeMissing && (
        <RuntimeMissingBanner info={runtimeMissing} onOpenRuntimeSettings={onOpenRuntimeSettings} />
      )}

      {loading && !view ? (
        <Spin />
      ) : (
        <>
          <Table
            rowKey="key"
            dataSource={view?.models ?? []}
            columns={columns as any}
            pagination={false}
            size="small"
            style={{ marginBottom: 20 }}
            locale={{ emptyText: t('No local models yet — download one from Hugging Face.') }}
          />
          {view && (
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 20 }}>
              <EyeOutlined /> {t('Stored under')} <Text code style={{ fontSize: 12 }}>{view.root}</Text>
            </Text>
          )}

          {settings && <LocalModelEngineSettingsCard settings={settings} onSave={saveSettings} />}

          <LocalModelDownloadDialog
            open={downloadOpen}
            onClose={() => {
              setDownloadOpen(false);
              refresh();
            }}
            downloads={view?.downloads ?? []}
            onStartDownload={startDownload}
            onCancelDownload={cancelDownload}
          />
        </>
      )}
    </div>
  );
};
