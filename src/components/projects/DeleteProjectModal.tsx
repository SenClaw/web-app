import { useEffect, useState } from 'react';
import { Alert, Modal, Spin, Typography, message } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import { useLang } from '../../i18n';
import {
  listProjectBoards,
  listProjectChats,
  listProjectFacts,
  purgeProject,
  type Project,
  type PurgeResult,
} from '../../lib/projectsApi';

interface Props {
  project: Project;
  open: boolean;
  onClose: () => void;
  onPurged: (result: PurgeResult) => void;
}

interface Counts {
  chats: number;
  boards: number;
  facts: number;
}

/**
 * Removing a project for good. Says what goes (its facts, its context) and
 * what stays (every chat and board, the folder), with the real numbers.
 *
 * The daemon deletes the fact bank a slice at a time and answers when it is
 * done — 20,000 facts took about 23 s — so the dialog cannot be closed while
 * the call runs, and the call is given a very long timeout.
 */
export function DeleteProjectModal({ project, open, onClose, onPurged }: Props) {
  const { t, tArgs, lang } = useLang();
  const num = (n: number) => n.toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US');
  const [counts, setCounts] = useState<Counts | null>(null);
  const [countError, setCountError] = useState<string | null>(null);
  const [purging, setPurging] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCounts(null);
    setCountError(null);
    let live = true;
    Promise.all([listProjectChats(project.id), listProjectBoards(project.id), listProjectFacts(project.id, { limit: 1 })])
      .then(([chats, boards, facts]) => {
        if (live) setCounts({ chats: chats.length, boards: boards.length, facts: facts.total });
      })
      .catch(e => {
        if (live) setCountError((e as Error).message);
      });
    return () => {
      live = false;
    };
  }, [open, project.id]);

  const run = async () => {
    setPurging(true);
    try {
      const result = await purgeProject(project.id);
      message.success(
        tArgs('Project deleted: {facts} fact(s) removed, {chats} chat(s) left it.', {
          facts: num(result.deletedFacts),
          chats: result.detachedChats.length,
        }),
      );
      onPurged(result);
    } catch (e) {
      const aborted = (e as Error).name === 'AbortError';
      message.error(
        aborted
          ? t('The daemon did not answer in time. Check the project list: the deletion may still be running.')
          : tArgs('Could not delete the project: {error}', { error: (e as Error).message }),
      );
    } finally {
      setPurging(false);
    }
  };

  const big = (counts?.facts ?? 0) >= 5000;

  return (
    <Modal
      title={tArgs('Delete project "{name}" for good?', { name: project.name })}
      open={open}
      onCancel={purging ? undefined : onClose}
      closable={!purging}
      maskClosable={!purging}
      keyboard={!purging}
      onOk={run}
      okText={t('Delete for good')}
      cancelText={t('Cancel')}
      okButtonProps={{ danger: true, disabled: counts === null, loading: purging }}
      cancelButtonProps={{ disabled: purging }}
      destroyOnHidden
      width={520}
    >
      {countError && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={tArgs('Could not count what is in the project: {error}', { error: countError })} />}
      {counts === null && !countError ? (
        <div style={{ textAlign: 'center', padding: 16 }}>
          <Spin />
        </div>
      ) : (
        counts && (
          <ul style={{ margin: '8px 0 12px', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <li>
              <b>{tArgs('{n} fact(s) of the project', { n: num(counts.facts) })}</b> {t('are deleted, and so is its context.')}
            </li>
            <li>
              <b>{tArgs('{n} chat(s)', { n: counts.chats })}</b>{' '}
              {t('leave the project and keep their history. They stay, outside any project.')}
            </li>
            <li>
              <b>{tArgs('{n} kanban board(s)', { n: counts.boards })}</b>{' '}
              {t('leave the project and keep running in the root folder they ran in.')}
            </li>
            <li>{t('Nothing inside the root folder is touched.')}</li>
          </ul>
        )
      )}
      {big && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('This is a large bank: deleting it takes a while (about 23 seconds for 20,000 facts). Keep this window open.')}
        />
      )}
      {!big && (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0 }}>
          {t('Facts are deleted in slices. A very large project (tens of thousands of facts) takes tens of seconds.')}
        </Typography.Paragraph>
      )}
      {purging && (
        <Alert
          type="info"
          showIcon
          icon={<LoadingOutlined />}
          style={{ marginTop: 12 }}
          message={t('Deleting… do not close this window until it finishes.')}
        />
      )}
    </Modal>
  );
}
