import React from 'react';
import { Card, Segmented, Typography } from 'antd';

import { useLang } from '../../i18n';

const { Text, Paragraph } = Typography;

export type SpecFlow = 'off' | 'on' | 'required';

/**
 * What each mode does, in the daemon's own terms (`specFlow` of
 * `/api/agent-behavior`). The English text is the i18n key, so a sentence
 * changed here needs the same edit in `vi.web.json`.
 */
const MODES: { value: SpecFlow; label: string; blurb: string }[] = [
  {
    value: 'required',
    label: 'Design first',
    blurb:
      'A code session or project chat needs an approved spec before its first code change; /spec skip waives it for a small fix.',
  },
  {
    value: 'on',
    label: 'When a spec exists',
    blurb: 'Only a folder that already has an open spec is held — one started with /brainstorm.',
  },
  { value: 'off', label: 'Off', blurb: 'No spec flow: the agent changes code without a design step.' },
];

interface Props {
  value: SpecFlow;
  saving: boolean;
  onChange: (next: SpecFlow) => void;
}

/**
 * Settings → Agent Behavior → Code sessions: whether the agent must have an
 * approved spec before it changes code. Persisted by the parent through
 * `/api/agent-behavior` and read by the daemon on every turn, so a change
 * applies to the next message.
 */
export const SpecFlowControl: React.FC<Props> = ({ value, saving, onChange }) => {
  const { t } = useLang();

  return (
    <Card size="small">
      <Text strong>{t('Design before code')}</Text>
      <Paragraph type="secondary" style={{ marginBottom: 12, marginTop: 4 }}>
        {t('Whether the agent needs an approved spec before it changes code.')}
      </Paragraph>

      <Segmented
        value={value}
        disabled={saving}
        onChange={(v) => onChange(v as SpecFlow)}
        options={MODES.map((m) => ({ label: t(m.label), value: m.value }))}
        style={{ marginBottom: 12 }}
      />

      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {MODES.map((m) => (
          <li key={m.value} style={{ marginBottom: 4 }}>
            <Text strong={m.value === value} type={m.value === value ? undefined : 'secondary'}>
              {t(m.label)}
            </Text>
            <Text type={m.value === value ? undefined : 'secondary'}> — {t(m.blurb)}</Text>
          </li>
        ))}
      </ul>

      <Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 8 }}>
        {t(
          'Type /brainstorm, /draft, /review and /approve in the chat to move a spec along; /spec shows the open one, switches, closes or skips it.'
        )}
      </Paragraph>
    </Card>
  );
};
