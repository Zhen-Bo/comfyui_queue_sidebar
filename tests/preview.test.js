import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
    renderImagePreview,
    renderVideoPreview,
    renderOutputPreview,
    makePreview,
    updateRunningPreview,
    PREVIEW_BG_CLASS,
    PREVIEW_FG_CLASS,
    PREVIEW_MEDIA_CLASS,
} from '../web/lib/preview.js'

function makeWrap() {
    return document.createElement('div')
}

function makeCardWithPreview() {
    const card = document.createElement('div')
    const preview = document.createElement('div')
    preview.className = 'task-preview'
    card.appendChild(preview)
    return card
}

// ─── renderImagePreview ───────────────────────────────────────────────────────
//
// There is only one fit now. The toolbar toggle is gone, so every image — live
// or finished — is composed the same way: a blurred, over-scaled copy filling the
// cell with the whole picture laid over it.

describe('renderImagePreview', () => {
    it('appends two img elements (blurred bg + foreground), both pointing at the image', () => {
        const wrap = makeWrap()
        renderImagePreview(wrap, 'http://example.com/img.png')
        const imgs = wrap.querySelectorAll('img')
        expect(imgs).toHaveLength(2)
        expect(imgs[0].src).toBe('http://example.com/img.png')
        expect(imgs[1].src).toBe('http://example.com/img.png')
    })

    it('never crops the picture itself — only the backdrop is allowed to', () => {
        const wrap = makeWrap()
        renderImagePreview(wrap, 'http://example.com/img.png')
        const bg = wrap.querySelector(`.${PREVIEW_BG_CLASS}`)
        const fg = wrap.querySelector(`.${PREVIEW_FG_CLASS}`)
        expect(fg.style.objectFit).toBe('contain')
        expect(bg.style.objectFit).toBe('cover')
        expect(bg.style.filter).toContain('blur')
    })

    it('sets loading="lazy" on both layers', () => {
        const wrap = makeWrap()
        renderImagePreview(wrap, 'http://x.com/a.png')
        for (const img of wrap.querySelectorAll('img')) {
            expect(img.loading).toBe('lazy')
        }
    })
})

// ─── renderVideoPreview ───────────────────────────────────────────────────────

describe('renderVideoPreview', () => {
    it('appends a video element with correct src, muted, and loop attributes', () => {
        const wrap = makeWrap()
        renderVideoPreview(wrap, 'http://example.com/clip.mp4')
        const vid = wrap.querySelector('video')
        expect(vid).not.toBeNull()
        expect(vid.src).toBe('http://example.com/clip.mp4')
        expect(vid.muted).toBe(true)
        expect(vid.loop).toBe(true)
    })

    it('is contained, and skips the blurred backdrop that images get', () => {
        const wrap = makeWrap()
        renderVideoPreview(wrap, 'http://example.com/clip.mp4')
        expect(wrap.querySelector('video').style.objectFit).toBe('contain')
        // A second decoder per visible cell is not worth a nicer letterbox.
        expect(wrap.querySelectorAll('video')).toHaveLength(1)
        expect(wrap.querySelector(`.${PREVIEW_BG_CLASS}`)).toBeNull()
    })
})

// ─── renderOutputPreview ─────────────────────────────────────────────────────

describe('renderOutputPreview', () => {
    let firstOutput
    let viewUrl

    beforeEach(() => {
        viewUrl = vi.fn((output) => `http://comfy/view?filename=${output.filename}`)
        firstOutput = vi.fn()
    })

    it('passes task.outputs and task.promptId to firstOutput', () => {
        firstOutput.mockReturnValue(null)
        const outputs = { '1': { images: [{ filename: 'a.png' }] } }
        const task = { promptId: 'p-abc', status: 'completed', outputs }
        renderOutputPreview(makeWrap(), task, { firstOutput, viewUrl })
        expect(firstOutput).toHaveBeenCalledWith(outputs, 'p-abc')
    })

    it('shows check-circle icon when firstOutput returns null (completed)', () => {
        firstOutput.mockReturnValue(null)
        const wrap = makeWrap()
        renderOutputPreview(wrap, { promptId: 'p1', status: 'completed', outputs: {} }, { firstOutput, viewUrl })
        expect(wrap.querySelector('.pi-check-circle')).not.toBeNull()
    })

    it('shows exclamation-circle icon when firstOutput returns null (failed)', () => {
        firstOutput.mockReturnValue(null)
        const wrap = makeWrap()
        renderOutputPreview(wrap, { promptId: 'p1', status: 'failed', outputs: {} }, { firstOutput, viewUrl })
        expect(wrap.querySelector('.pi-exclamation-circle')).not.toBeNull()
    })

    it('renders img with the URL returned by viewUrl for image output', () => {
        firstOutput.mockReturnValue({ filename: 'result.png', subfolder: '', type: 'output' })
        const wrap = makeWrap()
        renderOutputPreview(wrap, { promptId: 'p1', status: 'completed', outputs: {} }, { firstOutput, viewUrl })
        // contain mode renders two imgs (blurred bg + foreground); both get the view URL
        const imgs = wrap.querySelectorAll('img')
        expect(imgs.length).toBeGreaterThan(0)
        expect(imgs[0].src).toBe('http://comfy/view?filename=result.png')
    })

    it('renders video with correct src, muted, and loop for video output', () => {
        firstOutput.mockReturnValue({ filename: 'clip.mp4', subfolder: '', type: 'output' })
        const wrap = makeWrap()
        renderOutputPreview(wrap, { promptId: 'p1', status: 'completed', outputs: {} }, { firstOutput, viewUrl })
        const vid = wrap.querySelector('video')
        expect(vid).not.toBeNull()
        expect(vid.src).toBe('http://comfy/view?filename=clip.mp4')
        expect(vid.muted).toBe(true)
        expect(vid.loop).toBe(true)
    })

    it('renders volume-up icon for audio output', () => {
        firstOutput.mockReturnValue({ filename: 'sound.mp3', subfolder: '', type: 'output' })
        const wrap = makeWrap()
        renderOutputPreview(wrap, { promptId: 'p1', status: 'completed', outputs: {} }, { firstOutput, viewUrl })
        expect(wrap.querySelector('.pi-volume-up')).not.toBeNull()
    })

    it('renders file icon for unknown file type', () => {
        firstOutput.mockReturnValue({ filename: 'data.json', subfolder: '', type: 'output' })
        const wrap = makeWrap()
        renderOutputPreview(wrap, { promptId: 'p1', status: 'completed', outputs: {} }, { firstOutput, viewUrl })
        expect(wrap.querySelector('.pi-file')).not.toBeNull()
    })

    it('calls viewUrl with the output returned by firstOutput', () => {
        const output = { filename: 'upscaled.png', subfolder: 'sub', type: 'output' }
        firstOutput.mockReturnValue(output)
        const wrap = makeWrap()
        renderOutputPreview(wrap, { promptId: 'p1', status: 'completed', outputs: {} }, { firstOutput, viewUrl })
        expect(viewUrl).toHaveBeenCalledWith(output)
    })
})

// ─── updateRunningPreview ─────────────────────────────────────────────────────

describe('updateRunningPreview', () => {
    it('builds the contained pair and points both layers at the frame', () => {
        const card = makeCardWithPreview()
        updateRunningPreview(card, 'blob:http://example.com/abc')
        const preview = card.querySelector('.task-preview')
        expect(preview.querySelector(`.${PREVIEW_FG_CLASS}`).src).toBe('blob:http://example.com/abc')
        expect(preview.querySelector(`.${PREVIEW_BG_CLASS}`).src).toBe('blob:http://example.com/abc')
    })

    it('composes the live frame exactly like a finished card, never cropped', () => {
        const card = makeCardWithPreview()
        updateRunningPreview(card, 'blob:http://example.com/abc')
        const preview = card.querySelector('.task-preview')
        // The bug this replaces: the live frame was `cover` while the finished
        // image was `contain`, so every generation ended with a visible reframe.
        expect(preview.querySelector(`.${PREVIEW_FG_CLASS}`).style.objectFit).toBe('contain')
        for (const img of preview.querySelectorAll('img')) {
            expect(img.style.objectPosition).not.toBe('center')
        }
    })

    it('never defers the live frame — it is the whole point of the card', () => {
        const card = makeCardWithPreview()
        updateRunningPreview(card, 'blob:http://example.com/abc')
        for (const img of card.querySelectorAll('.task-preview img')) {
            expect(img.loading).not.toBe('lazy')
        }
    })

    it('reuses the existing layers and only swaps their src', () => {
        const card = makeCardWithPreview()
        updateRunningPreview(card, 'blob:http://example.com/old')
        const preview = card.querySelector('.task-preview')
        const fgBefore = preview.querySelector(`.${PREVIEW_FG_CLASS}`)
        const bgBefore = preview.querySelector(`.${PREVIEW_BG_CLASS}`)

        updateRunningPreview(card, 'blob:http://example.com/new')

        // Same nodes, new source: 20 frames a second must not mean 20 rebuilds.
        expect(preview.querySelector(`.${PREVIEW_FG_CLASS}`)).toBe(fgBefore)
        expect(preview.querySelector(`.${PREVIEW_BG_CLASS}`)).toBe(bgBefore)
        expect(fgBefore.src).toBe('blob:http://example.com/new')
        expect(bgBefore.src).toBe('blob:http://example.com/new')
        expect(preview.querySelectorAll('img')).toHaveLength(2)
    })

    it('calling with the same progressUrl does not duplicate the layers', () => {
        const card = makeCardWithPreview()
        updateRunningPreview(card, 'blob:http://example.com/same')
        updateRunningPreview(card, 'blob:http://example.com/same')
        expect(card.querySelectorAll('.task-preview img')).toHaveLength(2)
    })

    it('shows spinner when progressUrl is null', () => {
        const card = makeCardWithPreview()
        updateRunningPreview(card, null)
        expect(card.querySelector('.task-preview .pi-spin')).not.toBeNull()
    })

    it('replaces the preview with a spinner when progressUrl becomes null', () => {
        const card = makeCardWithPreview()
        updateRunningPreview(card, 'blob:http://example.com/abc')
        updateRunningPreview(card, null)
        expect(card.querySelector('.task-preview .pi-spin')).not.toBeNull()
        expect(card.querySelector('.task-preview img')).toBeNull()
    })

    it('does not recreate spinner if one is already present', () => {
        const card = makeCardWithPreview()
        const preview = card.querySelector('.task-preview')
        preview.innerHTML = '<i class="pi pi-spin pi-spinner"></i>'
        const spinnerBefore = preview.querySelector('.pi-spin')

        updateRunningPreview(card, null)

        expect(preview.querySelector('.pi-spin')).toBe(spinnerBefore) // same node, no re-render
    })

    it('rebuilds from a spinner, so the first frame after waiting still lands', () => {
        const card = makeCardWithPreview()
        updateRunningPreview(card, null)
        updateRunningPreview(card, 'blob:http://example.com/first')
        const preview = card.querySelector('.task-preview')
        expect(preview.querySelector('.pi-spin')).toBeNull()
        expect(preview.querySelector(`.${PREVIEW_FG_CLASS}`).src).toBe('blob:http://example.com/first')
    })

    it('does nothing when card has no .task-preview element', () => {
        const card = document.createElement('div')
        expect(() => updateRunningPreview(card, 'blob:http://example.com/abc')).not.toThrow()
    })
})

// ─── makePreview ──────────────────────────────────────────────────────────────

describe('makePreview', () => {
    let deps

    beforeEach(() => {
        deps = {
            progressUrl: null,
            firstOutput: vi.fn().mockReturnValue(null),
            viewUrl: vi.fn((o) => `http://comfy/view?filename=${o.filename}`),
        }
    })

    it('always carries the "task-preview" hook class', () => {
        const wrap = makePreview({ status: 'pending', outputs: {} }, deps)
        expect(wrap.classList.contains('task-preview')).toBe(true)
    })

    // The hover lift used to be two JS listeners setting wrap.style.transform.
    // render() replaces a card on status change, and the replacement never gets
    // a mouseenter from a pointer already resting on it — so a finishing card
    // went dead under the cursor. A CSS :hover rule re-evaluates against the new
    // node for free, and a tap can't latch it on a touch screen.
    it('marks the wrap with the media class the hover rule hangs off', () => {
        const wrap = makePreview({ status: 'pending', outputs: {} }, deps)
        expect(wrap.classList.contains(PREVIEW_MEDIA_CLASS)).toBe(true)
    })

    it('leaves transform unset inline, or the sheet\'s :hover could never win', () => {
        const wrap = makePreview({ status: 'pending', outputs: {} }, deps)
        expect(wrap.style.transform).toBe('')
    })

    it('injects the hover stylesheet once, quarantined behind a fine pointer', () => {
        makePreview({ status: 'pending', outputs: {} }, deps)
        makePreview({ status: 'pending', outputs: {} }, deps)
        const sheets = document.querySelectorAll('#queue-sidebar-preview-style')
        expect(sheets).toHaveLength(1)
        const css = sheets[0].textContent
        expect(css).toContain(`.${PREVIEW_MEDIA_CLASS}:hover{transform:scale(1.05)}`)
        expect(css).toContain('(hover:hover) and (pointer:fine)')
        expect(css).toContain('transition:transform 0.2s ease')
        expect(css).toContain('prefers-reduced-motion:reduce')
    })

    it('pending: shows dots placeholder', () => {
        const wrap = makePreview({ status: 'pending', outputs: {} }, deps)
        expect(wrap.textContent).toContain('···')
    })

    it('running with progressUrl: shows the contained pair with that src', () => {
        deps.progressUrl = 'blob:http://example.com/latent'
        const wrap = makePreview({ status: 'running', outputs: {} }, deps)
        expect(wrap.querySelector(`.${PREVIEW_FG_CLASS}`).src).toBe('blob:http://example.com/latent')
        expect(wrap.querySelector(`.${PREVIEW_BG_CLASS}`).src).toBe('blob:http://example.com/latent')
    })

    it('running and completed are composed identically, so the handover is invisible', () => {
        deps.progressUrl = 'blob:http://example.com/latent'
        const running = makePreview({ status: 'running', outputs: {} }, deps)

        deps.firstOutput.mockReturnValue({ filename: 'result.png', subfolder: '', type: 'output' })
        const done = makePreview({ status: 'completed', outputs: {}, promptId: 'p1' }, deps)

        const shape = (w) => ({
            imgs: w.querySelectorAll('img').length,
            fg: w.querySelector(`.${PREVIEW_FG_CLASS}`).style.objectFit,
            bg: w.querySelector(`.${PREVIEW_BG_CLASS}`).style.objectFit,
        })
        expect(shape(running)).toEqual(shape(done))
        expect(shape(running).fg).toBe('contain')
    })

    it('running without progressUrl: shows spinner', () => {
        deps.progressUrl = null
        const wrap = makePreview({ status: 'running', outputs: {} }, deps)
        expect(wrap.querySelector('.pi-spin')).not.toBeNull()
        expect(wrap.querySelector('img')).toBeNull()
    })

    it('completed with no output: shows check-circle icon', () => {
        const wrap = makePreview({ status: 'completed', outputs: {}, promptId: 'p1' }, deps)
        expect(wrap.querySelector('.pi-check-circle')).not.toBeNull()
    })

    it('completed with image output: shows img with the URL from viewUrl', () => {
        deps.firstOutput.mockReturnValue({ filename: 'result.png', subfolder: '', type: 'output' })
        const wrap = makePreview({ status: 'completed', outputs: {}, promptId: 'p1' }, deps)
        const imgs = wrap.querySelectorAll('img')
        expect(imgs.length).toBeGreaterThan(0)
        expect(imgs[0].src).toBe('http://comfy/view?filename=result.png')
    })

    it('failed with no output: shows exclamation-circle icon', () => {
        const wrap = makePreview({ status: 'failed', outputs: {}, promptId: 'p1' }, deps)
        expect(wrap.querySelector('.pi-exclamation-circle')).not.toBeNull()
    })

    it('cancelled with no output: shows ban icon in the cancelled colour, not a check', () => {
        const wrap = makePreview({ status: 'cancelled', outputs: {}, promptId: 'p1' }, deps)
        expect(wrap.querySelector('.pi-ban')).not.toBeNull()
        expect(wrap.querySelector('.pi-check-circle')).toBeNull()
        expect(wrap.querySelector('.pi-ban').style.color).toBe('var(--p-orange-500,#f97316)')
    })

    it('running status: does not call firstOutput (progressUrl path only)', () => {
        deps.progressUrl = 'blob:http://example.com/latent'
        makePreview({ status: 'running', outputs: {}, promptId: 'p1' }, deps)
        expect(deps.firstOutput).not.toHaveBeenCalled()
    })

    it('pending status: does not call firstOutput', () => {
        makePreview({ status: 'pending', outputs: {} }, deps)
        expect(deps.firstOutput).not.toHaveBeenCalled()
    })
})
