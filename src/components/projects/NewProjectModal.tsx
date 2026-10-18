import { useState } from 'react';
import { Collapse, Form, Input, Modal, message } from 'antd';
import { useLang } from '../../i18n';
import { createProject, ProjectApiError, type FactsWrite, type Project, type RootCheck } from '../../lib/projectsApi';
import { MemorySettingsFields } from './MemorySettingsFields';
import { RootField } from './RootField';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (project: Project) => void;
}

/** Last path segment of what was typed, offered as the name until the person writes one. */
function nameFromRoot(path: string): string {
  return path.trim().replace(/\/+$/, '').split('/').pop() ?? '';
}

export function NewProjectModal({ open, onClose, onCreated }: Props) {
  const { t, tArgs } = useLang();
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [root, setRoot] = useState('');
  const [check, setCheck] = useState<RootCheck | null>(null);
  const [description, setDescription] = useState('');
  const [factsWrite, setFactsWrite] = useState<FactsWrite>('project');
  const [inheritCommon, setInheritCommon] = useState(true);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName('');
    setNameTouched(false);
    setRoot('');
    setCheck(null);
    setDescription('');
    setFactsWrite('project');
    setInheritCommon(true);
  };

  const shownName = nameTouched ? name : name || nameFromRoot(root);
  const canCreate = shownName.trim() !== '' && check?.ok === true && !saving;

  const submit = async () => {
    setSaving(true);
    try {
      const project = await createProject({
        name: shownName.trim(),
        root: root.trim(),
        description: description.trim(),
        factsWrite,
        inheritCommon,
      });
      message.success(tArgs('Project "{name}" created', { name: project.name }));
      reset();
      onCreated(project);
    } catch (e) {
      // A refusal the field already explains (root in use, unsafe root) is
      // shown again here: the check and the create can disagree by a moment.
      const code = e instanceof ProjectApiError ? e.code : '';
      if (code === 'root_in_use') message.error(t('Another project already has this root folder.'));
      else if (code === 'invalid_root') message.error(t('This folder cannot be a project root.'));
      else message.error(tArgs('Could not create the project: {error}', { error: (e as Error).message }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={t('New project')}
      open={open}
      onCancel={() => {
        reset();
        onClose();
      }}
      onOk={submit}
      okText={t('Create')}
      cancelText={t('Cancel')}
      okButtonProps={{ disabled: !canCreate }}
      confirmLoading={saving}
      destroyOnHidden
      width={560}
      style={{ top: 24 }}
    >
      <Form layout="vertical" style={{ marginTop: 12 }}>
        <Form.Item label={t('Root folder')} required extra={t('Chats and kanban cards of the project work in this folder.')}>
          <RootField value={root} onChange={setRoot} onCheck={setCheck} />
        </Form.Item>
        <Form.Item label={t('Name')} required>
          <Input
            value={shownName}
            maxLength={80}
            onChange={e => {
              setName(e.target.value);
              setNameTouched(true);
            }}
          />
        </Form.Item>
        <Form.Item label={t('Description')} extra={t('One or two lines, shown in the project list.')}>
          <Input.TextArea
            value={description}
            rows={2}
            maxLength={300}
            onChange={e => setDescription(e.target.value)}
          />
        </Form.Item>
        {/* The defaults suit most projects, so the choice stays out of the way. */}
        <Collapse
          ghost
          size="small"
          items={[
            {
              key: 'memory',
              label: t('Facts and memory'),
              children: (
                <MemorySettingsFields
                  factsWrite={factsWrite}
                  inheritCommon={inheritCommon}
                  onFactsWrite={setFactsWrite}
                  onInheritCommon={setInheritCommon}
                />
              ),
            },
          ]}
        />
      </Form>
    </Modal>
  );
}
