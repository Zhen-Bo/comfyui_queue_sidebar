import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
    renderImagePreview,
    renderVideoPreview,
    renderOutputPreview,
    makePreview,
    updateRunningPreview,
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

describe('renderImagePreview', () => {
    it('contain mode: appends two img elements (blurred bg + foreground)', () => {
        const wrap = makeWrap()
        renderImagePreview(wrap, 'http://example.com/img.png', 'contain')
        const imgs = wrap.querySelectorAll('img')
        expect(imgs).toHaveLength(2)
        expect(imgs[0].src).toBe('http://example.com/img.png')
        expect(imgs[1].src).toBe('http://example.com/img.png')
    })

    it('cover mode: appends a single img element', () => {
        const wrap = makeWrap()
        renderImagePreview(wrap, 'http://example.com/img.png', 'cover')
        const imgs = wrap.querySelectorAll('img')
        expect(imgs).toHaveLength(1)
        expect(imgs[0].src).toBe('http://example.com/img.png')
    })

    it('both modes set loading="lazy"', () => {
        const wrapContain = makeWrap()
        renderImagePreview(wrapContain, 'http://x.com/a.png', 'contain')
        for (const img of wrapContain.querySelectorAll('img')) {
            expect(img.loading).toBe('lazy')
        }

        const wrapCover = makeWrap()
        renderImagePreview(wrapCover, 'http://x.com/b.png', 'cover')
        expect(wrapCover.querySelector('img').loading).toBe('lazy')
    })
})

// ─── renderVideoPreview ───────────────────────────────────────────────────────

describe('renderVideoPreview', () => {
    it('appends a video element with correct src, muted, and loop attributes', () => {
        const wrap = makeWrap()
        renderVideoPreview(wrap, 'http://example.com/clip.mp4', 'contain')
        const vid = wrap.querySelector('video')
        expect(vid).not.toBeNull()
        expect(vid.src).toBe('http://example.com/clip.mp4')
        expect(vid.muted).toBe(true)
        expect(vid.loop).toBe(true)
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
        renderOutputPreview(makeWrap(), task, { firstOutput, viewUrl, imageFit: 'contain' })
        expect(firstOutput).toHaveBeenCalledWith(outputs, 'p-abc')
    })

    it('shows check-circle icon when firstOutput returns null (completed)', () => {
        firstOutput.mockReturnValue(null)
        const wrap = makeWrap()
        renderOutputPreview(wrap, { promptId: 'p1', status: 'completed', outputs: {} }, { firstOutput, viewUrl, imageFit: 'contain' })
        expect(wrap.querySelector('.pi-check-circle')).not.toBeNull()
    })

    it('shows exclamation-circle icon when firstOutput returns null (failed)', () => {
        firstOutput.mockReturnValue(null)
        const wrap = makeWrap()
        renderOutputPreview(wrap, { promptId: 'p1', status: 'failed', outputs: {} }, { firstOutput, viewUrl, imageFit: 'contain' })
        expect(wrap.querySelector('.pi-exclamation-circle')).not.toBeNull()
    })

    it('renders img with the URL returned by viewUrl for image output', () => {
        firstOutput.mockReturnValue({ filename: 'result.png', subfolder: '', type: 'output' })
        const wrap = makeWrap()
        renderOutputPreview(wrap, { promptId: 'p1', status: 'completed', outputs: {} }, { firstOutput, viewUrl, imageFit: 'contain' })
        // contain mode renders two imgs (blurred bg + foreground); both get the view URL
        const imgs = wrap.querySelectorAll('img')
        expect(imgs.length).toBeGreaterThan(0)
        expect(imgs[0].src).toBe('http://comfy/view?filename=result.png')
    })

    it('renders video with correct src, muted, and loop for video output', () => {
        firstOutput.mockReturnValue({ filename: 'clip.mp4', subfolder: '', type: 'output' })
        const wrap = makeWrap()
        renderOutputPreview(wrap, { promptId: 'p1', status: 'completed', outputs: {} }, { firstOutput, viewUrl, imageFit: 'contain' })
        const vid = wrap.querySelector('video')
        expect(vid).not.toBeNull()
        expect(vid.src).toBe('http://comfy/view?filename=clip.mp4')
        expect(vid.muted).toBe(true)
        expect(vid.loop).toBe(true)
    })

    it('renders volume-up icon for audio output', () => {
        firstOutput.mockReturnValue({ filename: 'sound.mp3', subfolder: '', type: 'output' })
        const wrap = makeWrap()
        renderOutputPreview(wrap, { promptId: 'p1', status: 'completed', outputs: {} }, { firstOutput, viewUrl, imageFit: 'contain' })
        expect(wrap.querySelector('.pi-volume-up')).not.toBeNull()
    })

    it('renders file icon for unknown file type', () => {
        firstOutput.mockReturnValue({ filename: 'data.json', subfolder: '', type: 'output' })
        const wrap = makeWrap()
        renderOutputPreview(wrap, { promptId: 'p1', status: 'completed', outputs: {} }, { firstOutput, viewUrl, imageFit: 'contain' })
        expect(wrap.querySelector('.pi-file')).not.toBeNull()
    })

    it('calls viewUrl with the output returned by firstOutput', () => {
        const output = { filename: 'upscaled.png', subfolder: 'sub', type: 'output' }
        firstOutput.mockReturnValue(output)
        const wrap = makeWrap()
        renderOutputPreview(wrap, { promptId: 'p1', status: 'completed', outputs: {} }, { firstOutput, viewUrl, imageFit: 'contain' })
        expect(viewUrl).toHaveBeenCalledWith(output)
    })
})

// ─── updateRunningPreview ─────────────────────────────────────────────────────

describe('updateRunningPreview', () => {
    it('creates img and sets src when progressUrl is provided', () => {
        const card = makeCardWithPreview()
        updateRunningPreview(card, 'blob:http://example.com/abc')
        const img = card.querySelector('.task-preview img')
        expect(img).not.toBeNull()
        expect(img.src).toBe('blob:http://example.com/abc')
    })

    it('reuses existing img element and updates src', () => {
        const card = makeCardWithPreview()
        const preview = card.querySelector('.task-preview')
        const img = document.createElement('img')
        img.src = 'blob:http://example.com/old'
        preview.appendChild(img)

        updateRunningPreview(card, 'blob:http://example.com/new')

        const imgs = card.querySelectorAll('.task-preview img')
        expect(imgs).toHaveLength(1)
        expect(imgs[0].src).toBe('blob:http://example.com/new')
    })

    it('calling with the same progressUrl does not create a duplicate img element', () => {
        const card = makeCardWithPreview()
        const preview = card.querySelector('.task-preview')
        const img = document.createElement('img')
        img.src = 'blob:http://example.com/same'
        preview.appendChild(img)

        updateRunningPreview(card, 'blob:http://example.com/same')

        // Only one img should exist — not a second one appended
        expect(card.querySelectorAll('.task-preview img')).toHaveLength(1)
    })

    it('shows spinner when progressUrl is null', () => {
        const card = makeCardWithPreview()
        updateRunningPreview(card, null)
        expect(card.querySelector('.task-preview .pi-spin')).not.toBeNull()
    })

    it('replaces img with spinner when progressUrl becomes null', () => {
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
            imageFit: 'contain',
        }
    })

    it('always sets className to "task-preview"', () => {
        const wrap = makePreview({ status: 'pending', outputs: {} }, deps)
        expect(wrap.className).toBe('task-preview')
    })

    it('pending: shows dots placeholder', () => {
        const wrap = makePreview({ status: 'pending', outputs: {} }, deps)
        expect(wrap.textContent).toContain('···')
    })

    it('running with progressUrl: shows img with that src', () => {
        deps.progressUrl = 'blob:http://example.com/latent'
        const wrap = makePreview({ status: 'running', outputs: {} }, deps)
        const img = wrap.querySelector('img')
        expect(img).not.toBeNull()
        expect(img.src).toBe('blob:http://example.com/latent')
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

    it('cancelled with no output: shows check-circle icon (non-failed fallback)', () => {
        const wrap = makePreview({ status: 'cancelled', outputs: {}, promptId: 'p1' }, deps)
        expect(wrap.querySelector('.pi-check-circle')).not.toBeNull()
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
