/**
 * High-value tests for the render reconciliation logic and card lifecycle.
 *
 * These tests use jsdom (via vitest environment) to simulate DOM operations
 * and verify that status transitions correctly rebuild cards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Minimal DOM stubs ────────────────────────────────────────────────────────

function createMockCard(promptId, status) {
    const card = document.createElement('div')
    card.dataset.id = promptId
    card.dataset.status = status
    return card
}

// ─── Test: card reuse / rebuild on status change ──────────────────────────────

describe('Card reuse logic (render reconciliation)', () => {
    /**
     * Simulate the core reconciliation loop extracted from queue-sidebar.js:226.
     * This is a unit-testable version of the render() reconciliation behavior.
     */
    function reconcile(gridEl, allTasks, makeCardFn) {
        const existing = new Map()
        for (const child of [...gridEl.children]) {
            const id = child.dataset?.id
            if (id) existing.set(id, child)
            else child.remove()
        }

        for (let i = 0; i < allTasks.length; i++) {
            const task = allTasks[i]
            let card = existing.get(task.promptId)

            if (card) {
                existing.delete(task.promptId)
                // This is the fix: rebuild on status change
                if (card.dataset.status !== task.status) {
                    card.replaceWith(makeCardFn(task))
                    card = gridEl.children[i] ?? makeCardFn(task)
                }
                // else: running preview update would go here
            } else {
                card = makeCardFn(task)
            }

            if (gridEl.children[i] !== card) {
                gridEl.insertBefore(card, gridEl.children[i] ?? null)
            }
        }

        for (const card of existing.values()) card.remove()
    }

    let gridEl
    let makeCardFn

    beforeEach(() => {
        gridEl = document.createElement('div')
        makeCardFn = vi.fn((task) => createMockCard(task.promptId, task.status))
    })

    it('creates new cards for fresh tasks', () => {
        const tasks = [
            { promptId: 'a', status: 'pending' },
            { promptId: 'b', status: 'running' },
        ]
        reconcile(gridEl, tasks, makeCardFn)

        expect(gridEl.children).toHaveLength(2)
        expect(makeCardFn).toHaveBeenCalledTimes(2)
        expect(gridEl.children[0].dataset.id).toBe('a')
        expect(gridEl.children[1].dataset.id).toBe('b')
    })

    it('reuses cards when status has NOT changed', () => {
        // Pre-populate grid with existing cards
        gridEl.appendChild(createMockCard('a', 'running'))

        const tasks = [{ promptId: 'a', status: 'running' }]
        reconcile(gridEl, tasks, makeCardFn)

        // Should NOT call makeCard — reuses existing
        expect(makeCardFn).not.toHaveBeenCalled()
        expect(gridEl.children).toHaveLength(1)
        expect(gridEl.children[0].dataset.status).toBe('running')
    })

    it('rebuilds card when status changes from pending to completed', () => {
        gridEl.appendChild(createMockCard('a', 'pending'))

        const tasks = [{ promptId: 'a', status: 'completed' }]
        reconcile(gridEl, tasks, makeCardFn)

        expect(makeCardFn).toHaveBeenCalledTimes(1)
        expect(makeCardFn).toHaveBeenCalledWith({ promptId: 'a', status: 'completed' })
        expect(gridEl.children[0].dataset.status).toBe('completed')
    })

    it('rebuilds card when status changes from running to failed', () => {
        gridEl.appendChild(createMockCard('a', 'running'))

        const tasks = [{ promptId: 'a', status: 'failed' }]
        reconcile(gridEl, tasks, makeCardFn)

        expect(makeCardFn).toHaveBeenCalledTimes(1)
        expect(gridEl.children[0].dataset.status).toBe('failed')
    })

    it('rebuilds card when status changes from running to completed', () => {
        gridEl.appendChild(createMockCard('a', 'running'))

        const tasks = [{ promptId: 'a', status: 'completed' }]
        reconcile(gridEl, tasks, makeCardFn)

        expect(makeCardFn).toHaveBeenCalledTimes(1)
        expect(gridEl.children[0].dataset.status).toBe('completed')
    })

    it('removes stale cards not in the new task list', () => {
        gridEl.appendChild(createMockCard('a', 'completed'))
        gridEl.appendChild(createMockCard('b', 'completed'))

        const tasks = [{ promptId: 'a', status: 'completed' }]
        reconcile(gridEl, tasks, makeCardFn)

        expect(gridEl.children).toHaveLength(1)
        expect(gridEl.children[0].dataset.id).toBe('a')
    })

    it('removes empty-state placeholder elements', () => {
        const placeholder = document.createElement('div')
        // No dataset.id → treated as non-task element
        gridEl.appendChild(placeholder)

        const tasks = [{ promptId: 'a', status: 'pending' }]
        reconcile(gridEl, tasks, makeCardFn)

        expect(gridEl.children).toHaveLength(1)
        expect(gridEl.children[0].dataset.id).toBe('a')
    })

    it('handles multiple status transitions in the same render', () => {
        gridEl.appendChild(createMockCard('a', 'running'))
        gridEl.appendChild(createMockCard('b', 'pending'))
        gridEl.appendChild(createMockCard('c', 'completed'))

        const tasks = [
            { promptId: 'a', status: 'completed' },  // running → completed
            { promptId: 'b', status: 'running' },     // pending → running
            { promptId: 'c', status: 'completed' },   // no change
        ]
        reconcile(gridEl, tasks, makeCardFn)

        expect(makeCardFn).toHaveBeenCalledTimes(2)  // Only a and b rebuilt
        expect(gridEl.children[0].dataset.status).toBe('completed')
        expect(gridEl.children[1].dataset.status).toBe('running')
        expect(gridEl.children[2].dataset.status).toBe('completed')
    })
})
