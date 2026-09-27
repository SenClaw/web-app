import React, { useEffect, useState } from 'react';
import { Button, Modal, Spin, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useLang } from '../../i18n';
import { runtimeApi } from '../../lib/runtimeApi';

const { Text } = Typography;

interface Props {
  runtimeId: string | null;
  onClose: () => void;
}

/** `GET /api/runtimes/:id/logs` — the tail of the runtime's own log file. */
export const RuntimeLogsModal: React.FC<Props> = ({ runtimeId, onClose }) => {
  const { t, tArgs } = useLang();
  const [loading, setLoading] = useState(false);
  const [path, setPath] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);

  const load = async (id: string) => {
    setLoading(true);
    try {
      const r = await runtimeApi.logs(id, 200);
      setPath(r.path);
      setLines(r.lines);
    } catch (e: any) {
      message.error(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (runtimeId) load(runtimeId);
    else {
      setPath(null);
      setLines([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeId]);

  return (
    <Modal
      title={runtimeId ? tArgs('Logs — {id}', { id: runtimeId }) : t('Logs')}
      open={!!runtimeId}
      onCancel={onClose}
      footer={
        <Button icon={<ReloadOutlined />} onClick={() => runtimeId && load(runtimeId)} loading={loading}>
          {t('Reload')}
        </Button>
      }
      width={760}
    >
      {path && (
        <Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace', display: 'block', marginBottom: 8 }}>
          {path}
        </Text>
      )}
      {loading && lines.length === 0 ? (
        <Spin />
      ) : lines.length === 0 ? (
        <Text type="secondary">{t('No log output yet.')}</Text>
      ) : (
        <pre
          style={{
            margin: 0,
            padding: 12,
            background: 'rgba(0,0,0,0.35)',
            borderRadius: 8,
            fontSize: 12,
            maxHeight: 420,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {lines.join('\n')}
        </pre>
      )}
    </Modal>
  );
};
