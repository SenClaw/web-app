import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Flex,
  Input,
  InputNumber,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { CheckOutlined, CloseOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;

interface LspServerInfo {
  workspace: string;
  language: string;
  command: string;
  alive: boolean;
  idleSecs: number;
}

interface LspDisabledInfo {
  workspace: string;
  language: string;
  reason: string;
}

interface LspAvailableInfo {
  language: string;
  command: string | null;
  installed: boolean;
}

interface LspStatus {
  enabled: boolean;
  timeoutMs: number;
  settingsPath: string;
  servers: LspServerInfo[];
  disabled: LspDisabledInfo[];
  available: LspAvailableInfo[];
}

interface LspServerOverride {
  command: string;
  args: string[];
}

interface LspSettingsDoc {
  enabled: boolean;
  timeout_ms: number;
  servers: Record<string, LspServerOverride>;
}

interface OverrideRow {
  key: string;
  language: string;
  command: string;
  argsText: string;
}

// Suggested install for a language that is not on this machine yet — the
// daemon only reports `installed: false`, it does not know the user's
// package manager, so this is a hint, not a command we run for them.
const INSTALL_HINT: Record<string, string> = {
  rust: 'install rust-analyzer to enable',
  typescript: 'install typescript-language-server to enable',
  python: 'install pyright to enable',
  go: 'install gopls to enable',
  dart: 'install the Dart SDK (dart language-server) to enable',
  c: 'install clangd to enable',
};

const basename = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

let rowSeq = 0;
const nextKey = () => `row-${++rowSeq}-${Date.now()}`;

const overridesToRows = (servers: Record<string, LspServerOverride>): OverrideRow[] =>
  Object.entries(servers).map(([language, ov]) => ({
    key: nextKey(),
    language,
    command: ov.command ?? '',
    argsText: (ov.args ?? []).join(' '),
  }));

/**
 * Language servers (LSP) — after every Edit/Write the agent gets the file's
 * real compiler/linter diagnostics from a language server that is already
 * installed on this machine. Nothing is downloaded here; this card only
 * toggles the feature, its timeout, and per-language command overrides.
 */
export const LspSettings: React.FC = () => {
  const [status, setStatus] = useState<LspStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [timeoutMs, setTimeoutMs] = useState(5000);
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [statusRes, settingsRes] = await Promise.all([
        fetch('/api/lsp/status'),
        fetch('/api/lsp/settings'),
      ]);
      if (!statusRes.ok) throw new Error(await statusRes.text());
      if (!settingsRes.ok) throw new Error(await settingsRes.text());
      const s: LspStatus = await statusRes.json();
      const cfg: LspSettingsDoc = await settingsRes.json();
      setStatus(s);
      setEnabled(cfg.enabled);
      setTimeoutMs(cfg.timeout_ms);
      setRows(overridesToRows(cfg.servers ?? {}));
    } catch (e: any) {
      setLoadError(e.message || 'Request failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addRow = () => setRows((r) => [...r, { key: nextKey(), language: '', command: '', argsText: '' }]);
  const removeRow = (key: string) => setRows((r) => r.filter((row) => row.key !== key));
  const updateRow = (key: string, patch: Partial<OverrideRow>) =>
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const save = async () => {
    if (timeoutMs < 500 || timeoutMs > 60000) {
      message.error('Timeout phải trong khoảng 500–60000 ms');
      return;
    }
    const servers: Record<string, LspServerOverride> = {};
    for (const row of rows) {
      const language = row.language.trim();
      const command = row.command.trim();
      if (!language || !command) continue;
      const args = row.argsText.trim().length > 0 ? row.argsText.trim().split(/\s+/) : [];
      servers[language] = { command, args };
    }
    const payload: LspSettingsDoc = { enabled, timeout_ms: timeoutMs, servers };
    setSaving(true);
    try {
      const r = await fetch('/api/lsp/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Request failed');
      message.success('Đã lưu cấu hình language servers');
      await load();
    } catch (e: any) {
      message.error(e.message || 'Request failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ marginBottom: 20 }}>
        <Title level={4} style={{ margin: 0 }}>Language servers (LSP)</Title>
        <Text type="secondary">
          Sau mỗi lần Edit/Write, agent nhận diagnostics (lỗi biên dịch/lint) thật từ một language
          server đã cài sẵn trên máy này — không tải gì cả.
        </Text>
      </div>

      {loadError && (
        <Alert type="error" showIcon message={loadError} style={{ marginBottom: 16 }} />
      )}

      {loading && !status ? (
        <Spin />
      ) : (
        <>
          <Card size="small" title="Cấu hình" style={{ marginBottom: 16 }}>
            <Flex align="center" gap={12} style={{ marginBottom: 12 }}>
              <Switch checked={enabled} onChange={setEnabled} />
              <Text>Enabled</Text>
            </Flex>
            <Flex align="center" gap={12} style={{ marginBottom: 12 }}>
              <Text style={{ minWidth: 120 }}>Timeout (ms)</Text>
              <InputNumber min={500} max={60000} value={timeoutMs} onChange={(v) => setTimeoutMs(v ?? 5000)} />
            </Flex>
            {status?.settingsPath && (
              <Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>
                {status.settingsPath}
              </Text>
            )}
          </Card>

          <Card size="small" title="Language servers khả dụng" style={{ marginBottom: 16 }}>
            <Table
              size="small"
              rowKey="language"
              pagination={false}
              dataSource={status?.available ?? []}
              columns={[
                { title: 'Ngôn ngữ', dataIndex: 'language', width: 140 },
                {
                  title: 'Command',
                  dataIndex: 'command',
                  render: (c: string | null) =>
                    c ? <Text code>{c}</Text> : <Text type="secondary">—</Text>,
                },
                {
                  title: 'Đã cài',
                  dataIndex: 'installed',
                  width: 260,
                  render: (installed: boolean, row: LspAvailableInfo) =>
                    installed ? (
                      <Tag color="green" icon={<CheckOutlined />}>Có</Tag>
                    ) : (
                      <Space direction="vertical" size={0}>
                        <Tag color="default" icon={<CloseOutlined />}>Chưa</Tag>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {INSTALL_HINT[row.language] || 'chưa cài trên máy này'}
                        </Text>
                      </Space>
                    ),
                },
              ]}
            />
          </Card>

          <Card size="small" title="Đang chạy" style={{ marginBottom: 16 }}>
            {(status?.servers ?? []).length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<Text type="secondary">Chưa có server nào chạy.</Text>} />
            ) : (
              <Table
                size="small"
                rowKey={(r) => `${r.workspace}:${r.language}`}
                pagination={false}
                dataSource={status?.servers ?? []}
                columns={[
                  { title: 'Ngôn ngữ', dataIndex: 'language', width: 120 },
                  { title: 'Command', dataIndex: 'command', render: (c: string) => <Text code>{c}</Text> },
                  { title: 'Workspace', dataIndex: 'workspace', render: (w: string) => basename(w) },
                  {
                    title: 'Trạng thái',
                    dataIndex: 'alive',
                    width: 110,
                    render: (alive: boolean) =>
                      alive ? <Tag color="green">alive</Tag> : <Tag color="default">stopped</Tag>,
                  },
                  { title: 'Idle (s)', dataIndex: 'idleSecs', width: 90 },
                ]}
              />
            )}
          </Card>

          {(status?.disabled ?? []).length > 0 && (
            <Card size="small" title="Đã tắt" style={{ marginBottom: 16 }}>
              <Table
                size="small"
                rowKey={(r) => `${r.workspace}:${r.language}`}
                pagination={false}
                dataSource={status?.disabled ?? []}
                columns={[
                  { title: 'Ngôn ngữ', dataIndex: 'language', width: 120 },
                  { title: 'Workspace', dataIndex: 'workspace', render: (w: string) => basename(w) },
                  { title: 'Lý do', dataIndex: 'reason' },
                ]}
              />
            </Card>
          )}

          <Card
            size="small"
            title="Ghi đè theo ngôn ngữ"
            extra={<Button size="small" icon={<PlusOutlined />} onClick={addRow}>Thêm</Button>}
            style={{ marginBottom: 16 }}
          >
            <Paragraph type="secondary" style={{ fontSize: 12 }}>
              Chỉ định command/args riêng cho một ngôn ngữ, ghi đè mặc định của daemon. Args cách nhau
              bởi khoảng trắng.
            </Paragraph>
            {rows.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<Text type="secondary">Không có ghi đè nào.</Text>} />
            ) : (
              rows.map((row) => (
                <Flex key={row.key} gap={8} style={{ marginBottom: 8 }} align="center">
                  <Input
                    placeholder="ngôn ngữ (vd. rust)"
                    value={row.language}
                    onChange={(e) => updateRow(row.key, { language: e.target.value })}
                    style={{ maxWidth: 160 }}
                  />
                  <Input
                    placeholder="command (vd. rust-analyzer)"
                    value={row.command}
                    onChange={(e) => updateRow(row.key, { command: e.target.value })}
                    style={{ maxWidth: 260 }}
                  />
                  <Input
                    placeholder="args (cách nhau bởi dấu cách)"
                    value={row.argsText}
                    onChange={(e) => updateRow(row.key, { argsText: e.target.value })}
                  />
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={() => removeRow(row.key)} />
                </Flex>
              ))
            )}
          </Card>

          <Space>
            <Button type="primary" loading={saving} onClick={save}>Lưu</Button>
            <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>Làm mới</Button>
          </Space>
        </>
      )}
    </div>
  );
};
