import { TOOLBAR_BTN, STATUS_COLOR } from './constants.js'
import { el, safeApi, prefersReducedMotion } from './helpers.js'

// ─── Tunables ─────────────────────────────────────────────────────────────────

/**
 * Total press time, from pointerdown to "clear everything" firing.
 * The ring appears at HOLD_ARM_MS and fills over the remaining time, so this is
 * the single number to change if the hold feels too long or too twitchy.
 */
export const HOLD_DURATION_MS = 1500

/**
 * How long a press has to last before it stops being a tap and becomes a hold.
 * Under this, releasing is a plain click; over it, the ring is showing and
 * releasing cancels outright.
 */
export const HOLD_ARM_MS = 300

const RING_FILL_MS = HOLD_DURATION_MS - HOLD_ARM_MS

/**
 * How far the pointer may drift from where it landed before the hold is treated
 * as "the user moved away" rather than "the user's hand wobbled". Without this
 * a one-pixel tremor throws away a 1.5s press. Sized against the ~26px button:
 * anything past this is a deliberate move off it, not a wobble.
 */
export const HOLD_SLOP_PX = 12

/**
 * Cancelling is the system answering, so it is fast; the hold is the user
 * thinking, so it is slow. Same reason a released rubber band snaps back
 * quicker than it was pulled.
 */
export const RING_RETRACT_MS = 200
const RING_FADE_MS = 120
const PRESS_MS = 140
const FLASH_MS = 220

/**
 * How long cards take to leave once a wipe is committed. Shared by the hold's
 * clear-everything exit and the tap's clear-history exit, and read by JS as well
 * as the sheet: the wipe has to outlast the fade, or `render()` removes the cards
 * mid-transition and the abruptness comes straight back.
 */
export const CLEARED_EXIT_MS = 150

/**
 * How long a non-empty queue has to persist before the clear-pending button appears.
 *
 * Submitting a single prompt produces `status` (pending 1) and then
 * `execution_start` (pending 0, running 1) back to back, often inside a few
 * hundred milliseconds. Showing the button on the first of those and hiding it
 * on the second is a flash of a control nobody could have used — worse than not
 * offering it, because it draws the eye to something already gone.
 *
 * So the queue has to still be occupied when this elapses. There is deliberately
 * no matching delay on the way out: tasks finish seconds apart, so an empty queue
 * is never a transient, and a stale destructive control is worth more to remove
 * quickly than to remove smoothly.
 */
export const CLEAR_PENDING_REVEAL_DELAY_MS = 500

/**
 * Reveal delay for interrupt button.
 * Running tasks persist for seconds or minutes, so revealing the interrupt control
 * immediately (0ms delay) allows users to cancel runaway tasks without waiting.
 */
export const INTERRUPT_REVEAL_DELAY_MS = 0

/**
 * Hide delay for interrupt button.
 * Between back-to-back queued tasks, state updates can briefly drop `running` to 0
 * before the next `execution_start` event. A 300ms hide delay prevents the button
 * from flickering out and in during sequential batch processing.
 */
export const INTERRUPT_HIDE_DELAY_MS = 300

/**
 * Animation durations for the clear-pending button's drawer reveal/hide motion.
 * Revealing is the system presenting a new available action, so it is smooth and deliberate (240ms).
 * Hiding is the system clearing away a stale offer, so it is snappier (160ms).
 */
export const CLEAR_PENDING_REVEAL_MS = 240
export const CLEAR_PENDING_HIDE_MS = 160

/** Strong ease-out. The built-in keywords are too soft to read at these durations. */
const EASE_OUT = 'cubic-bezier(0.23,1,0.32,1)'

const DANGER = STATUS_COLOR.failed

// ─── Toolbar sync registry ────────────────────────────────────────────────────

// The toolbar is built once, but the clear-pending button only exists while
// something is queued, and the app re-renders from websocket events the toolbar
// never sees. render() calls syncToolbar() so that one piece of state stays
// honest without polling.
//
// Everything else on this toolbar is deliberately *not* in here. Labels describe
// what a button does rather than what is queued this second, so they are set once
// at build time. render() runs 5–20 times a second during a preview stream, and
// sync() has to stay cheap enough to be uninteresting at that rate — which it is,
// because it reads one number and usually returns having written nothing.
const syncers = new Set()

// Anything a button leaves running (timers, rAF loops, pointer capture) registers
// its own teardown here, so closing the sidebar cannot strand work against a
// node that is no longer on the page.
const teardowns = new Set()

export function syncToolbar() {
    for (const sync of syncers) sync()
}

/** Stop every button's in-flight work. Safe to call more than once. */
export function destroyToolbar() {
    for (const teardown of teardowns) teardown()
    teardowns.clear()
    syncers.clear()
}

// ─── Clear buttons ────────────────────────────────────────────────────────────

const CLEAR_STYLE_ID = 'queue-sidebar-clear-style'

/**
 * Every state a toolbar button can be in lives here rather than in inline
 * cssText, for one hard reason: inline styles outrank stylesheets, so an inline
 * `background:none` would make hover, press and flash unpaintable. Pseudo-classes
 * (`:hover`, `:active`, `:focus-visible`) and media queries cannot be expressed
 * inline at all. Geometry stays inline in TOOLBAR_BTN; state lives here.
 *
 * While the hold ring is filling, everything that is about to be deleted recedes
 * — so the answer to "how much am I destroying?" is the cards themselves, not a
 * number. Everything in the sidebar recedes (including any active running task, which is
 * interrupted as part of clearing all). The recede is opacity + scale only; both are composited,
 * so 64 cards can move at once without stealing frames from the ring that is filling right next to them.
 *
 * This rule is also what lets the trash button stay permanently enabled. It never
 * greys out when the history is empty — a control that flickers between live and
 * dead as tasks come and go is harder to read than one that simply always means
 * the same thing, and it is the one button whose position users navigate by. The
 * cost is a press that sometimes has nothing to delete, and the answer is right
 * here: hold with an empty queue and nothing recedes, because there was nothing
 * there. The grid reports the blast radius before the deletion happens, so
 * "nothing happened" is something the user watched, not something they have to
 * infer from silence.
 *
 * The clear-pending button takes the other route — present or absent, never
 * dimmed — because its whole subject is the queue, and a queue that is empty is
 * not a state it has anything to say about. See createClearPendingButton().
 */
function ensureToolbarStyle() {
    if (document.getElementById(CLEAR_STYLE_ID)) return
    const style = document.createElement('style')
    style.id = CLEAR_STYLE_ID
    style.textContent = [
        // Base. Named properties only — `all` would sweep up layout properties.
        `.queue-toolbar-btn{display:inline-flex;align-items:center;justify-content:center;` +
        `background-color:transparent;color:var(--input-text,#eee);` +
        `-webkit-tap-highlight-color:transparent;touch-action:manipulation;` +
        `transition:transform ${PRESS_MS}ms ${EASE_OUT},background-color ${PRESS_MS}ms ease-out,` +
        `color ${PRESS_MS}ms ease-out,opacity ${PRESS_MS}ms ease-out}`,

        // Hover is quarantined: on a touch screen a tap would otherwise leave the
        // button stuck looking hovered long after the finger is gone.
        //
        // Clear-pending brightens from muted to default text colour.
        // Trash carries standing red at rest and on hover. Interrupt rests at crisp
        // text colour (var(--input-text,#eee)) so it reads as an active live control,
        // revealing red danger colour + tint on hover before click.
        `@media (hover:hover) and (pointer:fine){` +
        `.queue-toolbar-btn:hover{background-color:rgba(255,255,255,.1)}` +
        `.queue-clear-pending:hover{color:var(--input-text,#eee)}` +
        `.queue-interrupt:hover{color:${DANGER};background-color:rgba(239,68,68,.16)}` +
        `.queue-clear-history:hover{background-color:rgba(239,68,68,.16)}}`,

        `.queue-toolbar-btn:focus-visible{outline:2px solid var(--p-primary-color,#3b82f6);outline-offset:2px}`,

        // Two depths, two meanings: "I felt that" the instant the pointer lands,
        // then a deeper seat the moment the hold actually arms.
        `.queue-toolbar-btn:active,.queue-toolbar-btn.queue-btn-pressed{transform:scale(.97)}`,
        `.queue-toolbar-btn.queue-btn-arming{transform:scale(.94)}`,

        // Single standing red accent: reserved for trash alone to signal permanent
        // destruction of generated results. Interrupt rests at crisp text colour (#eee)
        // as an active live control and reveals red on hover. Clear pending rests at muted grey.
        //
        // Lives in the sheet rather than inline so the flash can paint over it.
        `.queue-clear-history{color:${DANGER}}`,
        `.queue-clear-pending{color:var(--p-text-muted-color,#888)}`,
        `.queue-interrupt{color:var(--input-text,#eee)}`,

        // Same specificity as :hover but later in the sheet, so it wins.
        `.queue-toolbar-btn.queue-btn-flash{background-color:${DANGER};color:#fff}`,

        // Absent, not dimmed — and absent without occupying width, so the trash
        // button beside it never shifts. Spacing is handled on the conditional
        // buttons themselves (margin-right) so container gap never pushes trash when
        // conditional buttons are 0 width.
        `.queue-clear-pending,.queue-interrupt{width:26px;max-width:0;margin-right:0;opacity:0;overflow:hidden;` +
        `pointer-events:none;` +
        `transition:max-width ${CLEAR_PENDING_HIDE_MS}ms ${EASE_OUT},margin-right ${CLEAR_PENDING_HIDE_MS}ms ${EASE_OUT},` +
        `opacity ${CLEAR_PENDING_HIDE_MS}ms ${EASE_OUT},transform ${PRESS_MS}ms ${EASE_OUT},` +
        `background-color ${PRESS_MS}ms ease-out,color ${PRESS_MS}ms ease-out}`,

        `.queue-clear-pending.queue-btn-visible,.queue-interrupt.queue-btn-visible{max-width:26px;margin-right:2px;opacity:1;pointer-events:auto;` +
        `transition:max-width ${CLEAR_PENDING_REVEAL_MS}ms ${EASE_OUT},margin-right ${CLEAR_PENDING_REVEAL_MS}ms ${EASE_OUT},` +
        `opacity ${CLEAR_PENDING_REVEAL_MS}ms ${EASE_OUT},transform ${PRESS_MS}ms ${EASE_OUT},` +
        `background-color ${PRESS_MS}ms ease-out,color ${PRESS_MS}ms ease-out}`,

        `.queue-clear-pending.queue-btn-gone{display:none}`,
        `.queue-interrupt.queue-btn-gone{display:none}`,

        `.queue-btn-drawer-inner{display:inline-flex;align-items:center;justify-content:center;width:26px;height:100%;` +
        `transform:translateX(60%);transition:transform ${CLEAR_PENDING_HIDE_MS}ms ${EASE_OUT}}`,

        `.queue-btn-visible .queue-btn-drawer-inner{transform:translateX(0);` +
        `transition:transform ${CLEAR_PENDING_REVEAL_MS}ms ${EASE_OUT}}`,

        // Declared on every card, not just the receding ones, so restoring is as
        // smooth as leaving — a rule that only exists while the class is on would
        // snap back the instant it comes off.
        `.queue-sidebar-grid>[data-status]{` +
        `transition:opacity ${RING_RETRACT_MS}ms ${EASE_OUT},transform ${RING_RETRACT_MS}ms ${EASE_OUT}}`,
        `.queue-clearing-all>[data-status]{opacity:.32;transform:scale(.965)}`,
        // Two ways to leave, one look. The hold clears everything, so every card
        // goes. The tap clears only the history, so pending and running have to
        // stay solid — fading a card that survives the press would misreport what
        // is being deleted, which is the one thing the recede preview exists to
        // get right.
        `.queue-cleared>[data-status],` +
        `.queue-clearing-history>[data-status]:not([data-status="pending"]):not([data-status="running"])` +
        `{opacity:0;transform:scale(.94);` +
        `transition:opacity ${CLEARED_EXIT_MS}ms ${EASE_OUT},transform ${CLEARED_EXIT_MS}ms ${EASE_OUT}}`,

        // Reduced motion is not "no feedback" — it is the same information with
        // the travel taken out. Opacity and colour stay; displacement goes.
        //
        // The conditional buttons' fade survives here on purpose. It is an
        // opacity cross-fade with no movement in it, which is the very thing this
        // media query asks slides and springs to become — and the alternative, a
        // control popping into an otherwise still toolbar, is the more startling
        // of the two.
        //
        // The ring is deliberately absent from this block. It is a progress
        // readout, not decoration, and a destructive hold with nothing reporting
        // it would be far worse than any amount of movement. Its own fade is pure
        // opacity, which reduced motion has no quarrel with; what does get dropped
        // is the retract flourish, handled in JS where the preference is read.
        `@media (prefers-reduced-motion:reduce){` +
        `.queue-toolbar-btn{transition:background-color ${PRESS_MS}ms ease-out,` +
        `color ${PRESS_MS}ms ease-out,opacity ${PRESS_MS}ms ease-out}` +
        `.queue-toolbar-btn:active,.queue-toolbar-btn.queue-btn-pressed,` +
        `.queue-toolbar-btn.queue-btn-arming{transform:none;background-color:rgba(255,255,255,.18)}` +
        `.queue-sidebar-grid>[data-status]{transition:opacity ${RING_RETRACT_MS}ms ease-out}` +
        `.queue-clearing-all>[data-status]{transform:none}` +
        `.queue-cleared>[data-status],` +
        `.queue-clearing-history>[data-status]:not([data-status="pending"]):not([data-status="running"])` +
        `{opacity:0;transform:none;transition:opacity ${CLEARED_EXIT_MS}ms ease-out}` +
        `.queue-clear-pending,.queue-interrupt{max-width:26px!important;margin-right:2px!important;transition:opacity ${PRESS_MS}ms ease-out!important}` +
        `.queue-clear-pending.queue-btn-gone{display:none!important}` +
        `.queue-interrupt.queue-btn-gone{display:none!important}` +
        `.queue-btn-drawer-inner{transform:none!important;transition:none!important}}`,
    ].join('')
    document.head.appendChild(style)
}

const SVG_NS = 'http://www.w3.org/2000/svg'

function svg(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag)
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
    return node
}

// Copyright (c) 2026 Lucide Icons and Contributors
// ISC License — https://github.com/lucide-icons/lucide/blob/main/LICENSE
/**
 * Create the list-x SVG icon, optically aligned and derived from Lucide's `list-x`.
 * Arranged in a top-header / left-list / bottom-right-X layout (Motrix-style)
 * for 14px clarity. Uses `stroke="currentColor"` so hover and flash state styles
 * paint over the icon without inline color overrides.
 *
 * Note: When multiple subpaths are merged into a single `d` string, every subpath
 * MUST start with an absolute `M` command. A relative `m` following a previous path
 * segment is treated as a relative move from the end of that segment, which would offset
 * subsequent shapes out of the viewBox.
 */
function makeListXIcon() {
    const root = svg('svg', {
        viewBox: '0 0 24 24',
        width: '1.2em',
        height: '1.2em',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '3.0',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
    })
    root.style.cssText = 'display:block;flex-shrink:0'
    root.appendChild(svg('path', { d: 'M3.5 5.5H20.5M3.5 12H10.5M3.5 18.5H10.5M14.5 12.5L20.5 18.5M20.5 12.5L14.5 18.5' }))
    return root
}

/**
 * Progress ring drawn around a toolbar button.
 * `pathLength="100"` makes the dash maths plain percentages, and rotating the
 * circle -90° starts the sweep at twelve o'clock like a clock hand.
 *
 * Geometry note: the button is roughly 26px, so `inset:-3px` puts the ring in
 * the 2px gap between buttons. r=16 of a 36-unit box leaves 2 units of padding
 * each side, which is exactly the 2.5-wide stroke — so the stroke sits flush
 * against the viewBox edge and the ring reads as a hairline outline hugging the
 * button rather than a heavy collar around it.
 */
function makeRing() {
    const root = svg('svg', { viewBox: '0 0 36 36', 'aria-hidden': 'true' })
    root.setAttribute('class', 'queue-hold-ring')
    root.style.cssText =
        'position:absolute;inset:-3px;width:calc(100% + 6px);height:calc(100% + 6px);' +
        `pointer-events:none;opacity:0;transition:opacity ${RING_FADE_MS}ms ease-out`
    const shape = { cx: 18, cy: 18, r: 16, fill: 'none', pathLength: 100, transform: 'rotate(-90 18 18)' }
    const track = svg('circle', { ...shape, stroke: DANGER, 'stroke-width': 2.5, opacity: 0.2 })
    const arc = svg('circle', {
        ...shape,
        stroke: DANGER,
        'stroke-width': 2.5,
        'stroke-linecap': 'round',
        'stroke-dasharray': '0 100',
    })
    // A round cap on a zero-length dash still paints its two end-caps, which meet
    // as a red dot at twelve o'clock — a blob that flickers into view before the
    // ring has started. Butt caps have no such artifact, so the cap only becomes
    // round once there is actual arc for it to round off.
    const setCap = (p) => arc.setAttribute('stroke-linecap', p > 0 ? 'round' : 'butt')
    setCap(0)
    root.append(track, arc)

    let retractId = null
    const stopRetract = () => {
        if (retractId !== null) cancelAnimationFrame(retractId)
        retractId = null
    }
    const set = (p) => {
        stopRetract()
        setCap(p)
        arc.setAttribute('stroke-dasharray', `${p * 100} 100`)
    }
    // Raw value, so a retract in flight can read where it actually is.
    const current = () => parseFloat(arc.getAttribute('stroke-dasharray')) / 100 || 0

    return {
        root,
        set,
        show: () => { root.style.opacity = '1' },
        /**
         * Cancel: wind the arc back instead of blanking it. The user pressed for
         * up to 1.2s, so the progress is a thing they built — snapping it to zero
         * reads as a glitch, while watching it retract reads as "undone". Fast
         * (200ms) and ease-out, because this is the system replying, not the user
         * deliberating.
         *
         * On completion (`collapse` false) the ring fades out still full —
         * collapsing it to zero would read as "cancelled", the opposite of what
         * happened.
         */
        hide: (collapse = true) => {
            root.style.opacity = '0'
            stopRetract()
            if (!collapse) return
            const from = current()
            // Reduced motion keeps the ring — it is a progress readout, and a
            // destructive hold with nothing reporting it would be worse than any
            // amount of movement. What goes is the retract flourish: the fade
            // alone already says "cancelled", without the sweep.
            if (from <= 0 || prefersReducedMotion()) { set(0); return }
            const startedAt = performance.now()
            const step = () => {
                const k = Math.min(1, (performance.now() - startedAt) / RING_RETRACT_MS)
                // cubic ease-out, the JS twin of the CSS curve used elsewhere
                const eased = 1 - Math.pow(1 - k, 3)
                setCap(from * (1 - eased))
                arc.setAttribute('stroke-dasharray', `${from * (1 - eased) * 100} 100`)
                if (k >= 1) { retractId = null; setCap(0); return }
                retractId = requestAnimationFrame(step)
            }
            step()
        },
        /** Kill any in-flight retract and blank the arc, for teardown. */
        stop: () => { stopRetract(); setCap(0); arc.setAttribute('stroke-dasharray', '0 100') },
    }
}

/**
 * Opt a button into the shared hover / press / focus rules.
 * Called by every toolbar button so the three of them feel identical under the
 * finger, which is the whole point of them sitting in a row.
 */
function styleToolbarButton(btn, ...extra) {
    ensureToolbarStyle()
    btn.className = ['queue-toolbar-btn', ...extra].join(' ')
}

/**
 * Press-down feedback, applied on `pointerdown` rather than on click.
 *
 * `:active` already covers the common case, but it is not enough on its own: as
 * soon as this button takes pointer capture, or the pointer strays a few pixels,
 * the browser drops `:active` and the button silently pops back to full size
 * while the finger is still down. The class is ours, so it stays put until we
 * say otherwise.
 *
 * There is no "but is this button useful right now?" check here. Press feedback
 * answers the question "did you hear me?", which is true regardless of whether
 * the press ends up deleting anything.
 *
 * @returns {{press: () => void, clear: () => void}} manual control over the state
 */
function addPressFeedback(btn) {
    const press = () => btn.classList.add('queue-btn-pressed')
    const clear = () => btn.classList.remove('queue-btn-pressed')
    btn.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return
        press()
    })
    // A press can end in more ways than it can begin; all of them must let go.
    for (const type of ['pointerup', 'pointercancel', 'pointerleave', 'blur']) {
        btn.addEventListener(type, clear)
    }
    return { press, clear }
}

/**
 * POST /queue {clear:true} wipes only the waiting queue, POST /history
 * {clear:true} only the history. Neither touches the running task, so
 * `state.running` is never reset here.
 */
function makeWiper(deps) {
    const { api, state, render, refresh } = deps
    const post = (path) => safeApi(api, path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clear: true }),
    })
    // render() reconciles by key, so dropping the tasks from state is enough to
    // make exactly the matching cards disappear.
    //
    // `exit` is an optional card-leaving animation. It starts in the same tick as
    // the requests rather than ahead of them — a destructive action must never
    // queue behind its own animation — and the removal waits for whichever settles
    // last, so a fast localhost reply cannot yank the cards out mid-fade.
    return async (paths, mutate, exit) => {
        const leaving = exit ? exit() : null
        await Promise.all([...paths.map(post), leaving])
        mutate()
        render()
        await refresh()
    }
}

/**
 * Generic helper for conditional drawer buttons that slide in from the left (width 0 -> 26px).
 * Shared by createClearPendingButton and createInterruptButton.
 */
function createDrawerButton(deps, { extraClass, title, innerContent, condition, revealDelayMs = 0, hideDelayMs = 0, onClick }) {
    const btn = el('button', TOOLBAR_BTN)
    styleToolbarButton(btn, extraClass)
    addPressFeedback(btn)

    const inner = el('span', 'width:100%;height:100%;display:inline-flex;align-items:center;justify-content:center')
    inner.className = 'queue-btn-drawer-inner'
    if (typeof innerContent === 'string') {
        inner.innerHTML = innerContent
    } else if (innerContent instanceof Node) {
        inner.appendChild(innerContent)
    }
    btn.appendChild(inner)

    btn.title = title
    btn.classList.add('queue-btn-gone')

    let shown = false
    let revealTimer = null
    let hideTimer = null
    let fadeTimer = null

    const cancelReveal = () => {
        if (revealTimer !== null) {
            clearTimeout(revealTimer)
            revealTimer = null
        }
    }

    const cancelHideDelay = () => {
        if (hideTimer !== null) {
            clearTimeout(hideTimer)
            hideTimer = null
        }
    }

    const show = () => {
        shown = true
        cancelHideDelay()
        if (fadeTimer !== null) {
            clearTimeout(fadeTimer)
            fadeTimer = null
        }
        btn.classList.remove('queue-btn-gone')
        // Two frames, not one. Removing `display:none` and the starting drawer state in
        // the same frame gives the browser nothing to interpolate from.
        // The first rAF lets layout happen; the second starts the drawer transition.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (shown) btn.classList.add('queue-btn-visible')
        }))
    }

    /**
     * Active hide (user-initiated click): hides the button immediately with zero delay
     * and zero animation, applying `queue-btn-gone` (display:none) right away.
     *
     * Rationale for instant removal vs drawer retract:
     * When the user explicitly clicks an action button (e.g. clear pending or interrupt), they expect
     * instant feedback that their command was registered. Retracting via drawer animation
     * after an active click feels sluggish. Because conditional buttons sit to the left of the
     * pinned trash button, instant removal simply collapses the row leftward without shifting
     * the trash button's position.
     */
    const hideImmediately = () => {
        shown = false
        cancelReveal()
        cancelHideDelay()
        if (fadeTimer !== null) {
            clearTimeout(fadeTimer)
            fadeTimer = null
        }
        btn.classList.remove('queue-btn-visible')
        btn.classList.add('queue-btn-gone')
    }

    const hide = () => {
        shown = false
        cancelReveal()
        cancelHideDelay()
        btn.classList.remove('queue-btn-visible')
        if (fadeTimer !== null) {
            clearTimeout(fadeTimer)
        }
        fadeTimer = setTimeout(() => {
            fadeTimer = null
            if (!shown) btn.classList.add('queue-btn-gone')
        }, CLEAR_PENDING_HIDE_MS)
    }

    /**
     * Idempotent by construction: every branch is guarded on a state that is
     * already true, so repeated calls write nothing and never restart timers.
     */
    const sync = () => {
        const active = condition()
        if (!active) {
            cancelReveal()
            if (!shown) {
                cancelHideDelay()
                return
            }
            if (hideDelayMs > 0) {
                if (hideTimer === null) {
                    hideTimer = setTimeout(() => {
                        hideTimer = null
                        if (!condition()) hide()
                    }, hideDelayMs)
                }
            } else {
                hide()
            }
            return
        }

        cancelHideDelay()
        if (shown || revealTimer !== null) return

        if (revealDelayMs > 0) {
            revealTimer = setTimeout(() => {
                revealTimer = null
                if (condition()) show()
            }, revealDelayMs)
        } else {
            show()
        }
    }

    sync()
    syncers.add(sync)

    btn.addEventListener('click', (ev) => {
        if (!condition()) return
        onClick(ev, hideImmediately, sync)
    })

    btn.destroy = () => {
        cancelReveal()
        cancelHideDelay()
        if (fadeTimer !== null) {
            clearTimeout(fadeTimer)
            fadeTimer = null
        }
        shown = false
        btn.classList.remove('queue-btn-visible')
        btn.classList.add('queue-btn-gone')
        syncers.delete(sync)
    }
    teardowns.add(btn.destroy)

    return btn
}

/**
 * Button one: drop everything still waiting in the queue. Single click, no
 * confirmation — the queue is a plan, not a result, and it is cheap to rebuild.
 *
 * Uses a list-x SVG icon (derived from Lucide Icons, ISC license). The icon reads
 * as "cancel queued list", completely distinct from pi-stop-circle on running
 * tasks and pi-ban on cancelled tasks.
 *
 * The button is present or absent, never dimmed. Its entire subject is the queue,
 * so an empty queue leaves it with nothing to be about — and a disabled control
 * still asks to be read and dismissed every time the eye passes it. Absent costs
 * nothing to ignore. It sits to the *left* of the trash button so that appearing
 * and disappearing grows and shrinks the row leftwards, leaving the trash button
 * pinned to the right edge where users aim for it.
 *
 * @param {object} deps - { t, api, state, gridEl, render, refresh }
 */
export function createClearPendingButton(deps) {
    const { t, state } = deps
    const wipe = makeWiper(deps)
    return createDrawerButton(deps, {
        extraClass: 'queue-clear-pending',
        title: t('clearPending'),
        innerContent: makeListXIcon(),
        condition: () => state.pending.length > 0,
        revealDelayMs: CLEAR_PENDING_REVEAL_DELAY_MS,
        hideDelayMs: 0,
        onClick: (_ev, hideImmediately, sync) => {
            wipe(['/queue'], () => { state.pending = [] }).then(() => {
                hideImmediately()
                sync()
            })
        },
    })
}

/**
 * Button two: interrupt the currently running task. Single click, no confirmation.
 * Uses PrimeIcons pi-stop icon. Crisp text colour at rest (active live control),
 * reveals red danger colour on hover. Present only when state.running is non-empty.
 *
 * @param {object} deps - { t, api, state, refresh }
 */
export function createInterruptButton(deps) {
    const { t, api, state, refresh } = deps
    return createDrawerButton(deps, {
        extraClass: 'queue-interrupt',
        title: t('interruptRunning'),
        innerContent: '<i class="pi pi-stop"></i>',
        condition: () => state.running.length > 0,
        revealDelayMs: INTERRUPT_REVEAL_DELAY_MS,
        hideDelayMs: INTERRUPT_HIDE_DELAY_MS,
        onClick: (_ev, hideImmediately, sync) => {
            safeApi(api, '/interrupt', { method: 'POST' }).then(() => {
                state.running = []
                return refresh()
            }).then(() => {
                hideImmediately()
                sync()
            })
        },
    })
}

/**
 * Button three: clear the history on a click, or clear everything (pending, running,
 * history) by holding until the ring closes.
 *
 * Both gestures are always available. The hold in particular has one meaning and
 * only one — "stop everything and wipe the sidebar" — which stays true
 * whether or not there is anything right now. A gesture that is
 * sometimes offered and sometimes not is a gesture users stop reaching for.
 *
 * The hold deliberately does not degrade: once the ring is up, letting go early
 * does nothing at all. Falling back to "clear history" there would punish the
 * exact user who changed their mind mid-press.
 * @param {object} deps - { t, api, state, gridEl, render, refresh }
 */
export function createClearHistoryButton(deps) {
    const { t, state, gridEl } = deps
    const wipe = makeWiper(deps)

    /**
     * The tap: drop the history and let those cards leave rather than vanish.
     *
     * Membership is decided by a class on the grid instead of by touching each
     * card, so the stylesheet selector is the single place that says who goes —
     * and it excludes pending and running on purpose, because `POST /history`
     * leaves them alive. Reduced motion skips the fade and the wait; the wipe
     * itself is identical either way.
     */
    const clearHistory = () => {
        const grid = gridEl()
        const exit = grid && !prefersReducedMotion()
            ? () => {
                grid.classList.add('queue-clearing-history')
                return new Promise((resolve) => setTimeout(resolve, CLEARED_EXIT_MS))
            }
            : undefined
        return wipe(['/history'], () => { state.history = [] }, exit)
            .finally(() => grid?.classList.remove('queue-clearing-history'))
    }

    const btn = el('button', TOOLBAR_BTN + ';position:relative')
    styleToolbarButton(btn, 'queue-clear-history')
    const press = addPressFeedback(btn)
    const clearPress = press.clear
    btn.innerHTML = '<i class="pi pi-trash"></i>'
    const ring = makeRing()
    btn.appendChild(ring.root)

    // One label for both gestures, set once. Naming the hold unconditionally is
    // the point: it is how the gesture gets discovered at all, and it is never a
    // lie, because the hold always runs.
    btn.title = `${t('clearHistory')} · ${t('holdToClearAll')}`

    let armTimer = null
    let rafId = null
    let pressed = false
    let armed = false
    let flashTimer = null
    let wasMounted = false
    // Where the press landed, and which pointer owns it. Both null when idle.
    let origin = null
    let capturedId = null

    const onKey = (ev) => { if (ev.key === 'Escape') reset() }
    const onBlur = () => reset()

    /**
     * Hand the pointer back. Guarded on three counts: the API may be missing
     * (jsdom), the pointer may already be gone, and releasing one we never
     * captured throws. None of those are worth failing a reset over.
     */
    function releaseCapture() {
        if (capturedId === null) return
        try {
            if (btn.hasPointerCapture?.(capturedId)) btn.releasePointerCapture(capturedId)
        } catch { /* pointer already gone */ }
        capturedId = null
    }

    function reset(collapseRing = true) {
        clearTimeout(armTimer)
        cancelAnimationFrame(rafId)
        armTimer = null
        rafId = null
        pressed = false
        armed = false
        origin = null
        releaseCapture()
        clearPress()
        btn.classList.remove('queue-btn-arming')
        ring.hide(collapseRing)
        if (collapseRing) {
            gridEl()?.classList.remove('queue-clearing-all', 'queue-cleared')
        }
        window.removeEventListener('blur', onBlur)
        document.removeEventListener('keydown', onKey, true)
    }

    function arm() {
        armed = true
        // Seat the button deeper the instant the hold takes. Together with the
        // ring appearing, this is the moment the press stops being a tap — and it
        // should be felt, not just seen.
        btn.classList.add('queue-btn-arming')
        ring.show()
        gridEl()?.classList.add('queue-clearing-all')
        const startedAt = performance.now()
        const step = () => {
            // The sidebar can be destroyed mid-hold. Only treat detachment as an
            // abort if the button was actually mounted when the press started —
            // otherwise a never-mounted button could never complete a hold.
            if (wasMounted && !btn.isConnected) { reset(); return }
            const p = Math.min(1, (performance.now() - startedAt) / RING_FILL_MS)
            ring.set(p)
            if (p >= 1) { fire(); return }
            rafId = requestAnimationFrame(step)
        }
        rafId = requestAnimationFrame(step)
    }

    /**
     * Invert the button for a beat so the completion reads as "the ring closed",
     * not "I let go". Short and non-blocking — the requests go out first.
     *
     * Driven by a class rather than inline styles. The old version wrote
     * `btn.style.background` and then restored it to the literal `'none'`, which
     * left an inline declaration permanently outranking the stylesheet — hover
     * and press would have been dead on this button from the first hold onwards.
     * Removing a class leaves nothing behind, and the base rule's transition
     * carries both the flash in and the fade out.
     */
    function flash() {
        btn.classList.add('queue-btn-flash')
        clearTimeout(flashTimer)
        flashTimer = setTimeout(() => {
            btn.classList.remove('queue-btn-flash')
            flashTimer = null
        }, FLASH_MS)
    }

    async function fire() {
        const grid = gridEl()
        reset(false) // leave the ring drawn full while it fades
        flash()

        // Deepen cards (opacity: 0, scale: .94) on fire so they do not snap back to full opacity before refresh
        grid?.classList.add('queue-cleared')

        const postClear = (path) => safeApi(deps.api, path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clear: true }),
        })

        try {
            // Sequence: 1. POST /queue {clear:true} -> 2. POST /interrupt (if running) -> 3. POST /history {clear:true}
            await postClear('/queue')
            if (state.running.length > 0) {
                await safeApi(deps.api, '/interrupt', { method: 'POST' })
            }
            await postClear('/history')

            state.pending = []
            state.running = []
            state.history = []

            deps.render()
            await deps.refresh()
        } finally {
            grid?.classList.remove('queue-clearing-all', 'queue-cleared')
        }
    }

    btn.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return
        reset()
        // reset() wipes the press state that the shared handler just set, and the
        // listener order between them is not something to rely on. Re-assert it:
        // the whole point is that the button answers on the way down.
        press.press()
        pressed = true
        wasMounted = btn.isConnected
        origin = { x: ev.clientX, y: ev.clientY }
        // Keep receiving moves once the pointer wanders off the 26px button.
        // Without this the browser retargets to whatever is underneath and the
        // hold goes deaf exactly when it most needs to know where the finger is.
        try {
            if (ev.pointerId !== undefined && btn.setPointerCapture) {
                btn.setPointerCapture(ev.pointerId)
                capturedId = ev.pointerId
            }
        } catch { /* capture unavailable; slop still works via pointermove */ }
        window.addEventListener('blur', onBlur)
        document.addEventListener('keydown', onKey, true)
        // Unconditional: the hold is part of what this button is, not something
        // the queue hands out and takes away.
        armTimer = setTimeout(arm, HOLD_ARM_MS)
    })

    /**
     * Hysteresis. A hold is a static gesture, so the hand inevitably drifts a few
     * pixels over 1.5 seconds — cancelling on the first stray pixel punishes
     * holding still, which is the one thing the gesture asks for. Past
     * HOLD_SLOP_PX the movement is intent, not tremor, and the hold is off.
     */
    btn.addEventListener('pointermove', (ev) => {
        if (!pressed || !origin) return
        const dx = ev.clientX - origin.x
        const dy = ev.clientY - origin.y
        if (dx * dx + dy * dy > HOLD_SLOP_PX * HOLD_SLOP_PX) reset()
    })

    const release = () => {
        const tap = pressed && !armed
        reset()
        // Nothing in the history means no request. The tap gets no ring and no
        // flash — those belong to the hold, which earns them over a second and a
        // half — but it is not silent either: the history cards fade out on their
        // way, and that is what accounts for the press.
        if (tap && state.history.length > 0) clearHistory()
    }

    btn.addEventListener('pointerup', release)
    /**
     * The uncaptured fallback. Once capture is held the pointer counts as being
     * inside the button no matter where it goes, so this stops being the signal
     * that the user left — the distance check above is. Ignoring it while captured
     * also sidesteps the boundary events browsers fire as capture is handed back,
     * which would otherwise re-enter reset() mid-reset.
     */
    btn.addEventListener('pointerleave', () => {
        if (capturedId === null) reset()
    })
    btn.addEventListener('pointercancel', () => reset())

    // Keyboard activation (Enter/Space) produces a click with no pointer events
    // behind it — detail 0 — so it is handled here rather than in `release`.
    btn.addEventListener('click', (ev) => {
        if (ev.detail !== 0 || state.history.length === 0) return
        clearHistory()
    })

    // Everything this button starts must be stoppable from outside, so a torn-down
    // sidebar cannot leave a timer or a rAF loop running against a detached node.
    btn.destroy = () => {
        reset()
        clearTimeout(flashTimer)
        flashTimer = null
        btn.classList.remove('queue-btn-flash')
        ring.stop()
    }
    teardowns.add(btn.destroy)

    return btn
}

/**
 * Three buttons, right-aligned, trash last: [clear-pending] [interrupt] [trash].
 *
 * The order and the alignment are load-bearing together. Right alignment means
 * the row grows leftwards from the right edge, and putting trash last pins it to
 * that edge — so conditional buttons (clear-pending, interrupt) appearing and disappearing
 * move everything *except* the control users navigate to by position. Reverse either
 * decision and the most destructive button on the toolbar would slide sideways
 * every time a queue empties, under a cursor already on its way to it.
 *
 * @param {HTMLElement} sidebarEl
 * @param {object} deps - { t, api, state, gridEl, render, refresh }
 */
export function buildToolbar(sidebarEl, deps) {
    // Only one toolbar exists at a time. Stop the old sidebar's buttons before
    // dropping them, so a hold that was mid-flight when the panel was rebuilt
    // cannot keep a rAF loop alive against the detached button.
    destroyToolbar()
    const bar = el(
        'div',
        // No container gap: spacing lives on the conditional buttons' own
        // margin-right so they can animate open with the drawer. A flex gap would
        // add a second 2px on top of that margin, and would also reserve space
        // mid-animation.
        'display:flex;align-items:center;justify-content:flex-end;' +
        'padding:4px 8px;border-bottom:1px solid var(--border-color,#444);flex-shrink:0',
    )
    bar.className = 'queue-sidebar-toolbar'
    bar.appendChild(createClearPendingButton(deps))
    bar.appendChild(createInterruptButton(deps))
    bar.appendChild(createClearHistoryButton(deps))
    sidebarEl.appendChild(bar)
}
