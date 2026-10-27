import type { AgentCommandItem } from './useCommandSuggestions';

/**
 * The spec-flow chat commands (design before code). The daemon handles them
 * when the message is sent; the composer only offers them in the `/` menu.
 * The English description is the i18n key, so a sentence changed here needs
 * the same edit in `vi.web.json`.
 */
const SPEC_COMMANDS: AgentCommandItem[] = [
  {
    key: 'brainstorm',
    kind: 'command',
    desc: '/brainstorm <idea> — explore the idea and write a brief in docs/designs/.',
  },
  {
    key: 'draft',
    kind: 'command',
    desc: '/draft [path] — turn the open brief into a full spec.',
  },
  {
    key: 'review',
    kind: 'command',
    desc: '/review [path] — four reviewers with no context check the spec (Cảnh, Kiểm, Hiểu, Phản biện).',
  },
  {
    key: 'approve',
    kind: 'command',
    desc: '/approve [force] — approve the reviewed spec; code changes in the folder unlock.',
  },
  {
    key: 'spec',
    kind: 'command',
    desc: '/spec [use <path>|done|skip] — show the open spec, switch to another, close it, or skip it for a small fix.',
  },
];

/** The five commands with their descriptions translated by `t`. */
export function specCommands(t: (en: string) => string): AgentCommandItem[] {
  return SPEC_COMMANDS.map((c) => ({ ...c, desc: c.desc ? t(c.desc) : c.desc }));
}
