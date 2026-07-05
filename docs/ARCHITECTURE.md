# ComfyUI Queue Sidebar — Architecture

- **Status:** Living document
- **Related:** [SPEC.md](./SPEC.md)

> Diagrams use Mermaid so they render natively on GitHub and version alongside the code.
> The C4 layers below are expressed as Mermaid flowcharts for reliable rendering.

---

## 1. Overview

The extension is a set of **Vanilla JS ES modules** loaded by ComfyUI from `web/` (declared
by `WEB_DIRECTORY` in `__init__.py`). The browser executes them as native modules that
`import` ComfyUI's own `app` and `api` globals. There is no build step and no runtime
dependency. All coupling to ComfyUI internals is isolated in a single module,
`comfyAdapter.js`.

---

## 2. C4 — System Context

```mermaid
flowchart TB
    user([ComfyUI User])

    subgraph browser[Browser]
        comfy[ComfyUI Frontend<br/>scripts/app.js, scripts/api.js]
        ext[Queue Sidebar Extension<br/>web/*.js]
    end

    server[(ComfyUI Server<br/>REST + WebSocket)]

    user -->|clicks, keyboard Q, wheel, Ctrl+C| ext
    ext -->|import app, api| comfy
    ext -->|REST: /queue /history /view /interrupt| server
    server -->|WS: status, execution_start, b_preview, executed| ext
    comfy <-->|prompt execution| server
```

---

## 3. C4 — Containers / Components

Module responsibilities and their layering. Arrows show `import` direction.

```mermaid
flowchart TB
    subgraph entry[Entry / Orchestrator]
        main[queue-sidebar.js<br/>state · WS handlers · render · registration]
    end

    subgraph coupling[ComfyUI Coupling Point]
        adapter[comfyAdapter.js<br/>badge · schema · locale]
    end

    subgraph uimod[UI Modules]
        preview[preview.js<br/>card previews]
        gallery[gallery.js<br/>view mode overlay]
        ctx[contextMenu.js<br/>right-click actions]
        toolbar[toolbar.js<br/>fit · clear]
    end

    subgraph core[Core / Utilities]
        cache[outputCache.js<br/>localStorage + firstOutput]
        helpers[helpers.js<br/>el · mediaType · safeApi · toast]
        constants[constants.js<br/>styles · enums]
    end

    main --> adapter
    main --> preview
    main --> gallery
    main --> ctx
    main --> toolbar
    main --> cache
    preview --> cache
    preview --> helpers
    gallery --> helpers
    gallery --> constants
    ctx --> helpers
    ctx --> constants
    toolbar --> helpers
    toolbar --> constants
    preview --> constants
    adapter -.reads.-> comfyglobals[app / api globals]
    helpers --> constants
```

---

## 4. Runtime Sequence — Execution lifecycle

How a queued prompt flows from submission to a completed card. In 1.3.0 the refresh after
submission is driven purely by the `status` event (the previous `queuePrompt` monkey-patch
is removed).

```mermaid
sequenceDiagram
    actor User
    participant Comfy as ComfyUI app/api
    participant Ext as Queue Sidebar
    participant Server as ComfyUI Server

    User->>Comfy: Queue Prompt
    Comfy->>Server: POST /prompt
    Server-->>Ext: WS status (queue changed)
    Ext->>Server: GET /queue, /history
    Ext->>Ext: render() pending + running cards

    Server-->>Ext: WS execution_start {prompt_id}
    Ext->>Ext: move pending→running, render()

    loop sampling
        Server-->>Ext: WS b_preview {blob}
        Ext->>Ext: updateRunningPreview (latent)
    end

    Server-->>Ext: WS executed {prompt_id, output}
    Ext->>Ext: progressUrl = /view, saveOutputCache(), render()

    Server-->>Ext: WS status (queue empty)
    Ext->>Server: GET /history
    Ext->>Ext: render() completed card (firstOutput cache-hit)
```

---

## 5. State Machine — Task lifecycle

```mermaid
stateDiagram-v2
    [*] --> pending: queued
    pending --> running: execution_start
    pending --> cancelled: deleted from queue
    running --> completed: executed + success
    running --> failed: status_str = error
    running --> cancelled: status_str = cancelled / interrupt
    completed --> [*]
    failed --> [*]
    cancelled --> [*]
```

---

## 6. Data Flow

How output data moves between the server, extension state, the cache, and the DOM —
including the two new view-mode sinks (clipboard, workflow loader).

```mermaid
flowchart LR
    server[(ComfyUI Server)]
    state[Extension state<br/>running · pending · history]
    render[render + preview]
    dom[ComfyUI DOM<br/>sidebar cards]
    cache[(localStorage<br/>lastOutput)]
    gallery[view mode overlay]
    clip[(Clipboard)]
    graph[app.loadGraphData]

    server -->|REST + WS| state
    state --> render --> dom
    server -->|executed output| cache
    cache -->|firstOutput| render
    dom -->|click card| gallery
    gallery -->|Ctrl+C: fetch original blob| clip
    gallery -->|Load workflow| graph
```

---

## 7. Key design decisions

| Decision | Where | Rationale |
|---|---|---|
| Vanilla JS, no framework / build | whole `web/` | native ES modules; no framework or build step |
| Single ComfyUI coupling point | `comfyAdapter.js` | one file to update when upstream changes |
| Decouple from ComfyUI internals | remove tab-reorder + queuePrompt patch | registry compliance + upgrade safety |
| Cache-first output resolution | `outputCache.js` | correct image for multi-stage workflows |
| Feature-detected degradation | `comfyAdapter.js` | never break ComfyUI if internals move |

---

## 8. Module reference

| Module | Responsibility | Tests |
|---|---|---|
| `queue-sidebar.js` | Entry: state, WS handlers, render loop, extension registration | (e2e) |
| `comfyAdapter.js` | ComfyUI coupling: badge, schema normalization, locale | `comfyAdapter.test.js` |
| `preview.js` | Card preview rendering (image/video/running/pending) | `preview.test.js` |
| `gallery.js` | View mode overlay: nav, zoom, pan, copy, load workflow | `gallery.test.js` *(new)* |
| `contextMenu.js` | Right-click actions per status | `contextMenu.test.js` |
| `toolbar.js` | Fit toggle, clear-all with confirm | (via render/helpers) |
| `outputCache.js` | `localStorage` cache + `firstOutput` resolver | `outputCache.test.js` |
| `helpers.js` | `el`, `mediaType`, `safeApi`, `showToast` | `helpers.test.js` |
| `constants.js` | Shared styles, extension enums | — |
