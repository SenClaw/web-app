import { useState } from 'react';
import { Tag, theme, Typography, Tooltip } from 'antd';
import { CheckCircleFilled, CloseCircleFilled, RightOutlined, DownOutlined } from '@ant-design/icons';
import type { ToolMessage } from '../types';
import { ToolDetail } from './tool';
import { normalizeMcpName } from '../utils/toolName';
import { useLang } from '../i18n';

const { Text } = Typography;

interface Props {
  /** Consecutive ToolMessages from the same agent turn. */
  messages: ToolMessage[];
}

/** Map a tool name to a human-readable verb used in the collapsed summary
 *  (claude-code uses "Read a file, edited a file, ran a command"). */
function verbFor(rawName: string): string {
  // Fold the full registered form and the stripped bridge form onto one key
  // (e.g. `mcp__senclaw-space__space_event_create` → `mcp__space__event_create`).
  const toolName = normalizeMcpName(rawName);
  if (toolName === 'Read' || toolName === 'mcp__code__read_file') return 'Read a file';
  if (toolName === 'Write' || toolName === 'mcp__code__write_file') return 'Created a file';
  if (toolName === 'Edit' || toolName === 'NotebookEdit' || toolName === 'mcp__code__edit_file') return 'Edited a file';
  if (toolName === 'Bash' || toolName === 'mcp__code__bash') return 'Ran a command';
  if (toolName === 'Glob') return 'Searched files';
  if (toolName === 'Grep') return 'Searched content';
  if (toolName === 'WebFetch') return 'Fetched a URL';
  if (toolName === 'ToolSearch') return 'Discovered a tool';
  if (toolName === 'Skill') return 'Invoked a skill';
  if (toolName === 'Task') return 'Spawned a subagent';
  if (toolName === 'EnterPlanMode') return 'Entered Plan mode';
  if (toolName === 'ExitPlanMode') return 'Requested plan approval';
  if (toolName.startsWith('mcp__browser__')) return 'Browser action';
  if (toolName.startsWith('mcp__memory__')) return 'Memory lookup';
  if (toolName.startsWith('mcp__wiki__')) return 'Wiki action';
  if (toolName.startsWith('mcp__schedule__') || toolName.startsWith('mcp__space__recurring_')) return 'Scheduled task';
  if (toolName.startsWith('mcp__space__event_')) return 'Calendar action';
  if (toolName.startsWith('mcp__space__note_')) return 'Note action';
  if (toolName.startsWith('mcp__space__')) return 'Space action';
  if (toolName.startsWith('mcp__')) return toolName.split('__').slice(-1)[0]?.replace(/_/g, ' ') ?? 'Tool';
  return toolName;
}

/// True when `verbFor` recognised the tool rather than falling back to its
/// raw name. An unrecognised MCP tool has no useful verb, so its own display
/// title ("Browser Search") is the better label.
function hasKnownVerb(rawName: string): boolean {
  const toolName = normalizeMcpName(rawName);
  return verbFor(rawName) !== toolName && !toolName.startsWith('mcp__');
}

/**
 * The one line that says what a step was *for*.
 *
 * The daemon forwards the model's own `description` for the tools that take
 * one (`Bash`, `Task`) — "Survey existing skills and the wiki capability"
 * rather than "Ran a command". Everything else falls back to the tool's verb,
 * which is a truthful summary rather than an invented sentence. Rows persisted
 * before the daemon carried the field also land on the fallback.
 */
function headlineFor(m: ToolMessage, t: (s: string) => string): string {
  const own = (m.description ?? '').trim();
  if (own) return own;
  // No description of its own, so build one line out of what the tool is and
  // what it acted on. `title` is the display title (a command, a path, a
  // query) and is safe to show; `summary` is not — for an MCP tool it is the
  // raw JSON result, which is what made these rows unreadable.
  const target = oneLine(m.title ?? '');
  const verb = t(verbFor(m.toolName));
  if (!hasKnownVerb(m.toolName)) return target || verb;
  // A title that is just the tool's own name ("ToolSearch") repeats the verb
  // in a second spelling and tells the reader nothing.
  const bare = normalizeMcpName(m.toolName).split('__').slice(-1)[0] ?? '';
  if (!target || target === verb || target === bare || target === m.toolName) return verb;
  return `${verb} · ${target}`;
}

/// True when the step's line is the model's own sentence rather than one
/// composed from the tool name. The collapsed header only previews the former:
/// "10 steps · Discovered a tool" says nothing that "10 steps" did not.
function hasOwnDescription(m: ToolMessage): boolean {
  return (m.description ?? '').trim().length > 0;
}

/** Collapse newlines so a heredoc command stays on one tidy line. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Tool-call card, rendered as a numbered list of steps.
 *
 * Collapsed it is one line: how many steps ran, plus what the first one was
 * for. Expanded, each step is a row headed by the model's own description of
 * it, with the command (or diff, or match list) one more click away — the
 * detail views are unchanged, only what leads to them is.
 */
export function ToolGroupCard({ messages }: Props) {
  const { token } = theme.useToken();
  const { t, tArgs } = useLang();
  const [expanded, setExpanded] = useState(false);

  if (messages.length === 0) return null;
  const anyError = messages.some(m => !m.ok);
  const n = messages.length;
  const first = headlineFor(messages[0], t);
  // One step needs no count. Several do, and the first line is worth previewing
  // only when the model wrote it — a composed label like "Discovered a tool"
  // adds nothing to "10 steps".
  const header =
    n === 1
      ? first
      : hasOwnDescription(messages[0])
        ? `${tArgs('{n} steps', { n })} · ${first}`
        : tArgs('{n} steps', { n });

  return (
    <div style={{ margin: '4px 0' }}>
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'transparent',
          border: 'none',
          padding: '4px 0',
          cursor: 'pointer',
          // Only the status icon goes red. Painting the whole header red for
          // one failed step out of four reads as though all four failed —
          // the failing step is marked where it actually is, inside.
          color: token.colorTextSecondary,
          fontSize: 13,
          textAlign: 'left',
          width: '100%',
          minWidth: 0,
        }}
      >
        {anyError
          ? <CloseCircleFilled style={{ color: token.colorError, fontSize: 11, flex: '0 0 auto' }} />
          : <CheckCircleFilled style={{ color: token.colorSuccess, fontSize: 11, flex: '0 0 auto' }} />}
        <Text
          style={{ color: 'inherit', fontSize: 13, flex: 1, minWidth: 0 }}
          ellipsis={{ tooltip: header }}
        >
          {header}
        </Text>
        {expanded
          ? <DownOutlined style={{ fontSize: 10, color: token.colorTextQuaternary, flex: '0 0 auto' }} />
          : <RightOutlined style={{ fontSize: 10, color: token.colorTextQuaternary, flex: '0 0 auto' }} />}
      </button>

      {expanded && (
        <div
          style={{
            marginTop: 4,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadius,
            overflow: 'hidden',
            background: token.colorFillQuaternary,
          }}
        >
          {messages.map((m, i) => (
            <StepRow key={m.id} message={m} index={i + 1} last={i === messages.length - 1} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Tools whose detail view is shown inline by default (no extra click).
 *  Mirrors claude-code's behaviour of always rendering the diff/snippet
 *  immediately under file-mutation tool calls. */
function shouldAutoExpand(toolName: string): boolean {
  return (
    toolName === 'Edit' ||
    toolName === 'Write' ||
    toolName === 'NotebookEdit' ||
    toolName.endsWith('edit_file') ||
    toolName.endsWith('write_file')
  );
}

/**
 * One step: a numbered row whose headline says what the step was for, and
 * whose body (one click away) is the command, diff or result it produced.
 */
function StepRow({ message, index, last }: { message: ToolMessage; index: number; last: boolean }) {
  const { token } = theme.useToken();
  const { t } = useLang();
  const [open, setOpen] = useState(() => shouldAutoExpand(message.toolName));
  const headline = headlineFor(message, t);

  return (
    <div style={{ borderBottom: last ? 'none' : `1px solid ${token.colorBorderSecondary}` }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          minWidth: 0,
          background: 'transparent',
          border: 'none',
          padding: '9px 12px',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span
          style={{
            flex: '0 0 auto',
            width: 18,
            height: 18,
            borderRadius: '50%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontVariantNumeric: 'tabular-nums',
            color: message.ok ? token.colorTextTertiary : token.colorError,
            border: `1px solid ${message.ok ? token.colorBorder : token.colorError}`,
          }}
        >
          {index}
        </span>
        {/* One line, always. Everything else — the command's output, the diff,
            the raw MCP payload — lives behind the chevron. A step that spills
            a JSON result into the list is the display this replaced. */}
        <Tooltip title={message.toolName}>
          <Text style={{ fontSize: 13, flex: 1, minWidth: 0 }} ellipsis={{ tooltip: headline }}>
            {headline}
          </Text>
        </Tooltip>
        {!message.ok && <Tag color="error" style={{ marginInlineEnd: 0, flex: '0 0 auto' }}>error</Tag>}
        <span style={{ flex: '0 0 auto', display: 'inline-flex' }}>
          {open
            ? <DownOutlined style={{ fontSize: 10, color: token.colorTextQuaternary }} />
            : <RightOutlined style={{ fontSize: 10, color: token.colorTextQuaternary }} />}
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 10px 10px 36px' }}>
          <ToolDetail message={message} />
        </div>
      )}
    </div>
  );
}
