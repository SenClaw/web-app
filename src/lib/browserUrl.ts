/** A scheme spelled out. The digit check keeps a bare `example.com:8080` a host
 * and port; whatever passes here must still parse as http or https below. */
const EXPLICIT_SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;

/** Ends at the host, so `localhost.evil.com` is not mistaken for this machine. */
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?=[:/?#]|$)/i;

/**
 * What `input` loads in the Browser pane, or null when the pane must not load
 * it. A bare `localhost:3000` becomes `http://…`, any other host `https://…`.
 *
 * Only http and https pass. URLs reach the pane from a person, from a port chip
 * and from agent tool calls, and the iframe runs with `allow-same-origin`: a
 * `javascript:` URL would run in the console's origin and read its token.
 */
export function browserUrlFrom(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const candidate = EXPLICIT_SCHEME.test(s)
    ? s
    : `${LOOPBACK_HOST.test(s) ? 'http' : 'https'}://${s}`;
  try {
    const url = new URL(candidate);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname
      ? url.href
      : null;
  } catch {
    return null;
  }
}
