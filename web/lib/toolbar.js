import { TOOLBAR_BTN, POPUP_BG } from './constants.js'
import { el, safeApi } from './helpers.js'

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function fitIcon(fit) {
    return fit === 'cover'
        ? 'pi-arrow-down-left-and-arrow-up-right-to-center'
        : 'pi-arrow-up-right-and-arrow-down-left-from-center'
}

/**
 * @param {object} deps - { t, state, gridEl, render }
 */
export function createFitButton(deps) {
    const { t, state, gridEl, render } = deps
    const btn = el('button', TOOLBAR_BTN)
    const sync = () => {
        btn.title = state.imageFit === 'cover' ? t('fitImage') : t('fillImage')
        btn.innerHTML = `<i class="pi ${fitIcon(state.imageFit)}"></i>`
    }
    sync()
    btn.addEventListener('click', () => {
        state.imageFit = state.imageFit === 'cover' ? 'contain' : 'cover'
        sync()
        for (const child of gridEl()?.children ?? []) {
            if (child.dataset.status !== 'running') child.removeAttribute('data-id')
        }
        render()
    })
    return btn
}

/**
 * Show a confirm popup anchored to an element.
 * @param {HTMLElement} anchorEl
 * @param {Function} onConfirm
 * @param {object} deps - { t }
 */
export function showConfirmPopup(anchorEl, onConfirm, deps) {
    const { t } = deps
    const existing = document.querySelector('.queue-confirm-popup')
    if (existing) { existing.remove(); return }

    const popup = el(
        'div',
        `position:absolute;z-index:9999;${POPUP_BG};padding:16px;min-width:220px;` +
        'display:flex;flex-direction:column;gap:12px',
    )
    popup.className = 'queue-confirm-popup'

    // Unified close: removes popup AND unregisters the outside-click listener
    const onOutside = (ev) => {
        if (!popup.contains(ev.target) && ev.target !== anchorEl) closePopup()
    }
    const closePopup = () => {
        document.removeEventListener('pointerdown', onOutside, true)
        popup.remove()
    }

    const msg = el(
        'div',
        'display:flex;align-items:center;gap:8px;color:var(--p-text-color,#eee);font-size:13px',
    )
    msg.innerHTML =
        '<i class="pi pi-info-circle" style="font-size:16px;color:var(--p-blue-500,#3b82f6)"></i>' +
        `<span>${t('confirmDelete')}</span>`
    popup.appendChild(msg)

    const btns = el('div', 'display:flex;justify-content:flex-end;gap:8px')
    const cancelBtn = el(
        'button',
        'padding:6px 14px;border-radius:6px;font-size:13px;cursor:pointer;' +
        'background:transparent;border:1px solid var(--p-surface-400,#666);' +
        'color:var(--p-text-color,#eee)',
    )
    cancelBtn.textContent = t('cancel')
    cancelBtn.addEventListener('click', () => closePopup())

    const deleteBtn = el(
        'button',
        'padding:6px 14px;border-radius:6px;font-size:13px;cursor:pointer;' +
        'background:var(--p-red-500,#ef4444);border:none;color:#fff;font-weight:600',
    )
    deleteBtn.textContent = t('delete')
    deleteBtn.addEventListener('click', () => { closePopup(); onConfirm() })

    btns.appendChild(cancelBtn)
    btns.appendChild(deleteBtn)
    popup.appendChild(btns)

    const rect = anchorEl.getBoundingClientRect()
    popup.style.top = rect.bottom + 4 + 'px'
    popup.style.right = (window.innerWidth - rect.right) + 'px'
    document.body.appendChild(popup)

    setTimeout(() => document.addEventListener('pointerdown', onOutside, true), 0)
}

/**
 * @param {object} deps - { t, api, state, gridEl, render, refresh }
 */
export function createClearButton(deps) {
    const { t, api, state, gridEl, render, refresh } = deps
    const btn = el('button', TOOLBAR_BTN + ';color:var(--p-red-500,#ef4444)')
    btn.title = t('clearAll')
    btn.innerHTML = '<i class="pi pi-trash"></i>'
    btn.addEventListener('click', () => {
        showConfirmPopup(btn, async () => {
            await Promise.all([
                safeApi(api, '/queue', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clear: true }),
                }),
                safeApi(api, '/history', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clear: true }),
                }),
            ])
            state.running = []
            state.pending = []
            state.history = []
            const grid = gridEl()
            if (grid) grid.innerHTML = ''
            render()
            await refresh()
        }, deps)
    })
    return btn
}

/**
 * @param {HTMLElement} sidebarEl
 * @param {object} deps - { t, api, state, gridEl, render, refresh }
 */
export function buildToolbar(sidebarEl, deps) {
    const bar = el(
        'div',
        'display:flex;align-items:center;justify-content:flex-end;gap:2px;' +
        'padding:4px 8px;border-bottom:1px solid var(--border-color,#444);flex-shrink:0',
    )
    bar.appendChild(createFitButton(deps))
    bar.appendChild(createClearButton(deps))
    sidebarEl.appendChild(bar)
}
