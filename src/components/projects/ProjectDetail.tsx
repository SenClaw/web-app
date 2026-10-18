import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Spin, Tabs, Tag, Typography, theme } from 'antd';
import { ArrowLeftOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLang } from '../../i18n';
import { useAppContext } from '../../contexts/AppContext';
import { getProject, ProjectApiError, type Project } from '../../lib/projectsApi';
import { ProjectBoardsTab } from './ProjectBoardsTab';
import { ProjectChatsTab } from './ProjectChatsTab';
import { ProjectContextTab } from './ProjectContextTab';
import { ProjectFactsTab } from './ProjectFactsTab';
import { ProjectOverviewTab } from './ProjectOverviewTab';

const TABS = ['overview', 'context', 'facts', 'boards', 'chats'] as const;
type TabKey = (typeof TABS)[number];

function isTab(v: string | null): v is TabKey {
  return v !== null && (TABS as readonly string[]).includes(v);
}

interface Props {
  id: string;
}

export function ProjectDetail({ id }: Props) {
  const { token } = theme.useToken();
  const { t, tArgs } = useLang();
  const navigate = useNavigate();
  const { ws } = useAppContext();
  const [params, setParams] = useSearchParams();
  const [project, setProject] = useState<Project | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const tab: TabKey = isTab(params.get('tab')) ? (params.get('tab') as TabKey) : 'overview';

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const p = await getProject(id);
      if (mine !== seq.current) return;
      setProject(p);
      setMissing(false);
      setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      if (e instanceof ProjectApiError && e.status === 404) setMissing(true);
      else setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    setProject(null);
    setMissing(false);
    void load();
  }, [load]);

  // No push event for a project: look again when the window gets focus back.
  useEffect(() => {
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  if (missing) {
    return (
      <div style={{ padding: 24 }}>
        <Alert
          type="warning"
          showIcon
          message={t('This project does not exist (any more).')}
          action={
            <Button size="small" onClick={() => navigate('/projects')}>
              {t('Back to projects')}
            </Button>
          }
        />
      </div>
    );
  }

  if (!project) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        {error ? <Alert type="error" showIcon message={tArgs('Load failed: {error}', { error })} /> : <Spin />}
      </div>
    );
  }

  const archived = project.archivedAt != null;
  const changed = (p: Project) => {
    setProject(p);
    // The sidebar groups chats by project, so tell it too.
    ws.refreshGroups();
  };

  const items = [
    {
      key: 'overview',
      label: t('Overview'),
      children: (
        <ProjectOverviewTab
          project={project}
          onChanged={changed}
          onPurged={() => {
            ws.refreshGroups();
            navigate('/projects');
          }}
        />
      ),
    },
    { key: 'context', label: t('Context'), children: <ProjectContextTab projectId={project.id} /> },
    { key: 'facts', label: t('Project facts'), children: <ProjectFactsTab project={project} /> },
    { key: 'boards', label: t('Boards'), children: <ProjectBoardsTab project={project} /> },
    {
      key: 'chats',
      label: project.chatCount > 0 ? `${t('Chats')} (${project.chatCount})` : t('Chats'),
      children: <ProjectChatsTab project={project} />,
    },
  ];

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '16px 16px 48px' }}>
      <Button type="text" size="small" icon={<ArrowLeftOutlined />} onClick={() => navigate('/projects')} style={{ marginBottom: 8 }}>
        {t('Projects')}
      </Button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
        <Typography.Title level={3} style={{ margin: 0, wordBreak: 'break-word' }}>
          {project.name}
        </Typography.Title>
        {archived && <Tag>{t('Archived')}</Tag>}
        {!project.rootExists && <Tag color="red">{t('Folder missing')}</Tag>}
      </div>
      <div
        title={project.root}
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          fontSize: 12,
          color: token.colorTextSecondary,
          marginBottom: 12,
          wordBreak: 'break-all',
        }}
      >
        <FolderOpenOutlined /> {project.root}
      </div>
      <Tabs
        activeKey={tab}
        onChange={k => {
          const next = new URLSearchParams(params);
          next.set('tab', k);
          setParams(next, { replace: true });
        }}
        items={items}
        destroyOnHidden
      />
    </div>
  );
}
