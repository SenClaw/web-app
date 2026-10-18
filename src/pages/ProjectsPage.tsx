import { Layout } from 'antd';
import { useParams } from 'react-router-dom';
import { AppLayout } from '../components/AppLayout';
import { ProjectDetail } from '../components/projects/ProjectDetail';
import { ProjectList } from '../components/projects/ProjectList';

const { Content } = Layout;

/** `/projects` lists projects; `/projects/:id` is one of them, in tabs. */
export function ProjectsPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <AppLayout sidebar={null}>
      <Content className="h-full overflow-y-auto">{id ? <ProjectDetail key={id} id={id} /> : <ProjectList />}</Content>
    </AppLayout>
  );
}
