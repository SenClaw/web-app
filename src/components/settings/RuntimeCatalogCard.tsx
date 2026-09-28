import React, { useMemo, useState } from 'react';
import { Button, Card, Dropdown, Input, Modal, Progress, Select, Space, Tag, Tooltip, Typography, message } from 'antd';
import type { MenuProps } from 'antd';
import {
  ArrowRightOutlined,
  AudioOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  CloudDownloadOutlined,
  MoreOutlined,
  ScanOutlined,
  SearchOutlined,
  SoundOutlined,
  ThunderboltOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import { useLang } from '../../i18n';
import type {
  CatalogEntry,
  InstallJob,
  InstalledRuntime,
  RuntimeCatalog,
  RuntimeProcess,
  RuntimeType,
} from '../../lib/runtimeApi';
import { versionKey } from '../../hooks/useRuntimes';

const { Text, Paragraph } = Typography;

const TYPE_ICON: Record<RuntimeType, React.ReactNode> = {
  'llm-engine': <ThunderboltOutlined />,
  decision: <BranchesOutlined />,
  ocr: <ScanOutlined />,
  asr: <AudioOutlined />,
  tts: <SoundOutlined />,
  browser: <GlobalOutlined />,
};

const ACTIVE_JOB_STATES = new Set<InstallJob['state']>(['queued', 'downloading', 'verifying', 'extracting']);

interface Props {
  catalog: RuntimeCatalog | null;
  installed: InstalledRuntime[];
  processes: RuntimeProcess[];
  jobs: Record<string, InstallJob>;
  onInstall: (id: string, version?: string) => Promise<InstallJob>;
  onUninstall: (id: string, version: string) => Promise<unknown>;
  onStopProcess: (key: string) => Promise<unknown>;
  onViewLogs: (id: string) => void;
  onInstallLocal: () => void;
}

/** "Engines & Frameworks" — the catalog list with search/filter, install/update, and per-row management. */
export const RuntimeCatalogCard: React.FC<Props> = ({
  catalog,
  installed,
  processes,
  jobs,
  onInstall,
  onUninstall,
  onStopProcess,
  onViewLogs,
  onInstallLocal,
}) => {
  const { t, tArgs } = useLang();
  const [search, setSearch] = useState('');
  const [compatibleOnly, setCompatibleOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'all' | RuntimeType>('all');
  const [installing, setInstalling] = useState<Record<string, boolean>>({});

  const installedById = useMemo(() => new Map(installed.map((r) => [r.id, r])), [installed]);
  const processesById = useMemo(() => {
    const m = new Map<string, RuntimeProcess[]>();
    for (const p of processes) m.set(p.runtimeId, [...(m.get(p.runtimeId) ?? []), p]);
    return m;
  }, [processes]);

  const entries = useMemo(() => {
    const all = catalog?.entries ?? [];
    const q = search.trim().toLowerCase();
    return all.filter((e) => {
      if (compatibleOnly && !e.compatible) return false;
      if (typeFilter !== 'all' && e.type !== typeFilter) return false;
      if (!q) return true;
      return e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q) || (e.description ?? '').toLowerCase().includes(q);
    });
  }, [catalog, search, compatibleOnly, typeFilter]);

  const install = async (entry: CatalogEntry) => {
    // Guarded by the `!entry.available` branch below in render (no version
    // for this channel means unavailable), but stay defensive in case a
    // caller reaches this with nothing to install.
    if (!entry.latestVersion) return;
    setInstalling((s) => ({ ...s, [entry.id]: true }));
    try {
      await onInstall(entry.id, entry.latestVersion);
    } catch (e: any) {
      message.error(e?.message ?? String(e));
    } finally {
      setInstalling((s) => ({ ...s, [entry.id]: false }));
    }
  };

  const uninstallVersion = (id: string, version: string) => {
    Modal.confirm({
      title: tArgs('Uninstall {id} {version}?', { id, version }),
      okButtonProps: { danger: true },
      okText: t('Uninstall'),
      onOk: async () => {
        try {
          await onUninstall(id, version);
          message.success(t('Uninstalled'));
        } catch (e: any) {
          message.error(e?.message ?? String(e));
        }
      },
    });
  };

  const stopAll = async (id: string) => {
    const running = processesById.get(id) ?? [];
    try {
      await Promise.all(running.map((p) => onStopProcess(p.key)));
      message.success(t('Stopped'));
    } catch (e: any) {
      message.error(e?.message ?? String(e));
    }
  };

  const rowMenu = (entry: CatalogEntry): MenuProps['items'] => {
    const rec = installedById.get(entry.id);
    const running = processesById.get(entry.id) ?? [];
    const items: MenuProps['items'] = [];
    if (rec && rec.versions.length > 0) {
      items.push({
        key: 'uninstall',
        label: t('Uninstall version'),
        children: rec.versions.map((v) => ({
          key: `uninstall-${v}`,
          label: v,
          onClick: () => uninstallVersion(entry.id, v),
        })),
      });
    }
    items.push({ key: 'install-local', label: t('Install from a local path…'), onClick: onInstallLocal });
    items.push({ key: 'logs', label: t('View logs'), onClick: () => onViewLogs(entry.id) });
    if (running.length > 0) {
      items.push({
        key: 'stop',
        label: t('Stop running processes'),
        danger: true,
        onClick: () => stopAll(entry.id),
      });
    }
    return items;
  };

  return (
    <Card title={t('Engines & Frameworks')} style={{ marginBottom: 20 }}>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder={t('Search…')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 220 }}
        />
        <Select
          value={compatibleOnly ? 'compatible' : 'all'}
          onChange={(v) => setCompatibleOnly(v === 'compatible')}
          style={{ width: 160 }}
          options={[
            { value: 'compatible', label: t('Compatible only') },
            { value: 'all', label: t('All') },
          ]}
        />
        <Select
          value={typeFilter}
          onChange={setTypeFilter}
          style={{ width: 180 }}
          options={[
            { value: 'all', label: t('All types') },
            { value: 'llm-engine', label: t('LLM engines') },
            { value: 'decision', label: t('Decision') },
            { value: 'ocr', label: t('OCR') },
            { value: 'asr', label: t('Speech to text') },
            { value: 'tts', label: t('Text to speech') },
            { value: 'browser', label: t('Browser') },
          ]}
        />
      </Space>

      {catalog?.error && (
        <Text type="warning" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
          {t('Could not refresh the runtime index — showing the last known catalog.')} ({catalog.error})
        </Text>
      )}

      {entries.length === 0 ? (
        <Text type="secondary">{t('No runtimes match this filter.')}</Text>
      ) : (
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          {entries.map((entry) => {
            const job = entry.latestVersion ? jobs[versionKey(entry.id, entry.latestVersion)] : undefined;
            const jobActive = !!job && ACTIVE_JOB_STATES.has(job.state);
            return (
              <div
                key={entry.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '12px 14px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <div style={{ fontSize: 20, opacity: 0.85 }}>{TYPE_ICON[entry.type]}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Space size={8} wrap>
                    <Text strong>{entry.name}</Text>
                    {entry.installedVersion && <Tag style={{ fontFamily: 'monospace', margin: 0 }}>{entry.installedVersion}</Tag>}
                    {entry.installedVersion && entry.updateAvailable && <ArrowRightOutlined style={{ fontSize: 11, opacity: 0.6 }} />}
                    {(!entry.installedVersion || entry.updateAvailable) && entry.latestVersion && (
                      <Tag color={entry.installedVersion ? 'blue' : 'default'} style={{ fontFamily: 'monospace', margin: 0 }}>
                        {entry.latestVersion}
                      </Tag>
                    )}
                  </Space>
                  {entry.description && (
                    <Paragraph type="secondary" style={{ margin: '4px 0 0', fontSize: 12.5 }}>
                      {entry.description}
                    </Paragraph>
                  )}
                  {entry.releaseNotesUrl && entry.latestVersion && (
                    <a href={entry.releaseNotesUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                      {entry.latestVersion} - {t('Release notes')} ›
                    </a>
                  )}
                </div>

                <div style={{ minWidth: 160, display: 'flex', justifyContent: 'flex-end' }}>
                  {jobActive ? (
                    <Space direction="vertical" size={0} style={{ width: 140 }}>
                      <Progress percent={job.percent ?? 0} size="small" status="active" />
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {t(job.state)}
                      </Text>
                    </Space>
                  ) : !entry.available || !entry.latestVersion ? (
                    <Tooltip title={t('Listed but no package has been published for this platform/channel yet.')}>
                      <Tag>{t('Not published yet')}</Tag>
                    </Tooltip>
                  ) : !entry.compatible ? (
                    <Tooltip title={t('Not built for this platform.')}>
                      <Tag color="default">{t('Incompatible')}</Tag>
                    </Tooltip>
                  ) : entry.installedVersion && !entry.updateAvailable ? (
                    <Tag color="success" icon={<CheckCircleOutlined />}>
                      {t('Latest version')}
                    </Tag>
                  ) : (
                    <Button
                      size="small"
                      type="primary"
                      icon={<CloudDownloadOutlined />}
                      loading={!!installing[entry.id]}
                      onClick={() => install(entry)}
                    >
                      {entry.installedVersion ? t('Update') : t('Install')}
                    </Button>
                  )}
                </div>

                <Dropdown menu={{ items: rowMenu(entry) }} trigger={['click']} placement="bottomRight">
                  <Button type="text" icon={<MoreOutlined />} />
                </Dropdown>
              </div>
            );
          })}
        </Space>
      )}
    </Card>
  );
};
