import React, { useState } from 'react';
import { Button, Card, Col, InputNumber, Row, Select, Typography, message } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useLang } from '../../i18n';
import type { LocalModelsSettings } from '../../lib/runtimeApi';

const { Text, Paragraph } = Typography;

function numOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** §5.3: an unset `defaultContextLength` falls back to 32768 daemon-side — mirrored here so the field always shows a concrete, editable number instead of a blank one that looks broken. */
const DEFAULT_CONTEXT_LENGTH = 32768;

interface Props {
  settings: LocalModelsSettings;
  onSave: (next: LocalModelsSettings) => Promise<unknown>;
}

/**
 * Default context length + the settings shared by every local engine
 * (`<local-models>/settings.json`, snake_case). Only the commonly-tuned
 * fields get an input; anything else already in the file round-trips
 * untouched — this card only patches the keys it renders.
 */
export const LocalModelEngineSettingsCard: React.FC<Props> = ({ settings, onSave }) => {
  const { t } = useLang();
  const [ctx, setCtx] = useState<number>(settings.defaultContextLength ?? DEFAULT_CONTEXT_LENGTH);
  const [temperature, setTemperature] = useState<number | undefined>(numOrUndef(settings.engine.temperature));
  const [topK, setTopK] = useState<number | undefined>(numOrUndef(settings.engine.top_k));
  const [topP, setTopP] = useState<number | undefined>(numOrUndef(settings.engine.top_p));
  const [maxNewTokens, setMaxNewTokens] = useState<number | undefined>(numOrUndef(settings.engine.max_new_tokens));
  const [maxKvTokens, setMaxKvTokens] = useState<number | undefined>(numOrUndef(settings.engine.max_kv_tokens));
  const [enableThinking, setEnableThinking] = useState<boolean | undefined>(
    typeof settings.engine.enable_thinking === 'boolean' ? settings.engine.enable_thinking : undefined
  );
  const [saving, setSaving] = useState(false);

  const setKey = (engine: Record<string, unknown>, key: string, value: number | boolean | undefined) => {
    if (value === undefined) delete engine[key];
    else engine[key] = value;
  };

  const save = async () => {
    setSaving(true);
    try {
      const engine: Record<string, unknown> = { ...settings.engine };
      setKey(engine, 'temperature', temperature);
      setKey(engine, 'top_k', topK);
      setKey(engine, 'top_p', topP);
      setKey(engine, 'max_new_tokens', maxNewTokens);
      setKey(engine, 'max_kv_tokens', maxKvTokens);
      setKey(engine, 'enable_thinking', enableThinking);
      await onSave({ defaultContextLength: ctx, engine });
      message.success(t('Settings saved successfully'));
    } catch (e: any) {
      message.error(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title={t('Local model settings')}
      extra={
        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
          {t('Save')}
        </Button>
      }
    >
      <Paragraph type="secondary" style={{ marginTop: 0 }}>
        {t('Shared by every GGUF/MLX runtime. Leave a field blank to use the checkpoint default.')}
      </Paragraph>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
            {t('Default context length')}
          </Text>
          <InputNumber style={{ width: '100%' }} min={256} step={256} value={ctx} onChange={(v) => setCtx(v ?? ctx)} />
        </Col>
        <Col xs={24} md={12}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
            {t('Enable thinking')}
          </Text>
          <Select
            style={{ width: '100%' }}
            value={enableThinking === undefined ? 'auto' : enableThinking ? 'on' : 'off'}
            onChange={(v) => setEnableThinking(v === 'auto' ? undefined : v === 'on')}
            options={[
              { value: 'auto', label: t('Auto (checkpoint default)') },
              { value: 'on', label: t('On') },
              { value: 'off', label: t('Off') },
            ]}
          />
        </Col>
        <Col xs={24} md={12}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
            {t('Temperature')}
          </Text>
          <InputNumber
            style={{ width: '100%' }}
            min={0}
            max={2}
            step={0.05}
            placeholder={t('checkpoint default')}
            value={temperature}
            onChange={(v) => setTemperature(v ?? undefined)}
          />
        </Col>
        <Col xs={24} md={12}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
            top_k
          </Text>
          <InputNumber
            style={{ width: '100%' }}
            min={0}
            step={1}
            placeholder={t('checkpoint default')}
            value={topK}
            onChange={(v) => setTopK(v ?? undefined)}
          />
        </Col>
        <Col xs={24} md={12}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
            top_p
          </Text>
          <InputNumber
            style={{ width: '100%' }}
            min={0}
            max={1}
            step={0.01}
            placeholder={t('checkpoint default')}
            value={topP}
            onChange={(v) => setTopP(v ?? undefined)}
          />
        </Col>
        <Col xs={24} md={12}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
            {t('Max new tokens')}
          </Text>
          <InputNumber
            style={{ width: '100%' }}
            min={1}
            step={64}
            placeholder={t('checkpoint default')}
            value={maxNewTokens}
            onChange={(v) => setMaxNewTokens(v ?? undefined)}
          />
        </Col>
        <Col xs={24} md={12}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
            {t('Max KV cache tokens')}
          </Text>
          <InputNumber
            style={{ width: '100%' }}
            min={0}
            step={256}
            placeholder={t('checkpoint default')}
            value={maxKvTokens}
            onChange={(v) => setMaxKvTokens(v ?? undefined)}
          />
        </Col>
      </Row>
    </Card>
  );
};
