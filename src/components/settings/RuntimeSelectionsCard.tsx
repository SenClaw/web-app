import React, { useState } from 'react';
import { Card, Select, Space, Switch, Tag, Typography, message } from 'antd';
import { useLang } from '../../i18n';
import type { RuntimeSlot, RuntimesView } from '../../lib/runtimeApi';

const { Text } = Typography;

const NONE = '__none__';

interface Props {
  view: RuntimesView;
  onSelect: (slot: RuntimeSlot['slot'], id: string | null, version: string | null) => Promise<unknown>;
  onAutoUpdateChange: (value: boolean) => Promise<unknown>;
}

/** One row per slot (GGUF, MLX, Decision, OCR, Speech to text, Text to speech) — which installed runtime answers it. */
export const RuntimeSelectionsCard: React.FC<Props> = ({ view, onSelect, onAutoUpdateChange }) => {
  const { t } = useLang();
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [savingAutoUpdate, setSavingAutoUpdate] = useState(false);

  const change = async (slot: RuntimeSlot, value: string) => {
    setBusySlot(slot.slot);
    try {
      if (value === NONE) {
        await onSelect(slot.slot, null, null);
        return;
      }
      const candidate = slot.candidates.find((c) => `${c.id}@${c.version}` === value);
      if (!candidate) return;
      // §5.1: `version: null` means "track the newest installed version of
      // `id`" and is what clients send by default; an explicit version pins
      // the slot. Picking the runtime's current newest is the common case
      // (track it going forward); only picking an older build still
      // installed alongside it counts as an explicit pin.
      const newest = view.installed.find((r) => r.id === candidate.id)?.version;
      const version = newest === undefined || candidate.version === newest ? null : candidate.version;
      await onSelect(slot.slot, candidate.id, version);
    } catch (e: any) {
      message.error(e?.message ?? String(e));
    } finally {
      setBusySlot(null);
    }
  };

  return (
    <Card title={t('Runtime Selections')} style={{ marginBottom: 20 }}>
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        {view.slots.map((slot) => {
          const value = slot.selected ? `${slot.selected.id}@${slot.selected.version}` : NONE;
          return (
            <div
              key={slot.slot}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}
            >
              <Text strong style={{ minWidth: 140 }}>
                {slot.label}
              </Text>
              <Select
                style={{ flex: 1, maxWidth: 420 }}
                value={value}
                loading={busySlot === slot.slot}
                disabled={busySlot === slot.slot}
                onChange={(v) => change(slot, v)}
                options={[
                  { value: NONE, label: t('None selected') },
                  ...slot.candidates.map((c) => ({
                    value: `${c.id}@${c.version}`,
                    label: (
                      <Space size={6}>
                        <span>{c.name}</span>
                        <Tag style={{ fontFamily: 'monospace', margin: 0 }}>{c.version}</Tag>
                      </Space>
                    ),
                  })),
                ]}
                notFoundContent={
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('No installed runtime fills this slot yet — install one below.')}
                  </Text>
                }
              />
            </div>
          );
        })}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6 }}>
          <Text>{t('Auto-update selected runtime packages')}</Text>
          <Switch
            checked={view.settings.autoUpdate}
            loading={savingAutoUpdate}
            onChange={async (checked) => {
              setSavingAutoUpdate(true);
              try {
                await onAutoUpdateChange(checked);
              } catch (e: any) {
                message.error(e?.message ?? String(e));
              } finally {
                setSavingAutoUpdate(false);
              }
            }}
          />
        </div>
      </Space>
    </Card>
  );
};
