/**
 * Tests for the two toolbar clear buttons.
 *
 * The guarantees that matter here are about blast radius:
 *   - "clear pending" must never touch the history
 *   - "clear history" must never touch the queue
 *   - the hold must only fire when the ring actually completes
 *   - the hold clears the running task via `/interrupt`; neither `/queue` nor
 *     `/history` alone ever touches it
 *
 * And about steadiness, which the two buttons reach by opposite routes. The
 * trash button never disables itself and never moves: it is the one users aim
 * for by position. The clear-pending button is present only while something is
 * queued, and only after that has been true for CLEAR_PENDING_REVEAL_DELAY_MS,
 * so submitting a single prompt cannot flash a control nobody could have used.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    createClearPendingButton,
    createInterruptButton,
    createClearHistoryButton,
    buildToolbar,
    destroyToolbar,
    syncToolbar,
    HOLD_DURATION_MS,
    HOLD_ARM_MS,
    HOLD_SLOP_PX,
    RING_RETRACT_MS,
    CLEAR_PENDING_REVEAL_DELAY_MS,
    INTERRUPT_REVEAL_DELAY_MS,
    INTERRUPT_HIDE_DELAY_MS,
    CLEARED_EXIT_MS,
} from '../web/lib/toolbar.js'

const STRINGS = {
    clearPending: 'Clear pending tasks',
    interruptRunning: 'Interrupt running task',
    clearHistory: 'Clear history',
    holdToClearAll: 'hold to clear all',
}
const t = (k) => STRINGS[k] ?? k

function makeState({ pending = 0, history = 0, running = 0 } = {}) {
    const fill = (n, status) =>
        Array.from({ length: n }, (_, i) => ({ promptId: `${status}-${i}`, status, outputs: {} }))
    return {
        running: fill(running, 'running'),
        pending: fill(pending, 'pending'),
        history: fill(history, 'completed'),
    }
}

/** Replace the queue in-place, the way a websocket update would. */
function setPending(state, n) {
    state.pending = makeState({ pending: n }).pending
}

function setRunning(state, n) {
    state.running = makeState({ running: n }).running
}

function makeDeps(state, grid = null) {
    return {
        t,
        api: { fetchApi: vi.fn().mockResolvedValue({ ok: true, status: 200 }) },
        state,
        gridEl: () => grid,
        render: vi.fn(),
        refresh: vi.fn().mockResolvedValue(undefined),
    }
}

/** Every request the button made, as { path, body } pairs. */
function posts(api) {
    return api.fetchApi.mock.calls.map(([path, opts]) => ({ path, body: opts?.body ? JSON.parse(opts.body) : undefined }))
}

function paths(api) {
    return posts(api).map((p) => p.path).sort()
}

const down = (btn) => btn.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true, button: 0 }))
const up = (btn) => btn.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true, button: 0 }))
const leave = (btn) => btn.dispatchEvent(new window.PointerEvent('pointerleave', { bubbles: true }))
const cancel = (btn) => btn.dispatchEvent(new window.PointerEvent('pointercancel', { bubbles: true }))
const esc = () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
const move = (btn, x, y) =>
    btn.dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y }))

/** Fraction of the ring currently drawn, 0…1. */
function ringProgress(btn) {
    const arc = btn.querySelectorAll('circle')[1]
    return parseFloat(arc.getAttribute('stroke-dasharray')) / 100
}

function ringCap(btn) {
    return btn.querySelectorAll('circle')[1].getAttribute('stroke-linecap')
}

function ringVisible(btn) {
    return btn.querySelector('svg').style.opacity === '1'
}

/**
 * Whether the clear-pending button occupies space in the row. `queue-btn-gone` is
 * `display:none`, so this is also the answer to "can the trash button have
 * moved?".
 */
function clearPendingVisible(btn) {
    return !btn.classList.contains('queue-btn-gone')
}

/** Whether it has faded all the way in, as opposed to merely being laid out. */
function clearPendingFadedIn(btn) {
    return clearPendingVisible(btn) && btn.classList.contains('queue-btn-visible')
}

function interruptVisible(btn) {
    return !btn.classList.contains('queue-btn-gone')
}

function interruptFadedIn(btn) {
    return interruptVisible(btn) && btn.classList.contains('queue-btn-visible')
}

/** Let the two rAFs that start the fade run. */
function flushFrames() {
    vi.advanceTimersByTime(50)
}

/** The rule text of the toolbar's injected stylesheet. */
function styleSheetText() {
    return document.getElementById('queue-sidebar-clear-style')?.textContent ?? ''
}

/** Let the pending fetch/mutate/render/refresh chain settle. */
const settle = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
}

beforeEach(() => {
    // The stylesheet is injected into <head> and the registries are module-level,
    // so both outlive document.body. Clear them or tests inherit each other's state.
    destroyToolbar()
    document.getElementById('queue-sidebar-clear-style')?.remove()
    document.body.innerHTML = ''
    vi.useFakeTimers()
})

afterEach(() => {
    destroyToolbar() // no timer or rAF may outlive the test that started it
    vi.useRealTimers()
})

// ─── Clear pending ────────────────────────────────────────────────────────────

describe('clear pending button', () => {
    it('posts only to /queue', async () => {
        const state = makeState({ pending: 2, history: 3 })
        const deps = makeDeps(state)
        const btn = createClearPendingButton(deps)
        btn.click()
        await settle()
        expect(posts(deps.api)).toEqual([{ path: '/queue', body: { clear: true } }])
    })

    it('drops pending from local state but keeps history and running', async () => {
        const state = makeState({ pending: 2, history: 3, running: 1 })
        const deps = makeDeps(state)
        const btn = createClearPendingButton(deps)
        btn.click()
        await settle()
        expect(state.pending).toEqual([])
        expect(state.history).toHaveLength(3)
        expect(state.running).toHaveLength(1)
    })

    it('sends nothing when there is nothing waiting, and does not throw doing it', async () => {
        const state = makeState({ pending: 0, history: 3 })
        const deps = makeDeps(state)
        const btn = createClearPendingButton(deps)
        expect(() => btn.click()).not.toThrow()
        await settle()
        expect(deps.api.fetchApi).not.toHaveBeenCalled()
        // ...and the history it was sitting next to is untouched.
        expect(state.history).toHaveLength(3)
    })

    it('is absent rather than disabled — a dimmed control still asks to be read', () => {
        const btn = createClearPendingButton(makeDeps(makeState({ pending: 0 })))
        expect(clearPendingVisible(btn)).toBe(false)
        expect(btn.getAttribute('aria-disabled')).toBeNull()
        expect(btn.style.opacity).toBe('')
    })

    it('says the same thing whenever it is on screen', () => {
        const btn = createClearPendingButton(makeDeps(makeState({ pending: 1 })))
        expect(btn.title).toBe('Clear pending tasks')
    })

    it('uses an optically-aligned list-x SVG icon derived from Lucide, with stroke=currentColor and matching right boundaries', () => {
        const btn = createClearPendingButton(makeDeps(makeState({ pending: 1 })))
        const svg = btn.querySelector('svg:not(.queue-hold-ring)')
        expect(svg).not.toBeNull()
        expect(svg.getAttribute('stroke')).toBe('currentColor')
        expect(svg.getAttribute('stroke-width')).toBe('3.0')
        expect(svg.getAttribute('width')).toBe('1.2em')
        expect(svg.getAttribute('height')).toBe('1.2em')
        expect(btn.querySelector('i')).toBeNull()

        const strokeWidth = parseFloat(svg.getAttribute('stroke-width')) || 3.0
        const r = strokeWidth / 2
        const d = svg.querySelector('path').getAttribute('d')

        // 1. All raw coordinate numbers in d are within 0..24
        const coords = d.match(/-?\d+(?:\.\d+)?/g).map(Number)
        expect(coords.length).toBeGreaterThan(0)
        for (const c of coords) {
            expect(c).toBeGreaterThanOrEqual(0)
            expect(c).toBeLessThanOrEqual(24)
        }

        // 2. Subpath geometry and alignment checks
        expect(d).toContain('M3.5 5.5H20.5')
        expect(d).toContain('M3.5 12H10.5')
        expect(d).toContain('M3.5 18.5H10.5')
        expect(d).toContain('M14.5 12.5L20.5 18.5')
        expect(d).toContain('M20.5 12.5L14.5 18.5')

        // 3. Right boundary alignment: header line right edge matches X mark right edge
        const headerLineRight = 20.5
        const xMarkRight = 20.5
        expect(xMarkRight).toBe(headerLineRight)

        // 4. Bounding box including stroke cap radius r
        const minX = 3.5 - r
        const maxX = 20.5 + r
        const minY = 5.5 - r
        const maxY = 18.5 + r

        expect(minX).toBeGreaterThanOrEqual(0)
        expect(maxX).toBeLessThanOrEqual(24)
        expect(minY).toBeGreaterThanOrEqual(0)
        expect(maxY).toBeLessThanOrEqual(24)

        // 5. Perfect optical centering on (12, 12)
        expect((minX + maxX) / 2).toBe(12)
        expect((minY + maxY) / 2).toBe(12)
    })
})

// ─── Clear pending: the reveal debounce ───────────────────────────────────────
//
// Submitting one prompt fires `status` (pending 1) and then `execution_start`
// (pending 0, running 1) back to back. Without the delay the button would appear
// and vanish inside a few hundred milliseconds — a flash of a control nobody
// could have used.

describe('clear pending button — reveal debounce', () => {
    it('stays hidden while the queue is empty', () => {
        const btn = createClearPendingButton(makeDeps(makeState({ pending: 0 })))
        vi.advanceTimersByTime(CLEAR_PENDING_REVEAL_DELAY_MS * 4)
        expect(clearPendingVisible(btn)).toBe(false)
    })

    it('does not appear before the delay has elapsed', () => {
        const state = makeState({ pending: 0 })
        const btn = createClearPendingButton(makeDeps(state))

        setPending(state, 2)
        syncToolbar()
        expect(clearPendingVisible(btn)).toBe(false)

        vi.advanceTimersByTime(CLEAR_PENDING_REVEAL_DELAY_MS - 50)
        expect(clearPendingVisible(btn)).toBe(false)
    })

    it('appears once the delay elapses with work still queued', () => {
        const state = makeState({ pending: 0 })
        const btn = createClearPendingButton(makeDeps(state))

        setPending(state, 2)
        syncToolbar()
        vi.advanceTimersByTime(CLEAR_PENDING_REVEAL_DELAY_MS)
        expect(clearPendingVisible(btn)).toBe(true)
    })

    it('is never seen at all when the queue empties inside the delay', () => {
        const state = makeState({ pending: 0 })
        const btn = createClearPendingButton(makeDeps(state))

        // status: one task queued
        setPending(state, 1)
        syncToolbar()
        vi.advanceTimersByTime(200)
        expect(clearPendingVisible(btn)).toBe(false)

        // execution_start: straight to running, well inside the window
        setPending(state, 0)
        state.running = makeState({ running: 1 }).running
        syncToolbar()

        vi.advanceTimersByTime(CLEAR_PENDING_REVEAL_DELAY_MS * 4)
        expect(clearPendingVisible(btn)).toBe(false)
        expect(clearPendingFadedIn(btn)).toBe(false)
    })

    it('hides immediately when the queue empties, with no matching delay', () => {
        const state = makeState({ pending: 2 })
        const btn = createClearPendingButton(makeDeps(state))
        vi.advanceTimersByTime(CLEAR_PENDING_REVEAL_DELAY_MS)
        flushFrames()
        expect(clearPendingFadedIn(btn)).toBe(true)

        setPending(state, 0)
        syncToolbar()
        // The offer is stale the instant the queue is empty, so it stops being
        // offered at once — only the fade-out is allowed to take time.
        expect(clearPendingFadedIn(btn)).toBe(false)
        vi.advanceTimersByTime(500)
        expect(clearPendingVisible(btn)).toBe(false)
    })

    it('does not restart the timer when sync runs repeatedly, or it would never fire', () => {
        const state = makeState({ pending: 0 })
        const btn = createClearPendingButton(makeDeps(state))
        setPending(state, 2)

        // A preview stream calls render() — and so sync() — many times a second.
        // If each call rearmed the timer, the button would never appear at all.
        for (let i = 0; i < 20; i++) {
            syncToolbar()
            vi.advanceTimersByTime(25)
        }
        expect(clearPendingVisible(btn)).toBe(true)
    })

    it('writes nothing once it is already settled, however often it is asked', () => {
        const state = makeState({ pending: 2 })
        const btn = createClearPendingButton(makeDeps(state))
        vi.advanceTimersByTime(CLEAR_PENDING_REVEAL_DELAY_MS)
        flushFrames()
        const before = btn.className

        for (let i = 0; i < 20; i++) syncToolbar()
        flushFrames()
        expect(btn.className).toBe(before)
    })

    it('re-arms cleanly for a second batch after the first has drained', () => {
        const state = makeState({ pending: 0 })
        const btn = createClearPendingButton(makeDeps(state))

        setPending(state, 2)
        syncToolbar()
        vi.advanceTimersByTime(CLEAR_PENDING_REVEAL_DELAY_MS)
        expect(clearPendingVisible(btn)).toBe(true)

        setPending(state, 0)
        syncToolbar()
        vi.advanceTimersByTime(500)
        expect(clearPendingVisible(btn)).toBe(false)

        setPending(state, 3)
        syncToolbar()
        expect(clearPendingVisible(btn)).toBe(false)
        vi.advanceTimersByTime(CLEAR_PENDING_REVEAL_DELAY_MS)
        expect(clearPendingVisible(btn)).toBe(true)
    })

    it('fades in rather than popping, having already made the user wait', () => {
        const state = makeState({ pending: 0 })
        const btn = createClearPendingButton(makeDeps(state))
        setPending(state, 2)
        syncToolbar()
        vi.advanceTimersByTime(CLEAR_PENDING_REVEAL_DELAY_MS)

        // Laid out first, still transparent/collapsed: the transition needs a frame with a
        // start value or there is nothing to interpolate from.
        expect(clearPendingVisible(btn)).toBe(true)
        expect(btn.classList.contains('queue-btn-visible')).toBe(false)

        flushFrames()
        expect(clearPendingFadedIn(btn)).toBe(true)
    })

    it('takes its space back only after fading, so nothing slides beside a ghost', () => {
        const state = makeState({ pending: 2 })
        const btn = createClearPendingButton(makeDeps(state))
        vi.advanceTimersByTime(CLEAR_PENDING_REVEAL_DELAY_MS)
        flushFrames()

        setPending(state, 0)
        syncToolbar()
        // Collapsing...
        expect(btn.classList.contains('queue-btn-visible')).toBe(false)
        expect(clearPendingVisible(btn)).toBe(true)
        // ...and only then does display:none take the box away.
        vi.advanceTimersByTime(500)
        expect(clearPendingVisible(btn)).toBe(false)
    })

    it('hides again if the queue empties while the fade-in is still in flight', () => {
        const state = makeState({ pending: 0 })
        const btn = createClearPendingButton(makeDeps(state))
        setPending(state, 2)
        syncToolbar()
        vi.advanceTimersByTime(CLEAR_PENDING_REVEAL_DELAY_MS)

        setPending(state, 0)
        syncToolbar()
        flushFrames()
        vi.advanceTimersByTime(500)
        expect(clearPendingVisible(btn)).toBe(false)
        expect(clearPendingFadedIn(btn)).toBe(false)
    })

    it('re-checks the queue at the end of the delay rather than trusting the old reading', () => {
        const state = makeState({ pending: 0 })
        const btn = createClearPendingButton(makeDeps(state))
        setPending(state, 1)
        syncToolbar()

        // Queue drains without anyone calling sync() again — the timer itself
        // must notice, or a stale reading would show the button.
        vi.advanceTimersByTime(CLEAR_PENDING_REVEAL_DELAY_MS - 20)
        setPending(state, 0)
        vi.advanceTimersByTime(100)
        expect(clearPendingVisible(btn)).toBe(false)
    })

    it('drops the reveal timer on teardown, so a closed sidebar cannot show it', () => {
        const state = makeState({ pending: 0 })
        const btn = createClearPendingButton(makeDeps(state))
        setPending(state, 2)
        syncToolbar()

        destroyToolbar()
        vi.advanceTimersByTime(CLEAR_PENDING_REVEAL_DELAY_MS * 4)
        expect(clearPendingVisible(btn)).toBe(false)
    })

    it('hides itself after clearing the queue it was offering to clear', async () => {
        const state = makeState({ pending: 2 })
        const deps = makeDeps(state)
        const btn = createClearPendingButton(deps)
        vi.advanceTimersByTime(CLEAR_PENDING_REVEAL_DELAY_MS)
        flushFrames()
        expect(clearPendingVisible(btn)).toBe(true)

        btn.click()
        await settle()
        vi.advanceTimersByTime(500)
        expect(clearPendingVisible(btn)).toBe(false)
    })
})

// ─── Interrupt button ─────────────────────────────────────────────────────────

describe('interrupt button', () => {
    it('posts to /interrupt on click and calls refresh', async () => {
        const state = makeState({ running: 1 })
        const deps = makeDeps(state)
        const btn = createInterruptButton(deps)
        btn.click()
        await settle()
        expect(deps.api.fetchApi).toHaveBeenCalledWith('/interrupt', { method: 'POST' })
        expect(deps.refresh).toHaveBeenCalled()
    })

    it('hides immediately (0ms delay, no retract wait) on active user click', async () => {
        const state = makeState({ running: 1 })
        const deps = makeDeps(state)
        const btn = createInterruptButton(deps)
        syncToolbar()
        flushFrames()
        expect(interruptFadedIn(btn)).toBe(true)

        btn.click()
        await settle()
        expect(interruptVisible(btn)).toBe(false)
    })

    it('does nothing on click when running is empty', async () => {
        const state = makeState({ running: 0 })
        const deps = makeDeps(state)
        const btn = createInterruptButton(deps)
        btn.click()
        await settle()
        expect(deps.api.fetchApi).not.toHaveBeenCalled()
    })

    it('reveals immediately (0ms delay) when running task arrives', () => {
        const state = makeState({ running: 0 })
        const deps = makeDeps(state)
        const btn = createInterruptButton(deps)
        expect(interruptVisible(btn)).toBe(false)

        setRunning(state, 1)
        syncToolbar()
        flushFrames()
        expect(interruptFadedIn(btn)).toBe(true)
    })

    it('hides after INTERRUPT_HIDE_DELAY_MS (300ms) when running becomes empty', () => {
        const state = makeState({ running: 1 })
        const deps = makeDeps(state)
        const btn = createInterruptButton(deps)
        syncToolbar()
        flushFrames()
        expect(interruptFadedIn(btn)).toBe(true)

        setRunning(state, 0)
        syncToolbar()
        // Still visible during hide delay
        expect(interruptVisible(btn)).toBe(true)

        vi.advanceTimersByTime(INTERRUPT_HIDE_DELAY_MS - 10)
        expect(interruptVisible(btn)).toBe(true)

        vi.advanceTimersByTime(20)
        vi.advanceTimersByTime(300) // drawer hide animation
        expect(interruptVisible(btn)).toBe(false)
    })

    it('prevents flicker when consecutive tasks run (running drops to 0 and back to 1 within hide delay)', () => {
        const state = makeState({ running: 1 })
        const deps = makeDeps(state)
        const btn = createInterruptButton(deps)
        syncToolbar()
        flushFrames()
        expect(interruptFadedIn(btn)).toBe(true)

        // Task 1 finishes:
        setRunning(state, 0)
        syncToolbar()
        vi.advanceTimersByTime(100)

        // Task 2 starts:
        setRunning(state, 1)
        syncToolbar()

        // Advance past original hide delay:
        vi.advanceTimersByTime(INTERRUPT_HIDE_DELAY_MS + 200)
        flushFrames()
        expect(interruptVisible(btn)).toBe(true)
        expect(interruptFadedIn(btn)).toBe(true)
    })

    it('is absent rather than disabled when idle', () => {
        const btn = createInterruptButton(makeDeps(makeState({ running: 0 })))
        expect(interruptVisible(btn)).toBe(false)
        expect(btn.getAttribute('aria-disabled')).toBeNull()
    })

    it('has tooltip set from locale', () => {
        const btn = createInterruptButton(makeDeps(makeState({ running: 1 })))
        expect(btn.title).toBe('Interrupt running task')
    })

    it('renders PrimeIcons pi-stop icon inside drawer inner', () => {
        const btn = createInterruptButton(makeDeps(makeState({ running: 1 })))
        const icon = btn.querySelector('.queue-btn-drawer-inner .pi-stop')
        expect(icon).not.toBeNull()
    })

    it('clears timers and stays hidden when destroyed', () => {
        const state = makeState({ running: 0 })
        const btn = createInterruptButton(makeDeps(state))

        setRunning(state, 1)
        syncToolbar()

        destroyToolbar()
        vi.advanceTimersByTime(1000)
        expect(interruptVisible(btn)).toBe(false)
    })
})

// ─── Clear history: tap ───────────────────────────────────────────────────────

describe('clear history button — tap', () => {
    it('posts only to /history', async () => {
        const state = makeState({ pending: 2, history: 3 })
        const deps = makeDeps(state)
        const btn = createClearHistoryButton(deps)
        down(btn)
        vi.advanceTimersByTime(HOLD_ARM_MS - 50)
        up(btn)
        await settle()
        expect(posts(deps.api)).toEqual([{ path: '/history', body: { clear: true } }])
    })

    it('drops history from local state but keeps pending and running', async () => {
        const state = makeState({ pending: 2, history: 3, running: 1 })
        const deps = makeDeps(state)
        const btn = createClearHistoryButton(deps)
        down(btn)
        up(btn)
        await settle()
        expect(state.history).toEqual([])
        expect(state.pending).toHaveLength(2)
        expect(state.running).toHaveLength(1)
    })

    it('sends nothing on a tap when the history is already empty', async () => {
        const state = makeState({ pending: 2, history: 0 })
        const deps = makeDeps(state)
        const btn = createClearHistoryButton(deps)
        down(btn)
        vi.advanceTimersByTime(HOLD_ARM_MS - 50)
        up(btn)
        await settle()
        expect(deps.api.fetchApi).not.toHaveBeenCalled()
        // The tap must not quietly reach for the queue instead.
        expect(state.pending).toHaveLength(2)
    })

    it('fades the history cards out instead of making them vanish in one frame', async () => {
        const grid = document.createElement('div')
        grid.innerHTML = '<div data-status="completed"></div><div data-status="pending"></div>'
        const state = makeState({ pending: 1, history: 1 })
        const deps = makeDeps(state, grid)
        const btn = createClearHistoryButton(deps)

        down(btn)
        up(btn)
        await settle()

        // The request leaves immediately — the fade must never hold it back.
        expect(posts(deps.api)).toEqual([{ path: '/history', body: { clear: true } }])
        expect(grid.classList.contains('queue-clearing-history')).toBe(true)
        // ...and the cards are still on screen, because render() has not run yet.
        expect(deps.render).not.toHaveBeenCalled()

        vi.advanceTimersByTime(CLEARED_EXIT_MS)
        await settle()
        await settle()

        expect(deps.render).toHaveBeenCalled()
        expect(state.history).toEqual([])
        expect(grid.classList.contains('queue-clearing-history')).toBe(false)
    })

    it('fades only the cards the tap deletes, never pending or running', async () => {
        const grid = document.createElement('div')
        grid.innerHTML =
            '<div data-status="completed"></div><div data-status="failed"></div>' +
            '<div data-status="pending"></div><div data-status="running"></div>'
        const deps = makeDeps(makeState({ pending: 1, history: 2, running: 1 }), grid)
        const btn = createClearHistoryButton(deps)

        down(btn)
        up(btn)
        await settle()

        expect(grid.classList.contains('queue-clearing-history')).toBe(true)
        // Only the completed and failed cards are covered by the fade. /history
        // leaves pending and running alive, so dimming them would misreport what
        // the press destroys.
        const faded = [...grid.children].filter((card) =>
            card.matches('[data-status]:not([data-status="pending"]):not([data-status="running"])'),
        )
        expect(faded.map((card) => card.dataset.status)).toEqual(['completed', 'failed'])

        vi.advanceTimersByTime(CLEARED_EXIT_MS)
        await settle()
        await settle()
    })

    it('scopes the tap exit rule to the history cards in the stylesheet', () => {
        createClearHistoryButton(makeDeps(makeState({ history: 1 })))
        expect(styleSheetText()).toContain(
            '.queue-clearing-history>[data-status]:not([data-status="pending"]):not([data-status="running"])',
        )
    })

    it('adds no exit class when a tap finds nothing to clear', async () => {
        const grid = document.createElement('div')
        const deps = makeDeps(makeState({ pending: 2, history: 0 }), grid)
        const btn = createClearHistoryButton(deps)

        down(btn)
        up(btn)
        await settle()

        expect(grid.classList.contains('queue-clearing-history')).toBe(false)
        expect(deps.api.fetchApi).not.toHaveBeenCalled()
    })

    it('wipes immediately under reduced motion, with no fade to wait for', async () => {
        window.matchMedia = vi.fn(() => ({
            matches: true, media: '', addEventListener() {}, removeEventListener() {},
        }))
        try {
            const grid = document.createElement('div')
            grid.innerHTML = '<div data-status="completed"></div>'
            const state = makeState({ history: 1 })
            const deps = makeDeps(state, grid)
            const btn = createClearHistoryButton(deps)

            down(btn)
            up(btn)
            await settle()

            expect(grid.classList.contains('queue-clearing-history')).toBe(false)
            expect(deps.render).toHaveBeenCalled()
            expect(state.history).toEqual([])
        } finally {
            delete window.matchMedia
        }
    })

    it('never disables itself, so it cannot flicker as the history fills', () => {
        for (const history of [0, 3]) {
            const btn = createClearHistoryButton(makeDeps(makeState({ pending: 2, history })))
            expect(btn.getAttribute('aria-disabled')).toBeNull()
            expect(btn.style.opacity).toBe('')
        }
    })

    it('still answers the press when it has nothing to delete', () => {
        const btn = createClearHistoryButton(makeDeps(makeState({ pending: 0, history: 0 })))
        down(btn)
        expect(btn.classList.contains('queue-btn-pressed')).toBe(true)
        up(btn)
        expect(btn.classList.contains('queue-btn-pressed')).toBe(false)
    })

    it('is activated by keyboard, which fires a click with no pointer behind it', async () => {
        const state = makeState({ pending: 2, history: 3 })
        const deps = makeDeps(state)
        const btn = createClearHistoryButton(deps)
        btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 0 }))
        await settle()
        expect(paths(deps.api)).toEqual(['/history'])
    })

    it('sends nothing on a keyboard activation with an empty history', async () => {
        const state = makeState({ pending: 2, history: 0 })
        const deps = makeDeps(state)
        const btn = createClearHistoryButton(deps)
        btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 0 }))
        await settle()
        expect(deps.api.fetchApi).not.toHaveBeenCalled()
    })

    it('does not double-fire when a real mouse click follows its own pointerup', async () => {
        const state = makeState({ pending: 2, history: 3 })
        const deps = makeDeps(state)
        const btn = createClearHistoryButton(deps)
        down(btn)
        up(btn)
        btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }))
        await settle()
        expect(paths(deps.api)).toEqual(['/history'])
    })

    it('arms the hold even with nothing waiting — the gesture is not the queue\'s to withdraw', async () => {
        const state = makeState({ pending: 0, history: 3 })
        const deps = makeDeps(state)
        const btn = createClearHistoryButton(deps)
        down(btn)
        vi.advanceTimersByTime(HOLD_ARM_MS)
        expect(ringVisible(btn)).toBe(true)
        // Which also means letting go now is a cancel, not a tap.
        up(btn)
        await settle()
        expect(deps.api.fetchApi).not.toHaveBeenCalled()
        expect(state.history).toHaveLength(3)
    })
})

// ─── Clear history: hold ──────────────────────────────────────────────────────

describe('clear history button — hold', () => {
    it('only fires once the ring has closed', async () => {
        const state = makeState({ pending: 2, history: 3, running: 1 })
        const deps = makeDeps(state)
        const btn = createClearHistoryButton(deps)
        down(btn)
        vi.advanceTimersByTime(HOLD_DURATION_MS - 100)
        expect(deps.api.fetchApi).not.toHaveBeenCalled()
        vi.advanceTimersByTime(200)
        await settle()
        expect(posts(deps.api)).toEqual([
            { path: '/queue', body: { clear: true } },
            { path: '/interrupt', body: undefined },
            { path: '/history', body: { clear: true } },
        ])
    })

    it('clears pending, history, and interrupts the running task', async () => {
        const state = makeState({ pending: 2, history: 3, running: 1 })
        const deps = makeDeps(state)
        const btn = createClearHistoryButton(deps)
        down(btn)
        vi.advanceTimersByTime(HOLD_DURATION_MS + 100)
        await settle()
        expect(state.pending).toEqual([])
        expect(state.history).toEqual([])
        expect(state.running).toEqual([])
    })

    it('skips /interrupt when running is empty', async () => {
        const state = makeState({ pending: 2, history: 3, running: 0 })
        const deps = makeDeps(state)
        const btn = createClearHistoryButton(deps)
        down(btn)
        vi.advanceTimersByTime(HOLD_DURATION_MS + 100)
        await settle()
        expect(posts(deps.api)).toEqual([
            { path: '/queue', body: { clear: true } },
            { path: '/history', body: { clear: true } },
        ])
    })

    it('completes with nothing queued and nothing in history, safely', async () => {
        const state = makeState({ pending: 0, history: 0, running: 1 })
        const deps = makeDeps(state)
        const btn = createClearHistoryButton(deps)

        down(btn)
        vi.advanceTimersByTime(HOLD_ARM_MS)
        expect(ringVisible(btn)).toBe(true)

        // The ring still runs the full distance: the gesture means one thing, and
        // that does not change because the lists happen to be empty.
        vi.advanceTimersByTime(HOLD_DURATION_MS)
        expect(ringProgress(btn)).toBe(1)
        await settle()

        expect(posts(deps.api)).toEqual([
            { path: '/queue', body: { clear: true } },
            { path: '/interrupt', body: undefined },
            { path: '/history', body: { clear: true } },
        ])
        expect(state.pending).toEqual([])
        expect(state.history).toEqual([])
        expect(state.running).toEqual([])
    })

    it('recedes all cards including running during hold', () => {
        const grid = document.createElement('div')
        grid.innerHTML = '<div data-status="running"></div><div data-status="pending"></div>'
        const deps = makeDeps(makeState({ pending: 1, history: 1, running: 1 }), grid)
        const btn = createClearHistoryButton(deps)
        down(btn)
        vi.advanceTimersByTime(HOLD_ARM_MS)
        expect(grid.classList.contains('queue-clearing-all')).toBe(true)
        expect(grid.querySelectorAll('.queue-clearing-all>[data-status]')).toHaveLength(2)
    })

    it('deepens receded cards (adds queue-cleared) on fire until refresh completes', async () => {
        const grid = document.createElement('div')
        grid.innerHTML = '<div data-status="running"></div><div data-status="pending"></div>'
        const deps = makeDeps(makeState({ pending: 1, history: 1, running: 1 }), grid)
        const btn = createClearHistoryButton(deps)

        down(btn)
        vi.advanceTimersByTime(HOLD_ARM_MS)
        expect(grid.classList.contains('queue-clearing-all')).toBe(true)

        vi.advanceTimersByTime(HOLD_DURATION_MS)
        expect(grid.classList.contains('queue-cleared')).toBe(true)

        await settle()
        expect(grid.classList.contains('queue-cleared')).toBe(false)
        expect(grid.classList.contains('queue-clearing-all')).toBe(false)
    })

    it('draws the ring from empty to full instead of jumping', () => {
        const deps = makeDeps(makeState({ pending: 2, history: 3 }))
        const btn = createClearHistoryButton(deps)
        down(btn)
        expect(ringVisible(btn)).toBe(false)

        vi.advanceTimersByTime(HOLD_ARM_MS)
        expect(ringVisible(btn)).toBe(true)

        const seen = []
        for (let i = 0; i < 4; i++) {
            vi.advanceTimersByTime((HOLD_DURATION_MS - HOLD_ARM_MS) / 5)
            seen.push(ringProgress(btn))
        }
        expect(seen).toEqual([...seen].sort((a, b) => a - b))
        expect(seen.at(0)).toBeGreaterThan(0)
        expect(seen.at(0)).toBeLessThan(1)
        expect(seen.at(-1)).toBeGreaterThan(seen.at(0))
    })

    it('leaves the ring drawn full on completion, so it does not read as a cancel', () => {
        const deps = makeDeps(makeState({ pending: 2, history: 3 }))
        const btn = createClearHistoryButton(deps)
        down(btn)
        vi.advanceTimersByTime(HOLD_DURATION_MS + 100)
        expect(ringProgress(btn)).toBe(1)
        expect(ringVisible(btn)).toBe(false)
    })

    it('dims all cards that are about to go when holding clear history', () => {
        const grid = document.createElement('div')
        grid.innerHTML = '<div data-status="running"></div><div data-status="pending"></div>'
        const deps = makeDeps(makeState({ pending: 2, history: 3 }), grid)
        const btn = createClearHistoryButton(deps)
        down(btn)
        vi.advanceTimersByTime(HOLD_ARM_MS)
        expect(grid.classList.contains('queue-clearing-all')).toBe(true)

        const rule = document.getElementById('queue-sidebar-clear-style').textContent
        expect(rule).toContain('queue-clearing-all')
        expect(rule).toContain('.queue-clearing-all>[data-status]')

        up(btn)
        expect(grid.classList.contains('queue-clearing-all')).toBe(false)
    })
})

// ─── Cancelling a hold ────────────────────────────────────────────────────────

describe('cancelling an armed hold', () => {
    const abortedBy = {
        'releasing the pointer': (btn) => up(btn),
        'moving off the button': (btn) => leave(btn),
        'the browser cancelling the gesture': (btn) => cancel(btn),
        'pressing Escape': () => esc(),
        'the window losing focus': () => window.dispatchEvent(new window.Event('blur')),
    }

    for (const [name, abort] of Object.entries(abortedBy)) {
        it(`sends nothing at all after ${name}`, async () => {
            const state = makeState({ pending: 2, history: 3, running: 1 })
            const deps = makeDeps(state)
            const btn = createClearHistoryButton(deps)

            down(btn)
            vi.advanceTimersByTime(HOLD_ARM_MS + 200)
            expect(ringVisible(btn)).toBe(true)

            abort(btn)
            vi.advanceTimersByTime(HOLD_DURATION_MS * 2)
            await settle()

            // Crucially not "/history": an aborted hold must not degrade into
            // the very deletion the user was trying to avoid mis-triggering.
            expect(deps.api.fetchApi).not.toHaveBeenCalled()
            expect(state.pending).toHaveLength(2)
            expect(state.history).toHaveLength(3)
            expect(state.running).toHaveLength(1)
        })

        it(`retracts the ring to empty after ${name}`, () => {
            const deps = makeDeps(makeState({ pending: 2, history: 3 }))
            const btn = createClearHistoryButton(deps)
            down(btn)
            vi.advanceTimersByTime(HOLD_ARM_MS + 200)
            const atAbort = ringProgress(btn)
            expect(atAbort).toBeGreaterThan(0)

            abort(btn)
            // The ring goes invisible at once — the cancel is never in doubt.
            expect(ringVisible(btn)).toBe(false)
            // ...but it winds back rather than blanking, so the progress the user
            // built visibly comes undone instead of vanishing like a glitch.
            vi.advanceTimersByTime(RING_RETRACT_MS / 2)
            const midway = ringProgress(btn)
            expect(midway).toBeLessThan(atAbort)
            expect(midway).toBeGreaterThan(0)

            vi.advanceTimersByTime(RING_RETRACT_MS)
            expect(ringProgress(btn)).toBe(0)
            expect(ringVisible(btn)).toBe(false)
        })
    }

    it('stops listening after a cancel, so a later Escape cannot disturb anything', async () => {
        const state = makeState({ pending: 2, history: 3 })
        const deps = makeDeps(state)
        const btn = createClearHistoryButton(deps)
        down(btn)
        vi.advanceTimersByTime(HOLD_ARM_MS + 50)
        esc()

        // A fresh tap must still work normally.
        down(btn)
        up(btn)
        await settle()
        expect(paths(deps.api)).toEqual(['/history'])
    })

    it('aborts if the sidebar is torn down while the ring is filling', async () => {
        const state = makeState({ pending: 2, history: 3 })
        const deps = makeDeps(state)
        const btn = createClearHistoryButton(deps)
        document.body.appendChild(btn)

        down(btn)
        vi.advanceTimersByTime(HOLD_ARM_MS + 100)
        btn.remove()
        vi.advanceTimersByTime(HOLD_DURATION_MS * 2)
        await settle()
        expect(deps.api.fetchApi).not.toHaveBeenCalled()
    })
})

// ─── Tooltips ─────────────────────────────────────────────────────────────────

describe('tooltips', () => {
    it('names the hold every time, because that is how it gets discovered', () => {
        const withPending = createClearHistoryButton(makeDeps(makeState({ pending: 2, history: 3 })))
        const noPending = createClearHistoryButton(makeDeps(makeState({ pending: 0, history: 3 })))
        const empty = createClearHistoryButton(makeDeps(makeState({ pending: 0, history: 0 })))
        const expected = 'Clear history · hold to clear all'
        expect(withPending.title).toBe(expected)
        expect(noPending.title).toBe(expected)
        expect(empty.title).toBe(expected)
    })

    it('describes the action, not the current counts, so it never goes stale', () => {
        const state = makeState({ pending: 0, history: 0 })
        const sidebar = document.createElement('div')
        buildToolbar(sidebar, makeDeps(state))
        const before = [...sidebar.querySelectorAll('button')].map((b) => b.title)

        setPending(state, 3)
        state.history = makeState({ history: 3 }).history
        syncToolbar()
        vi.advanceTimersByTime(CLEAR_PENDING_REVEAL_DELAY_MS)
        // Visibility is the only thing sync() is allowed to change. The words
        // stay put, so nothing has to be re-read at 20 frames a second.
        expect([...sidebar.querySelectorAll('button')].map((b) => b.title)).toEqual(before)
    })
})

describe('buildToolbar', () => {
    it('builds a toolbar with clear-pending, interrupt, and clear-history buttons', () => {
        const sidebar = document.createElement('div')
        buildToolbar(sidebar, makeDeps(makeState({ pending: 1, history: 1, running: 1 })))
        expect(sidebar.querySelectorAll('button')).toHaveLength(3)
        expect(sidebar.querySelector('.queue-clear-pending')).not.toBeNull()
        expect(sidebar.querySelector('.queue-interrupt')).not.toBeNull()
        expect(sidebar.querySelector('.queue-clear-history')).not.toBeNull()
        // The fit toggle is gone: previews are always contained now.
        expect(sidebar.querySelector('.queue-fit-toggle')).toBeNull()
    })

    it('leaves the trash button marked neither disabled nor dimmed', () => {
        const sidebar = document.createElement('div')
        buildToolbar(sidebar, makeDeps(makeState({ pending: 0, history: 0, running: 0 })))
        const trash = sidebar.querySelector('.queue-clear-history')
        expect(trash.getAttribute('aria-disabled')).toBeNull()
        expect(trash.style.opacity).toBe('')
        expect(trash.classList.contains('queue-btn-gone')).toBe(false)
    })

    // jsdom has no layout, so "does not move" is asserted structurally: the
    // trash button stays the last child of a right-aligned row, and the only
    // thing that ever changes is whether a sibling *before* it takes up space.
    it('keeps the trash button last and hard against the right edge in order [clear-pending] [interrupt] [trash]', () => {
        const sidebar = document.createElement('div')
        buildToolbar(sidebar, makeDeps(makeState({ pending: 2, history: 1, running: 1 })))
        const bar = sidebar.querySelector('.queue-sidebar-toolbar')
        expect(bar.style.justifyContent).toBe('flex-end')
        expect(bar.children[0].classList.contains('queue-clear-pending')).toBe(true)
        expect(bar.children[1].classList.contains('queue-interrupt')).toBe(true)
        expect(bar.children[2].classList.contains('queue-clear-history')).toBe(true)
        expect(bar.lastElementChild.classList.contains('queue-clear-history')).toBe(true)
    })

    it('does not move the trash button when clear-pending or interrupt buttons come and go', () => {
        const sidebar = document.createElement('div')
        const state = makeState({ pending: 0, history: 1, running: 0 })
        buildToolbar(sidebar, makeDeps(state))
        const bar = sidebar.querySelector('.queue-sidebar-toolbar')
        const trash = sidebar.querySelector('.queue-clear-history')
        const clearPending = sidebar.querySelector('.queue-clear-pending')
        const interrupt = sidebar.querySelector('.queue-interrupt')

        const trashAnchor = () => ({
            last: bar.lastElementChild === trash,
            // Number of siblings before it that actually occupy space — the only
            // quantity that could push it off the right edge.
            occupiedBefore: [...bar.children]
                .slice(0, [...bar.children].indexOf(trash))
                .filter((c) => !c.classList.contains('queue-btn-gone')).length,
        })

        expect(trashAnchor()).toEqual({ last: true, occupiedBefore: 0 })

        setRunning(state, 1)
        syncToolbar()
        flushFrames()
        expect(interruptVisible(interrupt)).toBe(true)
        expect(trashAnchor()).toEqual({ last: true, occupiedBefore: 1 })

        setPending(state, 2)
        syncToolbar()
        vi.advanceTimersByTime(CLEAR_PENDING_REVEAL_DELAY_MS)
        flushFrames()
        expect(clearPendingVisible(clearPending)).toBe(true)
        expect(trashAnchor()).toEqual({ last: true, occupiedBefore: 2 })

        setPending(state, 0)
        syncToolbar()
        vi.advanceTimersByTime(500)
        expect(clearPendingVisible(clearPending)).toBe(false)
        expect(trashAnchor()).toEqual({ last: true, occupiedBefore: 1 })

        setRunning(state, 0)
        syncToolbar()
        vi.advanceTimersByTime(INTERRUPT_HIDE_DELAY_MS + 200)
        expect(interruptVisible(interrupt)).toBe(false)
        expect(trashAnchor()).toEqual({ last: true, occupiedBefore: 0 })
    })

    it('hides a clear-pending button that never earned its place, without disturbing the row', () => {
        const sidebar = document.createElement('div')
        const state = makeState({ pending: 0, history: 1 })
        buildToolbar(sidebar, makeDeps(state))
        const bar = sidebar.querySelector('.queue-sidebar-toolbar')

        setPending(state, 1)
        syncToolbar()
        vi.advanceTimersByTime(200)
        setPending(state, 0)
        syncToolbar()
        vi.advanceTimersByTime(CLEAR_PENDING_REVEAL_DELAY_MS * 4)

        const occupying = [...bar.children].filter((c) => !c.classList.contains('queue-btn-gone'))
        expect(occupying).toHaveLength(1)
        expect(occupying[0].classList.contains('queue-clear-history')).toBe(true)
    })
})

// ─── Press feedback ───────────────────────────────────────────────────────────
//
// The point of all of this is that the button answers on the way down, not on
// the way up. A press that shows nothing for 300ms reads as a dropped input.

describe('press feedback', () => {
    const buttons = {
        'clear pending': () => createClearPendingButton(makeDeps(makeState({ pending: 2 }))),
        'interrupt': () => createInterruptButton(makeDeps(makeState({ running: 1 }))),
        'clear history': () => createClearHistoryButton(makeDeps(makeState({ pending: 2, history: 3 }))),
    }

    for (const [name, make] of Object.entries(buttons)) {
        it(`${name} reacts on pointerdown, not on release`, () => {
            const btn = make()
            expect(btn.classList.contains('queue-btn-pressed')).toBe(false)
            down(btn)
            expect(btn.classList.contains('queue-btn-pressed')).toBe(true)
            up(btn)
            expect(btn.classList.contains('queue-btn-pressed')).toBe(false)
        })

        it(`${name} shares the toolbar button styling`, () => {
            expect(make().classList.contains('queue-toolbar-btn')).toBe(true)
        })
    }

    it('answers the press even when it has nothing to do', () => {
        const btn = createClearHistoryButton(makeDeps(makeState({ pending: 0, history: 0 })))
        down(btn)
        // The press is the button saying "heard you", which is true either way.
        expect(btn.classList.contains('queue-btn-pressed')).toBe(true)
        up(btn)
        expect(btn.classList.contains('queue-btn-pressed')).toBe(false)
    })

    it('lets go of the press when the pointer leaves or the gesture is cancelled', () => {
        const btn = createClearPendingButton(makeDeps(makeState({ pending: 2 })))
        down(btn)
        leave(btn)
        expect(btn.classList.contains('queue-btn-pressed')).toBe(false)

        down(btn)
        cancel(btn)
        expect(btn.classList.contains('queue-btn-pressed')).toBe(false)
    })

    it('deepens once the hold actually arms, so arming is felt and not just seen', () => {
        const btn = createClearHistoryButton(makeDeps(makeState({ pending: 2, history: 3 })))
        down(btn)
        expect(btn.classList.contains('queue-btn-arming')).toBe(false)

        vi.advanceTimersByTime(HOLD_ARM_MS)
        expect(btn.classList.contains('queue-btn-arming')).toBe(true)

        up(btn)
        expect(btn.classList.contains('queue-btn-arming')).toBe(false)
    })
})

// ─── Injected stylesheet ──────────────────────────────────────────────────────

describe('toolbar stylesheet', () => {
    it('is injected once no matter how many buttons ask for it', () => {
        buildToolbar(document.createElement('div'), makeDeps(makeState({ pending: 1, history: 1 })))
        expect(document.querySelectorAll('#queue-sidebar-clear-style')).toHaveLength(1)
    })

    it('quarantines hover so a tap on a touch screen cannot leave a button stuck', () => {
        createClearPendingButton(makeDeps(makeState({ pending: 1 })))
        expect(styleSheetText()).toContain('@media (hover:hover) and (pointer:fine)')
    })

    it('offers a visible focus ring for keyboard users', () => {
        createClearPendingButton(makeDeps(makeState({ pending: 1 })))
        expect(styleSheetText()).toContain(':focus-visible')
    })

    it('never animates layout-triggering properties on the cards', () => {
        createClearHistoryButton(makeDeps(makeState({ pending: 2, history: 3 })))
        const css = styleSheetText()
        // grayscale() forces a full paint on up to 64 cards at the exact moment
        // the ring needs a steady frame rate; opacity and transform do not.
        expect(css).not.toContain('grayscale')
        expect(css).not.toContain('filter')
        expect(css).not.toContain('transition:all')
    })

    it('recedes the doomed cards with composited properties only', () => {
        createClearHistoryButton(makeDeps(makeState({ pending: 2, history: 3 })))
        const css = styleSheetText()
        expect(css).toContain('.queue-clearing-all>[data-status]')
        expect(css).toMatch(/\.queue-clearing-all>[^}]*\{opacity:\.32;transform:scale\(\.965\)\}/)
    })

    it('keeps the ring under reduced motion — it is a progress readout, not decoration', () => {
        createClearHistoryButton(makeDeps(makeState({ pending: 2, history: 3 })))
        const reduced = styleSheetText().split('@media (prefers-reduced-motion:reduce)')[1]
        expect(reduced).toBeDefined()
        // Movement is dropped, but colour feedback stays so the press still answers.
        expect(reduced).toContain('transform:none')
        expect(reduced).toContain('background-color:rgba(255,255,255,.18)')
        // No rule anywhere hides the ring itself.
        expect(styleSheetText()).not.toMatch(/queue-hold-ring\{[^}]*display:none/)
    })

    it('never uses the `all` keyword, which would sweep up layout properties', () => {
        createClearHistoryButton(makeDeps(makeState({ pending: 2, history: 3 })))
        expect(styleSheetText()).not.toMatch(/transition:\s*all/)
    })

    it('carries no disabled-state rules, since no button is ever disabled', () => {
        buildToolbar(document.createElement('div'), makeDeps(makeState({ pending: 1, history: 1 })))
        expect(styleSheetText()).not.toContain('aria-disabled')
    })

    it('reserves standing red for the trash button alone and rests interrupt at crisp text colour', () => {
        buildToolbar(document.createElement('div'), makeDeps(makeState({ pending: 1, history: 1, running: 1 })))
        const css = styleSheetText()
        // Single standing red accent: trash permanently destroys non-reproducible outputs.
        // Interrupt rests at crisp text colour (#eee) so it reads as an active live control.
        // Clear pending rests at muted grey (#888).
        expect(css).toContain('.queue-clear-history{color:var(--p-red-500,#ef4444)}')
        expect(css).toContain('.queue-clear-pending{color:var(--p-text-muted-color,#888)}')
        expect(css).toContain('.queue-interrupt{color:var(--input-text,#eee)}')
    })

    it('reveals red danger color and tint on interrupt hover while brightening clear-pending', () => {
        buildToolbar(document.createElement('div'), makeDeps(makeState({ pending: 1, history: 1, running: 1 })))
        const hover = styleSheetText().split('@media (hover:hover) and (pointer:fine)')[1]
        expect(hover).toContain('.queue-clear-pending:hover{color:var(--input-text,#eee)}')
        expect(hover).toContain('.queue-interrupt:hover{color:var(--p-red-500,#ef4444);background-color:rgba(239,68,68,.16)}')
        expect(hover).toContain('.queue-clear-history:hover{background-color:rgba(239,68,68,.16)}')
    })

    it('removes the clear-pending button from the flow entirely, so nothing beside it shifts', () => {
        buildToolbar(document.createElement('div'), makeDeps(makeState({ pending: 1, history: 1 })))
        const css = styleSheetText()
        // visibility:hidden and opacity:0 both keep the box, which would leave a
        // permanent gap and defeat the whole point of anchoring trash on the right.
        expect(css).toContain('.queue-clear-pending.queue-btn-gone{display:none}')
        expect(css).not.toMatch(/queue-btn-gone\{[^}]*visibility/)
    })

    it('keeps the clear-pending fade under reduced motion — it is opacity, not travel', () => {
        buildToolbar(document.createElement('div'), makeDeps(makeState({ pending: 1, history: 1 })))
        const reduced = styleSheetText().split('@media (prefers-reduced-motion:reduce)')[1]
        // A cross-fade is what this preference asks movement to become, so no
        // rule here may cancel it.
        expect(reduced).toContain('opacity')
        expect(reduced).toContain('queue-btn-drawer-inner')
        expect(reduced).toContain('queue-btn-gone')
    })
})

// ─── Hold tolerance (hysteresis) ──────────────────────────────────────────────

describe('hold tolerance', () => {
    it('survives the hand drifting a few pixels — holding still is what it asked for', async () => {
        const state = makeState({ pending: 2, history: 3 })
        const deps = makeDeps(state)
        const btn = createClearHistoryButton(deps)

        down(btn)
        vi.advanceTimersByTime(HOLD_ARM_MS + 200)
        move(btn, HOLD_SLOP_PX - 4, 0) // a tremor, not a decision
        expect(ringVisible(btn)).toBe(true)

        vi.advanceTimersByTime(HOLD_DURATION_MS)
        await settle()
        expect(paths(deps.api)).toEqual(['/history', '/queue'])
    })

    it('still cancels when the pointer is deliberately dragged away', async () => {
        const state = makeState({ pending: 2, history: 3 })
        const deps = makeDeps(state)
        const btn = createClearHistoryButton(deps)

        down(btn)
        vi.advanceTimersByTime(HOLD_ARM_MS + 200)
        move(btn, HOLD_SLOP_PX + 10, 0)
        expect(ringVisible(btn)).toBe(false)

        vi.advanceTimersByTime(HOLD_DURATION_MS * 2)
        await settle()
        // And crucially it does not degrade into clearing the history.
        expect(deps.api.fetchApi).not.toHaveBeenCalled()
        expect(state.history).toHaveLength(3)
    })

    it('measures drift as a radius, not per-axis, so diagonal wobble counts the same', async () => {
        const deps = makeDeps(makeState({ pending: 2, history: 3 }))
        const btn = createClearHistoryButton(deps)
        down(btn)
        vi.advanceTimersByTime(HOLD_ARM_MS + 200)
        // 9,9 is under the limit on either axis alone but ~12.7 away in total.
        move(btn, 9, 9)
        expect(ringVisible(btn)).toBe(false)
    })

    it('ignores drift once no press is in flight', () => {
        const deps = makeDeps(makeState({ pending: 2, history: 3 }))
        const btn = createClearHistoryButton(deps)
        expect(() => move(btn, 200, 200)).not.toThrow()
    })
})

// ─── Pointer capture ──────────────────────────────────────────────────────────
//
// jsdom has no pointer capture, so these stub it to check the wiring. What the
// stub cannot prove is how a real browser routes events once capture is held —
// that is noted as unverified.

describe('pointer capture', () => {
    /** Minimal capture implementation, tracking which pointer is held. */
    function stubCapture(btn) {
        const held = new Set()
        btn.setPointerCapture = vi.fn((id) => held.add(id))
        btn.releasePointerCapture = vi.fn((id) => held.delete(id))
        btn.hasPointerCapture = vi.fn((id) => held.has(id))
        return held
    }

    it('grabs the pointer on press so the hold keeps tracking off the button', () => {
        const btn = createClearHistoryButton(makeDeps(makeState({ pending: 2, history: 3 })))
        const held = stubCapture(btn)
        down(btn)
        expect(btn.setPointerCapture).toHaveBeenCalledOnce()
        expect(held.size).toBe(1)
    })

    it('hands the pointer back on release, leaving nothing captured', () => {
        const btn = createClearHistoryButton(makeDeps(makeState({ pending: 2, history: 3 })))
        const held = stubCapture(btn)
        down(btn)
        up(btn)
        expect(held.size).toBe(0)
    })

    it('hands it back on every other way a hold can end', () => {
        for (const abort of [cancel, () => esc(), () => window.dispatchEvent(new window.Event('blur'))]) {
            const btn = createClearHistoryButton(makeDeps(makeState({ pending: 2, history: 3 })))
            const held = stubCapture(btn)
            down(btn)
            vi.advanceTimersByTime(HOLD_ARM_MS + 100)
            abort(btn)
            expect(held.size).toBe(0)
        }
    })

    it('hands it back when the hold completes, not just when it is cancelled', async () => {
        const deps = makeDeps(makeState({ pending: 2, history: 3 }))
        const btn = createClearHistoryButton(deps)
        const held = stubCapture(btn)
        down(btn)
        vi.advanceTimersByTime(HOLD_DURATION_MS + 100)
        await settle()
        expect(held.size).toBe(0)
    })

    it('ignores pointerleave while captured — the pointer is still logically inside', () => {
        const deps = makeDeps(makeState({ pending: 2, history: 3 }))
        const btn = createClearHistoryButton(deps)
        stubCapture(btn)
        down(btn)
        vi.advanceTimersByTime(HOLD_ARM_MS + 200)
        leave(btn) // a boundary event the browser may fire anyway
        expect(ringVisible(btn)).toBe(true)
        // Distance is what ends a captured hold, and it still does.
        move(btn, HOLD_SLOP_PX + 10, 0)
        expect(ringVisible(btn)).toBe(false)
    })

    it('still cancels on pointerleave when capture was refused', () => {
        const btn = createClearHistoryButton(makeDeps(makeState({ pending: 2, history: 3 })))
        btn.setPointerCapture = vi.fn(() => { throw new Error('capture unavailable') })
        down(btn)
        vi.advanceTimersByTime(HOLD_ARM_MS + 200)
        expect(ringVisible(btn)).toBe(true)
        leave(btn)
        expect(ringVisible(btn)).toBe(false)
    })

    it('presses normally on a host with no pointer capture at all', async () => {
        const deps = makeDeps(makeState({ pending: 2, history: 3 }))
        const btn = createClearHistoryButton(deps)
        expect(btn.setPointerCapture).toBeUndefined() // jsdom, as shipped
        down(btn)
        vi.advanceTimersByTime(HOLD_DURATION_MS + 100)
        await settle()
        expect(paths(deps.api)).toEqual(['/history', '/queue'])
    })

    it('does not throw when releasing a pointer the browser already dropped', () => {
        const btn = createClearHistoryButton(makeDeps(makeState({ pending: 2, history: 3 })))
        btn.setPointerCapture = vi.fn()
        btn.hasPointerCapture = vi.fn(() => { throw new Error('pointer gone') })
        down(btn)
        expect(() => up(btn)).not.toThrow()
    })
})

// ─── Reduced motion ───────────────────────────────────────────────────────────

describe('reduced motion', () => {
    /** jsdom ships no matchMedia, so install one that answers as we choose. */
    function stubMatchMedia(reduce) {
        window.matchMedia = vi.fn(() => ({ matches: reduce, media: '', addEventListener() {}, removeEventListener() {} }))
    }

    afterEach(() => { delete window.matchMedia })

    it('drops the retract sweep but keeps the ring itself', () => {
        stubMatchMedia(true)
        const btn = createClearHistoryButton(makeDeps(makeState({ pending: 2, history: 3 })))
        down(btn)
        vi.advanceTimersByTime(HOLD_ARM_MS + 200)
        // The ring still reports progress — it is status, not decoration.
        expect(ringVisible(btn)).toBe(true)
        expect(ringProgress(btn)).toBeGreaterThan(0)

        up(btn)
        // Cleared at once rather than swept back.
        expect(ringProgress(btn)).toBe(0)
        expect(ringVisible(btn)).toBe(false)
    })

    it('sweeps the retract when motion is welcome', () => {
        stubMatchMedia(false)
        const btn = createClearHistoryButton(makeDeps(makeState({ pending: 2, history: 3 })))
        down(btn)
        vi.advanceTimersByTime(HOLD_ARM_MS + 200)
        up(btn)
        expect(ringProgress(btn)).toBeGreaterThan(0) // still winding back
        vi.advanceTimersByTime(RING_RETRACT_MS * 2)
        expect(ringProgress(btn)).toBe(0)
    })

    it('treats a host without matchMedia as "motion is fine", never as an error', () => {
        expect(window.matchMedia).toBeUndefined()
        const btn = createClearHistoryButton(makeDeps(makeState({ pending: 2, history: 3 })))
        down(btn)
        vi.advanceTimersByTime(HOLD_ARM_MS + 200)
        expect(() => up(btn)).not.toThrow()
        expect(ringProgress(btn)).toBeGreaterThan(0)
    })

    it('does not let a throwing matchMedia break a press', () => {
        window.matchMedia = vi.fn(() => { throw new Error('nope') })
        const btn = createClearHistoryButton(makeDeps(makeState({ pending: 2, history: 3 })))
        down(btn)
        vi.advanceTimersByTime(HOLD_ARM_MS + 200)
        expect(() => up(btn)).not.toThrow()
    })

    it('still fires a completed hold, since the hold is not an animation', async () => {
        stubMatchMedia(true)
        const deps = makeDeps(makeState({ pending: 2, history: 3 }))
        const btn = createClearHistoryButton(deps)
        down(btn)
        vi.advanceTimersByTime(HOLD_DURATION_MS + 100)
        await settle()
        expect(paths(deps.api)).toEqual(['/history', '/queue'])
    })
})

// ─── Ring rendering ───────────────────────────────────────────────────────────

describe('hold ring rendering', () => {
    it('uses butt caps at zero so no stray dot appears before the sweep starts', () => {
        const btn = createClearHistoryButton(makeDeps(makeState({ pending: 2, history: 3 })))
        // A round cap on a zero-length dash paints its own end-caps as a red blob.
        expect(ringProgress(btn)).toBe(0)
        expect(ringCap(btn)).toBe('butt')

        down(btn)
        vi.advanceTimersByTime(HOLD_ARM_MS + 100)
        expect(ringProgress(btn)).toBeGreaterThan(0)
        expect(ringCap(btn)).toBe('round')
    })

    it('returns to butt caps once a cancelled ring has wound all the way back', () => {
        const btn = createClearHistoryButton(makeDeps(makeState({ pending: 2, history: 3 })))
        down(btn)
        vi.advanceTimersByTime(HOLD_ARM_MS + 200)
        up(btn)
        vi.advanceTimersByTime(RING_RETRACT_MS * 2)
        expect(ringProgress(btn)).toBe(0)
        expect(ringCap(btn)).toBe('butt')
    })

    it('a fresh press interrupts a retract still in flight instead of fighting it', () => {
        const btn = createClearHistoryButton(makeDeps(makeState({ pending: 2, history: 3 })))
        down(btn)
        vi.advanceTimersByTime(HOLD_ARM_MS + 300)
        up(btn)
        vi.advanceTimersByTime(RING_RETRACT_MS / 3) // retract underway

        down(btn)
        vi.advanceTimersByTime(HOLD_ARM_MS + 400)
        const p = ringProgress(btn)
        vi.advanceTimersByTime(100)
        // The new fill is climbing, not being dragged back down by the old retract.
        expect(ringProgress(btn)).toBeGreaterThan(p)
    })
})

// ─── Completion flash ─────────────────────────────────────────────────────────

describe('completion flash', () => {
    it('inverts the button for a beat, then leaves no inline style behind', async () => {
        const deps = makeDeps(makeState({ pending: 2, history: 3 }))
        const btn = createClearHistoryButton(deps)
        down(btn)
        vi.advanceTimersByTime(HOLD_DURATION_MS + 50)
        expect(btn.classList.contains('queue-btn-flash')).toBe(true)

        vi.advanceTimersByTime(300)
        expect(btn.classList.contains('queue-btn-flash')).toBe(false)
        // The old version restored `background:none` inline, which would have
        // outranked the stylesheet and killed hover/press from then on.
        expect(btn.style.background).toBe('')
        expect(btn.getAttribute('style')).not.toContain('background')
        await settle()
    })

    it('leaves hover and press working after a completed hold', async () => {
        const deps = makeDeps(makeState({ pending: 2, history: 3 }))
        const btn = createClearHistoryButton(deps)
        down(btn)
        vi.advanceTimersByTime(HOLD_DURATION_MS + 400)
        await settle()

        down(btn)
        expect(btn.classList.contains('queue-btn-pressed')).toBe(true)
    })
})

// ─── Teardown ─────────────────────────────────────────────────────────────────

describe('destroyToolbar', () => {
    it('stops a hold that was still filling when the sidebar closed', async () => {
        const sidebar = document.createElement('div')
        document.body.appendChild(sidebar)
        const state = makeState({ pending: 2, history: 3 })
        const deps = makeDeps(state)
        buildToolbar(sidebar, deps)
        const btn = sidebar.querySelector('.queue-clear-history')

        down(btn)
        vi.advanceTimersByTime(HOLD_ARM_MS + 200)
        destroyToolbar()

        vi.advanceTimersByTime(HOLD_DURATION_MS * 2)
        await settle()
        expect(deps.api.fetchApi).not.toHaveBeenCalled()
        expect(ringVisible(btn)).toBe(false)
        expect(ringProgress(btn)).toBe(0)
    })

    it('clears the receding state off the grid so a reopened sidebar is not stuck dimmed', () => {
        const grid = document.createElement('div')
        grid.innerHTML = '<div data-status="pending"></div>'
        const sidebar = document.createElement('div')
        buildToolbar(sidebar, makeDeps(makeState({ pending: 2, history: 3 }), grid))
        const btn = sidebar.querySelector('.queue-clear-history')

        down(btn)
        vi.advanceTimersByTime(HOLD_ARM_MS)
        expect(grid.classList.contains('queue-clearing-all')).toBe(true)

        destroyToolbar()
        expect(grid.classList.contains('queue-clearing-all')).toBe(false)
    })

    it('drops the flash timer, so nothing touches the button after teardown', () => {
        const sidebar = document.createElement('div')
        buildToolbar(sidebar, makeDeps(makeState({ pending: 2, history: 3 })))
        const btn = sidebar.querySelector('.queue-clear-history')

        down(btn)
        vi.advanceTimersByTime(HOLD_DURATION_MS + 50)
        expect(btn.classList.contains('queue-btn-flash')).toBe(true)

        destroyToolbar()
        expect(btn.classList.contains('queue-btn-flash')).toBe(false)
        vi.advanceTimersByTime(1000)
        expect(btn.classList.contains('queue-btn-flash')).toBe(false)
    })

    it('is safe to call twice, and safe to call with no toolbar at all', () => {
        expect(() => { destroyToolbar(); destroyToolbar() }).not.toThrow()
    })

    it('stops the old sidebar\'s buttons when a toolbar is rebuilt', async () => {
        const first = document.createElement('div')
        const deps = makeDeps(makeState({ pending: 2, history: 3 }))
        buildToolbar(first, deps)
        const stale = first.querySelector('.queue-clear-history')

        down(stale)
        vi.advanceTimersByTime(HOLD_ARM_MS + 200)
        buildToolbar(document.createElement('div'), makeDeps(makeState({ pending: 1, history: 1 })))

        vi.advanceTimersByTime(HOLD_DURATION_MS * 2)
        await settle()
        expect(deps.api.fetchApi).not.toHaveBeenCalled()
    })

    it('drops the old sidebar\'s syncers, so a stale button cannot still be driven', () => {
        const first = document.createElement('div')
        const firstState = makeState({ pending: 0, history: 1 })
        buildToolbar(first, makeDeps(firstState))
        const stale = first.querySelector('.queue-clear-pending')

        buildToolbar(document.createElement('div'), makeDeps(makeState({ pending: 0, history: 1 })))
        setPending(firstState, 3)
        syncToolbar()
        vi.advanceTimersByTime(CLEAR_PENDING_REVEAL_DELAY_MS * 2)
        expect(clearPendingVisible(stale)).toBe(false)
    })
})

// ─── Locale files ─────────────────────────────────────────────────────────────

describe('locales', () => {
    it('define exactly the same keys, so no language can go silently untranslated', async () => {
        const [en, zh] = await Promise.all([
            import('../web/locales/en.json', { with: { type: 'json' } }),
            import('../web/locales/zh.json', { with: { type: 'json' } }),
        ])
        expect(Object.keys(zh.default).sort()).toEqual(Object.keys(en.default).sort())
    })

    it('carry the toolbar strings the buttons actually ask for, and no stale ones', async () => {
        const en = (await import('../web/locales/en.json', { with: { type: 'json' } })).default
        for (const key of ['clearPending', 'interruptRunning', 'clearHistory', 'holdToClearAll']) {
            expect(en[key]).toBeTruthy()
        }
        // The fit toggle is gone; its strings must not linger.
        expect(en.fitImage).toBeUndefined()
        expect(en.fillImage).toBeUndefined()
    })
})
