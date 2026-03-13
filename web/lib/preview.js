import { STATUS_COLOR, MUTED_ICON } from './constants.js'
import { el, mediaType } from './helpers.js'

// ─── Preview Renderers ────────────────────────────────────────────────────────

export function renderImagePreview(wrap, url, imageFit) {
    if (imageFit === 'contain') {
        wrap.style.position = 'relative'
        const bg = el(
            'img',
            'position:absolute;top:-5%;left:-5%;width:110%;height:110%;' +
            'object-fit:cover;filter:blur(8px);pointer-events:none',
        )
        bg.src = url
        bg.loading = 'lazy'
        wrap.appendChild(bg)
        const img = el(
            'img',
            'position:relative;width:100%;height:100%;object-fit:contain;z-index:1',
        )
        img.src = url
        img.loading = 'lazy'
        wrap.appendChild(img)
    } else {
        const img = el('img', 'width:100%;height:100%;object-fit:cover;object-position:center')
        img.src = url
        img.loading = 'lazy'
        wrap.appendChild(img)
    }
}

export function renderVideoPreview(wrap, url, imageFit) {
    const vid = el('video', `width:100%;height:100%;object-fit:${imageFit}`)
    vid.src = url
    vid.muted = true
    vid.loop = true
    vid.addEventListener('mouseenter', () => vid.play())
    vid.addEventListener('mouseleave', () => { vid.pause(); vid.currentTime = 0 })
    wrap.appendChild(vid)
}

/**
 * Render output preview (completed/failed tasks).
 * @param {HTMLElement} wrap
 * @param {object} task
 * @param {object} deps - { firstOutput, viewUrl, imageFit }
 */
export function renderOutputPreview(wrap, task, deps) {
    const { firstOutput, viewUrl, imageFit } = deps
    const output = firstOutput(task.outputs, task.promptId)
    if (!output) {
        const icon = task.status === 'failed' ? 'pi-exclamation-circle' : 'pi-check-circle'
        const color = task.status === 'failed' ? STATUS_COLOR.failed : 'var(--p-text-muted-color,#888)'
        wrap.innerHTML = `<i class="pi ${icon}" style="font-size:2rem;color:${color}"></i>`
        return
    }
    const type = mediaType(output.filename)
    const url = viewUrl(output)
    if (type === 'image') renderImagePreview(wrap, url, imageFit)
    else if (type === 'video') renderVideoPreview(wrap, url, imageFit)
    else if (type === 'audio') wrap.innerHTML = `<i class="pi pi-volume-up" style="${MUTED_ICON}"></i>`
    else wrap.innerHTML = `<i class="pi pi-file" style="${MUTED_ICON}"></i>`
}

/**
 * Update an existing running card's preview without recreating the spinner.
 */
export function updateRunningPreview(card, progressUrl) {
    const preview = card.querySelector('.task-preview')
    if (!preview) return
    if (progressUrl) {
        let img = preview.querySelector('img')
        if (!img) {
            preview.innerHTML = ''
            img = el('img', 'width:100%;height:100%;object-fit:cover;object-position:center')
            preview.appendChild(img)
        }
        if (img.src !== progressUrl) img.src = progressUrl
    } else {
        if (!preview.querySelector('.pi-spin')) {
            preview.innerHTML = `<i class="pi pi-spin pi-spinner" style="${MUTED_ICON}"></i>`
        }
    }
}

/**
 * Create a full preview element for a task card.
 * @param {object} task
 * @param {object} deps - { progressUrl, firstOutput, viewUrl, imageFit }
 */
export function makePreview(task, deps) {
    const { progressUrl, firstOutput, viewUrl, imageFit } = deps
    const wrap = el(
        'div',
        'width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden',
    )
    wrap.className = 'task-preview'
    wrap.style.transition = 'transform 0.2s ease'
    wrap.addEventListener('mouseenter', () => (wrap.style.transform = 'scale(1.05)'))
    wrap.addEventListener('mouseleave', () => (wrap.style.transform = ''))

    if (task.status === 'running') {
        if (progressUrl) {
            const img = el('img', 'width:100%;height:100%;object-fit:cover;object-position:center')
            img.src = progressUrl
            wrap.appendChild(img)
        } else {
            wrap.innerHTML = `<i class="pi pi-spin pi-spinner" style="${MUTED_ICON}"></i>`
        }
        return wrap
    }
    if (task.status === 'pending') {
        wrap.innerHTML = `<span style="${MUTED_ICON}">···</span>`
        return wrap
    }
    renderOutputPreview(wrap, task, { firstOutput, viewUrl, imageFit })
    return wrap
}
