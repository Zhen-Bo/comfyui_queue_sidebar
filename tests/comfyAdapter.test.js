import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
    getComfyLocale,
    hookQueuePrompt,
    reorderQueueTab,
    updateTabBadge,
    normalizeQueue,
    normalizeHistoryItem,
} from '../web/lib/comfyAdapter.js'

// ─── normalizeQueue ───────────────────────────────────────────────────────────

describe('normalizeQueue', () => {
    it('normalizes a standard queue response', () => {
        const data = {
            queue_running: [['prompt-1', 'id1', {}, {}]],
            queue_pending: [[0, 'prompt-2', {}, {}]],
        }
        const result = normalizeQueue(data)
        expect(result.running).toEqual([
            { promptId: 'prompt-1', status: 'running', outputs: {} },
        ])
        expect(result.pending).toEqual([
            { promptId: 'prompt-2', status: 'pending', outputs: {} },
        ])
    })

    it('returns empty arrays when no queue data', () => {
        expect(normalizeQueue({})).toEqual({ running: [], pending: [] })
        expect(normalizeQueue({ queue_running: [], queue_pending: [] })).toEqual({
            running: [],
            pending: [],
        })
    })

    it('filters out malformed running entries and warns', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => { })
        const data = {
            queue_running: ['not-an-array', ['valid-id']],
            queue_pending: [],
        }
        const result = normalizeQueue(data)
        expect(result.running).toEqual([
            { promptId: 'valid-id', status: 'running', outputs: {} },
        ])
        expect(spy).toHaveBeenCalledOnce()
        spy.mockRestore()
    })

    it('filters out malformed pending entries (too short) and warns', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => { })
        const data = {
            queue_running: [],
            queue_pending: [['only-one-element']],
        }
        const result = normalizeQueue(data)
        expect(result.pending).toEqual([])
        expect(spy).toHaveBeenCalledOnce()
        spy.mockRestore()
    })

    it('handles multiple running and pending items', () => {
        const data = {
            queue_running: [['r1'], ['r2'], ['r3']],
            queue_pending: [[0, 'p1'], [1, 'p2']],
        }
        const result = normalizeQueue(data)
        expect(result.running).toHaveLength(3)
        expect(result.pending).toHaveLength(2)
        expect(result.running.map((r) => r.promptId)).toEqual(['r1', 'r2', 'r3'])
        expect(result.pending.map((p) => p.promptId)).toEqual(['p1', 'p2'])
    })
})

// ─── normalizeHistoryItem ─────────────────────────────────────────────────────

describe('normalizeHistoryItem', () => {
    it('normalizes a completed item with execution time', () => {
        const item = {
            status: {
                status_str: 'success',
                messages: [
                    ['execution_start', { timestamp: 1000 }],
                    ['execution_success', { timestamp: 3500 }],
                ],
            },
            outputs: { '1': { images: [{ filename: 'out.png' }] } },
            prompt: [0, 'pid', {}, { extra_pnginfo: { workflow: { nodes: [] } } }],
        }
        const result = normalizeHistoryItem('pid', item)
        expect(result).toEqual({
            promptId: 'pid',
            status: 'completed',
            outputs: { '1': { images: [{ filename: 'out.png' }] } },
            executionTime: 2.5,
            workflow: { nodes: [] },
        })
    })

    it('normalizes a failed item', () => {
        const item = {
            status: { status_str: 'error', messages: [] },
            outputs: {},
        }
        const result = normalizeHistoryItem('pid-fail', item)
        expect(result.status).toBe('failed')
        expect(result.executionTime).toBeUndefined()
        expect(result.workflow).toBeNull()
    })

    it('normalizes a cancelled item', () => {
        const item = {
            status: { status_str: 'cancelled', messages: [] },
            outputs: {},
        }
        const result = normalizeHistoryItem('pid-cancel', item)
        expect(result.status).toBe('cancelled')
    })

    it('handles missing status gracefully', () => {
        const result = normalizeHistoryItem('pid-empty', {})
        expect(result.status).toBe('completed')
        expect(result.outputs).toEqual({})
        expect(result.executionTime).toBeUndefined()
        expect(result.workflow).toBeNull()
    })

    it('handles missing prompt shape (no workflow)', () => {
        const item = {
            status: { status_str: 'success', messages: [] },
            outputs: {},
            prompt: [0, 'pid'],
        }
        const result = normalizeHistoryItem('pid', item)
        expect(result.workflow).toBeNull()
    })

    it('computes executionTime only when both timestamps exist', () => {
        const noEnd = {
            status: {
                messages: [['execution_start', { timestamp: 1000 }]],
            },
        }
        expect(normalizeHistoryItem('x', noEnd).executionTime).toBeUndefined()

        const noStart = {
            status: {
                messages: [['execution_success', { timestamp: 2000 }]],
            },
        }
        expect(normalizeHistoryItem('y', noStart).executionTime).toBeUndefined()
    })
})

// ─── getComfyLocale ───────────────────────────────────────────────────────────

describe('getComfyLocale', () => {
    it('returns the locale from app settings', () => {
        const app = { extensionManager: { setting: { get: () => 'zh-TW' } } }
        expect(getComfyLocale(app)).toBe('zh-TW')
    })

    it('defaults to "en" when setting returns null', () => {
        const app = { extensionManager: { setting: { get: () => null } } }
        expect(getComfyLocale(app)).toBe('en')
    })

    it('returns "en" and warns when app structure is broken', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => { })
        expect(getComfyLocale({})).toBe('en')
        expect(spy).toHaveBeenCalledOnce()
        spy.mockRestore()
    })
})

// ─── hookQueuePrompt ──────────────────────────────────────────────────────────

describe('hookQueuePrompt', () => {
    it('wraps queuePrompt and calls onQueued after', async () => {
        const onQueued = vi.fn()
        const origResult = { id: '123' }
        const app = { queuePrompt: vi.fn().mockResolvedValue(origResult) }

        hookQueuePrompt(app, onQueued)

        const result = await app.queuePrompt(1, 0)
        expect(result).toEqual(origResult)
        expect(onQueued).toHaveBeenCalledOnce()
    })

    it('warns and skips when queuePrompt is missing', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => { })
        const app = {}
        hookQueuePrompt(app, vi.fn())
        expect(spy).toHaveBeenCalled()
        spy.mockRestore()
    })

    it('warns when app is totally broken', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => { })
        hookQueuePrompt(null, vi.fn())
        expect(spy).toHaveBeenCalled()
        spy.mockRestore()
    })
})

// ─── reorderQueueTab ──────────────────────────────────────────────────────────

describe('reorderQueueTab', () => {
    it('moves queue tab after assets tab', () => {
        const tabs = [
            { id: 'search' },
            { id: 'assets' },
            { id: 'nodes' },
            { id: 'queue' },
        ]
        const app = { extensionManager: { sidebarTab: { sidebarTabs: tabs } } }
        reorderQueueTab(app)
        expect(tabs.map((t) => t.id)).toEqual(['search', 'assets', 'queue', 'nodes'])
    })

    it('does nothing when queue tab is already at position 0', () => {
        const tabs = [{ id: 'queue' }, { id: 'assets' }]
        const app = { extensionManager: { sidebarTab: { sidebarTabs: tabs } } }
        reorderQueueTab(app)
        expect(tabs.map((t) => t.id)).toEqual(['queue', 'assets'])
    })

    it('places queue at index 1 when no assets tab', () => {
        const tabs = [{ id: 'search' }, { id: 'nodes' }, { id: 'queue' }]
        const app = { extensionManager: { sidebarTab: { sidebarTabs: tabs } } }
        reorderQueueTab(app)
        expect(tabs.map((t) => t.id)).toEqual(['search', 'queue', 'nodes'])
    })

    it('warns when sidebarTabs is not available', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => { })
        reorderQueueTab({})
        expect(spy).toHaveBeenCalled()
        spy.mockRestore()
    })
})

// ─── updateTabBadge ───────────────────────────────────────────────────────────

describe('updateTabBadge', () => {
    it('sets badge to count string when > 0', () => {
        const tab = { id: 'queue', iconBadge: '' }
        const app = { extensionManager: { sidebarTab: { sidebarTabs: [tab] } } }
        updateTabBadge(app, 3)
        expect(tab.iconBadge).toBe('3')
    })

    it('clears badge when count is 0', () => {
        const tab = { id: 'queue', iconBadge: '5' }
        const app = { extensionManager: { sidebarTab: { sidebarTabs: [tab] } } }
        updateTabBadge(app, 0)
        expect(tab.iconBadge).toBe('')
    })

    it('does not throw when app structure is broken', () => {
        expect(() => updateTabBadge({}, 1)).not.toThrow()
        expect(() => updateTabBadge(null, 1)).not.toThrow()
    })
})
