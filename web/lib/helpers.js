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

export function showToast(message, duration = 3000) {
    const toast = el(
        'div',
        'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:99999;' +
        'padding:10px 20px;border-radius:8px;font-size:13px;color:#fff;' +
        'background:var(--p-red-500,#ef4444);box-shadow:0 4px 12px rgba(0,0,0,.3);' +
        'transition:opacity .3s ease',
        message,
    )
    document.body.appendChild(toast)
    setTimeout(() => {
        toast.style.opacity = '0'
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

