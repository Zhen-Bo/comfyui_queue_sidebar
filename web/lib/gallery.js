import { GALLERY_NAV_BTN, GALLERY_CORNER_BTN, EASE_OUT } from './constants.js'
import { el, elHtml, showToast, prefersReducedMotion } from './helpers.js'

// ─── Zoom / pan (images only) ───────────────────────────────────────────────────

const ZOOM_STEP = 0.12
const ZOOM_MIN = 1
const ZOOM_MAX = 4

/**
 * Wire drag-pan onto an image element and return a controller for zooming it.
 * Scale is clamped to [ZOOM_MIN, ZOOM_MAX]; panning is only active while
 * zoomed in (scale > 1). State lives in this closure and is baked into the
 * element's CSS transform, so re-rendering the image (on open / navigation)
 * starts fresh at fit.
 *
 * Wheel is deliberately NOT bound to `media` here: the lightbox wants
 * wheel-zoom to work anywhere over the overlay, including the dark surround,
 * not just the image. openGallery instead binds a single persistent wheel
 * listener on its content layer and forwards events to the current media's
 * controller.onWheel.
 *
 * @param {HTMLElement} media - the gallery <img> element
 * @returns {{ onWheel: (e: WheelEvent) => void }} controller to drive zoom externally
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

    // Zoom logic lives here but is not bound to `media` — see the doc comment
    // above for why. openGallery calls this from its own content-level listener.
    const onWheel = (e) => {
        if (!e.deltaY) return // ignore horizontal swipes (deltaY 0) — don't zoom or block scroll
        e.preventDefault()
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP
        scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale + delta))
        if (scale <= ZOOM_MIN) { offsetX = 0; offsetY = 0 } // recenter when back at fit
        apply()
    }

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

    return { onWheel }
}

// ─── Gallery Overlay ──────────────────────────────────────────────────────────

/**
 * Backdrop fade-in. Shorter than the content so the dark ground is already
 * settled by the time the media finishes arriving — a simultaneous slam of a
 * 92%-black fill reads as a camera flash.
 */
const BACKDROP_ENTER_MS = 140
/** Content fade + scale-up, trailing the backdrop slightly. */
const CONTENT_ENTER_MS = 180
/** Exit is one short fade for both layers: a lingering dismissal reads as lag. */
const EXIT_MS = 100

/**
 * @returns {{ media: HTMLElement, zoom: {onWheel:(e:WheelEvent)=>void}|null }}
 *   `zoom` is null for video items — they have no zoom/pan, so the caller's
 *   wheel routing can no-op instead of throwing.
 */
function createGalleryMedia(item) {
    const { type, url } = item
    let media
    let zoom = null
    if (type === 'image') {
        media = el(
            'img',
            'max-width:90vw;max-height:90vh;object-fit:contain;display:block;' +
            'border-radius:4px;box-shadow:0 8px 32px rgba(0,0,0,.6)',
        )
        media.src = url
        zoom = attachZoomPan(media)
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
    return { media, zoom }
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
    // Controller for whichever media show() most recently rendered. Routed to
    // from the single content-level wheel listener below — see attachZoomPan's
    // doc comment for why wheel isn't bound directly to the media element.
    let currentZoom = null
    const t = deps.t ?? ((k) => k)
    const app = deps.app
    const animate = !prefersReducedMotion()
    // Two layers, because the backdrop and the content move on different curves:
    // `overlay` is the dark ground and owns the click-to-close target, `content`
    // holds the media and all of its chrome and is what scales up.
    const overlay = el('div', 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.92)')
    overlay.className = 'gallery-overlay'
    // Full-viewport box (inset:0) rather than a shrink-wrapped one, so the
    // position:fixed chrome inside it — which the entrance transform turns into a
    // containing block — keeps resolving its offsets against the viewport rect.
    // The media element keeps its own zoom/pan transform; the entrance scale lives
    // out here on the wrapper so the two never overwrite each other.
    const content = el(
        'div',
        'position:absolute;inset:0;display:flex;align-items:center;justify-content:center',
    )
    overlay.appendChild(content)
    content.className = 'gallery-content'

    let closing = false
    /**
     * Dismiss the overlay. Idempotent — a second call while the fade-out is still
     * pending is a no-op, so Esc, the backdrop click and ✕ can't double-remove or
     * re-enter through a listener that outlived the first call.
     * @param {object} [opts]
     * @param {boolean} [opts.instant] - remove synchronously, no fade.
     */
    const close = (opts) => {
        if (closing) return
        closing = true
        document.removeEventListener('keydown', onKey)
        if (opts?.instant === true || !animate) { overlay.remove(); return }
        overlay.style.transition = `opacity ${EXIT_MS}ms ${EASE_OUT}`
        overlay.style.opacity = '0'
        content.style.transition = `opacity ${EXIT_MS}ms ${EASE_OUT}`
        content.style.opacity = '0'
        // Timer, not transitionend: the event never fires for a detached or
        // display:none'd overlay and the node would be stranded on screen.
        setTimeout(() => overlay.remove(), EXIT_MS)
    }

    const show = () => {
        // Navigation between items is deliberately unanimated — users arrow through
        // rapidly and a per-item fade would just smear.
        content.querySelector('.gallery-media')?.remove()
        content.querySelector('.gallery-counter')?.remove()
        const { media, zoom } = createGalleryMedia(items[idx])
        content.appendChild(media)
        currentZoom = zoom // null for video — the wheel listener below no-ops on it
        if (items.length > 1) {
            const counter = el(
                'div',
                'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
                'color:rgba(255,255,255,.7);font-size:13px;pointer-events:none',
                `${idx + 1} / ${items.length}`,
            )
            counter.className = 'gallery-counter'
            content.appendChild(counter)
        }
        loadBtn.style.display = items[idx].task?.workflow ? 'block' : 'none'
    }

    if (items.length > 1) {
        createGalleryNav(content, items, () => idx, (v) => { idx = v }, show)
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
    content.appendChild(closeBtn)

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
        // Instant, and before the load: loadGraphData blocks the main thread, so a
        // fade started here would freeze mid-way and then snap.
        close({ instant: true })
        app?.loadGraphData(wf)
    })
    content.appendChild(loadBtn)

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
    content.appendChild(hint)

    overlay.addEventListener('click', () => close())
    // One listener for the lightbox's lifetime, bound to `content` (inset:0, so
    // it already covers the full viewport including the dark surround) rather
    // than to the media element — media is recreated per navigation, so binding
    // there would accumulate listeners. Forwards to whichever media is current.
    content.addEventListener('wheel', (e) => currentZoom?.onWheel(e))

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

    if (animate) {
        // Set on style directly, not via cssText, so these stay addressable when the
        // flip below rewrites them.
        overlay.style.opacity = '0'
        overlay.style.transition = `opacity ${BACKDROP_ENTER_MS}ms ${EASE_OUT}`
        content.style.opacity = '0'
        content.style.transform = 'scale(.96)'
        content.style.transition =
            `opacity ${CONTENT_ENTER_MS}ms ${EASE_OUT},transform ${CONTENT_ENTER_MS}ms ${EASE_OUT}`
    }
    document.body.appendChild(overlay)
    if (animate) {
        // Two frames, not one: appending and flipping in the same frame gives the
        // browser nothing to interpolate from.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (closing) return
            overlay.style.opacity = '1'
            content.style.opacity = '1'
            content.style.transform = 'scale(1)'
        }))
    }
}
