/**
 * A tiny pub/sub so anything in the app (a `:port` chip in the background-task
 * strip, a future deep link) can ask the right-dock Browser pane to open a URL.
 * `AppLayout` subscribes and turns the request into "expand the dock + navigate
 * the pane". Kept out of React context on purpose: the publisher
 * (`BackgroundProcessStrip`, deep in the chat tree) and the subscriber
 * (`AppLayout`) sit far apart, and threading a callback through every layer
 * between them would be noise.
 */
type Listener = (url: string) => void;

const listeners = new Set<Listener>();

/** Ask the Browser pane to open [url] (expands the dock if it is collapsed). */
export function openInBrowserPane(url: string): void {
  for (const l of listeners) l(url);
}

/** Subscribe to open-requests; returns an unsubscribe. */
export function subscribeBrowserPane(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
