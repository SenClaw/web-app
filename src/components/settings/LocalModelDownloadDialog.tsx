import React, { useMemo, useState } from 'react';
import { Alert, Button, Input, Modal, Progress, Select, Space, Typography, message } from 'antd';
import { CloudDownloadOutlined, SearchOutlined, StopOutlined } from '@ant-design/icons';
import { useLang } from '../../i18n';
import { fmtBytes, GTURBO_MODEL, localModelsApi, type HfFilesResponse, type LocalDownload } from '../../lib/runtimeApi';

const { Text, Paragraph } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  downloads: LocalDownload[];
  onStartDownload: (body: {
    repo?: string;
    file?: string;
    mmproj?: string;
    revision?: string;
    format?: 'gturbo';
    vision?: boolean;
  }) => Promise<{ downloadId: string }>;
  onCancelDownload: (id: string) => Promise<unknown>;
}

// §5.3: `queued | listing | downloading | done | failed | cancelled` — the first three are active.
const ACTIVE_STATES = new Set(['queued', 'listing', 'downloading']);

/** HF repo id → `hf-files` → pick a GGUF file (+ optional mmproj) or the whole MLX snapshot → progress with cancel. */
export const LocalModelDownloadDialog: React.FC<Props> = ({ open, onClose, downloads, onStartDownload, onCancelDownload }) => {
  const { t, tArgs } = useLang();
  const [repo, setRepo] = useState('');
  const [revision, setRevision] = useState('');
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [result, setResult] = useState<HfFilesResponse | null>(null);
  const [file, setFile] = useState<string | undefined>();
  const [mmproj, setMmproj] = useState<string | undefined>();
  const [starting, setStarting] = useState(false);
  const [downloadId, setDownloadId] = useState<string | null>(null);

  const active = useMemo(() => downloads.find((d) => d.downloadId === downloadId) ?? null, [downloads, downloadId]);

  const reset = () => {
    setRepo('');
    setRevision('');
    setLookupError(null);
    setResult(null);
    setFile(undefined);
    setMmproj(undefined);
    setDownloadId(null);
  };

  const lookup = async () => {
    const trimmed = repo.trim();
    if (!trimmed) return;
    setLooking(true);
    setLookupError(null);
    setResult(null);
    setFile(undefined);
    setMmproj(undefined);
    try {
      const r = await localModelsApi.hfFiles(trimmed, revision.trim() || undefined);
      setResult(r);
      const firstModel = r.files.find((f) => !f.mmproj);
      if (r.format === 'gguf' && firstModel) setFile(firstModel.name);
    } catch (e: any) {
      setLookupError(e?.message ?? String(e));
    } finally {
      setLooking(false);
    }
  };

  const startDownload = async () => {
    const trimmed = repo.trim();
    if (!trimmed || !result) return;
    if (result.format === 'gguf' && !file) return;
    setStarting(true);
    try {
      const pinned = trimmed.toLowerCase() === GTURBO_MODEL.repo && result.format !== 'gguf';
      const r = await onStartDownload(
        pinned
          ? { repo: GTURBO_MODEL.repo, revision: GTURBO_MODEL.revision, format: 'gturbo' }
          : {
              repo: trimmed,
              file: result.format === 'gguf' ? file : undefined,
              mmproj: result.format === 'gguf' ? mmproj : undefined,
              revision: revision.trim() || undefined,
            }
      );
      setDownloadId(r.downloadId);
    } catch (e: any) {
      message.error(e?.message ?? String(e));
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    if (!downloadId) return;
    try {
      await onCancelDownload(downloadId);
    } catch (e: any) {
      message.error(e?.message ?? String(e));
    }
  };

  const modelFiles = result?.files.filter((f) => !f.mmproj) ?? [];
  const mmprojFiles = result?.files.filter((f) => f.mmproj) ?? [];

  return (
    <Modal
      title={t('Download from Hugging Face')}
      open={open}
      onCancel={() => {
        onClose();
        if (!active || !ACTIVE_STATES.has(active.state)) reset();
      }}
      footer={null}
      destroyOnClose={false}
      width={620}
    >
      {!active && (
        <>
          <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
            <Input
              placeholder={t('org/repo, e.g. Qwen/Qwen2.5-7B-Instruct-GGUF')}
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              onPressEnter={lookup}
              disabled={looking}
            />
            <Button icon={<SearchOutlined />} loading={looking} disabled={!repo.trim()} onClick={lookup}>
              {t('Look up files')}
            </Button>
          </Space.Compact>
          <Input
            placeholder={t('Revision (optional, defaults to main)')}
            value={revision}
            onChange={(e) => setRevision(e.target.value)}
            style={{ marginBottom: 16 }}
          />

          {lookupError && <Alert type="error" showIcon message={lookupError} style={{ marginBottom: 16 }} />}

          {result && result.format === 'unknown' && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message={t('Could not detect a GGUF or MLX layout in this repo.')}
            />
          )}

          {result && result.format === 'gguf' && (
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <Text strong style={{ display: 'block', marginBottom: 4 }}>
                  {t('Model file')}
                </Text>
                <Select
                  style={{ width: '100%' }}
                  value={file}
                  onChange={setFile}
                  options={modelFiles.map((f) => ({
                    value: f.name,
                    label: `${f.name}${f.quant ? ` · ${f.quant}` : ''} · ${fmtBytes(f.size)}`,
                  }))}
                />
              </div>
              {mmprojFiles.length > 0 && (
                <div>
                  <Text strong style={{ display: 'block', marginBottom: 4 }}>
                    {t('Vision projector (optional)')}
                  </Text>
                  <Select
                    allowClear
                    style={{ width: '100%' }}
                    placeholder={t('None')}
                    value={mmproj}
                    onChange={setMmproj}
                    options={mmprojFiles.map((f) => ({ value: f.name, label: `${f.name} · ${fmtBytes(f.size)}` }))}
                  />
                </div>
              )}
            </Space>
          )}

          {result && result.format === 'mlx' && result.repo.toLowerCase() === GTURBO_MODEL.repo && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 8 }}
              message={t(
                'This repo is the TurboFieldfare source. SenClaw repacks the pinned revision into a .gturbo directory instead of saving the raw MLX snapshot.'
              )}
            />
          )}

          {result && result.format === 'mlx' && result.repo.toLowerCase() !== GTURBO_MODEL.repo && (
            <Paragraph type="secondary">
              {tArgs('This is an MLX snapshot — the whole repo ({count} files) downloads as one model.', {
                count: result.files.length,
              })}
            </Paragraph>
          )}

          {result && (
            <Button
              type="primary"
              icon={<CloudDownloadOutlined />}
              loading={starting}
              disabled={result.format === 'unknown' || (result.format === 'gguf' && !file)}
              onClick={startDownload}
              style={{ marginTop: 16 }}
            >
              {t('Download')}
            </Button>
          )}
        </>
      )}

      {active && (
        <div>
          <Text strong>{active.repo}</Text>
          <Progress percent={active.percent ?? 0} status={active.state === 'failed' ? 'exception' : 'active'} style={{ marginTop: 8 }} />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t(active.state)} · {fmtBytes(active.receivedBytes)}
            {active.totalBytes ? ` / ${fmtBytes(active.totalBytes)}` : ''}
          </Text>
          {active.error && <Alert type="error" showIcon message={active.error} style={{ marginTop: 12 }} />}
          {ACTIVE_STATES.has(active.state) && (
            <Button danger icon={<StopOutlined />} onClick={cancel} style={{ marginTop: 12 }}>
              {t('Cancel')}
            </Button>
          )}
          {!ACTIVE_STATES.has(active.state) && (
            <Button
              style={{ marginTop: 12, marginLeft: active.error ? 0 : undefined }}
              onClick={() => {
                reset();
              }}
            >
              {t('Download another')}
            </Button>
          )}
        </div>
      )}
    </Modal>
  );
};
