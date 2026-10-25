import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Space, Tag, Typography, theme } from 'antd';
import { InfoCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { useLang } from '../../i18n';
import { fetchCoreBuild, WEB_APP_VERSION, type CoreBuild } from '../../lib/systemApi';

const { Text, Paragraph } = Typography;

/**
 * Settings → General: the senclaw core serving this console and the console's
 * own build. Updating is not done from here: what may replace the core depends
 * on how it was installed, and the hint under the versions says which.
 */
export const VersionCard: React.FC = () => {
  const { token } = theme.useToken();
  const { t, tArgs } = useLang();
  const [core, setCore] = useState<CoreBuild | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCore(await fetchCoreBuild());
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const kindLabel: Record<string, string> = {
    'desktop-bundle': t('App bundle'),
    standalone: t('Standalone install'),
    dev: t('Development build'),
  };
  const kindHint: Record<string, string> = {
    'desktop-bundle': t('This core ships inside SenClaw Desktop and is updated with the app.'),
    standalone: t('The web console is served by the daemon and updates with it. Update the daemon on the host machine: senclaw update'),
    dev: t('A development build: rebuild it from source to change it.'),
  };
  const mono: React.CSSProperties = { fontFamily: token.fontFamilyCode, fontSize: 12 };

  return (
    <Card
      style={{ borderRadius: 12, border: `1px solid ${token.colorBorderSecondary}`, background: token.colorBgContainer }}
      styles={{ body: { padding: 24 } }}
    >
      {/* Plain flex rather than antd Space: a Space item does not shrink, so a
          long "Running from" path pushed the card's own button out of view. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
        <div
          style={{
            flex: 'none',
            padding: 10,
            borderRadius: 10,
            backgroundColor: token.colorPrimaryBg,
            color: token.colorPrimary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <InfoCircleOutlined style={{ fontSize: 20 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Space size={8} wrap>
            <Text strong style={{ fontSize: 16 }}>SenClaw Core</Text>
            {core?.installKind && <Tag>{kindLabel[core.installKind] ?? core.installKind}</Tag>}
          </Space>
          <div style={{ marginTop: 4 }}>
            {loading && !core ? (
              <Text type="secondary">{t('Reading the core version…')}</Text>
            ) : failed || !core ? (
              <Text type="secondary">{t('The running core did not report its version.')}</Text>
            ) : (
              <>
                <Text style={mono}>
                  {tArgs('Version {v}', { v: core.version })}
                  {[core.gitHash, core.buildTarget].filter(Boolean).map((s) => ` · ${s}`).join('')}
                </Text>
                {core.exePath && (
                  <div>
                    <Text
                      type="secondary"
                      style={{ ...mono, fontSize: 11, display: 'block' }}
                      ellipsis={{ tooltip: core.exePath }}
                    >
                      {tArgs('Running from {path}', { path: core.exePath })}
                    </Text>
                  </div>
                )}
                {core.installKind && (
                  <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                    {kindHint[core.installKind]}
                  </Paragraph>
                )}
              </>
            )}
          </div>
          <div style={{ marginTop: 12 }}>
            <Text type="secondary">{t('Web console')}: </Text>
            <Text style={mono}>{WEB_APP_VERSION}</Text>
          </div>
        </div>
        <Button style={{ flex: 'none' }} icon={<ReloadOutlined />} loading={loading} onClick={load}>
          {t('Refresh')}
        </Button>
      </div>
    </Card>
  );
};

export default VersionCard;
