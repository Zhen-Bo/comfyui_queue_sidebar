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
export const OUTPUT_KEYS = ['images', 'gifs', 'video', 'audio']

/**
 * Resolve every media item produced by the single node that "wins" for this
 * task — cache-first, falling back to a node/key scan of `outputs`.
 *
 * ponytail: expansion is scoped to exactly ONE (node, key) match, never
 * accumulated across nodes. An upscale workflow keeps a 512px base image in one
 * node and its 2048px result in another; merging them would surface both, and a
 * thumbnail taken from `list[0]` would regress to the pre-upscale image.
 * Choosing the winning node is the cache's job — `onExecuted` overwrites
 * `cache[promptId]` per node, so it holds the last-executed one. Widening this
 * to every node needs cross-node ordering and mixed-media rules designed first;
 * ARCHITECTURE.md records what that would involve.
 *
 * @param {object} outputs  - map of nodeId → node output object
 * @param {string} promptId
 * @returns {object[]}      - media items from one node; the scan path filters for
 *                            `filename`, cache entries are returned as stored
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
