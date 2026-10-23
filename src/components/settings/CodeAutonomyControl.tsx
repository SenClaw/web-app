import React from 'react';
import { Card, Segmented, Typography } from 'antd';

import { useLang } from '../../i18n';

const { Text, Paragraph } = Typography;

export type CodeAutonomy = 'ask' | 'auto' | 'full';

/**
 * What each level does, in the daemon's own terms (`docs/code-autonomy.md`,
 * `util::command_risk`). The English text is the i18n key, so a sentence
 * changed here needs the same edit in `vi.web.json`.
 */
const LEVELS: { value: CodeAutonomy; label: string; blurb: string }[] = [
  { value: 'ask', label: 'Ask', blurb: 'Every command and every file edit asks first.' },
  {
    value: 'auto',
    label: 'Auto',
    blurb:
      'Edits inside the project and build, test, lint and local git commands run on their own; anything that leaves the project or cannot be undone still asks, and the card says why.',
  },
  {
    value: 'full',
    label: 'Full',
    blurb: 'Nothing asks: every command and edit runs on its own, including ones that cannot be undone.',
  },
];

interface Props {
  value: CodeAutonomy;
  saving: boolean;
  onChange: (next: CodeAutonomy) => void;
}

/**
 * Settings → Agent Behavior → Code sessions: how much a coding chat may do
 * without an approval card. Persisted by the parent through `/api/agent-behavior`
 * and read by the daemon on every turn, so a change applies to the next message.
 */
export const CodeAutonomyControl: React.FC<Props> = ({ value, saving, onChange }) => {
  const { t } = useLang();

  return (
    <Card size="small">
      <Text strong>{t('Approvals in code sessions')}</Text>
      <Paragraph type="secondary" style={{ marginBottom: 12, marginTop: 4 }}>
        {t('How much the agent may do without asking you first.')}
      </Paragraph>

      <Segmented
        value={value}
        disabled={saving}
        onChange={(v) => onChange(v as CodeAutonomy)}
        options={LEVELS.map((l) => ({ label: t(l.label), value: l.value }))}
        style={{ marginBottom: 12 }}
      />

      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {LEVELS.map((l) => (
          <li key={l.value} style={{ marginBottom: 4 }}>
            <Text strong={l.value === value} type={l.value === value ? undefined : 'secondary'}>
              {t(l.label)}
            </Text>
            <Text type={l.value === value ? undefined : 'secondary'}> — {t(l.blurb)}</Text>
          </li>
        ))}
      </ul>

      <Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 8 }}>
        {t(
          'Auto and Full apply only in code sessions and in folders that are git repositories — places where a checkpoint can undo the change. Other chats keep asking, whatever you choose here.'
        )}
      </Paragraph>
    </Card>
  );
};
