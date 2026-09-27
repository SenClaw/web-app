import React, { useState } from 'react';
import { Card, Select, Space, Tooltip, Typography, Button, message } from 'antd';
import { InfoCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { useLang } from '../../i18n';
import type { RuntimeSettings, UpdateChannel } from '../../lib/runtimeApi';

const { Text } = Typography;

interface Props {
  settings: RuntimeSettings;
  onChannelChange: (channel: UpdateChannel) => Promise<unknown>;
  onCheckUpdates: () => Promise<unknown>;
}

/** Channel picker (stable/beta) + a manual "Check for updates" — LM Studio's update card. */
export const RuntimeUpdatesChannelCard: React.FC<Props> = ({ settings, onChannelChange, onCheckUpdates }) => {
  const { t } = useLang();
  const [checking, setChecking] = useState(false);
  const [savingChannel, setSavingChannel] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      await onCheckUpdates();
      message.success(t('Checked for runtime updates'));
    } catch (e: any) {
      message.error(e?.message ?? String(e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <Card style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <Space size={6}>
          <Text strong>{t('Runtime updates channel')}</Text>
          <Tooltip
            title={t(
              'Stable installs the version every runtime pins for release. Beta tracks pre-releases as they are published.'
            )}
          >
            <InfoCircleOutlined style={{ color: 'rgba(150,150,150,0.9)' }} />
          </Tooltip>
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} loading={checking} onClick={check}>
            {t('Check for updates')}
          </Button>
          <Select
            style={{ width: 140 }}
            value={settings.channel}
            loading={savingChannel}
            onChange={async (v) => {
              setSavingChannel(true);
              try {
                await onChannelChange(v);
              } catch (e: any) {
                message.error(e?.message ?? String(e));
              } finally {
                setSavingChannel(false);
              }
            }}
            options={[
              { value: 'stable', label: t('Stable') },
              { value: 'beta', label: t('Beta') },
            ]}
          />
        </Space>
      </div>
    </Card>
  );
};
