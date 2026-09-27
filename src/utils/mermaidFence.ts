/**
 * Whether a fenced block with **no language tag** is a mermaid diagram.
 *
 * Models write the fence both ways. Asked for a diagram they often produce
 * ```mermaid, but just as often a bare ``` whose first line is `flowchart TD`
 * — and a renderer that only trusts the tag shows that as raw text, which is
 * the one form the diagram is useless in.
 *
 * Matched on the first non-empty line against mermaid's own diagram keywords,
 * not on "does it look drawable": a bare fence of Python that happens to
 * mention a graph must stay code. The keyword has to open the block, which no
 * other language does.
 */
const MERMAID_HEADERS = [
  'flowchart',
  'graph',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram-v2',
  'stateDiagram',
  'erDiagram',
  'journey',
  'gantt',
  'pie',
  'gitGraph',
  'mindmap',
  'timeline',
  'quadrantChart',
  'requirementDiagram',
  'sankey-beta',
  'xychart-beta',
  'block-beta',
  'packet-beta',
  'architecture-beta',
  'radar-beta',
  'treemap-beta',
  'zenuml',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment',
];

const HEADER_RE = new RegExp(`^(?:${MERMAID_HEADERS.join('|')})\\b`);

/** True when an untagged fence body opens with a mermaid diagram keyword. */
export function looksLikeMermaid(body: string): boolean {
  const first = body
    .split('\n')
    .map(l => l.trim())
    // A leading `%%{init: …}%%` directive is mermaid's own, and legal above
    // the diagram keyword.
    .find(l => l.length > 0 && !l.startsWith('%%'));
  return !!first && HEADER_RE.test(first);
}

/**
 * The mermaid source of a fenced block, or null when it is not one.
 *
 * `lang` is the fence's language tag (may be empty). `isBlock` says whether
 * this is a fence at all — react-markdown gives inline code and an untagged
 * fence the same shape, and a one-line `graph` in prose is not a diagram.
 */
export function mermaidSource(
  lang: string | undefined,
  body: string,
  isBlock: boolean,
): string | null {
  const code = body.replace(/\n$/, '');
  if ((lang ?? '').trim().toLowerCase() === 'mermaid') return code;
  if (!isBlock || lang) return null;
  return looksLikeMermaid(code) ? code : null;
}

/**
 * Whether a whole message contains a diagram fence.
 *
 * Used to widen the bubble. An assistant bubble sizes to its content, and a
 * TD flowchart is narrow — so without this the bubble hugs the diagram and
 * the box sits at the left of the thread, which reads as "not centred" no
 * matter how the diagram is aligned inside it.
 */
export function hasMermaidFence(markdown: string): boolean {
  // Fences only: an indented block or inline text is never a diagram here.
  const fence = /^[ \t]*```([^\n`]*)\n([\s\S]*?)^[ \t]*```/gm;
  for (let m = fence.exec(markdown); m; m = fence.exec(markdown)) {
    const lang = (m[1] ?? '').trim().toLowerCase();
    if (lang === 'mermaid') return true;
    if (!lang && looksLikeMermaid(m[2] ?? '')) return true;
  }
  return false;
}

/**
 * One conservative repair pass for a diagram mermaid refuses.
 *
 * Only ever applied **after** the source as written has failed to parse, so a
 * valid diagram is never rewritten. Two mistakes account for almost every
 * failure in practice, and both come from the model writing what looks
 * reasonable rather than what mermaid accepts:
 *
 * - **Parentheses and commas in an edge label.** `-->|Tải (PNG, MP3)|` is a
 *   parse error; mermaid wants the label quoted. This is the one that matters
 *   — the unquoted `(` is read as the start of a node shape.
 * - **A literal `\n` meaning a line break.** Mermaid's own break is `<br/>`.
 *   Under `securityLevel: 'strict'` the tag is then sanitised away, so the
 *   text ends up on one line rather than two — the words survive, which is
 *   the point.
 *
 * Deliberately not a general fixer. It cannot know what a broken diagram was
 * meant to be, and a wrong guess that *parses* is worse than an error: the
 * caller shows the source and the parse error when this does not help.
 */
export function repairMermaid(src: string): string {
  return src
    .replace(/\|([^|\n]*)\|/g, (whole, inner: string) => {
      const t = inner.trim();
      if (!t || (t.startsWith('"') && t.endsWith('"'))) return whole;
      return `|"${t.replace(/"/g, '&quot;')}"|`;
    })
    .replace(/\\n/g, '<br/>');
}
