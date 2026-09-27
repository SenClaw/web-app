import React, { useState } from 'react';
import { Alert, Spin, Typography } from 'antd';
import { useLang } from '../../i18n';
import { useRuntimes } from '../../hooks/useRuntimes';
import { RuntimeSelectionsCard } from './RuntimeSelectionsCard';
import { RuntimeUpdatesChannelCard } from './RuntimeUpdatesChannelCard';
import { RuntimeCatalogCard } from './RuntimeCatalogCard';
import { RuntimeProcessesCard } from './RuntimeProcessesCard';
import { RuntimeInstallLocalModal } from './RuntimeInstallLocalModal';
import { RuntimeLogsModal } from './RuntimeLogsModal';

const { Title, Paragraph } = Typography;

/**
 * Settings → Runtime, modelled on LM Studio's engine manager: which installed
 * runtime answers each slot (GGUF, MLX, Decision, OCR, Speech to text, Text
 * to speech), the update channel, the catalog of installable engines, and the
 * processes the daemon currently supervises. Every engine that used to run
 * in-process now lives here as a separate package (`docs/runtime-protocol.md`).
 */
export const RuntimeSettings: React.FC = () => {
  const { t } = useLang();
  const { view, catalog, loading, loadError, jobs, install, installLocal, uninstall, selectSlot, setAutoUpdate, setChannel, checkUpdates, stopProcess } =
    useRuntimes();
  const [installLocalOpen, setInstallLocalOpen] = useState(false);
  const [logsRuntimeId, setLogsRuntimeId] = useState<string | null>(null);

  return (
    <div>
      <Title level={3} style={{ marginTop: 0 }}>
        {t('Runtime')}
      </Title>
      <Paragraph type="secondary">
        {t(
          'Every inference engine — GGUF, MLX, Decision, OCR, Speech to text, Text to speech — runs as a separate program the daemon installs and supervises, the way LM Studio manages its engines.'
        )}
      </Paragraph>

      {loadError && <Alert type="error" showIcon message={loadError} style={{ marginBottom: 16 }} />}

      {loading && !view ? (
        <Spin />
      ) : view ? (
        <>
          <RuntimeSelectionsCard view={view} onSelect={selectSlot} onAutoUpdateChange={setAutoUpdate} />
          <RuntimeUpdatesChannelCard settings={view.settings} onChannelChange={setChannel} onCheckUpdates={checkUpdates} />
          <RuntimeCatalogCard
            catalog={catalog}
            installed={view.installed}
            processes={view.processes}
            jobs={jobs}
            onInstall={install}
            onUninstall={uninstall}
            onStopProcess={stopProcess}
            onViewLogs={setLogsRuntimeId}
            onInstallLocal={() => setInstallLocalOpen(true)}
          />
          <RuntimeProcessesCard processes={view.processes} onStop={stopProcess} />

          <RuntimeInstallLocalModal
            open={installLocalOpen}
            onClose={() => setInstallLocalOpen(false)}
            onInstall={installLocal}
          />
          <RuntimeLogsModal runtimeId={logsRuntimeId} onClose={() => setLogsRuntimeId(null)} />
        </>
      ) : null}
    </div>
  );
};
