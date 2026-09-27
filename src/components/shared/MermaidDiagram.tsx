import React, { useEffect, useRef, useState } from 'react';
import { theme } from 'antd';

import { repairMermaid } from '../../utils/mermaidFence';

/**
 * A ```mermaid fenced block, rendered as a diagram.
 *
 * Three things shape this component:
 *
 * **It must survive streaming.** A reply arrives a token at a time, so the
 * fence is parsed and re-rendered while its body is still half-written.
 * Mermaid throws on an incomplete graph, which is the correct signal: until
 * it parses, the source is shown as a code block, and the diagram replaces it
 * the moment the text is complete. Nothing flickers between two diagrams
 * because only a successful render ever swaps the content.
 *
 * **A failed diagram must still show its source.** A model gets the syntax
 * wrong often enough that a blank box, or an error with the text thrown away,
 * would lose what the user actually wanted to read.
 *
 * **The source is untrusted.** The text comes from a model, which can be
 * steered by whatever it just read. `securityLevel: 'strict'` turns off HTML
 * labels and the `click` directive, so a diagram cannot inject markup or wire
 * a label to a script.
 *
 * Mermaid is ~5 MB, so it is imported dynamically: a chat with no diagram in
 * it never pays for the parser.
 */

/** Loaded once per page, on the first diagram that needs it. */
let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;

function loadMermaid(dark: boolean) {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(m => {
      m.default.initialize({
        startOnLoad: false,
        // Untrusted input: no raw HTML in labels, no click handlers.
        securityLevel: 'strict',
        theme: dark ? 'dark' : 'default',
        fontFamily: 'inherit',
      });
      return m.default;
    });
  }
  return mermaidPromise;
}

/** Re-theme an already-loaded instance without re-downloading it. */
async function applyTheme(dark: boolean) {
  const mermaid = await loadMermaid(dark);
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: dark ? 'dark' : 'default',
    fontFamily: 'inherit',
  });
  return mermaid;
}

let seq = 0;

interface Props {
  code: string;
  isDarkMode?: boolean;
}

/** Mermaid emits a sized <svg>; flex must not shrink it below that. */
const SVG_WRAP: React.CSSProperties = { flex: '0 0 auto', maxWidth: '100%' };

export function MermaidDiagram({ code, isDarkMode }: Props) {
  const { token } = theme.useToken();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /// The diagram only parsed after being repaired — said out loud, because a
  /// silently adjusted diagram that differs from the text above it is
  /// impossible to account for.
  const [repaired, setRepaired] = useState(false);
  const idRef = useRef(`mermaid-${(seq += 1)}`);

  useEffect(() => {
    let cancelled = false;
    const source = code.trim();
    if (!source) {
      setSvg(null);
      return;
    }

    (async () => {
      const mermaid = await applyTheme(!!isDarkMode);
      // `parse` throws on an incomplete or invalid graph, which is how a
      // still-streaming block is told apart from a finished one.
      const attempt = async (text: string) => {
        await mermaid.parse(text);
        return mermaid.render(idRef.current, text);
      };

      try {
        const out = await attempt(source);
        if (!cancelled) {
          setSvg(out.svg);
          setError(null);
          setRepaired(false);
        }
        return;
      } catch {
        // Fall through to one repair attempt.
      }

      try {
        const out = await attempt(repairMermaid(source));
        if (!cancelled) {
          setSvg(out.svg);
          setError(null);
          setRepaired(true);
        }
      } catch (e) {
        // Report the *original* failure: the repaired source is not what the
        // author wrote, so its error would send them looking at the wrong text.
        if (!cancelled) {
          setSvg(null);
          setRepaired(false);
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, isDarkMode]);

  if (svg) {
    return (
      <div
        className="not-prose"
        style={{
          margin: '8px 0',
          padding: 12,
          borderRadius: 8,
          border: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
          // Centred in the bubble: a TD flowchart is narrow and tall, and
          // left-aligned it leaves a wide empty gutter beside itself.
          //
          // `width: 100%` is load-bearing. A flex container shrinks to fit its
          // content, so without it the panel hugs the diagram and the whole
          // box sits at the left of the message — centring inside a box that
          // is already only as wide as its content changes nothing.
          display: 'flex',
          justifyContent: 'center',
          width: '100%',
          boxSizing: 'border-box',
          // A graph wider than the bubble scrolls inside this box rather than
          // stretching the message.
          overflowX: 'auto',
        }}
      >
        <div style={SVG_WRAP}>
          <div
            // Mermaid's own output, produced under securityLevel 'strict'.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          {repaired && (
            <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 4 }}>
              Sơ đồ đã được chỉnh nhẹ cú pháp để vẽ được.
            </div>
          )}
        </div>
      </div>
    );
  }

  // Not a diagram (yet): the source, plus the reason when it failed for good.
  return (
    <div className="not-prose" style={{ margin: '8px 0' }}>
      <pre
        style={{
          background: token.colorFillSecondary,
          borderRadius: 8,
          padding: 12,
          overflowX: 'auto',
          fontSize: 12,
          fontFamily: 'monospace',
          margin: 0,
          color: token.colorText,
        }}
      >
        <code>{code}</code>
      </pre>
      {error && (
        <div
          style={{
            fontSize: 11,
            color: token.colorTextTertiary,
            marginTop: 4,
            paddingLeft: 2,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
