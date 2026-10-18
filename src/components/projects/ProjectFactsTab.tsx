import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Empty, Form, Input, Popconfirm, Select, Space, Switch, Table, Tag, Tooltip, message, theme } from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useLang } from '../../i18n';
import { factWhen } from '../../lib/memoryFactsApi';
import {
  addProjectFact,
  FACT_MAX_CHARS,
  FACT_MIN_CHARS,
  forgetProjectFact,
  listProjectFacts,
  ProjectApiError,
  type Project,
  type ProjectFact,
  type ProjectFactKind,
} from '../../lib/projectsApi';

interface Props {
  project: Project;
}

export function ProjectFactsTab({ project }: Props) {
  const { token } = theme.useToken();
  const { t, tArgs } = useLang();
  const [facts, setFacts] = useState<ProjectFact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [history, setHistory] = useState(false);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<ProjectFactKind>('world');
  const [when, setWhen] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listProjectFacts(project.id, { q: submitted, history });
      setFacts(r.facts);
      setTotal(r.total);
    } catch (e) {
      message.error(tArgs('Load failed: {error}', { error: (e as Error).message }));
    } finally {
      setLoading(false);
    }
  }, [project.id, submitted, history, tArgs]);

  useEffect(() => {
    void load();
  }, [load]);

  const textLen = Array.from(text.replace(/\s+/g, ' ').trim()).length;
  const textOk = textLen >= FACT_MIN_CHARS && textLen <= FACT_MAX_CHARS;

  const add = async () => {
    setAdding(true);
    try {
      const r = await addProjectFact(project.id, {
        text: text.trim(),
        kind,
        when: when.trim() || undefined,
      });
      message.success(r.existing ? t('The project already had this fact; it is now marked as typed by hand.') : t('Fact added'));
      setText('');
      setWhen('');
      await load();
    } catch (e) {
      if (e instanceof ProjectApiError) {
        if (e.code === 'secret_in_fact') {
          message.error(t('This looks like a password or key, so it was not saved. Facts are shown to the model.'));
          return;
        }
        if (e.code === 'invalid_when') {
          message.error(t('The date must look like 2026-03, 2026-03-02, or a range 2026-03/2026-05.'));
          return;
        }
      }
      message.error(tArgs('Could not add the fact: {error}', { error: (e as Error).message }));
    } finally {
      setAdding(false);
    }
  };

  const forget = useCallback(
    async (fact: ProjectFact) => {
      try {
        await forgetProjectFact(project.id, fact.id);
        message.success(t('Forgotten'));
        await load();
      } catch (e) {
        message.error(tArgs('Forget failed: {error}', { error: (e as Error).message }));
      }
    },
    [project.id, load, t, tArgs],
  );

  const columns = useMemo(
    () => [
      {
        title: t('Fact'),
        render: (_: unknown, f: ProjectFact) => {
          const replaced = f.supersededBy != null;
          return (
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  color: replaced ? token.colorTextTertiary : undefined,
                  textDecoration: replaced ? 'line-through' : undefined,
                  wordBreak: 'break-word',
                }}
              >
                {f.text}
              </div>
              <div style={{ marginTop: 4 }}>
                {f.source === 'manual' && (
                  <Tooltip title={t('Typed by hand. Nothing a chat says replaces it.')}>
                    <Tag color="green" style={{ fontSize: 11 }}>
                      {t('typed by hand')}
                    </Tag>
                  </Tooltip>
                )}
                {f.source === 'kanban' && (
                  <Tooltip title={t('Kept when a kanban card of this project was completed.')}>
                    <Tag color="cyan" style={{ fontSize: 11 }}>
                      kanban
                    </Tag>
                  </Tooltip>
                )}
                {replaced && <Tag color="orange">{t('replaced')}</Tag>}
                {f.entities.map(e => (
                  <Tag key={e} style={{ fontSize: 11 }}>
                    {e}
                  </Tag>
                ))}
              </div>
            </div>
          );
        },
      },
      {
        title: t('When'),
        width: 120,
        responsive: ['md' as const],
        render: (_: unknown, f: ProjectFact) => {
          const w = factWhen(f);
          return w.dated ? (
            <span>{w.label}</span>
          ) : (
            <span style={{ color: token.colorTextSecondary }}>{tArgs('said {date}', { date: w.label })}</span>
          );
        },
      },
      {
        title: '',
        width: 56,
        render: (_: unknown, f: ProjectFact) => (
          <Popconfirm
            title={t('Forget this fact?')}
            description={t('The agent will stop recalling it.')}
            okText={t('Forget')}
            okButtonProps={{ danger: true }}
            cancelText={t('Cancel')}
            onConfirm={() => forget(f)}
          >
            <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label={t('Forget')} />
          </Popconfirm>
        ),
      },
    ],
    [t, tArgs, token, forget],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Alert
        type="info"
        showIcon
        message={t('Personal facts said in a project chat stay in this project')}
        description={t(
          "A fact about you that comes up in a chat of this project is kept here, not in the agent's common facts, so a chat outside the project does not recall it. Deleting the project deletes it.",
        )}
      />
      {project.factsWrite !== 'project' && (
        <Alert
          type="warning"
          showIcon
          message={
            project.factsWrite === 'off'
              ? t('Extraction is off for this project: only facts typed by hand appear here.')
              : t('Chats of this project remember per chat: only facts typed by hand appear here.')
          }
        />
      )}

      <div
        style={{
          padding: 12,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 8,
        }}
      >
        <div style={{ fontWeight: 500, marginBottom: 8 }}>{t('Add a fact by hand')}</div>
        <Form layout="vertical">
          <Form.Item
            style={{ marginBottom: 8 }}
            validateStatus={text && !textOk ? 'error' : undefined}
            help={
              text && !textOk
                ? tArgs('A fact is {min} to {max} characters; this one is {n}.', {
                    min: FACT_MIN_CHARS,
                    max: FACT_MAX_CHARS,
                    n: textLen,
                  })
                : undefined
            }
          >
            <Input.TextArea
              value={text}
              rows={2}
              onChange={e => setText(e.target.value)}
              placeholder={t('One self-contained statement, for example: The API runs on port 8080 in development.')}
            />
          </Form.Item>
          <Space wrap align="start">
            <Select<ProjectFactKind>
              value={kind}
              onChange={setKind}
              style={{ width: 200 }}
              options={[
                { value: 'world', label: t('About the project') },
                { value: 'experience', label: t('Something that was done') },
              ]}
            />
            <Input
              value={when}
              onChange={e => setWhen(e.target.value)}
              placeholder={t('Date (optional): 2026-03')}
              style={{ width: 200 }}
            />
            <Button type="primary" icon={<PlusOutlined />} disabled={!textOk} loading={adding} onClick={add}>
              {t('Add')}
            </Button>
          </Space>
        </Form>
        <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 8 }}>
          {t('Stored as typed, with no model involved. A fact that looks like a password or key is refused.')}
        </div>
      </div>

      <Space wrap>
        <Input.Search
          allowClear
          style={{ width: 280, maxWidth: '100%' }}
          placeholder={t('Search facts…')}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onSearch={v => setSubmitted(v)}
        />
        <Space size={6}>
          <Switch size="small" checked={history} onChange={setHistory} disabled={submitted.trim() !== ''} />
          <span style={{ fontSize: 13 }}>{t('Show replaced')}</span>
        </Space>
        <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()}>
          {t('Refresh')}
        </Button>
        <span style={{ fontSize: 12, color: token.colorTextSecondary }}>{tArgs('{n} fact(s) in the project', { n: total })}</span>
      </Space>

      <Table<ProjectFact>
        size="small"
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={facts}
        pagination={{ pageSize: 20, hideOnSinglePage: true, showSizeChanger: false }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={submitted.trim() ? t('No fact matches that search.') : t('This project has no facts yet.')}
            />
          ),
        }}
      />
    </div>
  );
}
