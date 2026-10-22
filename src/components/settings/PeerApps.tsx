import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Modal, Popconfirm, Segmented, Space, Spin, Switch, Table, Tag, Tooltip, Typography, message } from 'antd';
import { EyeOutlined, SaveOutlined, SyncOutlined } from '@ant-design/icons';
import { useLang } from '../../i18n';
import { ApiError } from '../../lib/runtimeApi';
import {
  senLinkApi,
  type SenLinkAppList,
  type SenLinkAppPolicy,
  type SenLinkAppView,
  type SenLinkHeld,
  type SenLinkPeer,
  type SenLinkSyncDirection,
  type SenLinkSyncItem,
  type SenLinkSyncReport,
} from '../../lib/coworkApi';

const { Text, Paragraph } = Typography;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The policy without its `off` entries, so `{hosts: 'off'}` and `{}` are the same thing. */
const normalized = (p: SenLinkAppPolicy) => ({
  collections: Object.entries(p.collections)
    .filter(([, d]) => d !== 'off')
    .sort(([a], [b]) => a.localeCompare(b)),
  secrets: p.secrets,
  adoptMatches: p.adoptMatches,
});
const samePolicy = (a: SenLinkAppPolicy, b: SenLinkAppPolicy) => JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
const isOpen = (p: SenLinkAppPolicy) => normalized(p).collections.length > 0;

const STATUS_COLOR: Record<string, string> = {
  added: 'green',
  updated: 'green',
  deleted: 'green',
  tombstoned: 'green',
  adopted: 'green',
  held: 'orange',
  duplicate: 'orange',
  rejected: 'red',
  error: 'red',
};

/** `ms` or `s` since the epoch, whichever the daemon sent, as a local date and time. */
const when = (at: number) => new Date(at < 1e12 ? at * 1000 : at).toLocaleString();

/** One side of a run as `added 2 · updated 1`. */
const summaryText = (s: Record<string, number>, label: (k: string) => string) =>
  Object.entries(s)
    .filter(([k]) => k !== 'skipped' && k !== 'unchanged')
    .map(([k, n]) => `${label(k)} ${n}`)
    .join(' · ');

/**
 * What one peer may do with each Space App's data on this machine — closed
 * until a person opens it, and a collection only moves when this machine and
 * the peer both allow it. Preview shows what a sync would do on both machines;
 * a change that would send a stored credential somewhere new waits here for a
 * person to approve it.
 */
export const PeerApps: React.FC<{ peer: SenLinkPeer; onChanged: () => void }> = ({ peer, onChanged }) => {
  const { t, tArgs } = useLang();
  const [list, setList] = useState<SenLinkAppList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, SenLinkAppPolicy>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, 'save' | 'preview' | 'run' | undefined>>({});
  const [reports, setReports] = useState<Record<string, SenLinkSyncReport | undefined>>({});
  const [runErrors, setRunErrors] = useState<Record<string, string | undefined>>({});

  const load = useCallback(
    async (resetDrafts: boolean) => {
      try {
        const l = await senLinkApi.appSync(peer.id);
        setList(l);
        setDrafts((d) => (resetDrafts ? {} : d));
        setDrafts((d) => {
          const next = { ...d };
          for (const a of l.apps) if (!next[a.app]) next[a.app] = a.policy;
          return next;
        });
        setError(null);
      } catch (e) {
        setError(errText(e));
      }
    },
    [peer.id],
  );

  useEffect(() => {
    load(true);
  }, [load]);

  const directionLabel: Record<SenLinkSyncDirection, string> = {
    off: t('Off'),
    send: t('Send'),
    receive: t('Receive'),
    both: t('Both'),
  };
  const statusLabel = (k: string) =>
    ({
      added: t('added'),
      updated: t('updated'),
      unchanged: t('unchanged'),
      deleted: t('deleted'),
      tombstoned: t('deleted'),
      adopted: t('merged'),
      skipped: t('skipped'),
      held: t('waiting'),
      duplicate: t('duplicate'),
      rejected: t('refused'),
      error: t('failed'),
    })[k] ?? k;
  const whyText = (w: string | null) =>
    w &&
    ({
      not_on_peer: t('not on the peer'),
      schema_differs: t('versions differ'),
      off_here: t('off here'),
      off_on_peer: t('off on the peer'),
    }[w] ?? w);
  const reasonText = (r?: string) => {
    if (!r) return '';
    if (r.startsWith('waiting_for:')) return t('Waits for the record it points at');
    return (
      {
        credential_target_changed: t('Would send a saved password or key to a different address'),
        same_key_other_id: t('The same thing under another id — allow merging to take it'),
        local_in_use: t('In use on this machine (an open tunnel)'),
        not_receiving: t('This machine does not receive that collection'),
        clock_skew: t("The other machine's clock is too far ahead"),
        bad_id: t('Not a valid record'),
        bad_stamp: t('Not a valid record'),
        bad_data: t('Not a valid record'),
        unknown_collection: t('Not a valid record'),
        local_newer: t('Already newer here'),
        same: t('Already up to date'),
        secrets_filled: t('Passwords and keys filled in'),
        risky: t('Needs your approval'),
      }[r] ?? r
    );
  };
  const failure = (e: unknown) => {
    if (e instanceof ApiError) {
      if (e.code === 'not_open') return t('Open at least one collection for this peer and save, then try again.');
      if (e.code === 'busy') return t('Too many requests. Try again in a minute.');
    }
    return errText(e);
  };

  if (error) return <Alert type="warning" showIcon message={t('Could not load the app sync settings')} description={error} />;
  if (!list) return <Spin />;
  if (list.apps.length === 0) {
    return <Empty description={t('No installed Space App can sync its data yet. Update the app to a version that supports it.')} />;
  }

  const remote = list.remote && 'apps' in list.remote ? list.remote.apps : null;
  const remoteError = list.remote && 'error' in list.remote ? list.remote.error : null;

  const setDraft = (app: string, p: SenLinkAppPolicy) => setDrafts((d) => ({ ...d, [app]: p }));
  const setBusyFor = (app: string, v: 'save' | 'preview' | 'run' | undefined) => setBusy((b) => ({ ...b, [app]: v }));

  const save = async (a: SenLinkAppView) => {
    const draft = drafts[a.app];
    setBusyFor(a.app, 'save');
    try {
      await senLinkApi.putAppSync(peer.id, a.app, draft, confirmed[a.app] === true);
      setConfirmed((c) => ({ ...c, [a.app]: false }));
      await load(false);
      onChanged();
      message.success(t('Saved'));
    } catch (e) {
      message.error(failure(e));
    } finally {
      setBusyFor(a.app, undefined);
    }
  };

  const run = async (a: SenLinkAppView, kind: 'preview' | 'run', approve?: { collection: string; id: string }) => {
    setBusyFor(a.app, kind);
    setRunErrors((r) => ({ ...r, [a.app]: undefined }));
    try {
      const opts = approve ? { approve: [approve] } : {};
      const report = kind === 'preview' ? await senLinkApi.previewAppSync(peer.id, a.app, opts) : await senLinkApi.runAppSync(peer.id, a.app, opts);
      setReports((r) => ({ ...r, [a.app]: report }));
      await load(false);
    } catch (e) {
      setRunErrors((r) => ({ ...r, [a.app]: failure(e) }));
    } finally {
      setBusyFor(a.app, undefined);
    }
  };

  const askSecrets = (a: SenLinkAppView, draft: SenLinkAppPolicy) => {
    const holding = a.collections.filter((c) => c.secretFields.length > 0);
    Modal.confirm({
      title: tArgs('Send passwords and keys to {name}?', { name: peer.name }),
      width: 520,
      content: (
        <div>
          <Paragraph>
            {tArgs('They cross only if {name} also allows it. On the other machine they are stored as plain text, as they are here.', { name: peer.name })}
          </Paragraph>
          <ul style={{ paddingLeft: 20, marginBottom: 0 }}>
            {holding.map((c) => (
              <li key={c.id}>
                <Text code>{c.id}</Text> {c.secretFields.join(', ')}
              </li>
            ))}
          </ul>
        </div>
      ),
      okText: t('Allow'),
      cancelText: t('Cancel'),
      onOk: () => {
        setConfirmed((c) => ({ ...c, [a.app]: true }));
        setDraft(a.app, { ...draft, secrets: true });
      },
    });
  };

  const heldTable = (app: SenLinkAppView, held: SenLinkHeld[]) => (
    <div style={{ marginTop: 12 }}>
      <Text strong>{t('Waiting for you')}</Text>
      <Paragraph type="secondary" style={{ margin: '2px 0 8px', fontSize: 12 }}>
        {t('These changes were held back. Nothing is applied until you approve it here.')}
      </Paragraph>
      <Table<SenLinkHeld>
        size="small"
        rowKey={(h) => `${h.collection}/${h.id}`}
        pagination={false}
        dataSource={held}
        columns={[
          { title: t('Collection'), dataIndex: 'collection', render: (c: string) => <Text code style={{ whiteSpace: 'nowrap' }}>{c}</Text> },
          { title: t('Record'), render: (_, h) => h.name ?? <Text type="secondary" style={{ whiteSpace: 'nowrap' }}>{h.id.slice(0, 8)}</Text> },
          { title: t('Why'), render: (_, h) => reasonText(h.reason) },
          {
            title: '',
            width: 120,
            render: (_, h) => (
              <Popconfirm
                title={t('Apply this change?')}
                description={reasonText(h.reason)}
                okText={t('Approve')}
                cancelText={t('Cancel')}
                disabled={!peer.canSend}
                onConfirm={() => run(app, 'run', { collection: h.collection, id: h.id })}
              >
                <Button size="small" disabled={!peer.canSend || busy[app.app] !== undefined}>
                  {t('Approve')}
                </Button>
              </Popconfirm>
            ),
          },
        ]}
      />
    </div>
  );

  const reportView = (a: SenLinkAppView, r: SenLinkSyncReport) => {
    const rows: (SenLinkSyncItem & { side: 'pull' | 'push' })[] = [
      ...r.pull.results.map((x) => ({ ...x, side: 'pull' as const })),
      ...r.push.results.map((x) => ({ ...x, side: 'push' as const })),
    ].filter((x) => x.status !== 'skipped' && x.status !== 'unchanged');
    const pullText = summaryText(r.pull.summary, statusLabel);
    const pushText = summaryText(r.push.summary, statusLabel);
    return (
      <div style={{ marginTop: 12 }}>
        <Alert
          type={r.dryRun ? 'info' : 'success'}
          showIcon
          message={r.dryRun ? t('Preview: nothing was changed') : t('Synced')}
          description={
            <Space direction="vertical" size={2}>
              <Space size={4} wrap>
                {r.plan.map((p) => (
                  <Tooltip key={p.collection} title={p.why ? whyText(p.why) : undefined}>
                    <Tag color={p.pull || p.push ? 'blue' : 'default'}>
                      {[[p.collection, (p.pull ? '↓' : '') + (p.push ? '↑' : '')].filter(Boolean).join(' '), p.why ? whyText(p.why) : ''].filter(Boolean).join(' · ')}
                    </Tag>
                  </Tooltip>
                ))}
              </Space>
              <Text>
                {tArgs('Taken from {name}', { name: peer.name })}: {pullText || t('nothing')}
              </Text>
              <Text>
                {tArgs('Sent to {name}', { name: peer.name })}: {pushText || t('nothing')}
              </Text>
            </Space>
          }
        />
        {rows.length > 0 && (
          <Table<SenLinkSyncItem & { side: 'pull' | 'push' }>
            style={{ marginTop: 8 }}
            size="small"
            rowKey={(x) => `${x.side}/${x.collection}/${x.id}`}
            pagination={rows.length > 10 ? { pageSize: 10, size: 'small' } : false}
            dataSource={rows}
            columns={[
              { title: '', width: 40, render: (_, x) => (x.side === 'pull' ? '↓' : '↑') },
              { title: t('Collection'), dataIndex: 'collection', render: (c: string) => <Text code style={{ whiteSpace: 'nowrap' }}>{c}</Text> },
              { title: t('Record'), render: (_, x) => <Text type="secondary" style={{ whiteSpace: 'nowrap' }}>{x.id.slice(0, 8)}</Text> },
              { title: t('Result'), render: (_, x) => <Tag color={STATUS_COLOR[x.status]}>{statusLabel(x.status)}</Tag> },
              {
                title: t('Why'),
                render: (_, x) => (
                  <Space direction="vertical" size={0}>
                    {x.reason && <Text type="secondary">{reasonText(x.reason)}</Text>}
                    {(x.warnings ?? []).map((w, i) => (
                      <Text key={i} type="warning" style={{ fontSize: 12 }}>
                        {w}
                      </Text>
                    ))}
                  </Space>
                ),
              },
            ]}
          />
        )}
        {a.status.pending.length === 0 && r.held.length > 0 && heldTable(a, r.held)}
      </div>
    );
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%', maxWidth: 640 }}>
      <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 12 }}>
        {tArgs(
          'Closed until you open it. A collection moves only when one side sends it and the other receives it, and {name} has its own setting. Machine-local state (such as an open tunnel) never moves.',
          { name: peer.name },
        )}
      </Paragraph>
      {remoteError && <Alert type="warning" showIcon message={tArgs('Could not ask {name} what it has opened', { name: peer.name })} description={remoteError} />}
      {list.apps.map((a) => {
        const draft = drafts[a.app] ?? a.policy;
        const dirty = !samePolicy(draft, a.policy);
        const theirs = remote?.find((x) => x.app === a.app);
        const hasSecrets = a.collections.some((c) => c.secretFields.length > 0);
        const report = reports[a.app];
        const pending = a.status.pending;
        const working = busy[a.app] !== undefined;
        const canSync = peer.canSend && isOpen(a.policy) && !dirty && !working;
        return (
          <Card
            key={a.app}
            size="small"
            title={
              <Space size={6} wrap>
                <Text strong>{a.app}</Text>
                {a.version && <Tag>{a.version}</Tag>}
                {remote &&
                  (theirs ? (
                    <Tag color="green">{tArgs('{name} has opened it', { name: peer.name })}</Tag>
                  ) : (
                    <Tag>{tArgs('{name} has not opened it', { name: peer.name })}</Tag>
                  ))}
                {!isOpen(a.policy) && <Tag>{t('closed')}</Tag>}
              </Space>
            }
          >
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={a.collections}
              columns={[
                {
                  title: t('Collection'),
                  render: (_, c) => (
                    <Space direction="vertical" size={0}>
                      <Text code>{c.id}</Text>
                      {c.secretFields.length > 0 && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {t('Holds secrets')}: {c.secretFields.join(', ')}
                        </Text>
                      )}
                      {c.localFields.length > 0 && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {t('Stays on this machine')}: {c.localFields.join(', ')}
                        </Text>
                      )}
                    </Space>
                  ),
                },
                {
                  title: tArgs('With {name}', { name: peer.name }),
                  width: 250,
                  render: (_, c) => (
                    <Segmented
                      size="small"
                      value={draft.collections[c.id] ?? 'off'}
                      options={(['off', 'send', 'receive', 'both'] as SenLinkSyncDirection[]).map((d) => ({ value: d, label: directionLabel[d] }))}
                      onChange={(v) => {
                        const collections = { ...draft.collections };
                        if (v === 'off') delete collections[c.id];
                        else collections[c.id] = v as SenLinkSyncDirection;
                        setDraft(a.app, { ...draft, collections });
                      }}
                    />
                  ),
                },
              ]}
            />
            <Space direction="vertical" size={6} style={{ marginTop: 10 }}>
              {hasSecrets && (
                <Space>
                  <Switch
                    checked={draft.secrets}
                    onChange={(on) => {
                      if (on) askSecrets(a, draft);
                      else {
                        setConfirmed((c) => ({ ...c, [a.app]: false }));
                        setDraft(a.app, { ...draft, secrets: false });
                      }
                    }}
                  />
                  <Text>{t('Also send and accept passwords and keys')}</Text>
                </Space>
              )}
              <Space>
                <Switch checked={draft.adoptMatches} onChange={(on) => setDraft(a.app, { ...draft, adoptMatches: on })} />
                <Text>{t('Merge records that mean the same thing')}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('(same host and user, same name). Off: they are listed as duplicates and nothing is added.')}
                </Text>
              </Space>
            </Space>
            <Space style={{ marginTop: 12 }} wrap>
              <Button type="primary" icon={<SaveOutlined />} loading={busy[a.app] === 'save'} disabled={!dirty || working} onClick={() => save(a)}>
                {t('Save')}
              </Button>
              <Button
                disabled={!dirty || working}
                onClick={() => {
                  setDraft(a.app, a.policy);
                  setConfirmed((c) => ({ ...c, [a.app]: false }));
                }}
              >
                {t('Revert')}
              </Button>
              <Tooltip title={dirty ? t('Save your changes first') : !isOpen(a.policy) ? t('Open at least one collection first') : undefined}>
                <Button icon={<EyeOutlined />} loading={busy[a.app] === 'preview'} disabled={!canSync} onClick={() => run(a, 'preview')}>
                  {t('Preview')}
                </Button>
              </Tooltip>
              <Tooltip title={dirty ? t('Save your changes first') : !isOpen(a.policy) ? t('Open at least one collection first') : undefined}>
                <Button icon={<SyncOutlined />} loading={busy[a.app] === 'run'} disabled={!canSync} onClick={() => run(a, 'run')}>
                  {t('Sync now')}
                </Button>
              </Tooltip>
              {a.status.last && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {tArgs('Last synced {when}', { when: when(a.status.last.at) })}
                </Text>
              )}
            </Space>
            {runErrors[a.app] && <Alert style={{ marginTop: 8 }} type="warning" showIcon message={runErrors[a.app]} />}
            {pending.length > 0 && heldTable(a, pending)}
            {report && reportView(a, report)}
          </Card>
        );
      })}
    </Space>
  );
};
