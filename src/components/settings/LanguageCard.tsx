import React from 'react';
import { Card, Segmented, Space, Typography, theme } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';

import { useLang, type LangCode } from '../../i18n';

const { Text, Paragraph } = Typography;

/**
 * Interface language.
 *
 * The same two choices and the same wording as the desktop app, because both
 * read the same dictionary — a different label here would be the first place
 * the two drift. The choice is per-browser (`localStorage`) and applies
 * immediately; nothing is sent to the daemon, since this is how *this* client
 * renders, not a property of the account.
 */
export const LanguageCard: React.FC = () => {
  const { token } = theme.useToken();
  const { lang, setLang, t } = useLang();

  return (
    <Card
      hoverable
      style={{
        borderRadius: 12,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
      }}
      styles={{ body: { padding: 24 } }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
        <Space align="start" size="middle">
          <div
            style={{
              padding: 10,
              borderRadius: 10,
              backgroundColor: token.colorPrimaryBg,
              color: token.colorPrimary,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <GlobalOutlined style={{ fontSize: 20 }} />
          </div>
          <div>
            <Text strong style={{ fontSize: 16 }}>{t('Language')}</Text>
            <Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 0 }}>
              {t('Applies everywhere immediately. System follows your OS language (Vietnamese → Tiếng Việt, otherwise English).')}
            </Paragraph>
          </div>
        </Space>
        <Segmented
          value={lang}
          onChange={v => setLang(v as LangCode)}
          options={[
            { label: 'English', value: 'en' },
            { label: 'Tiếng Việt', value: 'vi' },
          ]}
        />
      </div>
    </Card>
  );
};
