/**
 * ComfyUI Adapter — Single integration point for all upstream coupling.
 *
 * This module centralizes every touch-point with ComfyUI internals so the rest
 * of the plugin depends only on clean, normalized interfaces.  When upstream
 * APIs change, only this file needs updating.
 *
 * Integration points (all guarded with feature detection):
 *  1. badge update       — reads sidebarTabs to set iconBadge
 *  2. queue schema       — normalizes /queue response tuples
 *  3. history schema     — normalizes /history response shape
 *  4. locale detection   — reads Comfy.Locale setting
 */

// ─── Locale ───────────────────────────────────────────────────────────────────

/**
 * Read the user's locale setting from ComfyUI.
 * @param {object} app - ComfyUI app instance
 * @returns {string} locale code, defaults to 'en'
 */
export function getComfyLocale(app) {
    try {
        return app.extensionManager.setting.get('Comfy.Locale') ?? 'en'
    } catch (err) {
        console.warn('[QueueSidebar] Could not read locale setting, defaulting to en:', err)
        return 'en'
    }
}

// ─── Sidebar tab management ──────────────────────────────────────────────────

/**
 * Update the icon badge on the 'queue' sidebar tab.
 *
 * @param {object} app - ComfyUI app instance
 * @param {number} count - number to show (0 = clear badge)
 */
export function updateTabBadge(app, count) {
    try {
        const tabs = app.extensionManager?.sidebarTab?.sidebarTabs
        if (!Array.isArray(tabs)) return
        const tab = tabs.find((t) => t.id === 'queue')
        if (tab) tab.iconBadge = count > 0 ? String(count) : ''
    } catch (err) {
        console.warn('[QueueSidebar] Could not update badge (degraded mode):', err)
    }
}

// ─── Queue / History schema normalization ──────────────────────────────────────

/**
 * Normalize the /queue API response into running & pending task arrays.
 * Upstream format: queue_running = [[number, promptId, ...]], queue_pending = [[number, promptId, ...]]
 *
 * @param {object} data - raw JSON from /queue
 * @returns {{ running: object[], pending: object[] }}
 */
export function normalizeQueue(data) {
    const running = (data.queue_running ?? []).map((tuple) => {
        if (!Array.isArray(tuple) || tuple.length < 1) {
            console.warn('[QueueSidebar] Unexpected queue_running entry shape:', tuple)
            return null
        }
        // Use UUID (tuple[1]) when available so the promptId matches the pending card's ID,
        // enabling card reconciliation across the pending→running transition.
        // Fall back to String(tuple[0]) only for single-element tuples ComfyUI may send
        // before full execution context is available.
        const promptId = tuple.length >= 2 ? tuple[1] : String(tuple[0])
        return { promptId, status: 'running', outputs: {} }
    }).filter(Boolean)

    const pending = (data.queue_pending ?? []).map((tuple) => {
        if (!Array.isArray(tuple) || tuple.length < 2) {
            console.warn('[QueueSidebar] Unexpected queue_pending entry shape:', tuple)
            return null
        }
        return { promptId: tuple[1], status: 'pending', outputs: {} }
    }).filter(Boolean)

    return { running, pending }
}

/**
 * Normalize a single history entry from /history API response.
 * Upstream format: { status: { messages, status_str }, outputs, prompt: [number, promptId, ..., { extra_pnginfo }] }
 *
 * @param {string} promptId
 * @param {object} item - raw history entry
 * @returns {object} normalized task object
 */
export function normalizeHistoryItem(promptId, item) {
    const msgs = item.status?.messages ?? []
    const t0 = msgs.find((m) => m[0] === 'execution_start')?.[1]?.timestamp
    const t1 = msgs.find((m) => m[0] === 'execution_success')?.[1]?.timestamp

    let status = 'completed'
    const statusStr = item.status?.status_str
    if (statusStr === 'error') status = 'failed'
    else if (statusStr === 'cancelled') status = 'cancelled'

    // Workflow extraction — deeply nested, may change across versions
    let workflow = null
    try {
        workflow = item.prompt?.[3]?.extra_pnginfo?.workflow ?? null
    } catch (err) {
        console.warn('[QueueSidebar] Could not extract workflow from history item:', err)
    }

    return {
        promptId,
        status,
        outputs: item.outputs ?? {},
        executionTime: t0 && t1 ? (t1 - t0) / 1000 : undefined,
        workflow,
    }
}
