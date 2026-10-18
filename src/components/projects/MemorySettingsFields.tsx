import { Radio, Switch, theme } from 'antd';
import { useLang } from '../../i18n';
import type { FactsWrite } from '../../lib/projectsApi';

interface Props {
  factsWrite: FactsWrite;
  inheritCommon: boolean;
  onFactsWrite: (v: FactsWrite) => void;
  onInheritCommon: (v: boolean) => void;
  disabled?: boolean;
}

/** Where a project's chats keep what they learn, and whether they also read the agent's common facts. */
export function MemorySettingsFields({ factsWrite, inheritCommon, onFactsWrite, onInheritCommon, disabled }: Props) {
  const { token } = theme.useToken();
  const { t } = useLang();
  const hint = { fontSize: 12, color: token.colorTextSecondary, lineHeight: 1.5 } as const;

  const options: { value: FactsWrite; label: string; help: string }[] = [
    {
      value: 'project',
      label: t("The project's own facts"),
      help: t('What chats and kanban cards of this project learn is kept in the project, shared by all of them.'),
    },
    {
      value: 'chat',
      label: t('Per chat'),
      help: t('Chats remember as they do outside a project. The project only offers the facts you type in by hand.'),
    },
    {
      value: 'off',
      label: t('Off'),
      help: t('Nothing is extracted from the chats of this project.'),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontWeight: 500, marginBottom: 6 }}>{t('Where new facts are kept')}</div>
        <Radio.Group
          value={factsWrite}
          disabled={disabled}
          onChange={e => onFactsWrite(e.target.value as FactsWrite)}
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {options.map(o => (
            <Radio key={o.value} value={o.value} style={{ alignItems: 'flex-start' }}>
              <div>{o.label}</div>
              <div style={hint}>{o.help}</div>
            </Radio>
          ))}
        </Radio.Group>
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Switch checked={inheritCommon} disabled={disabled} onChange={onInheritCommon} style={{ marginTop: 2, flexShrink: 0 }} />
        <div>
          <div style={{ fontWeight: 500 }}>{t('Also use the common facts')}</div>
          <div style={hint}>
            {t(
              "Chats of this project also recall the agent's common facts. Turn it off and they recall only the project's own.",
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
