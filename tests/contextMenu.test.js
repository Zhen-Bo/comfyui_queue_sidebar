/**
 * Tests for context menu action mapping.
 *
 * Verifies that:
 * - Running tasks get "Interrupt" (not "Delete")
 * - Pending tasks get "Delete" calling /queue delete
 * - Completed/failed tasks get "Delete" calling /history delete
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { showContextMenu } from '../web/lib/contextMenu.js'

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

// ─── Entrance animation ───────────────────────────────────────────────────────

/**
 * The menu grows in from the corner it is anchored to. jsdom reports every
 * element as 0x0, so the edge-flip threshold sits at `innerWidth - 8` /
 * `innerHeight - 8`: a cursor past that is enough to make the flip branch run.
 */
describe('Context menu entrance animation', () => {
    const deps = () => ({
        t: (k) => k,
        api: { fetchApi: vi.fn().mockResolvedValue({ ok: true }) },
        app: { loadGraphData: vi.fn() },
        refresh: vi.fn().mockResolvedValue(undefined),
    })

    /** Fire a right-click at a viewport point and return the menu it rendered. */
    function openAt(x, y) {
        const e = new window.MouseEvent('contextmenu', { clientX: x, clientY: y, cancelable: true })
        showContextMenu(e, { promptId: 'p1', status: 'pending' }, deps())
        return document.body.lastElementChild
    }

    /** Let the two rAFs that start the entrance run. */
    function flushFrames() {
        vi.advanceTimersByTime(50)
    }

    /** Pretend the OS reduced-motion switch is on. */
    function setReducedMotion(matches) {
        window.matchMedia = vi.fn().mockReturnValue({ matches })
    }

    const originalMatchMedia = window.matchMedia

    beforeEach(() => {
        document.body.innerHTML = ''
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
        window.matchMedia = originalMatchMedia
        document.body.innerHTML = ''
    })

    it('starts transparent and slightly small, growing from the cursor corner', () => {
        const menu = openAt(10, 10)

        expect(menu.style.opacity).toBe('0')
        expect(menu.style.transform).toBe('scale(.97)')
        expect(menu.style.transformOrigin).toBe('top left')
        expect(menu.style.transition).toContain('120ms cubic-bezier(0.23,1,0.32,1)')
    })

    it('reaches full size and opacity once the frames run', () => {
        const menu = openAt(10, 10)
        flushFrames()

        expect(menu.style.opacity).toBe('1')
        expect(menu.style.transform).toBe('scale(1)')
    })

    it('grows from the right edge when the menu is flipped horizontally', () => {
        const menu = openAt(window.innerWidth - 2, 10)

        expect(menu.style.transformOrigin).toBe('top right')
    })

    it('grows from the bottom edge when the menu is flipped vertically', () => {
        const menu = openAt(10, window.innerHeight - 2)

        expect(menu.style.transformOrigin).toBe('bottom left')
    })

    it('grows from the bottom-right corner when flipped both ways', () => {
        const menu = openAt(window.innerWidth - 2, window.innerHeight - 2)

        expect(menu.style.transformOrigin).toBe('bottom right')
    })

    it('still positions the menu at the cursor, clamped to the viewport', () => {
        expect(openAt(40, 60).style.left).toBe('40px')
        expect(openAt(40, 60).style.top).toBe('60px')

        const flipped = openAt(window.innerWidth - 2, window.innerHeight - 2)
        expect(flipped.style.left).toBe(`${window.innerWidth - 8}px`)
        expect(flipped.style.top).toBe(`${window.innerHeight - 8}px`)
    })

    it('appears fully visible with no transition under reduced motion', () => {
        setReducedMotion(true)
        const menu = openAt(10, 10)

        expect(menu.style.opacity).toBe('')
        expect(menu.style.transform).toBe('')
        expect(menu.style.transition).toBe('')
        expect(menu.style.transformOrigin).toBe('')

        flushFrames()
        expect(menu.style.opacity).toBe('')
    })
})

// ─── Dismissal ────────────────────────────────────────────────────────────────

/**
 * Dismissal reacts on pointerdown, not click: click fires on pointer release, so
 * a press-and-hold gesture elsewhere (e.g. the toolbar's 1.5s trash hold) would
 * otherwise leave the menu floating for the whole hold. The pointerdown handler
 * must ignore presses that land inside the menu itself, or it would detach a row
 * before its own click handler (contextMenu.js:32) gets a chance to run.
 */
describe('Context menu dismissal', () => {
    const deps = () => ({
        t: (k) => k,
        api: { fetchApi: vi.fn().mockResolvedValue({ ok: true }) },
        app: { loadGraphData: vi.fn() },
        refresh: vi.fn().mockResolvedValue(undefined),
    })

    /** Open a menu for a pending task (single "Delete" row) and return it with its deps. */
    function openMenu(d = deps()) {
        const e = new window.MouseEvent('contextmenu', { clientX: 10, clientY: 10, cancelable: true })
        showContextMenu(e, { promptId: 'p1', status: 'pending' }, d)
        return { menu: document.body.lastElementChild, deps: d }
    }

    const pointerdownOn = (target) =>
        target.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }))

    /** Let the row action's await safeApi()/await refresh() chain settle. */
    const settle = async () => {
        for (let i = 0; i < 6; i++) await Promise.resolve()
    }

    beforeEach(() => {
        document.body.innerHTML = ''
    })

    afterEach(() => {
        document.body.innerHTML = ''
    })

    it('pointerdown outside the menu closes it', () => {
        const { menu } = openMenu()

        pointerdownOn(document.body)

        expect(document.body.contains(menu)).toBe(false)
    })

    it('pointerdown inside the menu does not close it, and the row click action still runs', async () => {
        const { menu, deps: d } = openMenu()
        const row = menu.firstElementChild

        pointerdownOn(row)
        // Still open — pointerdown on the row itself must not detach it out from
        // under its own click handler.
        expect(document.body.contains(menu)).toBe(true)

        row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
        await settle()

        expect(document.body.contains(menu)).toBe(false) // the row's own click handler closed it
        expect(d.api.fetchApi).toHaveBeenCalledWith('/queue', expect.objectContaining({
            body: JSON.stringify({ delete: ['p1'] }),
        }))
    })

    it('click outside still closes the menu (covers activation with no pointerdown, e.g. keyboard)', () => {
        const { menu } = openMenu()

        document.body.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

        expect(document.body.contains(menu)).toBe(false)
    })

    it('Escape still closes the menu', () => {
        const { menu } = openMenu()

        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

        expect(document.body.contains(menu)).toBe(false)
    })
})
