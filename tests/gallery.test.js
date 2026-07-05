import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { attachZoomPan, openGallery } from '../web/lib/gallery.js'

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeImage() {
    return document.createElement('img')
}

// Parse the numeric parts of the applied CSS transform. Regex-based so the
// assertions are tolerant of spacing/float formatting differences.
function scaleOf(elm) {
    const m = elm.style.transform.match(/scale\(([-\d.]+)\)/)
    return m ? parseFloat(m[1]) : null
}

function translateOf(elm) {
    const m = elm.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/)
    return m ? { x: parseFloat(m[1]), y: parseFloat(m[2]) } : null
}

function wheel(elm, deltaY) {
    return elm.dispatchEvent(new WheelEvent('wheel', { deltaY, cancelable: true }))
}

function pointer(elm, type, x, y) {
    elm.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1 }))
}

// ─── attachZoomPan ────────────────────────────────────────────────────────────

describe('attachZoomPan', () => {
    it('sets an initial fit transform (scale 1, no offset)', () => {
        const img = makeImage()
        attachZoomPan(img)
        expect(scaleOf(img)).toBe(1)
        expect(translateOf(img)).toEqual({ x: 0, y: 0 })
    })

    it('wheel up zooms in by one step', () => {
        const img = makeImage()
        attachZoomPan(img)
        wheel(img, -100)
        expect(scaleOf(img)).toBeCloseTo(1.12, 5)
    })

    it('wheel zoom is clamped to a maximum of 4', () => {
        const img = makeImage()
        attachZoomPan(img)
        for (let i = 0; i < 40; i++) wheel(img, -100)
        expect(scaleOf(img)).toBe(4)
    })

    it('wheel down at fit stays clamped at 1', () => {
        const img = makeImage()
        attachZoomPan(img)
        wheel(img, 100)
        expect(scaleOf(img)).toBe(1)
    })

    it('ignores horizontal wheel (deltaY 0) instead of zooming', () => {
        const img = makeImage()
        attachZoomPan(img)
        expect(wheel(img, 0)).toBe(true) // not prevented — lets horizontal scroll through
        expect(scaleOf(img)).toBe(1) // no zoom on a horizontal swipe
    })

    it('wheel prevents the default page scroll', () => {
        const img = makeImage()
        attachZoomPan(img)
        expect(wheel(img, -100)).toBe(false) // dispatchEvent → false when preventDefault called
    })

    it('drag pans by the pointer delta while zoomed in', () => {
        const img = makeImage()
        attachZoomPan(img)
        wheel(img, -100) // zoom in so scale > 1
        pointer(img, 'pointerdown', 100, 100)
        pointer(img, 'pointermove', 130, 150)
        expect(translateOf(img)).toEqual({ x: 30, y: 50 })
    })

    it('does not pan at fit (scale 1)', () => {
        const img = makeImage()
        attachZoomPan(img)
        pointer(img, 'pointerdown', 100, 100)
        pointer(img, 'pointermove', 130, 150)
        expect(translateOf(img)).toEqual({ x: 0, y: 0 })
    })

    it('resets the pan offset when zooming back out to fit', () => {
        const img = makeImage()
        attachZoomPan(img)
        wheel(img, -100)
        wheel(img, -100) // scale ~1.24
        pointer(img, 'pointerdown', 100, 100)
        pointer(img, 'pointermove', 130, 150) // offset (30, 50)
        wheel(img, 100)
        wheel(img, 100)
        wheel(img, 100) // back down to scale 1
        expect(scaleOf(img)).toBe(1)
        expect(translateOf(img)).toEqual({ x: 0, y: 0 })
    })

    it('stops panning after the pointer is released', () => {
        const img = makeImage()
        attachZoomPan(img)
        wheel(img, -100)
        pointer(img, 'pointerdown', 100, 100)
        pointer(img, 'pointermove', 130, 150) // offset (30, 50)
        pointer(img, 'pointerup', 130, 150)
        pointer(img, 'pointermove', 300, 300) // ignored — drag ended
        expect(translateOf(img)).toEqual({ x: 30, y: 50 })
    })

    it('suppresses native image dragging so hold-drag pans instead', () => {
        const img = makeImage()
        attachZoomPan(img)
        const ev = new Event('dragstart', { cancelable: true })
        img.dispatchEvent(ev)
        expect(ev.defaultPrevented).toBe(true)
    })

    it('shows no special cursor at fit (panning unavailable)', () => {
        const img = makeImage()
        attachZoomPan(img)
        expect(img.style.cursor).toBe('')
    })

    it('shows a grab cursor once zoomed in', () => {
        const img = makeImage()
        attachZoomPan(img)
        wheel(img, -100)
        expect(img.style.cursor).toBe('grab')
    })

    it('shows a grabbing cursor while dragging', () => {
        const img = makeImage()
        attachZoomPan(img)
        wheel(img, -100)
        pointer(img, 'pointerdown', 100, 100)
        expect(img.style.cursor).toBe('grabbing')
    })

    it('returns to a grab cursor after the drag ends', () => {
        const img = makeImage()
        attachZoomPan(img)
        wheel(img, -100)
        pointer(img, 'pointerdown', 100, 100)
        pointer(img, 'pointerup', 100, 100)
        expect(img.style.cursor).toBe('grab')
    })

    it('clears the cursor when zooming back out to fit', () => {
        const img = makeImage()
        attachZoomPan(img)
        wheel(img, -100)
        wheel(img, 100) // back to scale 1
        expect(img.style.cursor).toBe('')
    })
})

// ─── openGallery — zoom/pan scope (images only) ─────────────────────────────────

describe('openGallery zoom/pan wiring', () => {
    afterEach(() => {
        // Close any open overlay and detach its global keydown listener.
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        document.body.innerHTML = ''
    })

    it('makes the shown image zoomable', () => {
        openGallery([{ type: 'image', url: 'http://x/a.png', task: {} }], 0)
        const media = document.querySelector('.gallery-media')
        expect(media.tagName).toBe('IMG')
        wheel(media, -100)
        expect(scaleOf(media)).toBeCloseTo(1.12, 5)
    })

    it('leaves video untouched (no zoom transform)', () => {
        openGallery([{ type: 'video', url: 'http://x/a.mp4', task: {} }], 0)
        const media = document.querySelector('.gallery-media')
        expect(media.tagName).toBe('VIDEO')
        wheel(media, -100)
        expect(media.style.transform).toBe('')
    })

    it('resets zoom and pan to fit when switching images', () => {
        const items = [
            { type: 'image', url: 'a', task: {} },
            { type: 'image', url: 'b', task: {} },
        ]
        openGallery(items, 0)
        const first = document.querySelector('.gallery-media')
        wheel(first, -100) // zoom image 0
        pointer(first, 'pointerdown', 100, 100)
        pointer(first, 'pointermove', 140, 160) // pan image 0
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
        const second = document.querySelector('.gallery-media')
        expect(second).not.toBe(first) // a fresh element is rendered
        expect(scaleOf(second)).toBe(1)
        expect(translateOf(second)).toEqual({ x: 0, y: 0 })
    })
})

// ─── openGallery — copy image with metadata (Ctrl/⌘+C, images only) ─────────────

function ctrlC({ meta = false } = {}) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: !meta, metaKey: meta }))
}

describe('openGallery copy image', () => {
    let clipboardWrite

    beforeEach(() => {
        clipboardWrite = vi.fn().mockResolvedValue(undefined)
        // jsdom implements none of these — supply mocks for the copy path.
        global.ClipboardItem = vi.fn(function ClipboardItem(data) { this.data = data })
        Object.defineProperty(navigator, 'clipboard', {
            value: { write: clipboardWrite }, configurable: true,
        })
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            blob: () => Promise.resolve(new Blob(['x'], { type: 'image/png' })),
        })
    })

    afterEach(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        document.body.innerHTML = ''
        vi.restoreAllMocks()
    })

    it('writes the original image blob to the clipboard as a ClipboardItem', async () => {
        openGallery([{ type: 'image', url: 'http://x/a.png', task: {} }], 0, { t: (k) => k })
        ctrlC()
        await vi.waitFor(() => expect(clipboardWrite).toHaveBeenCalledTimes(1))
        expect(global.fetch).toHaveBeenCalledWith('http://x/a.png')
        expect(global.ClipboardItem).toHaveBeenCalledWith({ 'image/png': expect.any(Blob) })
    })

    it('also copies on ⌘+C (metaKey)', async () => {
        openGallery([{ type: 'image', url: 'http://x/a.png', task: {} }], 0, { t: (k) => k })
        ctrlC({ meta: true })
        await vi.waitFor(() => expect(clipboardWrite).toHaveBeenCalledTimes(1))
    })

    it('shows a confirmation toast after a successful copy', async () => {
        openGallery([{ type: 'image', url: 'http://x/a.png', task: {} }], 0, { t: (k) => k })
        ctrlC()
        await vi.waitFor(() => expect(document.body.textContent).toContain('copied'))
    })

    it('shows an error toast when the copy fails (no URL fallback)', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('network down'))
        openGallery([{ type: 'image', url: 'http://x/a.png', task: {} }], 0, { t: (k) => k })
        ctrlC()
        await vi.waitFor(() => expect(document.body.textContent).toContain('copyFailed'))
        expect(clipboardWrite).not.toHaveBeenCalled()
    })

    it('shows an error toast when the server responds not-ok', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: false, status: 404,
            blob: () => Promise.resolve(new Blob(['x'], { type: 'image/png' })),
        })
        openGallery([{ type: 'image', url: 'http://x/a.png', task: {} }], 0, { t: (k) => k })
        ctrlC()
        await vi.waitFor(() => expect(document.body.textContent).toContain('copyFailed'))
        expect(clipboardWrite).not.toHaveBeenCalled()
    })

    it('is a no-op for video items', async () => {
        openGallery([{ type: 'video', url: 'http://x/a.mp4', task: {} }], 0, { t: (k) => k })
        ctrlC()
        await new Promise((r) => setTimeout(r, 10)) // give any stray async a chance to fire
        expect(global.fetch).not.toHaveBeenCalled()
        expect(clipboardWrite).not.toHaveBeenCalled()
    })

    it('does not let a slow earlier copy overwrite a newer copy result', async () => {
        // press1 fetch ok, but clipboard.write stays pending until we resolve it.
        let releaseWrite
        clipboardWrite.mockImplementationOnce(() => new Promise((r) => { releaseWrite = r }))
        // press2 fetch rejects fast → shows the error toast first.
        global.fetch = vi.fn()
            .mockResolvedValueOnce({ ok: true, blob: () => Promise.resolve(new Blob(['x'], { type: 'image/png' })) })
            .mockRejectedValueOnce(new Error('net down'))

        openGallery([{ type: 'image', url: 'http://x/a.png', task: {} }], 0, { t: (k) => k })

        ctrlC() // press1 → success path, parks on the pending clipboard.write
        await Promise.resolve(); await Promise.resolve() // reach the pending write
        ctrlC() // press2 → fails fast, shows copyFailed
        await vi.waitFor(() => expect(document.body.textContent).toContain('copyFailed'))

        releaseWrite() // press1's write resolves late — must NOT reshow the success toast
        await Promise.resolve(); await Promise.resolve()
        expect(document.body.textContent).toContain('copyFailed')
        expect(document.body.textContent).not.toContain('copied')
    })
})

// ─── openGallery — load-workflow button ─────────────────────────────────────────

function galleryDeps(loadGraphData = () => {}) {
    return { app: { loadGraphData }, t: (k) => k }
}

describe('openGallery load-workflow button', () => {
    afterEach(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        document.body.innerHTML = ''
    })

    it('is hidden when the current item has no workflow', () => {
        openGallery([{ type: 'image', url: 'u', task: {} }], 0, galleryDeps())
        expect(document.querySelector('.gallery-load-workflow').style.display).toBe('none')
    })

    it('is visible when the current item has a workflow', () => {
        openGallery([{ type: 'image', url: 'u', task: { workflow: { nodes: [] } } }], 0, galleryDeps())
        expect(document.querySelector('.gallery-load-workflow').style.display).not.toBe('none')
    })

    it('loads the workflow and closes the overlay on click', () => {
        const loadGraphData = vi.fn()
        const wf = { nodes: [1] }
        openGallery([{ type: 'image', url: 'u', task: { workflow: wf } }], 0, galleryDeps(loadGraphData))
        document.querySelector('.gallery-load-workflow').click()
        expect(loadGraphData).toHaveBeenCalledWith(wf)
        expect(document.querySelector('.gallery-media')).toBeNull() // overlay removed
    })

    it('updates button visibility when navigating between items', () => {
        const items = [
            { type: 'image', url: 'a', task: { workflow: { nodes: [] } } },
            { type: 'image', url: 'b', task: {} },
        ]
        openGallery(items, 0, galleryDeps())
        const btn = document.querySelector('.gallery-load-workflow')
        expect(btn.style.display).not.toBe('none') // item 0 has a workflow
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
        expect(btn.style.display).toBe('none') // item 1 has none
    })
})

// ─── openGallery — corner buttons (close / load-workflow) ───────────────────────

describe('openGallery corner buttons', () => {
    afterEach(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        document.body.innerHTML = ''
    })

    it('gives the close button a tooltip', () => {
        openGallery([{ type: 'image', url: 'u', task: {} }], 0, { t: (k) => k })
        expect(document.querySelector('.gallery-close').title).toBe('close')
    })

    it('places the load-workflow button on the same row as close (beside ✕)', () => {
        openGallery([{ type: 'image', url: 'u', task: { workflow: {} } }], 0, { t: (k) => k })
        const closeBtn = document.querySelector('.gallery-close')
        const loadBtn = document.querySelector('.gallery-load-workflow')
        expect(loadBtn.style.top).toBe('16px')
        expect(loadBtn.style.top).toBe(closeBtn.style.top) // side by side, not stacked below
    })
})

// ─── openGallery — help hint bar ────────────────────────────────────────────────

describe('openGallery hint bar', () => {
    afterEach(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        document.body.innerHTML = ''
    })

    it('shows a top-left help hint bar with the localized help text', () => {
        openGallery([{ type: 'image', url: 'u', task: {} }], 0, { t: (k) => k })
        const hint = document.querySelector('.gallery-hint')
        expect(hint).not.toBeNull()
        expect(hint.textContent).toBe('galleryHelp')
    })
})
