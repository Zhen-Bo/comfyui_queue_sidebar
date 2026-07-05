import { GALLERY_NAV_BTN, GALLERY_CORNER_BTN } from './constants.js'
import { el, elHtml, showToast } from './helpers.js'

// ─── Zoom / pan (images only) ───────────────────────────────────────────────────

const ZOOM_STEP = 0.12
const ZOOM_MIN = 1
const ZOOM_MAX = 4

/**
 * Wire wheel-zoom and drag-pan onto an image element. Scale is clamped to
 * [ZOOM_MIN, ZOOM_MAX]; panning is only active while zoomed in (scale > 1).
 * State lives in this closure and is baked into the element's CSS transform,
 * so re-rendering the image (on open / navigation) starts fresh at fit.
 *
 * @param {HTMLElement} media - the gallery <img> element
 */
export function attachZoomPan(media) {
    let scale = ZOOM_MIN
    let offsetX = 0
    let offsetY = 0
    let dragging = false
    let startX = 0
    let startY = 0
    let startOffsetX = 0
    let startOffsetY = 0

    const apply = () => {
        media.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`
        // Cursor affordance: grab when panning is available, grabbing mid-drag.
        media.style.cursor = scale > ZOOM_MIN ? (dragging ? 'grabbing' : 'grab') : ''
    }

    // <img> is natively draggable; suppress it so press-and-hold pans the image
    // instead of starting a browser drag-and-drop ghost.
    media.addEventListener('dragstart', (e) => e.preventDefault())

    media.addEventListener('wheel', (e) => {
        if (!e.deltaY) return // ignore horizontal swipes (deltaY 0) — don't zoom or block scroll
        e.preventDefault()
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP
        scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale + delta))
        if (scale <= ZOOM_MIN) { offsetX = 0; offsetY = 0 } // recenter when back at fit
        apply()
    })

    media.addEventListener('pointerdown', (e) => {
        if (scale <= ZOOM_MIN) return // panning only applies while zoomed in
        dragging = true
        startX = e.clientX
        startY = e.clientY
        startOffsetX = offsetX
        startOffsetY = offsetY
        media.setPointerCapture?.(e.pointerId) // keep tracking if the pointer leaves the element
        apply() // switch to the grabbing cursor
    })

    media.addEventListener('pointermove', (e) => {
        if (!dragging) return
        offsetX = startOffsetX + (e.clientX - startX)
        offsetY = startOffsetY + (e.clientY - startY)
        apply()
    })

    const endDrag = (e) => {
        if (!dragging) return
        dragging = false
        media.releasePointerCapture?.(e.pointerId)
        apply() // revert the grabbing cursor back to grab
    }
    media.addEventListener('pointerup', endDrag)
    media.addEventListener('pointercancel', endDrag)
    media.addEventListener('pointerleave', endDrag)

    apply()
}

// ─── Gallery Overlay ──────────────────────────────────────────────────────────

function createGalleryMedia(item) {
    const { type, url } = item
    let media
    if (type === 'image') {
        media = el(
            'img',
            'max-width:90vw;max-height:90vh;object-fit:contain;display:block;' +
            'border-radius:4px;box-shadow:0 8px 32px rgba(0,0,0,.6)',
        )
        media.src = url
        attachZoomPan(media)
    } else {
        media = el(
            'video',
            'max-width:90vw;max-height:90vh;object-fit:contain;display:block;border-radius:4px',
        )
        media.src = url
        media.controls = true
        media.autoplay = true
    }
    media.className = 'gallery-media'
    media.addEventListener('click', (e) => e.stopPropagation())
    return media
}

function addHoverEffect(btn) {
    btn.addEventListener('mouseenter', () => (btn.style.background = 'rgba(255,255,255,.25)'))
    btn.addEventListener('mouseleave', () => (btn.style.background = 'rgba(255,255,255,.1)'))
}

function createGalleryNav(overlay, items, getIdx, setIdx, showFn) {
    const prev = elHtml('button', `left:16px;${GALLERY_NAV_BTN}`, '&#8249;')
    addHoverEffect(prev)
    prev.addEventListener('click', (e) => {
        e.stopPropagation()
        setIdx((getIdx() - 1 + items.length) % items.length)
        showFn()
    })

    const next = elHtml('button', `right:16px;${GALLERY_NAV_BTN}`, '&#8250;')
    addHoverEffect(next)
    next.addEventListener('click', (e) => {
        e.stopPropagation()
        setIdx((getIdx() + 1) % items.length)
        showFn()
    })

    overlay.appendChild(prev)
    overlay.appendChild(next)
}

// ─── Copy image to clipboard ────────────────────────────────────────────────────

// Monotonic token identifying the latest copy request. A press bumps this and
// captures its value; only the still-latest request may show its toast, so a
// slow earlier copy resolving late can't overwrite a newer press's result.
let copyRequestId = 0

/**
 * Copy the current image to the clipboard as a ClipboardItem.
 * On any failure it surfaces an error toast — deliberately no URL fallback.
 *
 * NOTE(debt): Chromium's async-clipboard write decodes and re-encodes the PNG
 * (stripping ComfyUI's embedded workflow metadata) and rejects non-PNG types
 * outright. Actually preserving metadata would require web custom formats
 * (`web image/png`) plus reader opt-in — pending a design decision.
 *
 * @param {object} item - gallery item ({ type, url, ... })
 * @param {Function} t - i18n lookup
 */
async function copyImage(item, t) {
    const requestId = ++copyRequestId
    try {
        const res = await fetch(item.url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
        if (requestId !== copyRequestId) return // superseded by a newer copy
        showToast(t('copied'), undefined, 'var(--p-green-500,#22c55e)') // success confirmation
    } catch (err) {
        console.error('[QueueSidebar] Copy image failed:', err)
        if (requestId !== copyRequestId) return // superseded by a newer copy
        showToast(t('copyFailed'))
    }
}

export function openGallery(items, startIdx, deps = {}) {
    let idx = startIdx
    const t = deps.t ?? ((k) => k)
    const app = deps.app
    const overlay = el(
        'div',
        'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.92);' +
        'display:flex;align-items:center;justify-content:center',
    )

    const close = () => { document.removeEventListener('keydown', onKey); overlay.remove() }

    const show = () => {
        overlay.querySelector('.gallery-media')?.remove()
        overlay.querySelector('.gallery-counter')?.remove()
        overlay.appendChild(createGalleryMedia(items[idx]))
        if (items.length > 1) {
            const counter = el(
                'div',
                'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
                'color:rgba(255,255,255,.7);font-size:13px;pointer-events:none',
                `${idx + 1} / ${items.length}`,
            )
            counter.className = 'gallery-counter'
            overlay.appendChild(counter)
        }
        loadBtn.style.display = items[idx].task?.workflow ? 'block' : 'none'
    }

    if (items.length > 1) {
        createGalleryNav(overlay, items, () => idx, (v) => { idx = v }, show)
    }

    const closeBtn = el(
        'button',
        `top:16px;right:16px;background-color:rgba(255,255,255,.1);color:#ef4444;${GALLERY_CORNER_BTN}`,
        '✕',
    )
    closeBtn.className = 'gallery-close'
    closeBtn.title = t('close')
    addHoverEffect(closeBtn) // translucent-grey button, red ✕ icon; hover brightens
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close() })
    overlay.appendChild(closeBtn)

    // Load-workflow button left of ✕ — same subtle grey button as ✕, but a white
    // icon. Visibility toggled per current item in show().
    const loadBtn = elHtml(
        'button',
        `top:16px;right:60px;background-color:rgba(255,255,255,.1);color:rgba(255,255,255,.8);${GALLERY_CORNER_BTN};display:none`,
        '<i class="pi pi-file-export"></i>',
    )
    loadBtn.className = 'gallery-load-workflow'
    loadBtn.title = t('loadWorkflow')
    addHoverEffect(loadBtn)
    loadBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        const wf = items[idx].task?.workflow
        if (!wf) return
        app?.loadGraphData(wf)
        close()
    })
    overlay.appendChild(loadBtn)

    // Top-left help hint bar (SparkToComfy-style) — a non-interactive affordance reminder.
    const hint = el(
        'div',
        'position:fixed;top:16px;left:16px;max-width:calc(100vw - 120px);' +
        'padding:7px 10px;border:1px solid rgba(255,255,255,.1);border-radius:6px;' +
        'color:rgba(255,255,255,.72);background-color:rgba(20,20,20,.62);' +
        'backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);' +
        'font-size:11px;line-height:1.25;pointer-events:none;white-space:nowrap;' +
        'overflow:hidden;text-overflow:ellipsis',
        t('galleryHelp'),
    )
    hint.className = 'gallery-hint'
    overlay.appendChild(hint)

    overlay.addEventListener('click', close)

    const onKey = (e) => {
        if (e.key === 'Escape') return close()
        if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
            if (items[idx].type === 'image') copyImage(items[idx], t)
            return
        }
        if (items.length <= 1) return
        if (e.key === 'ArrowLeft') { idx = (idx - 1 + items.length) % items.length; show() }
        if (e.key === 'ArrowRight') { idx = (idx + 1) % items.length; show() }
    }
    document.addEventListener('keydown', onKey)
    show()
    document.body.appendChild(overlay)
}
