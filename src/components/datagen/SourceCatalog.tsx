import { Button, Card, Col, Empty, Modal, Progress, Row, Space, Tag, Tooltip, Typography, message } from 'antd';
import { CheckCircleOutlined, CloudDownloadOutlined, EyeOutlined, ThunderboltOutlined, WarningOutlined } from '@ant-design/icons';

import { useLang } from '../../i18n';
import { startJob, type CatalogEntry, type JobStatus } from '../../lib/datagenApi';

const { Text, Paragraph } = Typography;

/**
 * The dataset catalog (`GET /api/datagen/catalog`): datasets people wrote,
 * installed with one tap as an `import` job. A bundled entry installs from
 * the binary with no network; a Hugging Face preset downloads its pinned
 * split. An entry whose terms need a decision (share-alike, evaluation
 * only) shows its notice and installs only after the person agrees — the
 * daemon refuses it without `acceptLicense`.
 */
export function SourceCatalog({
  entries,
  jobs,
  onChanged,
  onView,
  onUseAsSeeds,
  onUseAsProblems,
}: {
  entries: CatalogEntry[];
  jobs: JobStatus[];
  onChanged: () => void;
  onView: (dataset: string) => void;
  onUseAsSeeds: (dataset: string) => void;
  onUseAsProblems: (dataset: string) => void;
}) {
  const { t, tArgs } = useLang();

  const install = (e: CatalogEntry) => {
    const go = async () => {
      try {
        await startJob({ pipeline: 'import', source: { catalog: e.id }, ...(e.needsConsent ? { acceptLicense: true } : {}) });
        message.success(t('Started'));
        onChanged();
      } catch (err) {
        message.error(String(err instanceof Error ? err.message : err));
      }
    };
    if (!e.needsConsent) {
      void go();
      return;
    }
    Modal.confirm({
      title: tArgs('Install {title}?', { title: e.title }),
      content: (
        <Space direction="vertical" size={4}>
          <Text strong>{e.license} · {e.attribution}</Text>
          {e.notice && <Text>{e.notice}</Text>}
        </Space>
      ),
      okText: t('I agree, install'),
      onOk: go,
    });
  };

  if (entries.length === 0) return <Empty description={t('The catalog is empty')} />;

  return (
    <Row gutter={[12, 12]}>
      {entries.map((e) => {
        const running = jobs.find(
          // The name until the job has read its source and recorded where it came from.
          (j) => j.state === 'running' && j.pipeline === 'import' && (j.provenance?.source?.catalog ?? j.name) === e.id,
        );
        return (
          <Col key={e.id} xs={24} md={12} xl={8}>
            <Card size="small" style={{ height: '100%' }}>
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                <Space wrap size={4}>
                  <Text strong>{e.title}</Text>
                  <Tag color={e.bundled ? 'green' : 'blue'}>{e.bundled ? t('Bundled') : 'Hugging Face'}</Tag>
                  <Tag>{t(e.kind)}</Tag>
                  <Tag>{e.lang}</Tag>
                  {e.flags.shareAlike && <Tag color="orange">BY-SA</Tag>}
                  {e.flags.noTraining && <Tag color="orange">{t('Eval only')}</Tag>}
                  {e.flags.nonCommercial && <Tag color="red">NC</Tag>}
                  {e.flags.researchOnly && <Tag color="red">{t('Research only')}</Tag>}
                </Space>
                <Paragraph type="secondary" style={{ fontSize: 12, margin: 0 }}>{e.description}</Paragraph>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {tArgs('{n} rows', { n: e.rows.toLocaleString() })} · {e.license} · {e.attribution}
                  {e.homepage && (
                    <> · <a href={e.homepage} target="_blank" rel="noreferrer">{t('Source')}</a></>
                  )}
                </Text>
                {e.notice && (
                  <Text type="warning" style={{ fontSize: 11 }}>
                    <WarningOutlined /> {e.notice}
                  </Text>
                )}
                <div style={{ marginTop: 4 }}>
                  {running ? (
                    <Progress
                      size="small"
                      status="active"
                      percent={running.target ? Math.round((running.attempts / Math.min(running.target, e.rows || running.target)) * 100) : 0}
                      format={() => tArgs('{n} rows', { n: running.accepted })}
                    />
                  ) : e.installed && e.dataset ? (
                    <Space wrap size={4}>
                      <Button size="small" disabled icon={<CheckCircleOutlined />}>{t('Installed')}</Button>
                      <Tooltip title={t('View records')}>
                        <Button size="small" icon={<EyeOutlined />} onClick={() => onView(e.dataset!)} />
                      </Tooltip>
                      {e.kind === 'labeled_text' && (
                        <Button size="small" onClick={() => onUseAsSeeds(e.dataset!)}>{t('Use as seeds')}</Button>
                      )}
                      {e.kind === 'problem_answer' && (
                        <Button size="small" onClick={() => onUseAsProblems(e.dataset!)}>{t('Use as problems')}</Button>
                      )}
                    </Space>
                  ) : (
                    <Button
                      size="small"
                      type="primary"
                      icon={e.bundled ? <ThunderboltOutlined /> : <CloudDownloadOutlined />}
                      onClick={() => install(e)}
                    >
                      {e.bundled ? t('Install now') : t('Download')}
                    </Button>
                  )}
                </div>
              </Space>
            </Card>
          </Col>
        );
      })}
    </Row>
  );
}
