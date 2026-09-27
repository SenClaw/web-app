import React, { useEffect, useState } from 'react';
import { Button, Card, Table, Tag, Typography, message } from 'antd';
import { StopOutlined } from '@ant-design/icons';
import { useLang } from '../../i18n';
import type { ProcessState, RuntimeProcess } from '../../lib/runtimeApi';

const { Text } = Typography;

const STATE_COLOR: Record<ProcessState, string> = {
  starting: 'processing',
  ready: 'success',
  stopping: 'warning',
  failed: 'error',
};

function fmtUptime(startedAt: number, now: number): string {
  const secs = Math.max(0, Math.floor((now - startedAt) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}

interface Props {
  processes: RuntimeProcess[];
  onStop: (key: string) => Promise<unknown>;
}

/** "Running" — every process the daemon currently supervises for a runtime slot. */
export const RuntimeProcessesCard: React.FC<Props> = ({ processes, onStop }) => {
  const { t } = useLang();
  const [stopping, setStopping] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const stop = async (key: string) => {
    setStopping((s) => ({ ...s, [key]: true }));
    try {
      await onStop(key);
    } catch (e: any) {
      message.error(e?.message ?? String(e));
    } finally {
      setStopping((s) => ({ ...s, [key]: false }));
    }
  };

  return (
    <Card title={t('Running')}>
      <Table
        rowKey="key"
        size="small"
        dataSource={processes}
        pagination={false}
        locale={{ emptyText: t('No runtime processes are running.') }}
        columns={[
          {
            title: t('Runtime'),
            key: 'runtime',
            render: (_: unknown, p: RuntimeProcess) => (
              <div>
                <Text strong>{p.runtimeId}</Text>{' '}
                <Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  {p.version}
                </Text>
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {p.slot}
                  {p.modelKey ? ` · ${p.modelKey}` : ''}
                </Text>
              </div>
            ),
          },
          {
            title: t('State'),
            dataIndex: 'state',
            width: 110,
            render: (state: ProcessState, p: RuntimeProcess) => (
              <Tag color={STATE_COLOR[state]}>{p.error ? t('failed') : t(state)}</Tag>
            ),
          },
          { title: t('Port'), dataIndex: 'port', width: 90 },
          {
            title: t('Uptime'),
            key: 'uptime',
            width: 100,
            render: (_: unknown, p: RuntimeProcess) => fmtUptime(p.startedAt, now),
          },
          { title: t('Launches'), dataIndex: 'launches', width: 90 },
          {
            title: '',
            key: 'actions',
            width: 90,
            render: (_: unknown, p: RuntimeProcess) => (
              <Button
                size="small"
                danger
                icon={<StopOutlined />}
                loading={!!stopping[p.key]}
                onClick={() => stop(p.key)}
              >
                {t('Stop')}
              </Button>
            ),
          },
        ]}
      />
    </Card>
  );
};
