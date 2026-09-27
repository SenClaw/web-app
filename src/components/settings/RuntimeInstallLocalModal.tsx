import React, { useState } from 'react';
import { Input, Modal, Typography, message } from 'antd';
import { useLang } from '../../i18n';

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  onInstall: (path: string) => Promise<unknown>;
}

/**
 * "Install from a local path" — a text input, not a file picker: the folder
 * or archive lives on the daemon's filesystem, which a browser cannot browse.
 */
export const RuntimeInstallLocalModal: React.FC<Props> = ({ open, onClose, onInstall }) => {
  const { t, tArgs } = useLang();
  const [path, setPath] = useState('');
  const [installing, setInstalling] = useState(false);

  const submit = async () => {
    const trimmed = path.trim();
    if (!trimmed) return;
    setInstalling(true);
    try {
      await onInstall(trimmed);
      message.success(tArgs('Installed from {path}', { path: trimmed }));
      setPath('');
      onClose();
    } catch (e: any) {
      message.error(e?.message ?? String(e));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Modal
      title={t('Install from a local path')}
      open={open}
      onCancel={onClose}
      onOk={submit}
      okText={t('Install')}
      confirmLoading={installing}
      okButtonProps={{ disabled: !path.trim() }}
    >
      <Text type="secondary">
        {t('Path to a directory holding senclaw-runtime.json, or a .tar.gz / .zip package — on the machine running the daemon.')}
      </Text>
      <Input
        style={{ marginTop: 12, fontFamily: 'monospace' }}
        placeholder="/path/to/sen-ocr-0.1.0-darwin-arm64"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        onPressEnter={submit}
        autoFocus
      />
    </Modal>
  );
};
