import { useEffect, useRef, useState } from 'react';
import { Input, Tag, theme } from 'antd';
import { CheckCircleFilled, CloseCircleFilled, LoadingOutlined } from '@ant-design/icons';
import { useLang } from '../../i18n';
import { validateRoot, type RootCheck, type RootReason } from '../../lib/projectsApi';

/** How long to wait after the last keystroke before asking the daemon. */
const DEBOUNCE_MS = 350;

/**
 * The sentence for one reason a root was refused. The daemon words them in
 * English and puts a path in some; a known code is shown in the person's
 * language, an unknown one as the daemon said it.
 */
export function useRootReasonText() {
  const { t, tArgs } = useLang();
  return (r: RootReason, inUseBy: RootCheck['inUseBy']): string => {
    switch (r.code) {
      case 'empty':
        return t('Enter the root folder.');
      case 'not_absolute':
        return t('The path must be absolute: start with / or ~.');
      case 'not_found':
        return t('This folder does not exist.');
      case 'not_a_directory':
        return t('This path is a file, not a folder.');
      case 'unreadable':
        return t('This folder cannot be read.');
      case 'filesystem_root':
        return t('The top of the filesystem cannot be a project root.');
      case 'home_dir':
        return t('The home folder is too broad to be a project root; pick a folder inside it.');
      case 'contains_home':
        return t('This folder contains the home folder, which is too broad to be a project root.');
      case 'senclaw_state':
        return t("This folder holds SenClaw's own state (tokens, databases, chats); it cannot be a project root.");
      case 'senclaw_profiles':
        return t('The agent profiles folder cannot be a project root.');
      case 'senclaw_projects':
        return t('The folder SenClaw keeps project contexts in cannot be a project root.');
      case 'root_in_use':
        return inUseBy
          ? tArgs('This folder is already the root of "{name}".', { name: inUseBy.name })
          : t('This folder is already the root of another project.');
      default:
        return r.message;
    }
  };
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Editing a project: its own current root is not a conflict. */
  projectId?: string;
  disabled?: boolean;
  /** The result for the text as it is now; `null` while it is being checked. */
  onCheck?: (check: RootCheck | null) => void;
}

/**
 * A root folder input that asks the daemon about the path as it is typed and
 * says why a path is refused — the same checks a create runs, so the person
 * is not told "no" only after pressing Create.
 */
export function RootField({ value, onChange, projectId, disabled, onCheck }: Props) {
  const { token } = theme.useToken();
  const { t, tArgs } = useLang();
  const reasonText = useRootReasonText();
  const [check, setCheck] = useState<RootCheck | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const seq = useRef(0);
  const report = useRef(onCheck);
  report.current = onCheck;

  useEffect(() => {
    const path = value.trim();
    const mine = ++seq.current;
    setFailed(null);
    if (!path) {
      setCheck(null);
      setChecking(false);
      report.current?.(null);
      return;
    }
    setChecking(true);
    report.current?.(null);
    const timer = setTimeout(async () => {
      try {
        const result = await validateRoot(path, projectId);
        if (mine !== seq.current) return;
        setCheck(result);
        report.current?.(result);
      } catch (e) {
        if (mine !== seq.current) return;
        setCheck(null);
        setFailed((e as Error).message);
        report.current?.(null);
      } finally {
        if (mine === seq.current) setChecking(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, projectId]);

  const status: 'error' | undefined = check && !check.ok ? 'error' : undefined;

  return (
    <div>
      <Input
        value={value}
        status={status}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        placeholder="/Users/you/code/my-app"
        autoComplete="off"
        spellCheck={false}
        style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 13 }}
      />
      <div style={{ marginTop: 6, fontSize: 12, minHeight: 20 }}>
        {checking && (
          <span style={{ color: token.colorTextSecondary }}>
            <LoadingOutlined /> {t('Checking the folder…')}
          </span>
        )}
        {!checking && failed && (
          <span style={{ color: token.colorError }}>
            <CloseCircleFilled /> {failed}
          </span>
        )}
        {!checking && check && !check.ok && (
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', color: token.colorError }}>
            {check.reasons.map(r => (
              <li key={r.code} style={{ display: 'flex', gap: 6 }}>
                <CloseCircleFilled style={{ marginTop: 3, flexShrink: 0 }} />
                <span>{reasonText(r, check.inUseBy)}</span>
              </li>
            ))}
          </ul>
        )}
        {!checking && check?.ok && (
          <div>
            <span style={{ color: token.colorSuccess }}>
              <CheckCircleFilled /> {t('This folder can be a project root.')}
            </span>
            {check.isGit && (
              <Tag style={{ marginLeft: 8, fontSize: 11 }}>{t('Git repository')}</Tag>
            )}
            {check.canonical && check.canonical !== value.trim() && (
              <div style={{ color: token.colorTextSecondary, wordBreak: 'break-all' }}>
                {tArgs('Resolves to {path}', { path: check.canonical })}
              </div>
            )}
            {check.hasClaudeMd && (
              <div style={{ color: token.colorTextSecondary }}>
                {t('The folder already has a CLAUDE.md or SENCLAW.md; the project context adds to it and does not replace it.')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
