/**
 * SkillHistoryPanel — every change to one skill: who or what changed it, what
 * the diff was, what the security scan said, how the skill has behaved since
 * (loads, how the turns ended), and a way back.
 *
 * Data: `GET /api/skills/:name/history[/:rev]`, `POST .../rollback/:rev`,
 * `GET /api/skill-usage/summary` (see `lib/skillHistoryApi.ts`).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Empty, Flex, Popconfirm, Spin, Tag, Tooltip, Typography, message, theme } from 'antd';
import { RollbackOutlined } from '@ant-design/icons';
import {
  fetchSkillHistory,
  fetchSkillRevision,
  fetchSkillUsage,
  rollbackSkill,
  type RevisionOrigin,
  type ScanSummary,
  type SkillRevision,
  type UsageVersion,
} from '../../lib/skillHistoryApi';

const { Text } = Typography;

const ORIGIN: Record<RevisionOrigin, { label: string; color: string; hint: string }> = {
  MANUAL: { label: 'Edited', color: 'blue', hint: 'Written through SenClaw: created, overwritten or saved in the editor.' },
  IMPORTED: { label: 'Installed', color: 'purple', hint: 'Installed from ClaWHub.' },
  ROLLBACK: { label: 'Restored', color: 'cyan', hint: 'Put back to an earlier revision.' },
  REMOVED: { label: 'Removed', color: 'red', hint: 'The skill was removed. Its last content is still restorable.' },
  DETECTED: { label: 'Changed outside SenClaw', color: 'orange', hint: 'Found different on disk: a CLI install, a kit, or a text editor. Also used to keep what was there just before SenClaw overwrote it.' },
  BASELINE: { label: 'First seen', color: 'default', hint: 'The first time SenClaw saw this skill; nothing earlier is known.' },
};

const SOURCE_NAME: Record<string, string> = {
  bundled: 'the bundled skill',
  'global-compat': 'the global skill',
  'global-sema': 'the global skill',
};

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

function pct(rate: number | null): string {
  return rate === null ? '–' : `${Math.round(rate * 100)}%`;
}

function ScanBadge({ scan }: { scan: ScanSummary | null }) {
  if (!scan || scan.verdict === 'allow') return null;
  const n = scan.findings.length;
  return (
    <Tag color={scan.verdict === 'block' ? 'error' : 'warning'} style={{ marginInlineEnd: 0 }}>
      scan: {n} finding{n === 1 ? '' : 's'}
    </Tag>
  );
}

/** A unified diff with the added and removed lines tinted. */
function DiffView({ diff }: { diff: string }) {
  const { token } = theme.useToken();
  if (!diff.trim()) {
    return <Text type="secondary" style={{ fontSize: 12 }}>No content difference from the previous revision.</Text>;
  }
  const tint = (line: string): { background?: string; color?: string; fontWeight?: number } => {
    if (line.startsWith('+++') || line.startsWith('---')) return { fontWeight: 600 };
    if (line.startsWith('+')) return { background: token.colorSuccessBg, color: token.colorSuccessText };
    if (line.startsWith('-')) return { background: token.colorErrorBg, color: token.colorErrorText };
    if (line.startsWith('@@')) return { background: token.colorInfoBg, color: token.colorInfoText };
    return {};
  };
  return (
    <pre
      style={{
        margin: 0,
        padding: '8px 0',
        fontSize: 12,
        lineHeight: 1.55,
        fontFamily: 'Menlo, Monaco, monospace',
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 8,
        overflow: 'auto',
        maxHeight: 420,
        background: token.colorBgContainer,
      }}
    >
      {diff.split('\n').map((line, i) => (
        <div key={i} style={{ padding: '0 12px', whiteSpace: 'pre', ...tint(line) }}>
          {line || ' '}
        </div>
      ))}
    </pre>
  );
}

function ScanFindings({ scan }: { scan: ScanSummary }) {
  if (scan.findings.length === 0) return null;
  return (
    <Alert
      type={scan.verdict === 'block' ? 'error' : 'warning'}
      showIcon
      message={`Security scan: ${scan.findings.length} finding${scan.findings.length === 1 ? '' : 's'} (risk ${scan.riskScore}/100)`}
      description={
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {scan.findings.map((f, i) => (
            <li key={i} style={{ fontSize: 12 }}>
              <Text code>{f.rule}</Text> {f.severity} — {f.title}{' '}
              <Text type="secondary">({f.file}{f.line ? `:${f.line}` : ''})</Text>
            </li>
          ))}
        </ul>
      }
    />
  );
}

export default function SkillHistoryPanel({ name, source, canRollback, refreshKey = 0, onRolledBack }: {
  name: string;
  source: string;
  /** Only skills in the managed directory can be restored. */
  canRollback: boolean;
  /** Bump to reload after the skill was changed from outside this panel. */
  refreshKey?: number;
  onRolledBack?: () => void;
}) {
  const { token } = theme.useToken();
  const [revisions, setRevisions] = useState<SkillRevision[] | null>(null);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkillRevision | null>(null);
  const [usage, setUsage] = useState<UsageVersion[]>([]);
  const [usageDays, setUsageDays] = useState(30);
  const [restoring, setRestoring] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const h = await fetchSkillHistory(name, source);
      setRevisions(h.revisions);
      setSelectedId(prev => (prev && h.revisions.some(r => r.id === prev) ? prev : h.revisions[0]?.id ?? null));
      // The numbers are optional: a daemon without the ledger just shows none.
      fetchSkillUsage(usageDays)
        .then(u => {
          setUsageDays(u.days);
          setUsage(u.skills.find(s => s.source === h.source && s.key === h.key)?.versions ?? []);
        })
        .catch(() => setUsage([]));
    } catch (e) {
      setRevisions([]);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [name, source, usageDays]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let live = true;
    setDetail(null);
    fetchSkillRevision(name, selectedId, source)
      .then(r => { if (live) setDetail(r); })
      .catch(() => { if (live) setDetail(null); });
    return () => { live = false; };
  }, [name, source, selectedId]);

  const usageByHash = useMemo(() => {
    const m = new Map<string, UsageVersion>();
    for (const v of usage) if (v.contentHash) m.set(v.contentHash, v);
    return m;
  }, [usage]);

  const restore = async (rev: SkillRevision) => {
    setRestoring(true);
    try {
      await rollbackSkill(name, rev.id);
      message.success('Skill restored');
      await load();
      onRolledBack?.();
    } catch (e) {
      message.error(e instanceof Error ? e.message : 'Could not restore this revision');
    } finally {
      setRestoring(false);
    }
  };

  if (revisions === null) {
    return <Flex align="center" justify="center" style={{ height: 200 }}><Spin /></Flex>;
  }
  if (error) {
    return <div style={{ padding: 20 }}><Alert type="error" showIcon message="Could not load the history" description={error} /></div>;
  }
  if (revisions.length === 0) {
    return (
      <Flex align="center" justify="center" style={{ height: 240 }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No history yet. A skill's history starts the first time it is changed through SenClaw or seen by the daemon."
        />
      </Flex>
    );
  }

  const newest = revisions[0];
  const rev = detail ?? revisions.find(r => r.id === selectedId) ?? null;
  const canRestore = !!rev && canRollback && rev.hasSnapshot && !rev.truncated && rev.origin !== 'REMOVED' && rev.id !== newest.id;
  const why = !rev ? '' : rev.id === newest.id ? 'This is the current revision.'
    : rev.origin === 'REMOVED' ? 'A removal has no content of its own; pick the revision before it.'
    : rev.truncated ? 'This revision hit a size cap, so its content is incomplete.'
    : !rev.hasSnapshot ? 'Its content was dropped: only the newest 30 revisions keep it.'
    : !canRollback ? 'Only skills in the managed skills directory can be restored.' : '';

  return (
    <Flex style={{ height: '100%', minHeight: 0 }}>
      {/* Timeline */}
      <div style={{ flex: '0 0 clamp(220px, 36%, 340px)', overflowY: 'auto', borderRight: `1px solid ${token.colorBorderSecondary}` }}>
        {usage.length > 0 && (
          <div style={{ padding: '10px 16px', borderBottom: `1px solid ${token.colorBorderSecondary}`, background: token.colorFillAlter }}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              Last {usageDays} days, all versions: {usage.reduce((n, v) => n + v.loads, 0)} loads
            </Text>
          </div>
        )}
        {revisions.map((r, i) => {
          const o = ORIGIN[r.origin] ?? { label: r.origin, color: 'default', hint: '' };
          const u = usageByHash.get(r.contentHash);
          const active = r.id === selectedId;
          return (
            <div
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              style={{
                padding: '10px 16px',
                cursor: 'pointer',
                borderBottom: `1px solid ${token.colorBorderSecondary}`,
                background: active ? token.colorPrimaryBg : undefined,
              }}
            >
              <Flex align="center" gap={6} wrap="wrap">
                <Tooltip title={o.hint}><Tag color={o.color} style={{ marginInlineEnd: 0 }}>{o.label}</Tag></Tooltip>
                {i === 0 && <Tag color="green" style={{ marginInlineEnd: 0 }}>current</Tag>}
                <ScanBadge scan={r.scan} />
                {r.shadows && <Tag color="gold" style={{ marginInlineEnd: 0 }}>overrides {SOURCE_NAME[r.shadows] ?? r.shadows}</Tag>}
              </Flex>
              <div style={{ marginTop: 4 }}>
                <Text style={{ fontSize: 12 }}>{r.changeSummary || '—'}</Text>
              </div>
              <Flex gap={8} style={{ marginTop: 2 }} wrap="wrap">
                <Tooltip title={new Date(r.createdAt).toLocaleString()}>
                  <Text type="secondary" style={{ fontSize: 11 }}>{ago(r.createdAt)}</Text>
                </Tooltip>
                <Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>{r.actor}</Text>
              </Flex>
              {u && (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {u.loads} load{u.loads === 1 ? '' : 's'} · fallback {pct(u.fallbackRate)} · tool failures {pct(u.toolFailureRate)}
                </Text>
              )}
            </div>
          );
        })}
      </div>

      {/* Detail */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '16px 20px' }}>
        {!rev ? (
          <Flex align="center" justify="center" style={{ height: 160 }}><Spin /></Flex>
        ) : (
          <Flex vertical gap={12}>
            <Flex align="center" gap={8} wrap="wrap">
              <Text strong>{ORIGIN[rev.origin]?.label ?? rev.origin}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {new Date(rev.createdAt).toLocaleString()} · generation {rev.generation} · {rev.fileCount} file{rev.fileCount === 1 ? '' : 's'}
              </Text>
              <div style={{ flex: 1 }} />
              <Tooltip title={why}>
                <Popconfirm
                  title="Restore this revision?"
                  description="The skill's files are put back as they were. The current content stays in the history."
                  okText="Restore"
                  disabled={!canRestore}
                  onConfirm={() => restore(rev)}
                >
                  <Button size="small" icon={<RollbackOutlined />} disabled={!canRestore} loading={restoring}>
                    Restore
                  </Button>
                </Popconfirm>
              </Tooltip>
            </Flex>
            <Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>
              {rev.id} · sha256 {rev.contentHash.slice(0, 12)} · by {rev.actor}{rev.restoredFrom ? ` · restored from ${rev.restoredFrom}` : ''}
            </Text>
            {rev.shadows && (
              <Alert
                type="info"
                showIcon
                message={`This skill replaces ${SOURCE_NAME[rev.shadows] ?? `the ${rev.shadows} skill`} with the same name.`}
                description="Skills in the managed directory take precedence over bundled ones; the other one is hidden while this exists."
              />
            )}
            {rev.scan && <ScanFindings scan={rev.scan} />}
            <div>
              <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>Change</Text>
              <div style={{ marginTop: 6 }}>
                {rev.diff === undefined ? <Spin size="small" /> : <DiffView diff={rev.diff} />}
              </div>
            </div>
          </Flex>
        )}
      </div>
    </Flex>
  );
}
