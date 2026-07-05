# ComfyUI Queue Sidebar — Software Specification

- **Status:** Living document
- **Targets:** 1.3.0
- **Audience:** maintainers, contributors, ComfyUI extension developers
- **Related:** [ARCHITECTURE.md](./ARCHITECTURE.md)

---

## 1. Overview

ComfyUI Queue Sidebar is an **in-process ComfyUI frontend extension** that restores a
queue/history panel with live image previews inside ComfyUI's sidebar. It shows pending,
running, and completed tasks as a card grid; updates the running card in real time from
WebSocket events; and lets the user open any output in a full-screen viewer ("view mode").

It ships as static `web/*.js` loaded by ComfyUI via `WEB_DIRECTORY` — **no build step, no
runtime dependencies**.

### Goals

- Bring back an always-visible queue/history panel with thumbnails.
- Reflect execution state (queue → running → done) with minimal latency.
- Show the *correct* output for multi-stage workflows (e.g. upscaling) — not just the
  first node's image.
- Provide a fast full-screen viewer for inspecting, copying, and re-loading outputs.

### Non-Goals

- Not a standalone web app; it lives inside ComfyUI's page and DOM.
- No server-side / Python logic (`__init__.py` only declares `WEB_DIRECTORY`).
- No database; the only persistence is a bounded `localStorage` cache.
- No UI framework or build pipeline.

---

## 2. Actors & Use Cases

The only actor is the **ComfyUI User** operating the ComfyUI web interface.

```mermaid
flowchart LR
    user([ComfyUI User])

    subgraph QS[Queue Sidebar]
        uc1([View queue and history])
        uc2([Inspect live preview])
        uc3([Open output in view mode])
        uc4([Zoom / pan image])
        uc5([Copy image to clipboard])
        uc6([Load workflow from output])
        uc7([Interrupt / delete task])
        uc8([Clear all tasks and history])
        uc9([Toggle image fit])
    end

    user --- uc1
    user --- uc2
    user --- uc3
    user --- uc7
    user --- uc8
    user --- uc9
    uc3 -.-> uc4
    uc3 -.-> uc5
    uc3 -.-> uc6
```

---

## 3. Functional Requirements

### FR-1 — Queue & history display
- Render a card grid combining `pending`, `running`, and `history` tasks (`queue-sidebar.js#render`).
- Order: pending → running → history; cards keyed by `promptId` for stable reconciliation.
- Empty state shows a "no tasks" placeholder.
- Each card shows a status tag (running/pending/completed/failed/cancelled) and, when known,
  execution time.

### FR-2 — Real-time preview
- During sampling, update the running card from `b_preview` WS events (latent blob previews).
- On each `executed` WS event, switch the running card to the decoded `/view` output and
  persist the selected output to the cache (`outputCache.saveOutputCache`).
- Completed/historical cards resolve their thumbnail via `firstOutput(outputs, promptId)`,
  which prefers the cached output and falls back to dict iteration (backward compatible).

### FR-3 — Task status lifecycle
- Status transitions follow the state machine in [ARCHITECTURE.md](./ARCHITECTURE.md#5-state-machine--task-lifecycle).
- Failed and cancelled tasks are derived from the `/history` `status_str`.

### FR-4 — View mode (full-screen viewer)
Opening a completed image/video card opens a full-screen overlay (`gallery.js`).

- **FR-4.1 Baseline sizing** — the image fits the viewport at `max-width:90vw; max-height:90vh;
  object-fit:contain` (this is the "minimum size" baseline; zoom scales up from here).
- **FR-4.2 Navigation** — prev/next arrows, `←`/`→` keys, counter; close via `✕`, `Esc`, or
  backdrop click.
- **FR-4.3 Wheel zoom** *(new in 1.3.0)* — scroll to zoom, step `±0.12`, clamped to
  `[1, 4]`, centered on the image. At scale `1` the offset resets.
- **FR-4.4 Drag-pan** *(new)* — when zoomed (`scale > 1`), press-and-hold to drag-pan
  (pointer capture); at scale `1` panning is disabled.
- **FR-4.5 Copy image** *(new)* — `Ctrl/⌘+C` copies the current image to the clipboard as a
  `ClipboardItem`. On success it shows a confirmation toast; on failure an error toast; it does
  **not** fall back to copying a URL. Applies to **images only**.

  > **Metadata is _not_ preserved — a browser-platform limit, not a bug.** The async Clipboard
  > API re-encodes images on write (Chromium/WebKit decode to a bitmap and emit a fresh PNG to
  > defend against decompression-bomb attacks), which drops ComfyUI's embedded workflow
  > (`tEXt`/`iTXt` chunks); the standard write path also accepts only `image/png`, so non-PNG
  > outputs are rejected outright. The one byte-exact escape hatch (web custom formats,
  > `web image/png`) needs the *receiving* app to opt in, so it would not restore the workflow
  > on paste. `Ctrl+C` is therefore a pixel-level "copy image", not a metadata transport — to
  > recover the workflow use the **Load-workflow button (FR-4.6)** or download the original file
  > from `/view` (raw bytes, chunks intact; saving bypasses clipboard sanitization).
- **FR-4.6 Load workflow button** *(new)* — a translucent-grey button (white icon) to the left of the red `✕` that,
  when the output carries a workflow, exits view mode and calls `app.loadGraphData(workflow)` —
  equivalent to the right-click "Load workflow". Hidden when no workflow is available.
- **FR-4.7 Scope** — zoom/pan/copy apply to **images only**; video keeps current behaviour.
- **FR-4.8 Help hint** *(new)* — a non-interactive top-left bar listing the viewer controls
  (`←/→`, wheel-zoom, drag-pan, `Ctrl+C`, `Esc`).

### FR-5 — Context menu
Right-click a card (`contextMenu.js`):
- Running → **Interrupt** (`POST /interrupt`).
- Pending → **Delete** (`POST /queue {delete}`).
- Completed/failed/cancelled → **Delete** (`POST /history {delete}`), and **Load workflow**
  when `task.workflow` is present (`app.loadGraphData`).

### FR-6 — Toolbar
- **Image-fit toggle** (contain ↔ cover) re-renders previews (`toolbar.createFitButton`).
- **Clear all** with a confirm popup clears queue + history (`toolbar.createClearButton`).

### FR-7 — Internationalization
- Labels load from `web/locales/<locale>.json`, locale read from ComfyUI's `Comfy.Locale`
  setting; English is the fallback (`comfyAdapter.getComfyLocale`, `queue-sidebar.js#t`).

### FR-8 — ComfyUI integration
- Register a sidebar tab + toggle command/keybinding (`Q`).
- Maintain an icon badge showing `running + pending` count.
- **Tab ordering:** uses ComfyUI's default registration order. *(Changed in 1.3.0 — the
  previous `sidebarTabs` array mutation is removed for registry compliance and upgrade safety.)*
- **Queue refresh:** driven by the `status` WS event. *(Changed in 1.3.0 — the previous
  `queuePrompt` monkey-patch is removed.)*

---

## 4. Non-Functional Requirements

- **NFR-1 Zero build / zero deps** — ships as native ES modules.
- **NFR-2 Graceful degradation** — every ComfyUI-internal touch point is feature-detected and
  fails into a logged "degraded mode" rather than throwing (`comfyAdapter.js`).
- **NFR-3 Registry compliance** — minimize patterns that trigger Comfy Registry security
  review; avoid mutating ComfyUI internals where an official API or event exists.
- **NFR-4 Testability** — DOM-producing logic is unit-tested with Vitest + jsdom; each `lib/`
  module has a matching `tests/*.test.js`.
- **NFR-5 Performance** — rendering uses keyed reconciliation; running-card previews update in
  place without full rebuilds.
- **NFR-6 Resilience** — API failures show a toast and return `null` (`helpers.safeApi`);
  cache writes fail silently on quota errors.

---

## 5. Data Contracts

### 5.1 ComfyUI REST (via `api.fetchApi`)
| Endpoint | Method | Use |
|---|---|---|
| `/queue` | GET | running + pending tuples → `normalizeQueue` |
| `/queue` | POST | `{delete:[id]}` / `{clear:true}` |
| `/history?max_items=N` | GET | history map → `normalizeHistoryItem` |
| `/history` | POST | `{delete:[id]}` / `{clear:true}` |
| `/view?filename&subfolder&type` | GET | output image/video URL |
| `/interrupt` | POST | stop running task |

### 5.2 WebSocket events (`api.addEventListener`)
| Event | Payload | Effect |
|---|---|---|
| `status` | queue counts | trigger `refresh()` |
| `execution_start` | `{prompt_id}` | move pending→running immediately |
| `b_preview` | image blob | update running card latent preview |
| `executed` | `{prompt_id, output}` | set `/view` preview + `saveOutputCache` |

### 5.3 localStorage
- Key `queueSidebar.lastOutput`: `{ [promptId]: { filename, subfolder, type } }`, bounded to
  `OUTPUT_CACHE_MAX = 200` (oldest evicted).

### 5.4 Workflow extraction
- `workflow = item.prompt[3].extra_pnginfo.workflow` (deeply nested; guarded — may be `null`).

---

## 6. Verification

Automated (Vitest): each `lib/` module has unit tests; new view-mode interactions add
`tests/gallery.test.js`. End-to-end behaviour (Playwright) covers load, card ordering,
real-time preview, output cache, view mode, context menu, toolbar, and i18n; acceptance
requires a running ComfyUI instance.

---

## 7. Glossary

| Term | Meaning |
|---|---|
| **Task / card** | One queued prompt, shown as a grid card, identified by `promptId`. |
| **View mode** | The full-screen image/video overlay (`gallery.js`). |
| **Output cache** | `localStorage` map of the last image-producing output per prompt. |
| **Coupling point** | `comfyAdapter.js` — the single module that touches ComfyUI internals. |
| **Degraded mode** | State after a feature-detected ComfyUI internal is missing; logged, non-fatal. |
| **`firstOutput`** | Resolver that picks the output to display, cache-first. |
