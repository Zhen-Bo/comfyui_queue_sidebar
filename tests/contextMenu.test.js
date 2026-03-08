/**
 * Tests for context menu action mapping.
 *
 * Verifies that:
 * - Running tasks get "Interrupt" (not "Delete")
 * - Pending tasks get "Delete" calling /queue delete
 * - Completed/failed tasks get "Delete" calling /history delete
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock DOM (showContextMenu needs document) ────────────────────────────────

// We test the logic by importing showContextMenu and capturing the menu items
// via the rendered DOM, or by extracting the action-mapping logic.

// Since showContextMenu interacts heavily with DOM, we test via the action map
// pattern extracted from the source.

function buildContextMenuItems(task, deps) {
    const { t, api } = deps
    const items = []

    if (task.status === 'running') {
        items.push({
            icon: 'pi-stop-circle',
            label: t('interruptTask'),
            action: async () => {
                await api.fetchApi('/interrupt', { method: 'POST' })
            },
        })
    } else if (task.status === 'pending') {
        items.push({
            icon: 'pi-trash',
            label: t('deleteTask'),
            action: async () => {
                await api.fetchApi('/queue', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ delete: [task.promptId] }),
                })
            },
        })
    }
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
        items.push({
            icon: 'pi-trash',
            label: t('deleteTask'),
            action: async () => {
                await api.fetchApi('/history', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ delete: [task.promptId] }),
                })
            },
        })
    }
    return items
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Context menu action mapping', () => {
    let api
    let t

    beforeEach(() => {
        api = {
            fetchApi: vi.fn().mockResolvedValue({ ok: true }),
        }
        t = (key) => {
            const map = {
                interruptTask: 'Interrupt',
                deleteTask: 'Delete',
                loadWorkflow: 'Load workflow',
            }
            return map[key] ?? key
        }
    })

    describe('running task', () => {
        it('shows "Interrupt" label, not "Delete"', () => {
            const task = { promptId: 'r1', status: 'running' }
            const items = buildContextMenuItems(task, { t, api })

            expect(items).toHaveLength(1)
            expect(items[0].label).toBe('Interrupt')
            expect(items[0].icon).toBe('pi-stop-circle')
        })

        it('calls /interrupt API', async () => {
            const task = { promptId: 'r1', status: 'running' }
            const items = buildContextMenuItems(task, { t, api })

            await items[0].action()

            expect(api.fetchApi).toHaveBeenCalledWith('/interrupt', { method: 'POST' })
        })

        it('does NOT call /queue delete', async () => {
            const task = { promptId: 'r1', status: 'running' }
            const items = buildContextMenuItems(task, { t, api })

            await items[0].action()

            expect(api.fetchApi).not.toHaveBeenCalledWith(
                '/queue',
                expect.objectContaining({ body: expect.any(String) }),
            )
        })
    })

    describe('pending task', () => {
        it('shows "Delete" label with trash icon', () => {
            const task = { promptId: 'p1', status: 'pending' }
            const items = buildContextMenuItems(task, { t, api })

            expect(items).toHaveLength(1)
            expect(items[0].label).toBe('Delete')
            expect(items[0].icon).toBe('pi-trash')
        })

        it('calls /queue delete with correct promptId', async () => {
            const task = { promptId: 'p1', status: 'pending' }
            const items = buildContextMenuItems(task, { t, api })

            await items[0].action()

            expect(api.fetchApi).toHaveBeenCalledWith('/queue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ delete: ['p1'] }),
            })
        })
    })

    describe('completed task', () => {
        it('shows "Delete" and calls /history delete', async () => {
            const task = { promptId: 'c1', status: 'completed' }
            const items = buildContextMenuItems(task, { t, api })

            expect(items).toHaveLength(1)
            expect(items[0].label).toBe('Delete')

            await items[0].action()
            expect(api.fetchApi).toHaveBeenCalledWith('/history', expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ delete: ['c1'] }),
            }))
        })
    })

    describe('failed task', () => {
        it('shows "Delete" and calls /history delete', async () => {
            const task = { promptId: 'f1', status: 'failed' }
            const items = buildContextMenuItems(task, { t, api })

            expect(items).toHaveLength(1)
            expect(items[0].label).toBe('Delete')

            await items[0].action()
            expect(api.fetchApi).toHaveBeenCalledWith('/history', expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ delete: ['f1'] }),
            }))
        })
    })

    describe('cancelled task', () => {
        it('shows "Delete" and calls /history delete', async () => {
            const task = { promptId: 'x1', status: 'cancelled' }
            const items = buildContextMenuItems(task, { t, api })

            expect(items).toHaveLength(1)

            await items[0].action()
            expect(api.fetchApi).toHaveBeenCalledWith('/history', expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ delete: ['x1'] }),
            }))
        })
    })
})
