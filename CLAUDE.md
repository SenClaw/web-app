# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Project overview

`senclaw-web` — the React UI the SenClaw daemon serves. React 18, Vite 6,
Tailwind 3, antd 6, react-router 7. No test runner is configured; correctness
is enforced by `npm run build` (`tsc -b && vite build`), which must stay
green with no new TypeScript errors.

See `README.md` for dev/build commands and the directory layout.

## Chat attachments: images (vision, else OCR) and documents

Everything attached to a chat message travels as `attachments:
[{dataUrl, mimeType, name?}]`. `ChatView.tsx` enforces two client-side caps
that **must stay in sync with the daemon** (`senclaw` repo,
`src/agent/documents.rs` / `src/zen_core/vision.rs`):

- `MAX_IMAGE_EDGE = 1568` — an attached image's long edge is downscaled to
  this before upload. Matches the size Anthropic's API resizes to internally
  and keeps a phone photo under the 5 MB per-image request limit.
- `MAX_DOC_BYTES = 32 * 1024 * 1024` — the largest non-image attachment
  accepted; rejecting client-side just gives the user the error before a
  40 MB base64 blob crosses the socket.

**`LLMSettings.tsx`'s vision-model regex table must match
`senclaw/src/zen_core/vision.rs` exactly** (comment at the top of the table
says so). Those patterns decide whether an attached image reaches the model
as a real image block or gets OCR'd into text first — a stale pattern here
silently demotes a new model generation to the OCR path even though the
daemon itself would have sent it as vision. Generation digits are
open-ended (`claude-[3-9]`, `gpt-[5-9]`, `gemini-[2-9]`) for the same reason
the daemon's copy is. The explicit `vision` override in Settings → LLM always
wins over inference — never remove that escape hatch.

## Runtime split: no inference engine runs in this browser or in the daemon

As of the runtime-split migration, the daemon links **no inference code**.
Every engine — GGUF (llama.cpp), MLX, the Laya decision model, OCR, Whisper,
TTS — is a separate program the daemon installs, launches, and proxies to
over loopback, the way LM Studio runs its engines. Contract:
`docs/runtime-protocol.md` in the `senclaw` daemon repo (this repo's `../senclaw`
sibling checkout). This client speaks to it through:

- **`src/lib/runtimeApi.ts`** — the one module that knows the wire shapes for
  `/api/runtimes*` (§5.1) and `/api/local-models*` (§5.3): types, `ApiError`
  (carries the daemon's `code`/`slot` on a non-2xx response), and the
  runtime-missing detection helpers (`runtimeMissingFromError` for callers
  using `request`/`apiGet`/`apiPost`/`apiPut`, `parseRuntimeMissing` for
  callers that fetch directly).
- **`src/hooks/useRuntimes.ts`** / **`useLocalModels.ts`** — data + actions for
  the two screens below. Each polls only what needs polling (active install
  jobs at ~1 s, active downloads/loads at ~1.2 s) and stops when nothing is
  in flight.
- **Settings → Runtime** (`src/components/settings/RuntimeSettings.tsx` +
  `RuntimeSelectionsCard`, `RuntimeUpdatesChannelCard`, `RuntimeCatalogCard`,
  `RuntimeProcessesCard`, `RuntimeInstallLocalModal`, `RuntimeLogsModal`) —
  LM Studio-style engine manager: per-slot selection, update channel, the
  installable catalog, and the processes the daemon currently supervises.
  "Install from a local path" is a **text input**, not a file picker — the
  package lives on the daemon's filesystem, which a browser cannot browse.
- **Settings → Local models** (`LocalModelsSettings.tsx` +
  `LocalModelDownloadDialog.tsx`, `LocalModelEngineSettingsCard.tsx`) — the
  shared GGUF/MLX model library. The engine settings card round-trips
  `<local-models>/settings.json` (snake_case) by spreading the fetched object
  and only patching the keys it renders — **never reconstruct that object
  from scratch**, or a field this UI does not know about (added by a runtime
  or a future field) is silently dropped on save.

- **Settings → Browser** (`BrowserSettings.tsx` + `src/lib/browserAgentApi.ts`)
  — the browser engine (`/api/browser-agent/*`, `senclaw` repo
  `src/browser_agent/rest.rs`): engine in use, settings saved as a partial
  `PUT` (only changed fields; a 422 carries a sentence for the person, shown
  as is), the Chrome extension's pairing (polled every 3 s while open — the
  call never starts a runtime), and open tabs **on request only**, because
  `GET /api/browser-agent/tabs` starts the browser runtime.

**Runtime-missing is an expected, actionable state, not a generic error.**
When the daemon answers a proxied route with `503` and one of
`runtime_not_installed` / `runtime_not_selected` / `runtime_start_failed`
(`docs/runtime-protocol.md` §5.2), the affected screen shows
`RuntimeMissingBanner` with the daemon's message and a link to Settings →
Runtime instead of a bare error toast:

- `OcrSettings.tsx`, `TtsSettings.tsx`, `WhisperSettings.tsx`,
  `DecisionSettings.tsx` — the model-management panel is replaced by the
  banner; **Decision's `DecisionGateCard` and `DecisionSkillsCard` keep
  rendering regardless** (they hit `/api/decision/gate` and `/skills`, which
  stay native to the daemon's control plane even when the `sen-sysone`
  runtime itself is missing — only `/api/decision/models` and
  `/api/decision/settings` are proxied).
- `ChatView.tsx` (voice recording → `/api/whisper/transcribe`) and
  `MessageBubble.tsx` / `utils/ttsPipeline.ts` (read-aloud →
  `/api/tts/synthesize`) show the same message via `antd.message.error` with
  a click-through link to `/settings?section=runtime`, instead of a plain
  "recognition failed" toast that gives the user nothing to act on.
- `EmbeddingSettings.tsx`'s `local` provider is a GGUF embedding model picked
  from Local models (`embedding: true` capability), not a candle download —
  candle left the daemon entirely. It shows its own inline warning (not the
  full banner, since the rest of the form still works) when the selected
  model's format slot has no runtime chosen yet.

**`SettingsPage.tsx`'s active section is deep-linkable** via `?section=`
(`useSearchParams`, not a plain `useState` default) specifically so a banner
or a chat-side link can navigate straight to `Settings → Runtime` from
anywhere in the app.

**Never invent a wire shape the contract does not pin.** Where
`docs/runtime-protocol.md` does not specify a response body (`POST
/api/runtimes/check-updates`, `POST /api/runtimes/install-local`'s exact
return), `runtimeApi.ts` types it loosely and callers treat it as a trigger,
re-fetching `GET /api/runtimes` / `/catalog` afterwards rather than reading
fields out of it. Tighten the type once the daemon side is confirmed, not
before.

## i18n

English strings are the dictionary key — `t(en)` returns the Vietnamese
translation when the language is `vi`, `en` unchanged otherwise, so a missing
entry degrades to readable English rather than a raw key. Full contract and
the reason there is no i18n library: comment block at the top of
`src/i18n/index.tsx`.

- **`src/i18n/vi.json` is generated from the desktop app's Dart dictionaries
  — never hand-edit it.** New web-only strings (or a wording the web says
  differently from desktop) go in `src/i18n/vi.web.json`, which wins on a
  shared key.
- **Every new user-facing string added to a component that already uses
  `useLang()`/`t()` must get a `vi.web.json` entry in the same change** — not
  deferred, and not left to the English fallback, which is for a translation
  gap, not a shortcut. Several older settings screens
  (`OcrSettings.tsx`, `TtsSettings.tsx`, `WhisperSettings.tsx`,
  `DecisionSettings.tsx`) predate this convention and hardcode Vietnamese
  prose directly with no `t()` at all; leave their existing text as-is and
  route only *new* additions (e.g. the runtime-missing banner) through
  `t()` — do not do a drive-by retrofit of surrounding unrelated strings.
- Use `tArgs(en, args)` for `{placeholder}` interpolation instead of
  `.replace()` — it is the one substitution mechanism every string goes
  through, and a hand-rolled `.replace()` chain is easy to get wrong when a
  placeholder repeats or a value itself contains `{`.

## Cross-client parity

Web, desktop (`../desktop`, Flutter) and mobile are meant to be the same
product on three shells — `docs/client-parity.md` in the old monorepo tracks
where they still differ, updated when a feature lands on any one client.
Two features in particular are wired into `ChatView.tsx`/`AppLayout.tsx` and
must not regress silently since nothing but a live daemon exercises them:
**watch strip** (`WatchStrip.tsx`, `GET /api/watches?chatJid=`) shows an
in-flight `schedule_watch` with a Stop button, and **dispatch retry**
(`InlineDispatchCard.tsx`, `POST /api/dispatch/{tasks,parents}/:id/retry`)
lets a user re-run a failed DAG task or parent from the chat itself.

## Testing

No unit/component test runner is configured. Verify changes with:

```bash
npm run build   # tsc -b && vite build — must be green, no new TS errors
```

For a manual check against a running daemon, never point at the real one on
18788/18789 for anything that writes — use a disposable daemon (`HOME` set to
a scratch dir, `SENCLAW_UI_PORT`/`SENCLAW_WS_PORT` overridden) and
`VITE_DAEMON_URL` (see README) to proxy at it.
