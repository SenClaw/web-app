import type { ChatMessage, DispatchParent } from '../types';

/**
 * Does this DAG belong in this chat?
 *
 * `adminFolder` is the **agent profile**, not the conversation. Every web
 * session created under one profile shares it (`ChatPage` resolves the folder
 * from the chosen agent), so filtering cards by folder alone put every DAG the
 * profile had ever run into a brand-new chat — which is how a fresh "thời tiết
 * ngày mai" session came up showing another session's task graphs.
 *
 * The daemon now stamps `chatJid` on each parent, and that is the answer
 * whenever it is present.
 *
 * For parents written before that field existed there is still a per-chat
 * signal: the tool call that created the DAG lives in this chat's own history,
 * and its output names the parent ("Parent task created: p-7"). Matching that
 * is how history keeps its cards without attributing them to the wrong
 * conversation. A legacy parent no chat claims is shown nowhere rather than
 * everywhere: a card in the wrong conversation is worse than a missing one,
 * and the dispatch view still lists it.
 */
export function ownsDispatchParent(
  parent: DispatchParent,
  chatJid: string,
  messages: ChatMessage[],
): boolean {
  if (parent.chatJid) return parent.chatJid === chatJid;
  return chatMentionsParent(messages, parent.id);
}

/** True when some tool result in this chat names `parentId`. */
function chatMentionsParent(messages: ChatMessage[], parentId: string): boolean {
  if (!parentId) return false;
  // Word-boundary match: `p-1` must not be found inside `p-12`.
  const needle = new RegExp(`(^|[^\\w-])${escapeRegExp(parentId)}([^\\w-]|$)`);
  for (const m of messages) {
    if (m.role !== 'tool') continue;
    const haystack = typeof m.content === 'string' ? m.content : safeJson(m.content);
    if (haystack && needle.test(haystack)) return true;
  }
  return false;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    // Cyclic or otherwise unserialisable payloads are not worth failing over;
    // the parent simply is not attributed from this chat.
    return '';
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
