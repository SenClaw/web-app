import React from 'react';
import { Alert, Button } from 'antd';
import { ToolOutlined } from '@ant-design/icons';
import { useLang } from '../../i18n';
import type { RuntimeMissingInfo } from '../../lib/runtimeApi';

/**
 * Shown in place of a feature's normal panel when the daemon answers 503 with
 * one of the runtime-missing codes (contract §5.2): `runtime_not_installed`,
 * `runtime_not_selected`, `runtime_start_failed`. The engine that used to run
 * in-process now lives in a separate runtime the daemon installs and starts —
 * so "not available" is an expected, actionable state, not a generic error.
 */
export const RuntimeMissingBanner: React.FC<{
  info: RuntimeMissingInfo;
  onOpenRuntimeSettings?: () => void;
}> = ({ info, onOpenRuntimeSettings }) => {
  const { t } = useLang();
  return (
    <Alert
      type="warning"
      showIcon
      icon={<ToolOutlined />}
      message={t('This feature needs a runtime')}
      description={info.message}
      style={{ marginBottom: 24 }}
      action={
        onOpenRuntimeSettings ? (
          <Button size="small" type="primary" onClick={onOpenRuntimeSettings}>
            {t('Open Runtime settings')}
          </Button>
        ) : undefined
      }
    />
  );
};
