import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { DeleteOutlined, LinkOutlined, ReloadOutlined, SaveOutlined, SendOutlined } from '@ant-design/icons';
import { useLang } from '../../i18n';
import {
  senLinkApi,
  taskStateLabel,
  type A2ATask,
  type SenLinkDiscovered,
  type SenLinkInvite,
  type SenLinkPeer,
  type SenLinkProbe,
  type SenLinkScan,
  type SenLinkSettings as Settings,
  type SenLinkStatus,
} from '../../lib/coworkApi';

const { Text, Paragraph } = Typography;

const Field: React.FC<{ label: string; help?: string; children: React.ReactNode }> = ({ label, help, children }) => (
  <div style={{ marginBottom: 16 }}>
    <Text strong style={{ display: 'block', marginBottom: 6 }}>
      {label}
    </Text>
    {children}
    {help && (
      <Text type="secondary" style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
        {help}
      </Text>
    )}
  </div>
);

const STATE_COLOR: Record<string, string> = {
  TASK_STATE_SUBMITTED: 'default',
  TASK_STATE_WORKING: 'processing',
  TASK_STATE_INPUT_REQUIRED: 'warning',
  TASK_STATE_COMPLETED: 'success',
  TASK_STATE_FAILED: 'error',
  TASK_STATE_CANCELED: 'default',
};

const orNull = (v: string) => (v.trim() === '' ? null : v.trim());
/** `ip:port`, with an IPv6 address in brackets. */
const hostPort = (ip: string, port: number) => (ip.includes(':') ? `[${ip}]:${port}` : `${ip}:${port}`);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Tasks this daemon sent to one peer, read back from the peer over A2A. */
const PeerTasks: React.FC<{ peer: SenLinkPeer }> = ({ peer }) => {
  const { t } = useLang();
  const [tasks, setTasks] = useState<A2ATask[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTasks((await senLinkApi.tasks(peer.id)).tasks);
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, [peer.id]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <Alert type="warning" showIcon message={t('Could not reach this peer')} description={error} />;
  if (!tasks) return <Spin />;
  if (tasks.length === 0) return <Empty description={t('No tasks sent to this peer yet')} />;
  return (
    <Table<A2ATask>
      size="small"
      rowKey="id"
      dataSource={tasks}
      scroll={{ x: 'max-content' }}
      pagination={false}
      expandable={{
        rowExpandable: (r) => r.artifacts.length > 0,
        expandedRowRender: (r) =>
          r.artifacts.map((a) => (
            <Paragraph key={a.artifactId} style={{ whiteSpace: 'pre-wrap', marginBottom: 8 }}>
              <Text strong>{a.name}: </Text>
              {a.parts.map((p) => p.text ?? '').join('\n')}
            </Paragraph>
          )),
      }}
      columns={[
        { title: '#', dataIndex: 'id', width: 60 },
        { title: t('Task'), render: (_, r) => r.metadata?.title ?? '' },
        {
          title: t('State'),
          render: (_, r) => <Tag color={STATE_COLOR[r.status.state] ?? 'default'}>{taskStateLabel(r.status.state)}</Tag>,
        },
        {
          title: '',
          width: 90,
          render: (_, r) =>
            ['TASK_STATE_SUBMITTED', 'TASK_STATE_INPUT_REQUIRED'].includes(r.status.state) ? (
              <Button
                size="small"
                onClick={async () => {
                  try {
                    await senLinkApi.cancel(peer.id, r.id);
                    load();
                  } catch (e) {
                    message.error(errText(e));
                  }
                }}
              >
                {t('Cancel')}
              </Button>
            ) : null,
        },
      ]}
    />
  );
};

/** The address to type for a discovered SLink: its first (IPv4-first) address and port. */
const addrOf = (d: SenLinkDiscovered) => hostPort(d.addrs[0] ?? '', d.port);

/**
 * Other SLinks the network has shown — announcements arrive on their own, a
 * scan only when the person asks — each one tap away from the address field.
 */
const Nearby: React.FC<{
  enabled: boolean;
  discovered: SenLinkDiscovered[];
  scan: SenLinkScan | null;
  announcing: boolean;
  discoveryError: string | null;
  onScan: () => void;
  onCancel: () => void;
  onUse: (d: SenLinkDiscovered) => void;
}> = ({ enabled, discovered, scan, announcing, discoveryError, onScan, onCancel, onUse }) => {
  const { t, tArgs } = useLang();
  const running = scan?.state === 'running';
  return (
    <Space direction="vertical" style={{ width: '100%' }} size={8}>
      <Space wrap>
        <Text strong>{t('Nearby SenClaws')}</Text>
        <Tooltip title={t('A scan tries to connect to the SLink port on every address of this machine\'s networks. Some company networks flag that.')}>
          <Button size="small" loading={running} disabled={!enabled} onClick={onScan}>
            {t('Scan network')}
          </Button>
        </Tooltip>
        {running && (
          <Button size="small" onClick={onCancel}>
            {t('Cancel')}
          </Button>
        )}
      </Space>
      {running && scan && <Progress percent={scan.total ? Math.round((scan.scanned / scan.total) * 100) : 0} size="small" format={() => `${scan.scanned}/${scan.total}`} />}
      {scan && scan.notes.length > 0 && <Alert type="info" showIcon message={scan.notes.join(' ')} />}
      {scan && scan.state !== 'running' && (
        <Text type="secondary">
          {scan.state === 'canceled'
            ? t('Scan canceled.')
            : scan.found.length === 0
              ? tArgs('Scan finished: no SenClaw on {ranges}.', { ranges: scan.ranges.join(', ') })
              : tArgs('Scan finished: {n} found on {ranges}.', { n: scan.found.length, ranges: scan.ranges.join(', ') })}
        </Text>
      )}
      {discoveryError && enabled && (
        <Alert type="warning" showIcon message={tArgs('Finding SenClaws by announcement is not working: {error}', { error: discoveryError })} />
      )}
      {discovered.length === 0 ? (
        <Text type="secondary">
          {enabled
            ? t('No other SenClaw seen yet. They show up here when they announce themselves on this network; or scan, or type an address.')
            : t('Enable SLink to find other SenClaws.')}
        </Text>
      ) : (
        discovered.map((d) => (
          <Space key={d.daemonId} wrap>
            <Text strong>{d.name}</Text>
            <Text code>{addrOf(d)}</Text>
            {d.pairable && <Tag color="green">{t('has an invite')}</Tag>}
            {d.sources.map((src) => (
              <Tag key={src}>{src === 'mdns' ? t('announced') : t('scan')}</Tag>
            ))}
            <Button size="small" icon={<LinkOutlined />} onClick={() => onUse(d)}>
              {t('Use')}
            </Button>
          </Space>
        ))
      )}
      {!announcing && enabled && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {t('This SenClaw is not announcing itself, so others will not find it by listening.')}
        </Text>
      )}
    </Space>
  );
};

/** What a typed address turned out to be, in a sentence a person can act on. */
const ProbeResult: React.FC<{ probe: SenLinkProbe }> = ({ probe }) => {
  const { t, tArgs } = useLang();
  if (!probe.ok || !probe.card) {
    if (probe.ok && probe.hidden) {
      return <Alert type="success" showIcon message={tArgs('A SLink answers at {addr}, but it hides its name. You can still pair with a code.', { addr: probe.addr })} />;
    }
    return <Alert type="warning" showIcon message={probe.error ?? t('Nothing answered.')} />;
  }
  return (
    <Alert
      type={probe.card.pairable ? 'success' : 'info'}
      showIcon
      message={tArgs('Found {name} at {addr}', { name: probe.card.name, addr: probe.addr })}
      description={
        <>
          {probe.resolved.length > 0 && <div>{probe.resolved.join(', ')}</div>}
          {!probe.card.pairable && <div>{t('It has no invite right now. Create one on that SenClaw and type its code here.')}</div>}
        </>
      }
    />
  );
};

/**
 * Settings → SLink (code name sen-link): peer this SenClaw with another one on
 * the same network over A2A, delegate tasks to it, and decide how much a
 * peer's own tasks may do here.
 */
export const SenLinkSettings: React.FC = () => {
  const { t, tArgs } = useLang();
  const [status, setStatus] = useState<SenLinkStatus | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [peers, setPeers] = useState<SenLinkPeer[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [invite, setInvite] = useState<SenLinkInvite | null>(null);
  const [pairAddr, setPairAddr] = useState('');
  const [pairCode, setPairCode] = useState('');
  const [probe, setProbe] = useState<SenLinkProbe | null>(null);
  const [probing, setProbing] = useState(false);
  const [pairing, setPairing] = useState(false);
  const [migratedShown, setMigratedShown] = useState(true);
  const [discovered, setDiscovered] = useState<SenLinkDiscovered[]>([]);
  const [scan, setScan] = useState<SenLinkScan | null>(null);
  const [sendTo, setSendTo] = useState<SenLinkPeer | null>(null);
  const [sendText, setSendText] = useState('');
  const [sendWorktree, setSendWorktree] = useState(true);

  const load = useCallback(async () => {
    try {
      const [st, p] = await Promise.all([senLinkApi.status(), senLinkApi.peers()]);
      setStatus(st);
      setDraft(st.settings);
      setPeers(p.peers);
      setLoadError(null);
    } catch (e) {
      setLoadError(errText(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // What the network shows changes by itself: look again every few seconds while this screen is open.
  const enabledNow = status?.settings.enabled ?? false;
  useEffect(() => {
    if (!enabledNow) return;
    let alive = true;
    const look = () =>
      senLinkApi
        .discovered()
        .then((d) => alive && setDiscovered(d.discovered))
        .catch(() => undefined);
    look();
    const timer = setInterval(look, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [enabledNow]);

  // A running scan is polled until it ends, then the list is read once more.
  const scanId = scan?.state === 'running' ? scan.scanId : null;
  useEffect(() => {
    if (!scanId) return;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const s = await senLinkApi.scanGet(scanId);
        if (!alive) return;
        setScan(s);
        if (s.state !== 'running') senLinkApi.discovered().then((d) => alive && setDiscovered(d.discovered)).catch(() => undefined);
      } catch (e) {
        if (alive) message.error(errText(e));
      }
    }, 700);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [scanId]);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      setDraft(await senLinkApi.putSettings(draft));
      message.success(t('Saved'));
      // The daemon opens, moves or closes its LAN socket a moment after the save.
      setTimeout(load, 600);
    } catch (e) {
      message.error(errText(e));
    } finally {
      setSaving(false);
    }
  };

  const patchPeer = async (id: string, p: Parameters<typeof senLinkApi.patchPeer>[1]) => {
    try {
      const updated = await senLinkApi.patchPeer(id, p);
      setPeers((ps) => ps.map((x) => (x.id === id ? updated : x)));
    } catch (e) {
      message.error(errText(e));
    }
  };

  const checkAddress = async () => {
    setProbing(true);
    try {
      setProbe(await senLinkApi.probe(pairAddr.trim()));
    } catch (e) {
      message.error(errText(e));
    } finally {
      setProbing(false);
    }
  };

  const startScan = async () => {
    try {
      setScan(await senLinkApi.scanStart());
    } catch (e) {
      message.error(errText(e));
    }
  };

  const useDiscovered = (d: SenLinkDiscovered) => {
    const addr = addrOf(d);
    setPairAddr(addr);
    setProbe(null);
    senLinkApi
      .probe(addr)
      .then(setProbe)
      .catch((e) => message.error(errText(e)));
  };

  if (loadError) return <Alert type="error" showIcon message={t('Could not load SLink')} description={loadError} />;
  if (!draft || !status) return <Spin />;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {status.migrated.length > 0 && migratedShown && (
        <Alert
          type="warning"
          showIcon
          closable
          onClose={() => setMigratedShown(false)}
          message={tArgs('Peers that only a hub reached were removed: {names}. Pair them again over the LAN.', {
            names: status.migrated.join(', '),
          })}
        />
      )}
      <Card
        title="SLink"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={load}>
              {t('Refresh')}
            </Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
              {t('Save')}
            </Button>
          </Space>
        }
      >
        <Paragraph type="secondary">
          {t('Connect this SenClaw to another one on the same network (A2A protocol) to hand tasks back and forth. Tasks a peer sends land on a kanban board.')}
        </Paragraph>
        <Field label={t('Enabled')}>
          <Space wrap>
            <Switch checked={draft.enabled} onChange={(v) => set('enabled', v)} />
            {status.settings.enabled &&
              (status.listening ? (
                <Tag color="green">{tArgs('Listening on {addr}', { addr: status.listening })}</Tag>
              ) : (
                <Tag color="red">{status.listenError ?? t('Not listening')}</Tag>
              ))}
          </Space>
        </Field>
        <Space wrap size={24}>
          <Field label={t('Name shown to peers')}>
            <Input style={{ width: 240 }} value={draft.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field
            label={t('Listen address')}
            help={t('Which network interface SLink listens on; 0.0.0.0 is all of them. Only connections from a private network are accepted either way.')}
          >
            <Input style={{ width: 200 }} placeholder="0.0.0.0" value={draft.listenHost} onChange={(e) => set('listenHost', e.target.value)} />
          </Field>
          <Field label={t('Listen port')}>
            <InputNumber
              style={{ width: 120 }}
              min={1}
              max={65535}
              value={draft.listenPort}
              onChange={(v) => set('listenPort', typeof v === 'number' ? v : draft.listenPort)}
            />
          </Field>
        </Space>
        <Field
          label={t('Visible to others')}
          help={t('Off: another SenClaw cannot find this one by checking or scanning its address. Pairing with a typed address and a code still works.')}
        >
          <Switch checked={draft.discoverable} onChange={(v) => set('discoverable', v)} />
        </Field>
        {status.addresses.length > 0 && (
          <Field label={t('Addresses of this machine')} help={t('Type one of these on the other SenClaw to pair with this one.')}>
            <Space wrap>
              {status.addresses.map((a) => (
                <Text key={a} code copyable={{ text: hostPort(a, draft.listenPort) }}>
                  {hostPort(a, draft.listenPort)}
                </Text>
              ))}
            </Space>
          </Field>
        )}
        <Field label={t('Description')}>
          <Input value={draft.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <Space wrap size={24}>
          <Field label={t('Board for incoming tasks')}>
            <Input style={{ width: 200 }} value={draft.boardTitle} onChange={(e) => set('boardTitle', e.target.value)} />
          </Field>
          <Field label={t('Workspace folder')} help={t('Where workers for incoming tasks run.')}>
            <Input style={{ width: 280 }} value={draft.workspaceDir ?? ''} onChange={(e) => set('workspaceDir', orNull(e.target.value))} />
          </Field>
          <Field label={t('Default assignee')}>
            <Input
              style={{ width: 180 }}
              placeholder="claude-code"
              value={draft.defaultAssignee ?? ''}
              onChange={(e) => set('defaultAssignee', orNull(e.target.value))}
            />
          </Field>
        </Space>
      </Card>

      <Card title={t('Pair with another SenClaw')}>
        {!status.settings.enabled && <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('Enable SLink and save first.')} />}
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space wrap>
            <Button
              disabled={!status.settings.enabled}
              onClick={async () => {
                try {
                  setInvite(await senLinkApi.invite());
                } catch (e) {
                  message.error(errText(e));
                }
              }}
            >
              {t('Create invite code')}
            </Button>
            {invite && (
              <Text>
                <Text code copyable style={{ fontSize: 18 }}>
                  {invite.code}
                </Text>{' '}
                <Text type="secondary">
                  {t('valid until')} {new Date(invite.expiresAt * 1000).toLocaleTimeString()} · {t('use it once on the other SenClaw')}
                </Text>
              </Text>
            )}
          </Space>
          {invite && !invite.listening && (
            <Alert type="warning" showIcon message={invite.listenError ?? t('SLink is not listening, so the other SenClaw cannot reach this one.')} />
          )}
          {invite && invite.addresses.length > 0 && (
            <Text type="secondary">
              {t('Type this on the other SenClaw:')}{' '}
              {invite.addresses.map((a) => (
                <Text key={a} code copyable={{ text: hostPort(a, invite.port) }} style={{ marginRight: 8 }}>
                  {hostPort(a, invite.port)}
                </Text>
              ))}
            </Text>
          )}
          <Nearby
            enabled={status.settings.enabled}
            discovered={discovered}
            scan={scan}
            announcing={status.discovery.advertising || !status.settings.discoverable || !status.listening}
            discoveryError={status.discovery.error}
            onScan={startScan}
            onCancel={() => scan && senLinkApi.scanCancel(scan.scanId).then(setScan).catch((e) => message.error(errText(e)))}
            onUse={useDiscovered}
          />
          <Space wrap>
            <Input
              style={{ width: 320 }}
              placeholder={t('IP or name of the other SenClaw, e.g. 192.168.1.20 or mac-mini.local')}
              value={pairAddr}
              onChange={(e) => {
                setPairAddr(e.target.value);
                setProbe(null);
              }}
              onPressEnter={() => pairAddr.trim() && checkAddress()}
            />
            <Button loading={probing} disabled={!pairAddr.trim()} onClick={checkAddress}>
              {t('Check')}
            </Button>
            <Input style={{ width: 160 }} placeholder={t('Invite code')} value={pairCode} onChange={(e) => setPairCode(e.target.value)} />
            <Button
              type="primary"
              icon={<LinkOutlined />}
              loading={pairing}
              disabled={!status.settings.enabled || !pairAddr.trim() || !pairCode.trim()}
              onClick={async () => {
                setPairing(true);
                try {
                  const p = await senLinkApi.pair(pairAddr.trim(), pairCode.trim());
                  message.success(`${t('Paired with')} ${p.name}`);
                  setPairCode('');
                  setProbe(null);
                  load();
                } catch (e) {
                  message.error(errText(e));
                } finally {
                  setPairing(false);
                }
              }}
            >
              {t('Pair')}
            </Button>
          </Space>
          {probe && <ProbeResult probe={probe} />}
        </Space>
      </Card>

      <Card title={t('Peers')}>
        {peers.length === 0 ? (
          <Empty description={t('No peers yet')} />
        ) : (
          <Table<SenLinkPeer>
            rowKey="id"
            dataSource={peers}
            scroll={{ x: 'max-content' }}
            pagination={false}
            expandable={{ expandedRowRender: (p) => <PeerTasks peer={p} />, rowExpandable: (p) => p.canSend }}
            columns={[
              { title: t('Name'), dataIndex: 'name' },
              {
                title: t('Address'),
                render: (_, p) => (
                  <Space size={4}>
                    {p.addr ?? <Text type="secondary">—</Text>}
                    {p.online && <Tag color="green">{t('online')}</Tag>}
                    {p.legacy && (
                      <Tooltip title={t('Paired by an older version. Pair again over the LAN.')}>
                        <Tag color="orange">{t('re-pair')}</Tag>
                      </Tooltip>
                    )}
                  </Space>
                ),
              },
              {
                title: t('Their tasks run'),
                render: (_, p) => (
                  <Popconfirm
                    disabled={p.autoRun}
                    title={t('Run this peer\'s tasks without review?')}
                    description={t('With assignee claude-code this gives the peer a shell on this machine.')}
                    onConfirm={() => patchPeer(p.id, { autoRun: true })}
                  >
                    <Switch
                      checked={p.autoRun}
                      checkedChildren={t('auto')}
                      unCheckedChildren={t('triage')}
                      onChange={(v) => {
                        if (!v) patchPeer(p.id, { autoRun: false });
                      }}
                    />
                  </Popconfirm>
                ),
              },
              {
                title: t('Assignee'),
                render: (_, p) => (
                  <Input
                    size="small"
                    style={{ width: 140 }}
                    defaultValue={p.assignee ?? ''}
                    placeholder={draft.defaultAssignee ?? t('default')}
                    onBlur={(e) => {
                      if ((e.target.value.trim() || null) !== p.assignee) patchPeer(p.id, { assignee: e.target.value.trim() });
                    }}
                  />
                ),
              },
              {
                title: '',
                render: (_, p) => (
                  <Space>
                    <Button size="small" icon={<SendOutlined />} disabled={!p.canSend} onClick={() => setSendTo(p)}>
                      {t('Send task')}
                    </Button>
                    <Popconfirm
                      title={t('Remove this peer?')}
                      onConfirm={async () => {
                        try {
                          await senLinkApi.removePeer(p.id);
                          load();
                        } catch (e) {
                          message.error(errText(e));
                        }
                      }}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </Card>

      <Modal
        open={!!sendTo}
        title={`${t('Send a task to')} ${sendTo?.name ?? ''}`}
        okText={t('Send')}
        okButtonProps={{ disabled: !sendText.trim() }}
        onCancel={() => setSendTo(null)}
        onOk={async () => {
          if (!sendTo) return;
          try {
            const r = await senLinkApi.send(sendTo.id, sendText.trim(), { worktree: sendWorktree });
            message.success(`${t('Task')} #${r.task.id}: ${taskStateLabel(r.task.status.state)}`);
            setSendTo(null);
            setSendText('');
          } catch (e) {
            message.error(errText(e));
          }
        }}
      >
        <Input.TextArea rows={6} value={sendText} onChange={(e) => setSendText(e.target.value)} placeholder={t('What should the other SenClaw do?')} />
        <Checkbox style={{ marginTop: 8 }} checked={sendWorktree} onChange={(e) => setSendWorktree(e.target.checked)}>
          {t('Ask it to work on its own git branch (worktree)')}
        </Checkbox>
      </Modal>
    </Space>
  );
};
