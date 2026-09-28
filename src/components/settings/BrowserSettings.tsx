import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Divider,
  Empty,
  Flex,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import { ChromeOutlined, DeleteOutlined, GlobalOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useLang } from '../../i18n';
import { apiGet } from '../../lib/runtimeApi';
import {
  browserAgentApi,
  changedFields,
  type BrowserDriver,
  type BrowserSession,
  type BrowserSettings as Settings,
  type BrowserSettingsView,
  type ConfidenceBands,
  type ExtensionStatus,
} from '../../lib/browserAgentApi';

const { Text, Paragraph } = Typography;

/** One labelled control with an optional help line, like the other settings forms. */
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

/**
 * Settings → Browser: the browser engine (a decision loop in the daemon plus
 * the `sen-browser` runtime driving Chrome) and the Chrome extension that
 * lets it use the person's own browser.
 *
 * The engine choice reaches an agent's tools when its chat starts, so a change
 * applies to chats started afterwards — the help text says so rather than
 * implying the open chat switched.
 */
export const BrowserSettings: React.FC<{ onOpenRuntimeSettings?: () => void }> = ({ onOpenRuntimeSettings }) => {
  const { t } = useLang();
  const [view, setView] = useState<BrowserSettingsView | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [llms, setLlms] = useState<{ id: string; label: string }[]>([]);

  const load = useCallback(async () => {
    try {
      const v = await browserAgentApi.settings();
      setView(v);
      setDraft(v.settings);
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e?.message ?? String(e));
    }
  }, []);

  useEffect(() => {
    load();
    apiGet<{ configs?: { id: string; label?: string; modelName?: string }[] }>('/api/llm-config')
      .then((r) => setLlms((r.configs ?? []).map((c) => ({ id: c.id, label: c.label || c.modelName || c.id }))))
      .catch(() => setLlms([]));
  }, [load]);

  const patch = useMemo(() => (view && draft ? changedFields(view.settings, draft) : {}), [view, draft]);
  const dirty = Object.keys(patch).length > 0;

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      const v = await browserAgentApi.saveSettings(patch);
      setView(v);
      setDraft(v.settings);
      message.success(t('Settings saved'));
    } catch (e: any) {
      // A 422 is worded for a person (which field, which range): show it as is.
      message.error(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));

  if (loadError) {
    return <Alert type="error" showIcon message={loadError} action={<Button size="small" onClick={load}>{t('Retry')}</Button>} />;
  }
  if (!view || !draft) {
    return <Spin />;
  }

  const modelOptions = [{ value: '', label: t('Active chat model') }, ...llms.map((c) => ({ value: c.id, label: c.label }))];
  const driverOptions = [
    { value: 'managed', label: t("SenClaw's own Chrome") },
    { value: 'extension', label: t('Your Chrome (extension)') },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" title={<Space><GlobalOutlined />{t('Browser engine')}</Space>}>
        <Text>
          {t('Engine in use')}:{' '}
          <Tag color={view.engine === 'v2' ? 'green' : 'default'}>
            {view.engine === 'v2' ? t('New (Jev + LLM)') : t('Legacy (extension scripts)')}
          </Tag>
        </Text>
        {!view.runtimeInstalled && (
          <Alert
            style={{ marginTop: 12 }}
            type="warning"
            showIcon
            message={t('The Browser runtime is not installed.')}
            action={
              onOpenRuntimeSettings && (
                <Button size="small" type="primary" onClick={onOpenRuntimeSettings}>
                  {t('Open Runtime settings')}
                </Button>
              )
            }
          />
        )}
      </Card>

      <Card
        size="small"
        title={t('Settings')}
        extra={
          <Button type="primary" size="small" disabled={!dirty} loading={saving} onClick={save}>
            {t('Save')}
          </Button>
        }
      >
        <Divider titlePlacement="start" plain style={{ marginTop: 0 }}>
          {t('General')}
        </Divider>
        <Field
          label={t('Engine')}
          help={t('Auto uses the new engine once the Browser runtime is installed. Applies to chats started afterwards.')}
        >
          <Select
            style={{ width: 280 }}
            value={draft.engine}
            onChange={(v) => set('engine', v)}
            options={[
              { value: 'auto', label: t('Auto') },
              { value: 'v2', label: t('New (Jev + LLM)') },
              { value: 'legacy', label: t('Legacy (extension scripts)') },
            ]}
          />
        </Field>
        <Field label={t('Default browser')}>
          <Select style={{ width: 280 }} value={draft.defaultDriver} onChange={(v) => set('defaultDriver', v)} options={driverOptions} />
        </Field>
        <Field label={t("Run SenClaw's Chrome without a window")}>
          <Switch checked={draft.headless} onChange={(v) => set('headless', v)} />
        </Field>
        <Field label={t('Chrome profile name')}>
          <Input style={{ width: 280 }} value={draft.profile} onChange={(e) => set('profile', e.target.value)} />
        </Field>
        <Field label={t('Step budget')}>
          <InputNumber min={1} max={120} value={draft.maxSteps} onChange={(v) => set('maxSteps', Number(v ?? 1))} />
        </Field>
        <Field label={t('Start page')}>
          <Input style={{ width: 360 }} value={draft.startUrl} onChange={(e) => set('startUrl', e.target.value)} />
        </Field>

        <Divider titlePlacement="start" plain>
          {t('Decisions')}
        </Divider>
        <Field label={t('Decision backend')}>
          <Select
            style={{ width: 360 }}
            value={draft.decisionBackend}
            onChange={(v) => set('decisionBackend', v)}
            options={[
              { value: 'auto', label: t('Auto (local, hosted only for allowed sites)') },
              { value: 'local', label: t('Local model only') },
              { value: 'hosted', label: t('Hosted Jev') },
              { value: 'llm-only', label: t('LLM only (no decision model)') },
            ]}
          />
        </Field>
        <Field label={t('Local decision model')}>
          <Input style={{ width: 280 }} value={draft.localModel} onChange={(e) => set('localModel', e.target.value)} />
        </Field>
        <Field label={t('Hosted model')}>
          <Input
            style={{ width: 280 }}
            value={draft.hostedModel ?? ''}
            onChange={(e) => set('hostedModel', e.target.value.trim() ? e.target.value : null)}
          />
        </Field>
        <Field
          label={t('Sites allowed for hosted decisions')}
          help={t("Only these sites' page text may go to the hosted decision model.")}
        >
          <Select
            mode="tags"
            style={{ width: '100%' }}
            value={draft.hostedDomains}
            onChange={(v) => set('hostedDomains', v)}
            tokenSeparators={[',', ' ']}
          />
        </Field>
        <Field label={t('Sensitive sites')} help={t('Always decided locally, with stricter rules.')}>
          <Select
            mode="tags"
            style={{ width: '100%' }}
            value={draft.sensitiveDomains}
            onChange={(v) => set('sensitiveDomains', v)}
            tokenSeparators={[',', ' ']}
          />
        </Field>
        <Field label={t('Text writer model')}>
          <Select
            style={{ width: 360 }}
            value={draft.textModel ?? ''}
            onChange={(v) => set('textModel', v || null)}
            options={modelOptions}
          />
        </Field>
        <Field label={t('Fallback model')}>
          <Select
            style={{ width: 360 }}
            value={draft.fallbackModel ?? ''}
            onChange={(v) => set('fallbackModel', v || null)}
            options={modelOptions}
          />
        </Field>

        <Divider titlePlacement="start" plain>
          {t('Sites')}
        </Divider>
        <DomainDrivers value={draft.domainDrivers} onChange={(v) => set('domainDrivers', v)} options={driverOptions} />

        <Divider titlePlacement="start" plain>
          {t('Advanced')}
        </Divider>
        <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
          {t('Confidence bands')}
        </Text>
        <Flex gap={24} wrap>
          <Bands label={t('Local')} value={draft.bandsLocal} onChange={(v) => set('bandsLocal', v)} />
          <Bands label={t('Hosted')} value={draft.bandsHosted} onChange={(v) => set('bandsHosted', v)} />
        </Flex>
      </Card>

      <ExtensionCard />
      <ActivityCard />
    </Space>
  );
};

const Bands: React.FC<{ label: string; value: ConfidenceBands; onChange: (v: ConfidenceBands) => void }> = ({
  label,
  value,
  onChange,
}) => {
  const { t } = useLang();
  return (
    <Space direction="vertical" size={4}>
      <Text strong>{label}</Text>
      <Space>
        <Text>{t('Act at or above')}</Text>
        <InputNumber min={0} max={1} step={0.05} value={value.act} onChange={(v) => onChange({ ...value, act: Number(v ?? 0) })} />
      </Space>
      <Space>
        <Text>{t('Ask the LLM at or above')}</Text>
        <InputNumber
          min={0}
          max={1}
          step={0.05}
          value={value.fallback}
          onChange={(v) => onChange({ ...value, fallback: Number(v ?? 0) })}
        />
      </Space>
    </Space>
  );
};

/** Host → browser rows. Kept as a list while editing so a half-typed host is not lost to object keys. */
const DomainDrivers: React.FC<{
  value: Record<string, BrowserDriver>;
  onChange: (v: Record<string, BrowserDriver>) => void;
  options: { value: string; label: string }[];
}> = ({ value, onChange, options }) => {
  const { t } = useLang();
  const [rows, setRows] = useState<[string, BrowserDriver][]>(() => Object.entries(value));
  const toMap = (list: [string, BrowserDriver][]) =>
    Object.fromEntries(list.filter(([host]) => host.trim()).map(([host, d]) => [host.trim(), d]));
  // Follow the saved value (a load, a save) without dropping a row still being typed.
  useEffect(() => {
    if (JSON.stringify(toMap(rows)) !== JSON.stringify(value)) setRows(Object.entries(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const commit = (next: [string, BrowserDriver][]) => {
    setRows(next);
    onChange(toMap(next));
  };
  return (
    <Field label={t('Browser per site')}>
      <Space direction="vertical" style={{ width: '100%' }}>
        {rows.map(([host, driver], i) => (
          <Space key={i}>
            <Input
              style={{ width: 240 }}
              placeholder="example.com"
              value={host}
              onChange={(e) => commit(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))}
            />
            <Select
              style={{ width: 220 }}
              value={driver}
              options={options}
              onChange={(d) => commit(rows.map((r, j) => (j === i ? [r[0], d as BrowserDriver] : r)))}
            />
            <Button icon={<DeleteOutlined />} onClick={() => commit(rows.filter((_, j) => j !== i))} />
          </Space>
        ))}
        <Button icon={<PlusOutlined />} onClick={() => setRows([...rows, ['', 'extension']])}>
          {t('Add site')}
        </Button>
      </Space>
    </Field>
  );
};

/**
 * The extension's connection and its pairing. A new browser shows an
 * 8-character code in the extension's side panel; approving it here is the
 * same as `pair approve <CODE>` in a chat. Polled while this section is open:
 * the person who just opened the side panel is usually looking at this page.
 */
const ExtensionCard: React.FC = () => {
  const { t } = useLang();
  const [status, setStatus] = useState<ExtensionStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await browserAgentApi.extension());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [load]);

  const approve = async (code: string) => {
    setBusy(code);
    try {
      const r = await browserAgentApi.approvePairing(code);
      message.success(`${t('Connected')} ${r.paired}`);
      load();
    } catch (e: any) {
      message.error(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (extId: string) => {
    setBusy(extId);
    try {
      await browserAgentApi.removePaired(extId);
      load();
    } catch (e: any) {
      message.error(e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      size="small"
      title={<Space><ChromeOutlined />{t('Chrome extension')}</Space>}
      extra={<Button size="small" icon={<ReloadOutlined />} onClick={load} />}
    >
      {status?.connected ? (
        <Paragraph>
          <Tag color="green">{t('Connected')}</Tag>
          <Text code>{status.connected.ext_id}</Text>
          {status.connected.version && <Text type="secondary"> v{status.connected.version}</Text>}
          {status.connected.chrome && <Text type="secondary"> · Chrome {status.connected.chrome}</Text>}
        </Paragraph>
      ) : (
        <Paragraph>
          <Tag>{t('Not connected')}</Tag>
        </Paragraph>
      )}

      {(status?.pending ?? []).length > 0 && (
        <>
          <Text strong>{t('Waiting to pair')}</Text>
          {(status?.pending ?? []).map((p) => (
            <Flex key={p.code} align="center" gap={12} style={{ margin: '8px 0' }}>
              <Text code style={{ fontSize: 16, letterSpacing: 2 }}>{p.code}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>{p.ext_id}</Text>
              <Button type="primary" size="small" loading={busy === p.code} onClick={() => approve(p.code)}>
                {t('Approve')}
              </Button>
            </Flex>
          ))}
        </>
      )}

      <Text strong style={{ display: 'block', marginTop: 8 }}>
        {t('Paired browsers')}
      </Text>
      {(status?.paired ?? []).length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={false} style={{ margin: '8px 0' }} />
      ) : (
        (status?.paired ?? []).map((p) => (
          <Flex key={p.ext_id} align="center" gap={12} style={{ margin: '6px 0' }}>
            <Text code>{p.ext_id}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>{new Date(p.paired_at).toLocaleString()}</Text>
            <Popconfirm title={t('This browser will need to pair again.')} onConfirm={() => remove(p.ext_id)}>
              <Button size="small" danger loading={busy === p.ext_id}>
                {t('Remove')}
              </Button>
            </Popconfirm>
          </Flex>
        ))
      )}

      <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
        {t(
          'Install the SenClaw extension in Chrome and open its side panel; its pairing code appears here — or send `pair approve <CODE>` in any chat.'
        )}
      </Text>
    </Card>
  );
};

/** Open sessions and tabs. Only on request: asking starts the browser runtime. */
const ActivityCard: React.FC = () => {
  const { t } = useLang();
  const [sessions, setSessions] = useState<BrowserSession[] | null>(null);
  const [loading, setLoading] = useState(false);

  const show = async () => {
    setLoading(true);
    try {
      const r = await browserAgentApi.tabs();
      setSessions(r.sessions ?? []);
    } catch (e: any) {
      message.error(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  const tabs = (sessions ?? []).flatMap((s) => s.tabs.filter((tab) => !tab.closed).map((tab) => ({ session: s, tab })));

  return (
    <Card size="small" title={t('Activity')} extra={<Button size="small" loading={loading} onClick={show}>{t('Show open tabs')}</Button>}>
      {sessions === null ? null : tabs.length === 0 ? (
        <Text type="secondary">{t('No open tabs')}</Text>
      ) : (
        tabs.map(({ session, tab }) => (
          <Flex key={`${session.id}/${tab.id}`} gap={8} align="center" style={{ margin: '6px 0' }} wrap>
            <Tag>{session.driver === 'extension' ? t('Your Chrome (extension)') : t("SenClaw's own Chrome")}</Tag>
            <Text code>{tab.owner ?? '—'}</Text>
            <Text ellipsis style={{ maxWidth: 420 }}>{tab.url ?? 'about:blank'}</Text>
            {tab.hold !== 'none' && <Tag color="orange">{tab.hold}</Tag>}
          </Flex>
        ))
      )}
    </Card>
  );
};
