// ─── Output Cache ─────────────────────────────────────────────────────────────

export const OUTPUT_CACHE_KEY = 'queueSidebar.lastOutput'
export const OUTPUT_CACHE_MAX = 200

/**
 * Persist the output items for a given promptId into localStorage.
 * A non-array argument is normalised into a one-element array.
 * Evicts the oldest entry when the cache exceeds OUTPUT_CACHE_MAX.
 * All JSON errors are silently caught.
 *
 * @param {string} promptId
 * @param {object[]|object} items
 */
export function saveOutputCache(promptId, items) {
    if (!promptId) return
    try {
        const raw = localStorage.getItem(OUTPUT_CACHE_KEY)
        let cache = {}
        try {
            if (raw) cache = JSON.parse(raw)
        } catch {
            cache = {}
        }
        cache[promptId] = Array.isArray(items) ? items : [items]
        while (Object.keys(cache).length > OUTPUT_CACHE_MAX) {
            delete cache[Object.keys(cache)[0]]
        }
        localStorage.setItem(OUTPUT_CACHE_KEY, JSON.stringify(cache))
    } catch {
        // silent — storage failure must not crash the page
    }
}

/**
 * Load the cached output items for a given promptId.
 * Returns null if not found or if JSON parsing fails. An entry written before
 * this cache held arrays (a bare descriptor object) is wrapped into a
 * one-element array on read — that wrap IS the entire migration.
 *
 * @param {string} promptId
 * @returns {object[]|null}
 */
export function loadOutputCache(promptId) {
    if (!promptId) return null
    try {
        const raw = localStorage.getItem(OUTPUT_CACHE_KEY)
        if (!raw) return null
        const cache = JSON.parse(raw)
        const entry = cache[promptId]
        if (entry == null) return null
        return Array.isArray(entry) ? entry : [entry]
    } catch {
        return null
    }
}

// Keys checked in priority order when scanning node outputs
const OUTPUT_KEYS = ['images', 'gifs', 'video', 'audio']

/**
 * Resolve every media item produced by the single node that "wins" for this
 * task — cache-first, falling back to a node/key scan of `outputs`.
 *
 * ponytail: expansion is scoped to exactly ONE (node, key) match, never
 * accumulated across nodes. An upscale workflow has a 512px base image in one
 * node and a 2048px result in another; flattening every node together would
 * put the two side by side, and if a thumbnail were casually switched to
 * `list[0]` the card would regress from the upscaled result back to the
 * pre-upscale image. The cache's job is choosing WHICH NODE wins —
 * `onExecuted` overwrites `cache[promptId]` per node, so it holds the
 * last-executed node's output, which is what makes multi-stage workflows show
 * the final image. That selection must keep working untouched. If "all
 * media" (every node, not just the winner) is ever actually required,
 * cross-node ordering, mixed media types, counter semantics, and cache
 * aggregation all need to be designed first — do not smuggle
 * array-flattening back in as a local fix.
 *
 * @param {object} outputs  - map of nodeId → node output object
 * @param {string} promptId
 * @returns {object[]}      - items with a `filename` property, all from one node; [] if none
 */
export function taskOutputs(outputs = {}, promptId) {
    const cached = loadOutputCache(promptId)
    if (cached !== null && cached.length > 0) return cached

    for (const nodeOutput of Object.values(outputs)) {
        for (const key of OUTPUT_KEYS) {
            if (!(key in nodeOutput)) continue
            const val = nodeOutput[key]
            const items = (Array.isArray(val) ? val : [val]).filter((item) => item && item.filename)
            if (items.length > 0) return items
        }
    }

    return []
}

/**
 * Find the single output item to show for a task — same contract as before
 * `taskOutputs` existed: cache-first, node-first/key-second fallback order.
 *
 * @param {object} outputs  - map of nodeId → node output object
 * @param {string} promptId
 * @returns {object|null}   - a single media item with a `filename` property, or null
 */
export function firstOutput(outputs = {}, promptId) {
    return taskOutputs(outputs, promptId)[0] ?? null
}
