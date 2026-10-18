import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Empty, Space, Table, Tag, Tooltip, Typography, message, theme } from 'antd';
import { FolderOpenOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useLang } from '../../i18n';
import { listProjectBoards, type Project, type ProjectBoard } from '../../lib/projectsApi';

interface Props {
  project: Project;
}

export function ProjectBoardsTab({ project }: Props) {
  const { token } = theme.useToken();
  const { t, tArgs } = useLang();
  const navigate = useNavigate();
  const [boards, setBoards] = useState<ProjectBoard[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const archived = project.archivedAt != null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBoards(await listProjectBoards(project.id));
      setUnavailable(false);
    } catch (e) {
      // 503: the daemon was started without the kanban store.
      if ((e as { status?: number }).status === 503) setUnavailable(true);
      else message.error(tArgs('Load failed: {error}', { error: (e as Error).message }));
    } finally {
      setLoading(false);
    }
  }, [project.id, tArgs]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = (id: number) => navigate(`/kanban?board=${id}`);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ margin: 0, color: token.colorTextSecondary, fontSize: 13 }}>
        {t(
          'Kanban boards created in this project. Their cards run in the project root, or in a folder of their own inside it.',
        )}
      </p>
      {unavailable && <Alert type="warning" showIcon message={t('The kanban store is not available on this daemon.')} />}
      <Space wrap>
        <Tooltip title={archived ? t('An archived project takes no new boards.') : undefined}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={archived}
            onClick={() => navigate(`/kanban?project=${encodeURIComponent(project.id)}&new=1`)}
          >
            {t('New board in this project')}
          </Button>
        </Tooltip>
        <Button icon={<ReloadOutlined />} onClick={() => void load()}>
          {t('Refresh')}
        </Button>
      </Space>
      <Table<ProjectBoard>
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={boards}
        pagination={{ pageSize: 20, hideOnSinglePage: true, showSizeChanger: false }}
        onRow={b => ({ onClick: () => open(b.id), style: { cursor: 'pointer' } })}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No boards in this project yet.')} /> }}
        columns={[
          {
            title: t('Board'),
            render: (_: unknown, b: ProjectBoard) => (
              <div style={{ minWidth: 0 }}>
                <Typography.Text strong>{b.title}</Typography.Text>
                <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
                  {tArgs('{cols} column(s) · {cards} card(s)', { cols: b.column_count, cards: b.card_count })}
                </div>
              </div>
            ),
          },
          {
            title: t('Runs in'),
            render: (_: unknown, b: ProjectBoard) =>
              b.effective_workspace_dir ? (
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, wordBreak: 'break-all' }}>
                  <FolderOpenOutlined /> {b.effective_workspace_dir}
                  {b.workspace_dir && b.workspace_dir === b.effective_workspace_dir && b.workspace_dir !== project.root && (
                    <Tag style={{ marginLeft: 6, fontSize: 11 }}>{t('own folder')}</Tag>
                  )}
                </span>
              ) : (
                <span style={{ color: token.colorTextTertiary }}>—</span>
              ),
          },
        ]}
      />
    </div>
  );
}
