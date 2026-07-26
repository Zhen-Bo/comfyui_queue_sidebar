import { MENU_BG } from './constants.js'
import { el, elHtml, safeApi, prefersReducedMotion } from './helpers.js'

// ─── Context Menu ─────────────────────────────────────────────────────────────

/**
 * Entrance only. Dismissal stays instant: a menu that lingers after the choice is
 * made reads as lag, and the click that closes it has already been acted on.
 */
const ENTER_MS = 120
/** Strong ease-out. The built-in keywords are too soft to read at these durations. */
const EASE_OUT = 'cubic-bezier(0.23,1,0.32,1)'

let activeMenu = null

function hideMenu() {
    activeMenu?.remove()
    activeMenu = null
}

function renderMenu(items, x, y) {
    const menu = el('div', `position:fixed;z-index:9999;${MENU_BG}`)
    for (const item of items) {
        const row = el(
            'div',
            'display:flex;align-items:center;gap:8px;padding:9px 14px;cursor:pointer;' +
            'font-size:13px;color:var(--input-text,#eee);white-space:nowrap',
        )
        row.innerHTML = `<i class="pi ${item.icon}"></i>${item.label}`
        row.addEventListener('mouseenter', () => (row.style.background = 'var(--comfy-input-bg,#333)'))
        row.addEventListener('mouseleave', () => (row.style.background = ''))
        row.addEventListener('click', async () => { hideMenu(); await item.action() })
        menu.appendChild(row)
    }
    const animate = !prefersReducedMotion()
    if (animate) {
        // Set on style directly, not via cssText, so the animated properties stay
        // addressable when the flip below writes transform-origin.
        menu.style.opacity = '0'
        menu.style.transform = 'scale(.97)'
        menu.style.transition = `opacity ${ENTER_MS}ms ${EASE_OUT},transform ${ENTER_MS}ms ${EASE_OUT}`
    }
    document.body.appendChild(menu)
    activeMenu = menu

    // Measuring needs the menu in the document, so placement happens after append.
    // Near the right/bottom edge the menu is pulled back off the cursor, which moves
    // its visual anchor to that side — so the growth origin has to follow, or the
    // menu appears to expand away from the corner it is pinned to.
    const left = Math.min(x, innerWidth - menu.offsetWidth - 8)
    const top = Math.min(y, innerHeight - menu.offsetHeight - 8)
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
    if (animate) {
        menu.style.transformOrigin = `${top < y ? 'bottom' : 'top'} ${left < x ? 'right' : 'left'}`
        // Next frame → grow into place (a same-frame set wouldn't transition).
        requestAnimationFrame(() => requestAnimationFrame(() => {
            if (activeMenu !== menu) return
            menu.style.opacity = '1'
            menu.style.transform = 'scale(1)'
        }))
    }
}

/**
 * Show a context menu for a task card.
 * @param {MouseEvent} e
 * @param {object} task
 * @param {object} deps - { t, api, app, refresh }
 */
export function showContextMenu(e, task, deps) {
    const { t, api, app, refresh } = deps
    e.preventDefault()
    hideMenu()

    const items = []
    if (task.status === 'running') {
        items.push({
            icon: 'pi-stop-circle',
            label: t('interruptTask'),
            action: async () => {
                await safeApi(api, '/interrupt', { method: 'POST' })
                await refresh()
            },
        })
    } else if (task.status === 'pending') {
        items.push({
            icon: 'pi-trash',
            label: t('deleteTask'),
            action: async () => {
                await safeApi(api, '/queue', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ delete: [task.promptId] }),
                })
                await refresh()
            },
        })
    }
    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
        items.push({
            icon: 'pi-trash',
            label: t('deleteTask'),
            action: async () => {
                await safeApi(api, '/history', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ delete: [task.promptId] }),
                })
                await refresh()
            },
        })
        if (task.workflow) {
            items.push({
                icon: 'pi-file-export',
                label: t('loadWorkflow'),
                action: () => app.loadGraphData(task.workflow),
            })
        }
    }
    if (items.length === 0) return
    renderMenu(items, e.clientX, e.clientY)
}

// Global listeners for closing on outside interaction or Escape.
// pointerdown (not click) so a press-and-hold elsewhere — e.g. the toolbar's 1.5s
// trash hold — dismisses the menu the instant the press starts, not ~1.5s later
// when click finally fires on release. Row clicks are exempted via `contains`, so
// this can never beat the row's own click handler (line 32) to the punch.
document.addEventListener('pointerdown', (e) => {
    if (activeMenu && !activeMenu.contains(e.target)) hideMenu()
})
// click stays too: a click with no prior pointerdown (keyboard-triggered, detail
// 0) would otherwise never dismiss the menu. hideMenu() is a no-op once already
// hidden, so the two listeners overlapping is harmless.
document.addEventListener('click', hideMenu)
document.addEventListener('keydown', (e) => e.key === 'Escape' && hideMenu())
