import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Form, Input, Popconfirm, Space, Typography, message, theme } from 'antd';
import { InboxOutlined, UndoOutlined } from '@ant-design/icons';
import { useLang } from '../../i18n';
import {
  archiveProject,
  restoreProject,
  updateProject,
  type FactsWrite,
  type Project,
  type ProjectPatch,
  type PurgeResult,
  type RootCheck,
} from '../../lib/projectsApi';
import { DeleteProjectModal } from './DeleteProjectModal';
import { MemorySettingsFields } from './MemorySettingsFields';
import { RootField } from './RootField';

interface Props {
  project: Project;
  /** The project as the daemon now has it, after something here changed it. */
  onChanged: (project: Project) => void;
  onPurged: (result: PurgeResult) => void;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function ProjectOverviewTab({ project, onChanged, onPurged }: Props) {
  const { token } = theme.useToken();
  const { t, tArgs } = useLang();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [root, setRoot] = useState(project.root);
  const [factsWrite, setFactsWrite] = useState<FactsWrite>(project.factsWrite);
  const [inheritCommon, setInheritCommon] = useState(project.inheritCommon);
  const [check, setCheck] = useState<RootCheck | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Take what the daemon has when the project itself changed (a save here, or
  // an edit from another window). A refresh that finds it unchanged must not
  // wipe what is being typed, so this keys on `updatedAt`, not on the object.
  useEffect(() => {
    setName(project.name);
    setDescription(project.description);
    setRoot(project.root);
    setFactsWrite(project.factsWrite);
    setInheritCommon(project.inheritCommon);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.updatedAt]);

  const patch = useMemo<ProjectPatch>(() => {
    const p: ProjectPatch = {};
    if (name.trim() !== project.name) p.name = name.trim();
    if (description.trim() !== project.description) p.description = description.trim();
    if (root.trim() !== project.root) p.root = root.trim();
    if (factsWrite !== project.factsWrite) p.factsWrite = factsWrite;
    if (inheritCommon !== project.inheritCommon) p.inheritCommon = inheritCommon;
    return p;
  }, [name, description, root, factsWrite, inheritCommon, project]);

  const rootChanged = patch.root !== undefined;
  const dirty = Object.keys(patch).length > 0;
  const rootOk = !rootChanged || check?.ok === true;
  const canSave = dirty && name.trim() !== '' && rootOk && !saving;
  const archived = project.archivedAt != null;

  const save = async () => {
    setSaving(true);
    try {
      const updated = await updateProject(project.id, patch);
      message.success(t('Saved'));
      onChanged(updated);
    } catch (e) {
      message.error(tArgs('Could not save: {error}', { error: (e as Error).message }));
    } finally {
      setSaving(false);
    }
  };

  const toggleArchive = async () => {
    setBusy(true);
    try {
      const updated = archived ? await restoreProject(project.id) : await archiveProject(project.id);
      message.success(archived ? t('Project restored') : t('Project archived'));
      onChanged(updated);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {archived && (
        <Alert
          type="info"
          showIcon
          message={t('This project is archived')}
          description={t('It takes no new chats or boards. The chats and boards it already has keep working.')}
          action={
            <Button size="small" icon={<UndoOutlined />} loading={busy} onClick={toggleArchive}>
              {t('Restore')}
            </Button>
          }
        />
      )}
      {!project.rootExists && (
        <Alert
          type="warning"
          showIcon
          message={t('The root folder no longer exists')}
          description={t('New chats cannot start in this project until the root points to a folder that exists.')}
        />
      )}

      <Card size="small" title={t('Project')}>
        <Form layout="vertical">
          <Form.Item label={t('Name')} required>
            <Input value={name} maxLength={80} onChange={e => setName(e.target.value)} />
          </Form.Item>
          <Form.Item label={t('Description')}>
            <Input.TextArea value={description} rows={2} maxLength={300} onChange={e => setDescription(e.target.value)} />
          </Form.Item>
          <Form.Item
            label={t('Root folder')}
            required
            extra={
              rootChanged
                ? t(
                    'A chat that is already open keeps the folder it started in until the daemon restarts. New chats and kanban cards use the new root.',
                  )
                : undefined
            }
          >
            <RootField value={root} onChange={setRoot} projectId={project.id} onCheck={setCheck} />
          </Form.Item>
          <MemorySettingsFields
            factsWrite={factsWrite}
            inheritCommon={inheritCommon}
            onFactsWrite={setFactsWrite}
            onInheritCommon={setInheritCommon}
          />
          <div style={{ marginTop: 20 }}>
            <Space>
              <Button type="primary" disabled={!canSave} loading={saving} onClick={save}>
                {t('Save')}
              </Button>
              <Button
                disabled={!dirty || saving}
                onClick={() => {
                  setName(project.name);
                  setDescription(project.description);
                  setRoot(project.root);
                  setFactsWrite(project.factsWrite);
                  setInheritCommon(project.inheritCommon);
                }}
              >
                {t('Reset')}
              </Button>
            </Space>
          </div>
        </Form>
      </Card>

      <Card size="small" title={t('Details')}>
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '6px 16px', fontSize: 13 }}>
          <dt style={{ color: token.colorTextSecondary }}>ID</dt>
          <dd style={{ margin: 0, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>
            <Typography.Text copyable>{project.id}</Typography.Text>
          </dd>
          <dt style={{ color: token.colorTextSecondary }}>{t('Fact bank')}</dt>
          <dd style={{ margin: 0, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>project:{project.id}</dd>
          <dt style={{ color: token.colorTextSecondary }}>{t('Created')}</dt>
          <dd style={{ margin: 0 }}>{formatTime(project.createdAt)}</dd>
          <dt style={{ color: token.colorTextSecondary }}>{t('Updated')}</dt>
          <dd style={{ margin: 0 }}>{formatTime(project.updatedAt)}</dd>
        </dl>
      </Card>

      <Card size="small" title={t('Archive or delete')} styles={{ body: { display: 'flex', flexDirection: 'column', gap: 16 } }}>
        {!archived && (
          <div>
            <Popconfirm
              styles={{ root: { maxWidth: 340 } }}
              title={t('Archive this project?')}
              description={t('It disappears from the list and takes no new chats or boards. Nothing is deleted; you can restore it.')}
              okText={t('Archive')}
              cancelText={t('Cancel')}
              onConfirm={toggleArchive}
            >
              <Button icon={<InboxOutlined />} loading={busy}>
                {t('Archive')}
              </Button>
            </Popconfirm>
            <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 6 }}>
              {t('Hides the project and stops new chats and boards from joining it. Everything is kept.')}
            </div>
          </div>
        )}
        <div>
          <Button danger onClick={() => setDeleting(true)}>
            {t('Delete for good…')}
          </Button>
          <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 6 }}>
            {t('Removes the project, its facts and its context. Chats and boards stay, outside the project.')}
          </div>
        </div>
      </Card>

      <DeleteProjectModal
        project={project}
        open={deleting}
        onClose={() => setDeleting(false)}
        onPurged={result => {
          setDeleting(false);
          onPurged(result);
        }}
      />
    </div>
  );
}
