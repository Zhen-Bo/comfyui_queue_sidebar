import { MENU_BG } from './constants.js'
import { el, elHtml, safeApi } from './helpers.js'

// ─── Context Menu ─────────────────────────────────────────────────────────────

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
    document.body.appendChild(menu)
    activeMenu = menu
    menu.style.left = `${Math.min(x, innerWidth - menu.offsetWidth - 8)}px`
    menu.style.top = `${Math.min(y, innerHeight - menu.offsetHeight - 8)}px`
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

// Global listeners for closing on click/escape
document.addEventListener('click', hideMenu)
document.addEventListener('keydown', (e) => e.key === 'Escape' && hideMenu())
