import { GALLERY_NAV_BTN } from './constants.js'
import { el, elHtml } from './helpers.js'

// ─── Gallery Overlay ──────────────────────────────────────────────────────────

function createGalleryMedia(item) {
    const { type, url } = item
    let media
    if (type === 'image') {
        media = el(
            'img',
            'max-width:90vw;max-height:90vh;object-fit:contain;display:block;' +
            'border-radius:4px;box-shadow:0 8px 32px rgba(0,0,0,.6)',
        )
        media.src = url
    } else {
        media = el(
            'video',
            'max-width:90vw;max-height:90vh;object-fit:contain;display:block;border-radius:4px',
        )
        media.src = url
        media.controls = true
        media.autoplay = true
    }
    media.className = 'gallery-media'
    media.addEventListener('click', (e) => e.stopPropagation())
    return media
}

function addHoverEffect(btn) {
    btn.addEventListener('mouseenter', () => (btn.style.background = 'rgba(255,255,255,.25)'))
    btn.addEventListener('mouseleave', () => (btn.style.background = 'rgba(255,255,255,.1)'))
}

function createGalleryNav(overlay, items, getIdx, setIdx, showFn) {
    const prev = elHtml('button', `left:16px;${GALLERY_NAV_BTN}`, '&#8249;')
    addHoverEffect(prev)
    prev.addEventListener('click', (e) => {
        e.stopPropagation()
        setIdx((getIdx() - 1 + items.length) % items.length)
        showFn()
    })

    const next = elHtml('button', `right:16px;${GALLERY_NAV_BTN}`, '&#8250;')
    addHoverEffect(next)
    next.addEventListener('click', (e) => {
        e.stopPropagation()
        setIdx((getIdx() + 1) % items.length)
        showFn()
    })

    overlay.appendChild(prev)
    overlay.appendChild(next)
}

export function openGallery(items, startIdx) {
    let idx = startIdx
    const overlay = el(
        'div',
        'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.92);' +
        'display:flex;align-items:center;justify-content:center',
    )

    const close = () => { document.removeEventListener('keydown', onKey); overlay.remove() }

    const show = () => {
        overlay.querySelector('.gallery-media')?.remove()
        overlay.querySelector('.gallery-counter')?.remove()
        overlay.appendChild(createGalleryMedia(items[idx]))
        if (items.length > 1) {
            const counter = el(
                'div',
                'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
                'color:rgba(255,255,255,.7);font-size:13px;pointer-events:none',
                `${idx + 1} / ${items.length}`,
            )
            counter.className = 'gallery-counter'
            overlay.appendChild(counter)
        }
    }

    if (items.length > 1) {
        createGalleryNav(overlay, items, () => idx, (v) => { idx = v }, show)
    }

    const closeBtn = el(
        'button',
        'position:fixed;top:16px;right:16px;background:rgba(255,255,255,.1);' +
        'border:none;color:rgba(255,255,255,.8);font-size:1.1rem;padding:8px 12px;' +
        'cursor:pointer;border-radius:6px', '✕',
    )
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close() })
    overlay.appendChild(closeBtn)
    overlay.addEventListener('click', close)

    const onKey = (e) => {
        if (e.key === 'Escape') return close()
        if (items.length <= 1) return
        if (e.key === 'ArrowLeft') { idx = (idx - 1 + items.length) % items.length; show() }
        if (e.key === 'ArrowRight') { idx = (idx + 1) % items.length; show() }
    }
    document.addEventListener('keydown', onKey)
    show()
    document.body.appendChild(overlay)
}
