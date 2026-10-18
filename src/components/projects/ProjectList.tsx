import { useState } from 'react';
import { Alert, Button, Card, Empty, Space, Spin, Switch, Tag, Tooltip, Typography, theme } from 'antd';
import { ContainerOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useLang } from '../../i18n';
import { useProjects } from '../../hooks/useProjects';
import { NewProjectModal } from './NewProjectModal';

export function ProjectList() {
  const { token } = theme.useToken();
  const { t, tArgs } = useLang();
  const navigate = useNavigate();
  const { projects, loaded, error, refresh } = useProjects('all');
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);

  const archivedCount = projects.filter(p => p.archivedAt != null).length;
  const shown = showArchived ? projects : projects.filter(p => p.archivedAt == null);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '16px 16px 48px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          <ContainerOutlined style={{ marginRight: 8 }} />
          {t('Projects')}
        </Typography.Title>
        <Space wrap>
          <Space size={6}>
            <Switch size="small" checked={showArchived} onChange={setShowArchived} />
            <span style={{ fontSize: 13 }}>
              {archivedCount > 0 ? tArgs('Show archived ({n})', { n: archivedCount }) : t('Show archived')}
            </span>
          </Space>
          <Tooltip title={t('Refresh')}>
            <Button icon={<ReloadOutlined />} onClick={() => void refresh()} aria-label={t('Refresh')} />
          </Tooltip>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            {t('New project')}
          </Button>
        </Space>
      </div>
      <p style={{ margin: '0 0 16px', color: token.colorTextSecondary, fontSize: 13 }}>
        {t(
          'A project is a folder that chats and kanban boards work in, with a context the agent reads on every turn and facts of its own.',
        )}
      </p>

      {error && <Alert type="error" showIcon style={{ marginBottom: 12 }} message={tArgs('Load failed: {error}', { error })} />}

      {!loaded ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin />
        </div>
      ) : shown.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={projects.length === 0 ? t('No projects yet.') : t('No active projects. Show archived ones to see the rest.')}
        >
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            {t('New project')}
          </Button>
        </Empty>
      ) : (
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))' }}>
          {shown.map(p => {
            const archived = p.archivedAt != null;
            return (
              <Card
                key={p.id}
                hoverable
                size="small"
                onClick={() => navigate(`/projects/${p.id}`)}
                style={{ opacity: archived ? 0.7 : 1 }}
                styles={{ body: { padding: 16 } }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <Typography.Text strong style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>
                    {p.name}
                  </Typography.Text>
                  {archived && <Tag style={{ margin: 0 }}>{t('Archived')}</Tag>}
                </div>
                <Tooltip title={p.root}>
                  <div
                    style={{
                      marginTop: 4,
                      fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                      fontSize: 12,
                      color: token.colorTextSecondary,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      direction: 'rtl',
                      textAlign: 'left',
                    }}
                  >
                    <bdi>{p.root}</bdi>
                  </div>
                </Tooltip>
                {p.description && (
                  <Typography.Paragraph
                    type="secondary"
                    ellipsis={{ rows: 2 }}
                    style={{ fontSize: 12, margin: '8px 0 0' }}
                  >
                    {p.description}
                  </Typography.Paragraph>
                )}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
                  <Tag style={{ margin: 0 }}>{tArgs('{n} chat(s)', { n: p.chatCount })}</Tag>
                  {p.isGit && <Tag style={{ margin: 0 }}>git</Tag>}
                  {p.factsWrite !== 'project' && (
                    <Tag style={{ margin: 0 }}>{p.factsWrite === 'off' ? t('facts off') : t('facts per chat')}</Tag>
                  )}
                  {!p.rootExists && (
                    <Tag color="red" style={{ margin: 0 }}>
                      {t('Folder missing')}
                    </Tag>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <NewProjectModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={p => {
          setCreating(false);
          void refresh();
          navigate(`/projects/${p.id}`);
        }}
      />
    </div>
  );
}
