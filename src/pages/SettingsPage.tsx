import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Layout, Typography, Card, theme, Menu } from 'antd';
import type { MenuProps } from 'antd';
import {
  BranchesOutlined,
  SafetyOutlined,
  ApiOutlined,
  UserOutlined,
  ThunderboltOutlined,
  FilterOutlined,
  DatabaseOutlined,
  CloudDownloadOutlined,
  ExperimentOutlined,
  AudioOutlined,
  SoundOutlined,
  AppstoreOutlined,
  ControlOutlined,
  ScanOutlined,
  LinkOutlined,
  IdcardOutlined,
  CodeOutlined,
  DeploymentUnitOutlined,
  HddOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import { useAppContext } from '../contexts/AppContext';
import { AppLayout } from '../components/AppLayout';
import { GeneralSettings } from '../components/settings/GeneralSettings';
import { ChannelSettings } from '../components/settings/ChannelSettings';
import { PairingCard } from '../components/settings/PairingCard';
import { AgentSettings } from '../components/settings/AgentSettings';
import { AgentBehaviorSettings } from '../components/settings/AgentBehaviorSettings';
import { LLMSettings } from '../components/settings/LLMSettings';
import { OAuthSettings } from '../components/settings/OAuthSettings';
import { ToolRulesSettings } from '../components/settings/ToolRulesSettings';
import { EmbeddingSettings } from '../components/settings/EmbeddingSettings';
import { LspSettings } from '../components/settings/LspSettings';
import { CognitiveSettings } from '../components/settings/CognitiveSettings';
import { WhisperSettings } from '../components/settings/WhisperSettings';
import { TtsSettings } from '../components/settings/TtsSettings';
import { OcrSettings } from '../components/settings/OcrSettings';
import { DecisionSettings } from '../components/settings/DecisionSettings';
import { BrowserSettings } from '../components/settings/BrowserSettings';
import { UserProfileSettings } from '../components/settings/UserProfileSettings';
import { RuntimeSettings } from '../components/settings/RuntimeSettings';
import { LocalModelsSettings } from '../components/settings/LocalModelsSettings';
import { useLang } from '../i18n';

const { Content } = Layout;
const { Title, Text } = Typography;

type SettingsSection =
  | 'general'
  | 'user-profile'
  | 'tool-rules'
  | 'channels'
  | 'agents'
  | 'llm'
  | 'provider-signin'
  | 'embedding'
  | 'lsp'
  | 'runtime'
  | 'local-models'
  | 'whisper'
  | 'tts'
  | 'ocr'
  | 'decision'
  | 'browser'
  | 'cognitive'
  | 'agent-behavior';

const SECTIONS = new Set<SettingsSection>([
  'general', 'user-profile', 'tool-rules', 'channels', 'agents', 'llm', 'provider-signin',
  'embedding', 'lsp', 'runtime', 'local-models', 'whisper', 'tts', 'ocr', 'decision', 'browser',
  'cognitive', 'agent-behavior',
]);

export const SettingsPage: React.FC = () => {
  const { ws } = useAppContext();
  const { token } = theme.useToken();
  const [selectedJid, setSelectedJid] = useState<string | null>(null);
  // Deep-linkable (?section=runtime): the runtime-missing banners elsewhere in
  // Settings, and the voice features in Chat, link here to point the user at
  // the fix — a plain useState default would lose that on navigation.
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSection = searchParams.get('section');
  const [activeSection, setActiveSectionState] = useState<SettingsSection>(
    initialSection && SECTIONS.has(initialSection as SettingsSection) ? (initialSection as SettingsSection) : 'agents'
  );
  const setActiveSection = React.useCallback(
    (section: SettingsSection) => {
      setActiveSectionState(section);
      setSearchParams({ section }, { replace: true });
    },
    [setSearchParams]
  );
  const { t } = useLang();

  const handleSelect = (jid: string) => {
    setSelectedJid(jid);
    if (!ws.subscribed.has(jid)) ws.subscribe(jid);
  };

  // Labels go through `t` so the menu follows the chosen language. One label
  // was hardcoded Vietnamese, which meant an English UI showed one Vietnamese
  // entry — exactly the drift a single dictionary exists to prevent.
  const menuItems: MenuProps['items'] = useMemo(
    () => [
      { key: 'general', icon: <SafetyOutlined />, label: t('Permissions') },
      { key: 'tool-rules', icon: <FilterOutlined />, label: t('Tool Rules') },
      { key: 'channels', icon: <ApiOutlined />, label: t('Channels') },
      { key: 'agents', icon: <UserOutlined />, label: t('Profile') },
      { key: 'user-profile', icon: <IdcardOutlined />, label: t('User profile') },
      { key: 'agent-behavior', icon: <ControlOutlined />, label: t('Agent Behavior') },
      { key: 'llm', icon: <ThunderboltOutlined />, label: 'LLM' },
      { key: 'provider-signin', icon: <LinkOutlined />, label: t('Provider Sign-in') },
      { key: 'embedding', icon: <DatabaseOutlined />, label: t('Embedding') },
      { key: 'lsp', icon: <CodeOutlined />, label: t('Language servers (LSP)') },
      { key: 'runtime', icon: <DeploymentUnitOutlined />, label: t('Runtime') },
      { key: 'local-models', icon: <HddOutlined />, label: t('Local models') },
      { key: 'whisper', icon: <AudioOutlined />, label: t('Whisper ASR') },
      { key: 'tts', icon: <SoundOutlined />, label: t('Text-to-Speech') },
      { key: 'ocr', icon: <ScanOutlined />, label: t('OCR') },
      { key: 'decision', icon: <BranchesOutlined />, label: t('Decision (Laya)') },
      { key: 'browser', icon: <GlobalOutlined />, label: t('Browser') },
      { key: 'cognitive', icon: <ExperimentOutlined />, label: t('Cognitive') },
    ],
    [t]
  );

  const panelContent = useMemo(() => {
    switch (activeSection) {
      case 'general':
        return <GeneralSettings />;
      case 'tool-rules':
        return <ToolRulesSettings />;
      case 'channels':
        return (
          <>
            {/* Above the channel list on purpose: a chat waiting to be let in
                is a to-do, and it is invisible everywhere else in the UI. */}
            <PairingCard />
            <ChannelSettings
              channels={ws.channels}
              onRegister={ws.registerChannel}
              onUnregister={ws.unregisterChannel}
              onUpdate={ws.updateChannel}
            />
          </>
        );
      case 'agents':
        return (
          <AgentSettings
            agents={ws.agents}
            channels={ws.channels}
            bindings={ws.bindings}
            onRegister={ws.registerAgent}
            onUnregister={ws.unregisterAgent}
            onUpdate={ws.updateAgent}
            onRegisterBinding={ws.registerBinding}
            onUnregisterBinding={ws.unregisterBinding}
          />
        );
      case 'user-profile':
        return <UserProfileSettings />;
      case 'llm':
        return <LLMSettings />;
      case 'provider-signin':
        return <OAuthSettings />;
      case 'embedding':
        return (
          <EmbeddingSettings
            onOpenLocalModels={() => setActiveSection('local-models')}
            onOpenRuntimeSettings={() => setActiveSection('runtime')}
          />
        );
      case 'lsp':
        return <LspSettings />;
      case 'runtime':
        return <RuntimeSettings />;
      case 'local-models':
        return <LocalModelsSettings onOpenRuntimeSettings={() => setActiveSection('runtime')} />;
      case 'whisper':
        return <WhisperSettings onOpenRuntimeSettings={() => setActiveSection('runtime')} />;
      case 'tts':
        return <TtsSettings onOpenRuntimeSettings={() => setActiveSection('runtime')} />;
      case 'ocr':
        return <OcrSettings onOpenRuntimeSettings={() => setActiveSection('runtime')} />;
      case 'decision':
        return <DecisionSettings onOpenRuntimeSettings={() => setActiveSection('runtime')} />;
      case 'browser':
        return <BrowserSettings onOpenRuntimeSettings={() => setActiveSection('runtime')} />;
      case 'cognitive':
        return <CognitiveSettings />;
      case 'agent-behavior':
        return <AgentBehaviorSettings />;
      default:
        return null;
    }
  }, [activeSection, ws, setActiveSection]);

  return (
    <AppLayout
      sidebar={
        <Menu
        mode="inline"
        selectedKeys={[activeSection]}
        items={menuItems}
        onClick={({ key }) => setActiveSection(key as SettingsSection)}
        style={{ border: 'none', padding: '8px 0' }}
      />
      }
    >
      <Content style={{ padding: '24px 40px', maxWidth: 1280, margin: '0 auto', width: '100%', overflowY: 'auto' }}>
        <div style={{ marginBottom: 24 }}>
          <Title level={2} style={{ margin: 0, fontWeight: 700 }}>{t('Settings')}</Title>
          <Text type="secondary">
            {t('Manage your application configurations, agents, and external integrations.')}
          </Text>
        </div>

        <Layout
          style={{
            background: 'transparent',
            gap: 0,
            alignItems: 'stretch',
            minHeight: 480,
          }}
          hasSider
        >
          <Layout.Content style={{ marginLeft: 24, minWidth: 0 }}>
            <Card
              style={{
                borderRadius: 16,
                boxShadow: token.boxShadowSecondary,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
                minHeight: 480,
              }}
              styles={{ body: { padding: '24px 28px 32px' } }}
            >
              {panelContent}
            </Card>
          </Layout.Content>
        </Layout>
      </Content>
    </AppLayout>
  );
};
