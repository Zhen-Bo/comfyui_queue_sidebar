import { app } from '../../scripts/app.js'
import { api } from '../../scripts/api.js'

import { MAX_HISTORY_ITEMS, STATUS_COLOR } from './lib/constants.js'
import { el, mediaType, safeApi } from './lib/helpers.js'
import { openGallery } from './lib/gallery.js'
import { showContextMenu } from './lib/contextMenu.js'
import { makePreview, updateRunningPreview } from './lib/preview.js'
import { buildToolbar } from './lib/toolbar.js'
import {
  getComfyLocale, hookQueuePrompt, reorderQueueTab,
  updateTabBadge, normalizeQueue, normalizeHistoryItem,
} from './lib/comfyAdapter.js'

// ─── i18n ──────────────────────────────────────────────────────────────────────
// Translations are loaded from web/locales/<locale>.json at startup.

let _translations = {}
let _fallback = {}

function getLocale() {
  return getComfyLocale(app)
}

async function loadI18n() {
  const base = new URL('.', import.meta.url).href + 'locales'
  const locale = getLocale()
  try {
    _fallback = await fetch(`${base}/en.json`).then((r) => r.json())
  } catch (err) { console.warn('[QueueSidebar] Failed to load fallback (en) translations:', err) }
  if (locale !== 'en') {
    try {
      _translations = await fetch(`${base}/${locale}.json`).then((r) => r.json())
    } catch (err) { console.warn(`[QueueSidebar] Failed to load ${locale} translations, using fallback:`, err); _translations = _fallback }
  } else {
    _translations = _fallback
  }
}

function t(key) {
  return _translations[key] ?? _fallback[key] ?? key
}

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  running: [],
  pending: [],
  history: [],
  progressUrl: null,
  imageFit: 'contain',
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

function viewUrl(result) {
  const p = new URLSearchParams({
    filename: result.filename,
    subfolder: result.subfolder ?? '',
    type: result.type ?? 'output',
  })
  return api.apiURL(`/view?${p}`)
}

function firstOutput(outputs = {}) {
  for (const nodeOutputs of Object.values(outputs)) {
    for (const key of ['images', 'gifs', 'video', 'audio']) {
      const val = nodeOutputs[key]
      if (!val) continue
      const item = Array.isArray(val) ? val[0] : val
      if (item?.filename) return item
    }
  }
  return null
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function fetchQueue() {
  const res = await safeApi(api, '/queue')
  if (!res) return
  const data = await res.json()
  const normalized = normalizeQueue(data)
  state.running = normalized.running
  state.pending = normalized.pending
}

async function fetchHistory() {
  const res = await safeApi(api, `/history?max_items=${MAX_HISTORY_ITEMS}`)
  if (!res) return
  const data = await res.json()
  state.history = Object.entries(data)
    .map(([promptId, item]) => normalizeHistoryItem(promptId, item))
    .reverse()
}

let _refreshPending = false
let _refreshQueued = false

async function refresh() {
  if (_refreshPending) { _refreshQueued = true; return }
  _refreshPending = true
  try {
    await Promise.all([fetchQueue(), fetchHistory()])
    render()
  } finally {
    _refreshPending = false
    if (_refreshQueued) { _refreshQueued = false; refresh() }
  }
}

// ─── Gallery items ────────────────────────────────────────────────────────────

function galleryItems() {
  return state.history
    .map((task) => {
      const output = firstOutput(task.outputs)
      if (!output) return null
      const type = mediaType(output.filename)
      if (type !== 'image' && type !== 'video') return null
      return { task, output, type, url: viewUrl(output) }
    })
    .filter(Boolean)
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function previewDeps() {
  return {
    progressUrl: state.progressUrl,
    firstOutput,
    viewUrl,
    imageFit: state.imageFit,
  }
}

function makeStatusTag(task) {
  const tag = el(
    'span',
    `display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:6px;` +
    `font-size:13px;font-weight:600;` +
    `background:${STATUS_COLOR[task.status] ?? 'rgba(0,0,0,.6)'};` +
    `color:#fff`,
  )
  const labels = {
    running: `<i class="pi pi-spin pi-spinner" style="font-weight:bold"></i> ${t('running')}`,
    pending: t('pending'),
    completed: '<i class="pi pi-check" style="font-weight:bold"></i>',
    failed: t('failed'),
    cancelled: t('cancelled'),
  }
  tag.innerHTML = labels[task.status] ?? task.status
  if (task.executionTime !== undefined) {
    tag.appendChild(
      el('span', 'margin-left:4px;font-size:11px;opacity:.85', `${task.executionTime.toFixed(1)}s`),
    )
  }
  return tag
}

function makeCard(task) {
  const card = el(
    'div',
    'position:relative;border-radius:4px;overflow:hidden;aspect-ratio:1/1;' +
    'background:var(--comfy-input-bg,#1a1a1a);cursor:pointer;min-width:0',
  )
  card.dataset.id = task.promptId
  card.dataset.status = task.status

  card.appendChild(makePreview(task, previewDeps()))

  const overlay = el(
    'div',
    'position:absolute;top:0;left:0;right:0;padding:6px;pointer-events:none;z-index:2',
  )
  overlay.appendChild(makeStatusTag(task))
  card.appendChild(overlay)

  card.addEventListener('click', () => {
    const output = firstOutput(task.outputs)
    if (!output) return
    const type = mediaType(output.filename)
    if (type !== 'image' && type !== 'video') return
    const items = galleryItems()
    const idx = items.findIndex((it) => it.task.promptId === task.promptId)
    if (idx !== -1) openGallery(items, idx)
  })

  card.addEventListener('contextmenu', (e) =>
    showContextMenu(e, task, { t, api, app, refresh }),
  )

  return card
}

// ─── Render (keyed reconciliation) ────────────────────────────────────────────

let gridEl = null
let scrollEl = null

function updateBadge() {
  updateTabBadge(app, state.running.length + state.pending.length)
}

function render() {
  updateBadge()
  if (!gridEl) return

  const allTasks = [...state.running, ...state.pending, ...state.history]

  if (allTasks.length === 0) {
    gridEl.innerHTML =
      `<div style="grid-column:1/-1;display:flex;flex-direction:column;` +
      `align-items:center;justify-content:center;padding:48px 16px;` +
      `color:var(--p-text-muted-color,#888)">` +
      `<i class="pi pi-info-circle" style="font-size:2rem;margin-bottom:12px"></i>` +
      `<span style="font-size:13px">${t('noTasks')}</span></div>`
    return
  }

  const existing = new Map()
  for (const child of [...gridEl.children]) {
    const id = child.dataset?.id
    if (id) existing.set(id, child)
    else child.remove() // Remove non-task elements (e.g. empty state message)
  }

  for (let i = 0; i < allTasks.length; i++) {
    const task = allTasks[i]
    let card = existing.get(task.promptId)

    if (card) {
      existing.delete(task.promptId)
      // Status changed → rebuild card to sync preview, overlay, and event handlers
      if (card.dataset.status !== task.status) {
        card.replaceWith(makeCard(task))
        card = gridEl.children[i] ?? makeCard(task)
      } else if (task.status === 'running') {
        updateRunningPreview(card, state.progressUrl)
      }
    } else {
      card = makeCard(task)
    }

    if (gridEl.children[i] !== card) {
      gridEl.insertBefore(card, gridEl.children[i] ?? null)
    }
  }

  for (const card of existing.values()) card.remove()
}

// ─── Sidebar setup ────────────────────────────────────────────────────────────

function toolbarDeps() {
  return { t, api, state, gridEl: () => gridEl, render, refresh }
}

function buildSidebar(sidebarEl) {
  sidebarEl.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden'
  buildToolbar(sidebarEl, toolbarDeps())

  scrollEl = el('div', 'flex:1;overflow-y:auto;overflow-x:hidden')
  gridEl = el(
    'div',
    'display:grid;' +
    'grid-template-columns:repeat(auto-fill,minmax(min(200px,100%),1fr));' +
    'gap:8px;padding:8px;align-content:start',
  )
  scrollEl.appendChild(gridEl)
  sidebarEl.appendChild(scrollEl)
  refresh()
}

// ─── Event handlers ───────────────────────────────────────────────────────────

function onStatus() {
  refresh()
}

function onExecutionStart() {
  if (state.progressUrl) {
    URL.revokeObjectURL(state.progressUrl)
    state.progressUrl = null
  }
  render()
}

function onProgressPreview({ detail }) {
  if (state.running.length === 0) return
  const prev = state.progressUrl
  if (prev) URL.revokeObjectURL(prev)
  state.progressUrl = URL.createObjectURL(detail)
  render()
}

// ─── Badge style injection ─────────────────────────────────────────────────────

function injectBadgeStyle() {
  const id = 'queue-sidebar-badge-style'
  if (document.getElementById(id)) return
  const style = document.createElement('style')
  style.id = id
  style.textContent =
    '.sidebar-icon-badge{font-size:9px!important;min-width:14px!important;line-height:13px!important}'
  document.head.appendChild(style)
}

// ─── Register ─────────────────────────────────────────────────────────────────

app.registerExtension({
  name: 'ComfyUI.QueueSidebar',

  commands: [
    {
      id: 'ComfyUI.QueueSidebar.Toggle',
      label: () => t('queue'),
      icon: 'pi pi-history',
      function() {
        app.extensionManager.sidebarTab?.toggleSidebarTab('queue')
      },
    },
  ],

  keybindings: [
    {
      commandId: 'ComfyUI.QueueSidebar.Toggle',
      combo: { key: 'q' },
    },
  ],

  async setup() {
    // Load translations from web/locales/<locale>.json
    await loadI18n()

    injectBadgeStyle()
    hookQueuePrompt(app, refresh)

    api.addEventListener('status', onStatus)
    api.addEventListener('execution_start', onExecutionStart)
    api.addEventListener('b_preview', onProgressPreview)

    app.extensionManager.registerSidebarTab({
      id: 'queue',
      icon: 'pi pi-history',
      title: t('queue'),
      tooltip: t('queue'),
      type: 'custom',
      iconBadge: '',

      render(el) {
        buildSidebar(el)
      },

      destroy() {
        if (state.progressUrl) {
          URL.revokeObjectURL(state.progressUrl)
          state.progressUrl = null
        }
        gridEl = null
        scrollEl = null
      },
    })

    reorderQueueTab(app)
  },
})
