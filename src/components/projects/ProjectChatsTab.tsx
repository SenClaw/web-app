import { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Space, Table, Tag, Tooltip, message, theme } from 'antd';
import { MessageOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useLang } from '../../i18n';
import { useAppContext } from '../../contexts/AppContext';
import { listProjectChats, type Project, type ProjectChat } from '../../lib/projectsApi';

interface Props {
  project: Project;
}

/**
 * When the chat last had a message. The REST row carries `lastActive`, which a
 * web chat never has, so the socket's group list (updated on every message)
 * answers first; a chat nobody has opened falls back to when it was created.
 */
function activity(c: ProjectChat, lastActivityMs: number | null | undefined): string {
  const d = lastActivityMs ? new Date(lastActivityMs) : new Date(c.lastActive ?? c.addedAt);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export function ProjectChatsTab({ project }: Props) {
  const { token } = theme.useToken();
  const { t, tArgs } = useLang();
  const navigate = useNavigate();
  const { ws } = useAppContext();
  const [chats, setChats] = useState<ProjectChat[]>([]);
  const [loading, setLoading] = useState(false);
  const archived = project.archivedAt != null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setChats(await listProjectChats(project.id));
    } catch (e) {
      message.error(tArgs('Load failed: {error}', { error: (e as Error).message }));
    } finally {
      setLoading(false);
    }
  }, [project.id, tArgs]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = (jid: string) => navigate(`/chat/${encodeURIComponent(jid)}`);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ margin: 0, color: token.colorTextSecondary, fontSize: 13 }}>
        {t(
          'Chats created in this project. A chat joins a project only when it is created; it cannot be moved in or out afterwards.',
        )}
      </p>
      <Space wrap>
        <Tooltip title={archived ? t('An archived project takes no new chats.') : undefined}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={archived}
            onClick={() => navigate(`/chats?newProject=${encodeURIComponent(project.id)}`)}
          >
            {t('New chat in this project')}
          </Button>
        </Tooltip>
        <Button icon={<ReloadOutlined />} onClick={() => void load()}>
          {t('Refresh')}
        </Button>
      </Space>
      <Table<ProjectChat>
        size="small"
        rowKey="jid"
        loading={loading}
        dataSource={chats}
        pagination={{ pageSize: 20, hideOnSinglePage: true, showSizeChanger: false }}
        onRow={c => ({ onClick: () => open(c.jid), style: { cursor: 'pointer' } })}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No chats in this project yet.')} /> }}
        columns={[
          {
            title: t('Chat'),
            render: (_: unknown, c: ProjectChat) => (
              <span style={{ wordBreak: 'break-word' }}>
                <MessageOutlined style={{ marginRight: 6, color: token.colorTextTertiary }} />
                {c.name || c.jid}
              </span>
            ),
          },
          {
            title: t('Kind'),
            width: 90,
            render: (_: unknown, c: ProjectChat) => <Tag color={c.groupType === 'code' ? 'purple' : 'blue'}>{c.groupType}</Tag>,
          },
          {
            title: t('Last activity'),
            width: 180,
            responsive: ['md' as const],
            render: (_: unknown, c: ProjectChat) => (
              <span style={{ fontSize: 12 }}>{activity(c, ws.groups.find(g => g.jid === c.jid)?.lastActivity)}</span>
            ),
          },
          {
            title: '',
            width: 90,
            render: (_: unknown, c: ProjectChat) => (
              <Button
                size="small"
                onClick={e => {
                  e.stopPropagation();
                  open(c.jid);
                }}
              >
                {t('Open')}
              </Button>
            ),
          },
        ]}
      />
    </div>
  );
}
