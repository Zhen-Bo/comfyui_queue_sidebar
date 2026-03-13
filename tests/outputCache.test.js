import { describe, it, expect, beforeEach } from 'vitest'
import {
    saveOutputCache,
    loadOutputCache,
    firstOutput,
    OUTPUT_CACHE_KEY,
    OUTPUT_CACHE_MAX,
} from '../web/lib/outputCache.js'

// clear localStorage before every test to ensure isolation across all describe blocks
beforeEach(() => localStorage.clear())

describe('loadOutputCache', () => {
    it('returns null for unknown promptId', () => {
        expect(loadOutputCache('nonexistent')).toBeNull()
    })

    it('returns null when localStorage value is corrupt JSON', () => {
        localStorage.setItem(OUTPUT_CACHE_KEY, 'not-valid-json{{{')
        expect(loadOutputCache('any')).toBeNull()
    })

    it('returns null for null or undefined promptId', () => {
        expect(loadOutputCache(null)).toBeNull()
        expect(loadOutputCache(undefined)).toBeNull()
    })
})

describe('saveOutputCache', () => {
    it('round-trips an output object', () => {
        const output = { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] }
        saveOutputCache('prompt-1', output)
        expect(loadOutputCache('prompt-1')).toEqual(output)
    })

    it('overwrites existing entry for the same promptId', () => {
        const first = { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] }
        const second = { images: [{ filename: 'b.png', subfolder: '', type: 'output' }] }
        saveOutputCache('prompt-1', first)
        saveOutputCache('prompt-1', second)
        expect(loadOutputCache('prompt-1')).toEqual(second)
    })

    it('returns null for a different promptId', () => {
        saveOutputCache('prompt-1', { images: [{ filename: 'a.png' }] })
        expect(loadOutputCache('prompt-2')).toBeNull()
    })

    it('does not write to cache for falsy promptId', () => {
        saveOutputCache(null, { filename: 'img.png', subfolder: '', type: 'output' })
        saveOutputCache(undefined, { filename: 'img.png', subfolder: '', type: 'output' })
        // cache 應維持空白
        const raw = localStorage.getItem(OUTPUT_CACHE_KEY)
        expect(raw).toBeNull()
    })

    it('evicts the oldest entry when exceeding OUTPUT_CACHE_MAX', () => {
        for (let i = 0; i < OUTPUT_CACHE_MAX; i++) {
            saveOutputCache(`p-${i}`, { filename: `img-${i}.png`, subfolder: '', type: 'temp' })
        }
        saveOutputCache('p-overflow', { filename: 'overflow.png', subfolder: '', type: 'temp' })

        expect(loadOutputCache('p-0')).toBeNull()                            // 被踢出
        expect(loadOutputCache('p-1')).not.toBeNull()                        // 仍保留
        expect(loadOutputCache(`p-${OUTPUT_CACHE_MAX - 1}`)).not.toBeNull()  // 仍保留
        expect(loadOutputCache('p-overflow')).not.toBeNull()                 // 新增的存在
    })
})

describe('firstOutput', () => {
    it('returns null when outputs is empty', () => {
        expect(firstOutput({}, 'prompt-1')).toBeNull()
    })

    it('returns the first image found in dict order (no cache)', () => {
        const outputs = {
            nodeA: { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] },
            nodeB: { images: [{ filename: 'b.png', subfolder: '', type: 'output' }] },
        }
        expect(firstOutput(outputs, 'no-cache')).toEqual({ filename: 'a.png', subfolder: '', type: 'output' })
    })

    it('returns cached output when promptId matches, ignoring dict order', () => {
        const cached = { filename: 'cached.png', subfolder: 'sub', type: 'output' }
        saveOutputCache('prompt-cached', cached)
        const outputs = {
            nodeA: { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] },
        }
        expect(firstOutput(outputs, 'prompt-cached')).toEqual(cached)
    })

    it('falls back to dict iteration when cache misses', () => {
        const outputs = {
            nodeA: { images: [{ filename: 'fallback.png', subfolder: '', type: 'output' }] },
        }
        expect(firstOutput(outputs, 'cache-miss')).toEqual({ filename: 'fallback.png', subfolder: '', type: 'output' })
    })

    it('returns null when outputs contains only empty arrays', () => {
        const outputs = {
            nodeA: { images: [] },
            nodeB: { gifs: [] },
        }
        expect(firstOutput(outputs, 'prompt-empty')).toBeNull()
    })

    it.each([
        ['gifs',  { gifs:  [{ filename: 'anim.gif', subfolder: '', type: 'output' }] }, { filename: 'anim.gif', subfolder: '', type: 'output' }],
        ['video', { video: { filename: 'clip.mp4', subfolder: '', type: 'output' } },   { filename: 'clip.mp4', subfolder: '', type: 'output' }],
        ['audio', { audio: { filename: 'sound.wav', subfolder: '', type: 'output' } },  { filename: 'sound.wav', subfolder: '', type: 'output' }],
    ])('returns item for %s key', (_key, nodeOut, expected) => {
        expect(firstOutput({ n: nodeOut }, undefined)).toEqual(expected)
    })

    it('prefers images key over later keys in the same node', () => {
        const imgItem = { filename: 'img.png', subfolder: '', type: 'output' }
        const gifItem = { filename: 'anim.gif', subfolder: '', type: 'output' }
        const outputs = {
            nodeA: {
                images: [imgItem],
                gifs: [gifItem],
            },
        }
        expect(firstOutput(outputs, 'prompt-prefer')).toEqual(imgItem)
    })
})
