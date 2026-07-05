import { IMAGE_EXTS, VIDEO_EXTS, AUDIO_EXTS } from './constants.js'

// ─── DOM Helper ───────────────────────────────────────────────────────────────

// Safe default: uses textContent
export function el(tag, style = '', text = '') {
    const e = document.createElement(tag)
    if (style) e.style.cssText = style
    if (text) e.textContent = text
    return e
}

// Explicit opt-in for trusted HTML content
export function elHtml(tag, style = '', html = '') {
    const e = document.createElement(tag)
    if (style) e.style.cssText = style
    if (html) e.innerHTML = html
    return e
}

// ─── Media Helpers ────────────────────────────────────────────────────────────

export function mediaType(filename) {
    const ext = filename.split('.').pop().toLowerCase()
    if (IMAGE_EXTS.has(ext)) return 'image'
    if (VIDEO_EXTS.has(ext)) return 'video'
    if (AUDIO_EXTS.has(ext)) return 'audio'
    return 'unknown'
}

// ─── Toast Notification ───────────────────────────────────────────────────────

/**
 * Show a transient toast at the bottom of the screen. Uses an opaque dark-grey
 * background that matches how the gallery corner buttons look over the dark
 * overlay (a translucent-white fill would read differently against a bright
 * image), with a coloured text + border to signal tone; defaults to the error
 * red. Any toast already on screen is cleared first so only the latest shows.
 * @param {string} message
 * @param {number} [duration=1500] - visible time in ms before fade-out
 * @param {string} [color] - CSS colour for text and border; defaults to the error red
 */
export function showToast(message, duration = 1500, color = 'var(--p-red-500,#ef4444)') {
    for (const prev of document.querySelectorAll('.queue-sidebar-toast')) prev.remove()
    const toast = el(
        'div',
        'position:fixed;bottom:64px;left:50%;z-index:99999;' +
        'padding:10px 20px;border-radius:8px;font-size:13px;' +
        `color:${color};border:1px solid ${color};` +
        'background-color:#1a1a1a;box-shadow:0 4px 12px rgba(0,0,0,.3);' +
        'transition:opacity .3s ease,transform .3s ease',
        message,
    )
    // Start below and transparent (set on style directly, not via cssText, so the
    // animated properties are addressable and survive per-property updates).
    toast.style.opacity = '0'
    toast.style.transform = 'translate(-50%,16px)'
    toast.className = 'queue-sidebar-toast'
    document.body.appendChild(toast)
    // Next frame → slide up into place and fade in (a same-frame set wouldn't transition).
    requestAnimationFrame(() => {
        toast.style.opacity = '1'
        toast.style.transform = 'translate(-50%,0)'
    })
    setTimeout(() => {
        toast.style.opacity = '0' // fade out (position holds)
        setTimeout(() => toast.remove(), 300)
    }, duration)
}

// ─── Safe API Wrapper ─────────────────────────────────────────────────────────

/**
 * Wraps an api.fetchApi call with error handling.
 * Shows a toast on failure and returns null instead of throwing.
 * @param {object} apiInstance - The ComfyUI api object
 * @param {string} url - API endpoint
 * @param {object} [options] - fetch options
 * @returns {Promise<Response|null>}
 */
export async function safeApi(apiInstance, url, options = {}) {
    try {
        const res = await apiInstance.fetchApi(url, options)
        if (!res.ok) {
            console.error(`[QueueSidebar] API error ${res.status}: ${url}`)
            showToast(`API error: ${res.status} ${res.statusText}`)
            return null
        }
        return res
    } catch (err) {
        console.error(`[QueueSidebar] API request failed: ${url}`, err)
        showToast(`Request failed: ${url}`)
        return null
    }
}

