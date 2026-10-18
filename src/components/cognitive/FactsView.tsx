/**
 * What the agent remembers from conversations, one dated fact per row.
 *
 * Facts are written automatically (a conversation window, or the summary made
 * when the context is compacted), so the person has to be able to read them
 * and take one away. Wraps `/api/memory/facts*` — see `lib/memoryFactsApi.ts`.
 *
 * Facts belong to an agent (its folder, "bank"). The bank picker lists only
 * agents that have facts; a fact is never shown under, or forgotten from, a
 * different agent than the one selected.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Empty, Input, Popconfirm, Select, Space, Switch, Table, Tag, Tooltip, message, theme } from 'antd';
import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { useLang } from '../../i18n';
import { useProjects } from '../../hooks/useProjects';
import { projectIdOfBank } from '../../lib/projectsApi';
import {
  FactStoreNotStarted,
  factWhen,
  forgetFact,
  listFactBanks,
  listFacts,
  type FactBank,
  type MemoryFact,
} from '../../lib/memoryFactsApi';

interface Props {
  /** Tell the parent a fact was forgotten. */
  onMutated?: () => void;
}

export function FactsView({ onMutated }: Props) {
  const { token } = theme.useToken();
  const { t, tArgs } = useLang();
  // Archived projects keep their facts, so name every project, not only active ones.
  const { byId: projectOf } = useProjects('all');

  const [banks, setBanks] = useState<FactBank[] | null>(null);
  const [bank, setBank] = useState<string | null>(null);
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [history, setHistory] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notStarted, setNotStarted] = useState(false);

  const loadBanks = useCallback(async () => {
    try {
      const list = await listFactBanks();
      setBanks(list);
      setNotStarted(false);
      // Keep the pick if it still exists; otherwise the most recently active agent.
      setBank(prev => (prev && list.some(b => b.bank === prev) ? prev : (list[0]?.bank ?? null)));
    } catch (e) {
      if (e instanceof FactStoreNotStarted) setNotStarted(true);
      else message.error(tArgs('Load failed: {error}', { error: (e as Error).message }));
      setBanks([]);
    }
  }, [tArgs]);

  const loadFacts = useCallback(async () => {
    if (!bank) {
      setFacts([]);
      return;
    }
    setLoading(true);
    try {
      setFacts(await listFacts({ bank, q: submitted, history }));
    } catch (e) {
      if (e instanceof FactStoreNotStarted) setNotStarted(true);
      else message.error(tArgs('Load failed: {error}', { error: (e as Error).message }));
    } finally {
      setLoading(false);
    }
  }, [bank, submitted, history, tArgs]);

  useEffect(() => {
    loadBanks();
  }, [loadBanks]);

  useEffect(() => {
    loadFacts();
  }, [loadFacts]);

  const forget = useCallback(
    async (fact: MemoryFact) => {
      if (!bank) return;
      try {
        await forgetFact(bank, fact.id);
        message.success(t('Forgotten'));
        // Forgetting a replacement brings back what it replaced, so reload both.
        await Promise.all([loadFacts(), loadBanks()]);
        onMutated?.();
      } catch (e) {
        message.error(tArgs('Forget failed: {error}', { error: (e as Error).message }));
      }
    },
    [bank, loadFacts, loadBanks, onMutated, t, tArgs],
  );

  const columns = useMemo(
    () => [
      {
        title: t('Fact'),
        render: (_: unknown, f: MemoryFact) => {
          const replaced = f.supersededBy != null;
          return (
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  color: replaced ? token.colorTextTertiary : undefined,
                  textDecoration: replaced ? 'line-through' : undefined,
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
                {replaced && (
                  <Tooltip title={t('The person changed their mind; the newer fact replaced this one. Forgetting the newer fact brings this one back.')}>
                    <Tag color="orange">{t('replaced')}</Tag>
                  </Tooltip>
                )}
                {f.origin && (
                  <Tooltip title={t('Said in this chat; only this chat recalls it.')}>
                    <Tag color="geekblue" style={{ fontSize: 11 }}>
                      {f.origin}
                    </Tag>
                  </Tooltip>
                )}
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
        width: 130,
        render: (_: unknown, f: MemoryFact) => {
          const w = factWhen(f);
          return w.dated ? (
            <span>{w.label}</span>
          ) : (
            <Tooltip title={t('No date in the fact; this is the day it was said.')}>
              <span style={{ color: token.colorTextSecondary }}>{tArgs('said {date}', { date: w.label })}</span>
            </Tooltip>
          );
        },
      },
      {
        title: t('Kind'),
        dataIndex: 'kind',
        width: 110,
        render: (k: MemoryFact['kind']) => (
          <Tooltip
            title={
              k === 'world'
                ? t('Something about the world or the person.')
                : t('Something the agent itself did or experienced.')
            }
          >
            <Tag color={k === 'world' ? 'blue' : 'purple'}>{k}</Tag>
          </Tooltip>
        ),
      },
      {
        title: t('Said'),
        dataIndex: 'proofCount',
        width: 80,
        render: (n: number) => (n > 1 ? `×${n}` : <span style={{ color: token.colorTextQuaternary }}>—</span>),
      },
      {
        title: '',
        width: 56,
        render: (_: unknown, f: MemoryFact) => (
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

  const current = banks?.find(b => b.bank === bank);
  const currentProjectId = bank ? projectIdOfBank(bank) : null;

  /** A project's bank reads as the project's name; an agent's bank as its folder. */
  const bankLabel = (b: FactBank): string => {
    const pid = projectIdOfBank(b.bank);
    const name = pid ? (projectOf(pid)?.name ?? pid) : b.bank;
    const prefix = pid ? `${t('Project')}: ` : '';
    return `${prefix}${name} · ${b.current}${b.replaced > 0 ? ` (+${b.replaced})` : ''}`;
  };

  return (
    <Card
      size="small"
      title={t('Facts')}
      extra={
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => {
            loadBanks();
            loadFacts();
          }}
        >
          {t('Refresh')}
        </Button>
      }
    >
      <p style={{ margin: '0 0 12px', color: token.colorTextSecondary, fontSize: 13 }}>
        {t(
          'Dated statements the agent picked out of your conversations. They are recalled automatically in later chats — forget any that are wrong or that you did not want kept.',
        )}
      </p>

      {notStarted && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={t('The fact store has not started yet — try again in a moment.')} />}

      {currentProjectId && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={tArgs('These are the facts of the project "{name}".', { name: projectOf(currentProjectId)?.name ?? currentProjectId })}
          description={
            <Link to={`/projects/${encodeURIComponent(currentProjectId)}?tab=facts`}>{t('Add or manage them in the project')}</Link>
          }
        />
      )}

      <Space wrap style={{ marginBottom: 12 }}>
        <Select
          style={{ minWidth: 240 }}
          loading={banks === null}
          value={bank ?? undefined}
          placeholder={t('Agent')}
          onChange={b => {
            setBank(b);
            setSubmitted('');
            setQuery('');
          }}
          options={(banks ?? []).map(b => ({ value: b.bank, label: bankLabel(b) }))}
          notFoundContent={t('No agent has facts yet')}
        />
        <Input.Search
          allowClear
          style={{ width: 280 }}
          placeholder={t('Search facts…')}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onSearch={v => setSubmitted(v)}
          disabled={!bank}
        />
        <Tooltip title={t('Also list facts that were replaced. A keyword search never shows them.')}>
          <Space size={6}>
            <Switch size="small" checked={history} onChange={setHistory} disabled={!bank || submitted.trim() !== ''} />
            <span style={{ fontSize: 13 }}>
              {current && current.replaced > 0 ? tArgs('Show replaced ({n})', { n: current.replaced }) : t('Show replaced')}
            </span>
          </Space>
        </Tooltip>
      </Space>

      <Table<MemoryFact>
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
              description={
                banks && banks.length === 0
                  ? t('Nothing remembered yet. Facts appear here a minute or two after a conversation goes quiet.')
                  : submitted.trim()
                    ? t('No fact matches that search.')
                    : t('This agent has no facts.')
              }
            />
          ),
        }}
      />
    </Card>
  );
}
