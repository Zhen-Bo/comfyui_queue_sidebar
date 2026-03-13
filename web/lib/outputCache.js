// ─── Output Cache ─────────────────────────────────────────────────────────────

export const OUTPUT_CACHE_KEY = 'queueSidebar.lastOutput'
export const OUTPUT_CACHE_MAX = 200

/**
 * Persist an output object for a given promptId into localStorage.
 * Evicts the oldest entry when the cache exceeds OUTPUT_CACHE_MAX.
 * All JSON errors are silently caught.
 *
 * @param {string} promptId
 * @param {object} output
 */
export function saveOutputCache(promptId, output) {
    if (!promptId) return
    try {
        const raw = localStorage.getItem(OUTPUT_CACHE_KEY)
        let cache = {}
        try {
            if (raw) cache = JSON.parse(raw)
        } catch {
            cache = {}
        }
        cache[promptId] = output
        while (Object.keys(cache).length > OUTPUT_CACHE_MAX) {
            delete cache[Object.keys(cache)[0]]
        }
        localStorage.setItem(OUTPUT_CACHE_KEY, JSON.stringify(cache))
    } catch {
        // silent — storage failure must not crash the page
    }
}

/**
 * Load the cached output for a given promptId.
 * Returns null if not found or if JSON parsing fails.
 *
 * @param {string} promptId
 * @returns {object|null}
 */
export function loadOutputCache(promptId) {
    if (!promptId) return null
    try {
        const raw = localStorage.getItem(OUTPUT_CACHE_KEY)
        if (!raw) return null
        const cache = JSON.parse(raw)
        return cache[promptId] ?? null
    } catch {
        return null
    }
}

// Keys checked in priority order when scanning node outputs
const OUTPUT_KEYS = ['images', 'gifs', 'video', 'audio']

/**
 * Find the first media item from task outputs.
 * Checks the localStorage cache first; falls back to iterating output values.
 *
 * @param {object} outputs  - map of nodeId → node output object
 * @param {string} promptId
 * @returns {object|null}   - a single media item with a `filename` property, or null
 */
export function firstOutput(outputs = {}, promptId) {
    const cached = loadOutputCache(promptId)
    if (cached !== null) return cached

    for (const nodeOutput of Object.values(outputs)) {
        for (const key of OUTPUT_KEYS) {
            if (!(key in nodeOutput)) continue
            const val = nodeOutput[key]
            const item = Array.isArray(val) ? val[0] : val
            if (item && item.filename) return item
        }
    }

    return null
}
