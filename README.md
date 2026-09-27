# SenClaw Web

React 18 + Vite 6 + Tailwind 3 + antd 6 — the web UI served by the
[SenClaw](https://github.com/SenClaw/senclaw) daemon. Two entry points:
`main.tsx` (the main app) and `wiki-main.tsx` (the standalone wiki viewer).

## Develop

```bash
npm install
npm run dev       # Vite dev server on :5173, proxies /api to the daemon
```

By default `/api` is proxied to `http://127.0.0.1:18788` (the daemon's normal
UI port). To point the dev server at a different daemon — for example a
disposable test instance instead of your real one — set `VITE_DAEMON_URL`:

```bash
VITE_DAEMON_URL=http://127.0.0.1:28788 npm run dev
```

`.env.local` (gitignored) works too:

```
VITE_DAEMON_URL=http://127.0.0.1:28788
```

**Do not point a dev server that performs writes (installs, deletes, model
loads, selections) at your real daemon on 18788/18789** — that instance holds
real data (`~/.senclaw`). Use a disposable daemon started with its own `HOME`
and `SENCLAW_UI_PORT`/`SENCLAW_WS_PORT` for anything beyond read-only checks.

## Build

```bash
npm run build      # tsc -b && vite build → dist/
npm run preview    # serve the built dist/ locally
```

`dist/` is what the daemon serves in production. A release build is packed as
`senclaw-web-dist.tar.gz` and attached to GitHub releases tagged `v*`
(`.github/workflows/release.yml`) — the same asset name the daemon's
installer (`senclaw web`, `src/cli/commands/distrib.rs` in the daemon repo)
downloads. In development the daemon falls back to `../web-app/dist` as a
sibling checkout.

## Structure

```
src/
  pages/         one file per top-level route (Chat, Settings, Space, …)
  components/    UI components; components/settings/ and components/chat-common/
                 group by feature, not by page
  hooks/         data-fetching hooks (useWebSocket, useSpace, useWiki, useRuntimes, …)
  lib/           framework-free API/auth modules consumed by hooks and components
  i18n/          en (in-source) / vi dictionary — see below
  utils/         pure helpers (markdown, TTS pipeline, dispatch ownership, …)
```

## Runtimes and Local models

Every inference engine (GGUF via llama.cpp, MLX, the Laya decision model, OCR,
Whisper, TTS) runs as a separate program the daemon installs and supervises —
never in-process — the way LM Studio manages its engines. **Settings →
Runtime** manages which installed runtime answers each slot, the update
channel, and the catalog of installable engines; **Settings → Local models**
manages the shared GGUF/MLX model library those runtimes load from. Contract:
`docs/runtime-protocol.md` in the `senclaw` daemon repo. Client code:
`src/lib/runtimeApi.ts`, `src/hooks/useRuntimes.ts`,
`src/hooks/useLocalModels.ts`, `src/components/settings/Runtime*.tsx` and
`LocalModel*.tsx`.

When a feature's runtime is not installed, not selected, or fails to start,
the daemon answers `503` with a `code` (`runtime_not_installed` /
`runtime_not_selected` / `runtime_start_failed`); the affected screen (OCR,
TTS, Whisper, Decision settings; voice features in Chat) shows a banner with
the daemon's message and a link to Settings → Runtime instead of a bare
error. See `src/components/settings/RuntimeMissingBanner.tsx` and
`runtimeMissingFromError`/`parseRuntimeMissing` in `src/lib/runtimeApi.ts`.

## i18n

English strings are the dictionary key. `useLang()` from `src/i18n/index.tsx`
gives `t(en)`/`tArgs(en, args)`; a Vietnamese translation lives in
`src/i18n/vi.web.json` (hand-edited, web-only strings) or `src/i18n/vi.json`
(generated from the desktop app's dictionary — **do not hand-edit**). A
missing translation shows the English string, which is correct, not a bug —
see `CLAUDE.md` and the comment at the top of `src/i18n/index.tsx`.

## Chat attachments

Images are capped at `MAX_IMAGE_EDGE = 1568` px on the long edge before
upload (`ChatView.tsx`) and documents at `MAX_DOC_BYTES = 32 MB` — both must
stay in sync with the daemon's own limits. See `CLAUDE.md` for the full list
of cross-repo invariants this UI must keep.
