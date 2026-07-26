import { STATUS_COLOR, MUTED_ICON } from './constants.js'
import { el, mediaType } from './helpers.js'

/**
 * Class hooks on the two layers a contained image is made of, so a live preview
 * can find and re-point them without rebuilding the pair every frame.
 */
export const PREVIEW_BG_CLASS = 'queue-preview-bg'
export const PREVIEW_FG_CLASS = 'queue-preview-fg'

/**
 * Fill the cell with an image without ever cropping it.
 *
 * Plain `object-fit:contain` would letterbox — a grid of ragged black bars where
 * the aspect ratios disagree. Instead the same image is used twice: an
 * over-scaled, blurred copy paints the whole frame, and the real image sits on
 * top at its true proportions. The cell is always full, the picture is always
 * whole, and the padding is made of the picture itself, so the eye reads one
 * object rather than an image parked on a backdrop.
 *
 * Both layers point at the same URL, so the browser decodes once.
 *
 * @param {HTMLElement} wrap
 * @param {string} url
 * @param {boolean} [lazy] - false for a live preview, which must never be deferred
 */
export function fillContain(wrap, url, lazy = true) {
    wrap.style.position = 'relative'
    // 110% at -5% hides the transparent edge blur() leaves behind; without the
    // overscale the frame would have a soft pale border on all four sides.
    const bg = el(
        'img',
        'position:absolute;top:-5%;left:-5%;width:110%;height:110%;' +
        'object-fit:cover;filter:blur(8px);pointer-events:none',
    )
    bg.className = PREVIEW_BG_CLASS
    bg.src = url
    const fg = el(
        'img',
        'position:relative;width:100%;height:100%;object-fit:contain;z-index:1',
    )
    fg.className = PREVIEW_FG_CLASS
    fg.src = url
    if (lazy) {
        bg.loading = 'lazy'
        fg.loading = 'lazy'
    }
    wrap.append(bg, fg)
    return { bg, fg }
}

/**
 * Point an existing contained pair at a new image. Returns false when the cell
 * has no pair yet and the caller has to build one.
 */
export function retargetContain(wrap, url) {
    const fg = wrap.querySelector(`.${PREVIEW_FG_CLASS}`)
    if (!fg) return false
    if (fg.src !== url) {
        fg.src = url
        const bg = wrap.querySelector(`.${PREVIEW_BG_CLASS}`)
        if (bg) bg.src = url
    }
    return true
}

export function renderImagePreview(wrap, url) {
    fillContain(wrap, url)
}

/**
 * Video gets plain `contain` rather than the blurred backdrop above. The backdrop
 * costs a second decode of the same source, which is free for an image the
 * browser has already decoded and decidedly not free for a video, where it means
 * a second decoder running in every visible cell.
 */
export function renderVideoPreview(wrap, url) {
    const vid = el('video', 'width:100%;height:100%;object-fit:contain')
    vid.src = url
    vid.muted = true
    vid.loop = true
    vid.addEventListener('mouseenter', () => vid.play())
    vid.addEventListener('mouseleave', () => { vid.pause(); vid.currentTime = 0 })
    wrap.appendChild(vid)
}

// Icon + colour for a task that finished with no output to show. Colours come
// from STATUS_COLOR so the centre icon reads as the same signal as the status
// tag in the corner, not a second contradictory one. `completed` is the
// exception: a finished task is the normal case, so it stays muted grey.
const NO_OUTPUT_ICON = {
    failed: { icon: 'pi-exclamation-circle', color: STATUS_COLOR.failed },
    cancelled: { icon: 'pi-ban', color: STATUS_COLOR.cancelled },
    completed: { icon: 'pi-check-circle', color: 'var(--p-text-muted-color,#888)' },
}
const DEFAULT_NO_OUTPUT_ICON = NO_OUTPUT_ICON.completed

/**
 * Render output preview (completed/failed tasks).
 * @param {HTMLElement} wrap
 * @param {object} task
 * @param {object} deps - { firstOutput, viewUrl }
 */
export function renderOutputPreview(wrap, task, deps) {
    const { firstOutput, viewUrl } = deps
    const output = firstOutput(task.outputs, task.promptId)
    if (!output) {
        const { icon, color } = NO_OUTPUT_ICON[task.status] ?? DEFAULT_NO_OUTPUT_ICON
        wrap.innerHTML = `<i class="pi ${icon}" style="font-size:2rem;color:${color}"></i>`
        return
    }
    const type = mediaType(output.filename)
    const url = viewUrl(output)
    if (type === 'image') renderImagePreview(wrap, url)
    else if (type === 'video') renderVideoPreview(wrap, url)
    else if (type === 'audio') wrap.innerHTML = `<i class="pi pi-volume-up" style="${MUTED_ICON}"></i>`
    else wrap.innerHTML = `<i class="pi pi-file" style="${MUTED_ICON}"></i>`
}

/**
 * Update an existing running card's preview without recreating the spinner.
 *
 * The live preview must compose identically to a finished one. If it does not,
 * the handover when the output arrives is a visible reframe instead of the
 * picture simply sharpening.
 *
 * `retargetContain` keeps the two layers and swaps their `src`, so a stream
 * arriving 20 times a second re-points existing nodes instead of building and
 * discarding a pair every frame.
 */
export function updateRunningPreview(card, progressUrl) {
    const preview = card.querySelector('.task-preview')
    if (!preview) return
    if (progressUrl) {
        if (retargetContain(preview, progressUrl)) return
        preview.innerHTML = ''
        // Never lazy: this frame is the entire point of the card.
        fillContain(preview, progressUrl, false)
    } else if (!preview.querySelector('.pi-spin')) {
        preview.innerHTML = `<i class="pi pi-spin pi-spinner" style="${MUTED_ICON}"></i>`
    }
}

export const PREVIEW_MEDIA_CLASS = 'queue-card-media'
const PREVIEW_STYLE_ID = 'queue-sidebar-preview-style'

/**
 * The hover lift lives in a stylesheet, not in JS listeners, for two reasons.
 *
 * render() replaces a card outright when its status changes. With mouseenter/
 * mouseleave handlers the replacement card is born un-hovered under a pointer
 * that is already sitting on it and never fires enter again — so the card a user
 * is actively watching finishes and goes visually dead until they move away and
 * come back. CSS `:hover` re-evaluates against the new node immediately.
 *
 * Second, `:hover` is quarantined behind a fine-pointer query, the same as the
 * toolbar buttons: a tap on a touch screen leaves a JS-driven hover latched on
 * with no leave event coming.
 *
 * Nothing inline may set `transform` at rest — an inline declaration outranks
 * the sheet and the `:hover` rule would never paint. The transition lives here
 * too so the reduced-motion query can actually switch it off.
 */
function ensurePreviewStyle() {
    if (document.getElementById(PREVIEW_STYLE_ID)) return
    const style = document.createElement('style')
    style.id = PREVIEW_STYLE_ID
    style.textContent = [
        `.${PREVIEW_MEDIA_CLASS}{transition:transform 0.2s ease}`,
        `@media (hover:hover) and (pointer:fine){` +
        `.${PREVIEW_MEDIA_CLASS}:hover{transform:scale(1.05)}}`,
        `@media (prefers-reduced-motion:reduce){.${PREVIEW_MEDIA_CLASS}{transition:none}}`,
    ].join('')
    document.head.appendChild(style)
}

/**
 * Create a full preview element for a task card.
 * @param {object} task
 * @param {object} deps - { progressUrl, firstOutput, viewUrl }
 */
export function makePreview(task, deps) {
    const { progressUrl, firstOutput, viewUrl } = deps
    ensurePreviewStyle()
    const wrap = el(
        'div',
        'width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden',
    )
    wrap.className = `task-preview ${PREVIEW_MEDIA_CLASS}`

    if (task.status === 'running') {
        if (progressUrl) fillContain(wrap, progressUrl, false)
        else wrap.innerHTML = `<i class="pi pi-spin pi-spinner" style="${MUTED_ICON}"></i>`
        return wrap
    }
    if (task.status === 'pending') {
        wrap.innerHTML = `<span style="${MUTED_ICON}">···</span>`
        return wrap
    }
    renderOutputPreview(wrap, task, { firstOutput, viewUrl })
    return wrap
}
