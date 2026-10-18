import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Modal, Progress, Segmented, Space, Spin, message, theme } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useLang } from '../../i18n';
import { MarkdownBody } from '../shared/MarkdownBody';
import {
  CONTEXT_MAX_CHARS,
  CONTEXT_WARN_CHARS,
  ContextChangedError,
  contextChars,
  contextLevel,
  getContext,
  putContext,
  type ProjectContext,
} from '../../lib/projectsApi';

interface Props {
  projectId: string;
}

function formatTime(ms: number): string {
  return ms > 0 ? new Date(ms).toLocaleString() : '—';
}

/**
 * The text the agent reads about this project on every turn.
 *
 * The daemon refuses a save made from an older copy than the one it holds
 * (409 with the stored text), so two windows — or a hand edit of the file —
 * cannot silently overwrite each other: the person is shown the stored text
 * next to their own and chooses.
 */
export function ProjectContextTab({ projectId }: Props) {
  const { token } = theme.useToken();
  const { t, tArgs, lang } = useLang();
  const num = (n: number) => n.toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US');
  const [saved, setSaved] = useState<ProjectContext | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ProjectContext | null>(null);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const savedRef = useRef(saved);
  savedRef.current = saved;

  const dirty = saved !== null && draft !== saved.content;
  const chars = contextChars(draft);
  const level = contextLevel(chars);

  const load = useCallback(
    async (quiet: boolean) => {
      if (!quiet) setLoading(true);
      try {
        const ctx = await getContext(projectId);
        setLoadError(null);
        const was = savedRef.current;
        const untouched = was === null || draftRef.current === was.content;
        if (was === null || ctx.updatedAt !== was.updatedAt) {
          setSaved(ctx);
          // A copy the person has not edited follows the stored one; an edited
          // draft is kept and meets the 409 if they save.
          if (untouched) setDraft(ctx.content);
        }
      } catch (e) {
        setLoadError((e as Error).message);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    setSaved(null);
    setDraft('');
    void load(false);
  }, [load]);

  // The file can change from outside (another window, a hand edit); look again
  // when this window gets focus back.
  useEffect(() => {
    const onFocus = () => void load(true);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const save = async (text: string, basedOn: number) => {
    setSaving(true);
    try {
      const stored = await putContext(projectId, text, basedOn);
      setSaved(stored);
      setDraft(stored.content);
      setConflict(null);
      message.success(t('Context saved. The agent reads it from the next turn.'));
    } catch (e) {
      if (e instanceof ContextChangedError) setConflict(e.current);
      else message.error(tArgs('Could not save the context: {error}', { error: (e as Error).message }));
    } finally {
      setSaving(false);
    }
  };

  if (loading && saved === null) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <Spin />
      </div>
    );
  }

  const hint = { fontSize: 12, color: token.colorTextSecondary } as const;
  const color = level === 'over' ? token.colorError : level === 'warn' ? token.colorWarning : token.colorTextSecondary;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ margin: 0, color: token.colorTextSecondary, fontSize: 13 }}>
        {t(
          'What this project is and how to work in it. Every chat of the project and every kanban card reads it on every turn, so an edit applies from the next turn. The agent never writes it.',
        )}
      </p>
      {loadError && (
        <Alert
          type="error"
          showIcon
          message={tArgs('Could not load the context: {error}', { error: loadError })}
          action={
            <Button size="small" onClick={() => void load(false)}>
              {t('Reload')}
            </Button>
          }
        />
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Segmented
          size="small"
          value={mode}
          onChange={v => setMode(v as 'edit' | 'preview')}
          options={[
            { value: 'edit', label: t('Edit') },
            { value: 'preview', label: t('Preview') },
          ]}
        />
        <span style={{ ...hint, marginLeft: 'auto' }}>
          {t('Last saved')}: {formatTime(saved?.updatedAt ?? 0)}
        </span>
      </div>

      {mode === 'edit' ? (
        <Input.TextArea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          autoSize={{ minRows: 14, maxRows: 30 }}
          placeholder={t('Describe the project: what it is, how it is laid out, conventions, what to avoid…')}
          spellCheck={false}
          style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 13 }}
        />
      ) : (
        <div
          style={{
            minHeight: 280,
            padding: 12,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 8,
            overflow: 'auto',
          }}
        >
          {draft.trim() ? <MarkdownBody content={draft} /> : <span style={hint}>{t('Nothing to preview.')}</span>}
        </div>
      )}

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4, color }}>
          <span>{tArgs('{n} / {max} characters', { n: num(chars), max: num(CONTEXT_MAX_CHARS) })}</span>
          {dirty && <span style={{ color: token.colorWarning }}>{t('Unsaved changes')}</span>}
        </div>
        <Progress
          percent={Math.min(100, (chars / CONTEXT_MAX_CHARS) * 100)}
          showInfo={false}
          size="small"
          strokeColor={level === 'over' ? token.colorError : level === 'warn' ? token.colorWarning : token.colorPrimary}
        />
        {level === 'warn' && (
          <div style={{ ...hint, color: token.colorWarning, marginTop: 4 }}>
            {tArgs('From {n} characters the context takes a lot of room in every turn. Keep it short.', {
              n: num(CONTEXT_WARN_CHARS),
            })}
          </div>
        )}
        {level === 'over' && (
          <div style={{ ...hint, color: token.colorError, marginTop: 4 }}>
            {tArgs('Over {max} characters: the agent only reads the first {max}, the rest is cut.', {
              max: num(CONTEXT_MAX_CHARS),
            })}
          </div>
        )}
      </div>

      <Space>
        <Button type="primary" disabled={!dirty || saving} loading={saving} onClick={() => saved && save(draft, saved.updatedAt)}>
          {t('Save')}
        </Button>
        <Button disabled={!dirty || saving} onClick={() => saved && setDraft(saved.content)}>
          {t('Discard changes')}
        </Button>
        <Button icon={<ReloadOutlined />} disabled={saving} onClick={() => void load(false)}>
          {t('Reload')}
        </Button>
      </Space>

      <Modal
        title={t('The context changed somewhere else')}
        open={conflict !== null}
        onCancel={() => setConflict(null)}
        width={760}
        destroyOnHidden
        footer={[
          <Button key="keep" onClick={() => setConflict(null)}>
            {t('Keep editing')}
          </Button>,
          <Button
            key="theirs"
            onClick={() => {
              if (!conflict) return;
              setSaved(conflict);
              setDraft(conflict.content);
              setConflict(null);
            }}
          >
            {t('Use the stored text')}
          </Button>,
          <Button key="mine" type="primary" danger loading={saving} onClick={() => conflict && save(draft, conflict.updatedAt)}>
            {t('Replace it with mine')}
          </Button>,
        ]}
      >
        <p style={{ color: token.colorTextSecondary, marginTop: 0 }}>
          {t('Another window or a hand edit saved the context after you opened it. Nothing was overwritten. Choose which text to keep.')}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>
              {t('Stored now')} · <span style={hint}>{formatTime(conflict?.updatedAt ?? 0)}</span>
            </div>
            <Input.TextArea readOnly value={conflict?.content ?? ''} rows={12} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }} />
          </div>
          <div>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>{t('Your text')}</div>
            <Input.TextArea readOnly value={draft} rows={12} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
