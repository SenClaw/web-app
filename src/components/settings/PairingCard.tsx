import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Empty, Flex, Input, Popconfirm, Space, Spin, Table, Tag, Typography, message, theme } from 'antd';
import { CheckOutlined, CloseOutlined, ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons';

const { Text, Paragraph } = Typography;

interface Pairing {
  id: number;
  channelId: number;
  channelName: string;
  chatJid: string;
  chatType: 'user' | 'group';
  senderJid: string;
  senderName: string;
  code: string;
  status: string;
  expired: boolean;
  createdAt: string;
  expiresAt: string;
}

/**
 * Chats waiting to be let into a channel.
 *
 * Before pairing existed, a Telegram message from an unknown chat completed the
 * channel's pending binding on sight — so whoever messaged the bot first owned
 * it, with every tool a UI-created agent has (which is all of them). The bot now
 * answers with a code and stops; this panel is where a person turns that code
 * into access.
 *
 * The sender's name is shown next to the code on purpose: approving is a
 * judgement about a person, and a bare `tg:…:user:812…` gives nothing to judge.
 */
export const PairingCard: React.FC = () => {
  const { token } = theme.useToken();
  const [rows, setRows] = useState<Pairing[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [code, setCode] = useState('');
  const [approvingCode, setApprovingCode] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/pairings');
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setRows(j.pairings ?? []);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => {
    load();
    // The person who just messaged the bot is usually standing at the browser,
    // so a slow poll beats making them reload. The WS `pairing:requested` event
    // covers the fast path when the socket is up.
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (id: number, action: 'approve' | 'reject') => {
    setBusy(id);
    try {
      const r = await fetch(`/api/pairings/${id}/${action}`, { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        // The daemon words its refusals for a person — an expired code, a row
        // somebody already handled, and a channel with no agent are three
        // different problems. Show what it said, not "action failed".
        throw new Error(j.error || 'Request failed');
      }
      message.success(
        action === 'approve'
          ? `Đã duyệt → agent '${j.agentFolder || '?'}'`
          : 'Đã từ chối'
      );
      load();
    } catch (e: any) {
      message.error(e.message || 'Request failed');
    } finally {
      setBusy(null);
    }
  };

  const approveByCode = async () => {
    if (!code.trim()) return;
    setApprovingCode(true);
    try {
      const r = await fetch('/api/pairings/approve-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Request failed');
      message.success(`Đã duyệt → agent '${j.agentFolder || '?'}'`);
      setCode('');
      load();
    } catch (e: any) {
      message.error(e.message || 'Request failed');
    } finally {
      setApprovingCode(false);
    }
  };

  const pending = (rows ?? []).filter((p) => p.status === 'pending');

  return (
    <Card
      size="small"
      title={
        <Space>
          <SafetyCertificateOutlined />
          <span>Pairing — chats đang chờ duyệt</span>
          {pending.length > 0 && <Tag color="orange">{pending.length}</Tag>}
        </Space>
      }
      extra={<Button size="small" icon={<ReloadOutlined />} onClick={load} />}
      style={{ marginBottom: 16 }}
    >
      <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
        Khi một chat lạ nhắn cho bot, nó nhận một mã 8 ký tự và <b>không</b> được xử lý gì
        thêm cho tới khi bạn duyệt ở đây. Mã hết hạn sau 1 giờ.
      </Paragraph>

      <Flex gap={8} style={{ marginBottom: 12 }}>
        <Input
          placeholder="Dán mã người dùng gửi cho bạn (vd. K7M2PQ4R)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onPressEnter={approveByCode}
          style={{ fontFamily: 'monospace', maxWidth: 320 }}
        />
        <Button type="primary" loading={approvingCode} onClick={approveByCode} disabled={!code.trim()}>
          Duyệt mã
        </Button>
      </Flex>

      {rows === null ? (
        <Spin />
      ) : pending.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<Text type="secondary" style={{ fontSize: 12 }}>Không có chat nào đang chờ.</Text>}
        />
      ) : (
        <Table<Pairing>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={pending}
          columns={[
            {
              title: 'Mã',
              dataIndex: 'code',
              width: 110,
              render: (c: string) => (
                <Text strong style={{ fontFamily: 'monospace', letterSpacing: 1 }}>{c}</Text>
              ),
            },
            {
              title: 'Người gửi',
              key: 'sender',
              render: (_: unknown, p) => (
                <Space direction="vertical" size={0}>
                  <Text>{p.senderName || '(không rõ tên)'}</Text>
                  <Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>
                    {p.chatJid}
                  </Text>
                </Space>
              ),
            },
            {
              title: 'Kiểu',
              dataIndex: 'chatType',
              width: 90,
              render: (t: string) =>
                t === 'group' ? (
                  // A group approval lets in everyone in that group, not one
                  // person — the difference has to be visible before clicking.
                  <Tag color="volcano">Group</Tag>
                ) : (
                  <Tag>DM</Tag>
                ),
            },
            { title: 'Channel', dataIndex: 'channelName', width: 140, ellipsis: true },
            {
              title: '',
              key: 'actions',
              width: 150,
              render: (_: unknown, p) => (
                <Space size={4}>
                  <Popconfirm
                    title={
                      p.chatType === 'group'
                        ? 'Duyệt cả group? Mọi thành viên trong group sẽ dùng được agent.'
                        : `Duyệt ${p.senderName || p.chatJid}?`
                    }
                    onConfirm={() => act(p.id, 'approve')}
                  >
                    <Button size="small" type="primary" icon={<CheckOutlined />} loading={busy === p.id}>
                      Duyệt
                    </Button>
                  </Popconfirm>
                  <Button size="small" icon={<CloseOutlined />} onClick={() => act(p.id, 'reject')} disabled={busy === p.id} />
                </Space>
              ),
            },
          ]}
        />
      )}

      {(rows ?? []).some((p) => p.expired && p.status !== 'approved') && (
        <Alert
          type="info"
          showIcon
          style={{ marginTop: 12, fontSize: 12 }}
          message="Có mã đã hết hạn"
          description="Bảo người dùng nhắn lại cho bot để lấy mã mới."
        />
      )}
    </Card>
  );
};
