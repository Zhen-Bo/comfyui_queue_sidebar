import { describe, it, expect, beforeEach } from 'vitest'
import {
    saveOutputCache,
    loadOutputCache,
    firstOutput,
    taskOutputs,
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

    it('normalises a legacy bare-object entry into a one-element array on read', () => {
        // Entries written before the cache held arrays are a bare descriptor object.
        const legacy = { filename: 'legacy.png', subfolder: '', type: 'output' }
        localStorage.setItem(OUTPUT_CACHE_KEY, JSON.stringify({ 'prompt-legacy': legacy }))
        expect(loadOutputCache('prompt-legacy')).toEqual([legacy])
        expect(firstOutput({}, 'prompt-legacy')).toEqual(legacy)
    })
})

describe('saveOutputCache', () => {
    it('round-trips an array of output items', () => {
        const items = [
            { filename: 'a.png', subfolder: '', type: 'output' },
            { filename: 'b.png', subfolder: '', type: 'output' },
        ]
        saveOutputCache('prompt-1', items)
        expect(loadOutputCache('prompt-1')).toEqual(items)
    })

    it('overwrites existing entry for the same promptId with a new array', () => {
        const first = [{ filename: 'a.png', subfolder: '', type: 'output' }]
        const second = [
            { filename: 'b0.png', subfolder: '', type: 'output' },
            { filename: 'b1.png', subfolder: '', type: 'output' },
        ]
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

describe('taskOutputs / firstOutput', () => {
    it('returns null when outputs is empty', () => {
        expect(firstOutput({}, 'prompt-1')).toBeNull()
    })

    it('returns all items from the first node found in dict order (no cache)', () => {
        const a0 = { filename: 'a0.png', subfolder: '', type: 'output' }
        const a1 = { filename: 'a1.png', subfolder: '', type: 'output' }
        const outputs = {
            nodeA: { images: [a0, a1] },
            nodeB: { images: [{ filename: 'b.png', subfolder: '', type: 'output' }] },
        }
        expect(taskOutputs(outputs, 'no-cache')).toEqual([a0, a1])
    })

    it('cache selects the winning node for multi-stage workflows — later save wins, in full', () => {
        const early = [{ filename: 'early.png', subfolder: '', type: 'output' }]
        const final = [
            { filename: 'final0.png', subfolder: '', type: 'output' },
            { filename: 'final1.png', subfolder: '', type: 'output' },
        ]
        saveOutputCache('prompt-multi', early)
        saveOutputCache('prompt-multi', final)
        // Without the cache, dict iteration below would resolve to the early node.
        const outputs = { nodeEarly: { images: early } }
        expect(taskOutputs(outputs, 'prompt-multi')).toEqual(final)
        expect(firstOutput(outputs, 'prompt-multi')).toEqual(final[0])
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
        ['gifs',  { gifs:  [{ filename: 'a.gif', subfolder: '', type: 'output' }, { filename: 'b.gif', subfolder: '', type: 'output' }] }, [{ filename: 'a.gif', subfolder: '', type: 'output' }, { filename: 'b.gif', subfolder: '', type: 'output' }]],
        ['video', { video: { filename: 'clip.mp4', subfolder: '', type: 'output' } },   [{ filename: 'clip.mp4', subfolder: '', type: 'output' }]],
        ['audio', { audio: { filename: 'sound.wav', subfolder: '', type: 'output' } },  [{ filename: 'sound.wav', subfolder: '', type: 'output' }]],
    ])('%s: an array is preserved in full, a scalar normalises to a one-element array', (_key, nodeOut, expected) => {
        expect(taskOutputs({ n: nodeOut }, undefined)).toEqual(expected)
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

    it('expands only the first matching node — never accumulates across nodes', () => {
        // This is the core invariant: enumerating every node would put an upscale
        // workflow's 512px base image next to its 2048px result.
        const a0 = { filename: 'a0.png', subfolder: '', type: 'output' }
        const a1 = { filename: 'a1.png', subfolder: '', type: 'output' }
        const b0 = { filename: 'b0.png', subfolder: '', type: 'output' }
        const b1 = { filename: 'b1.png', subfolder: '', type: 'output' }
        const outputs = {
            nodeA: { images: [a0, a1] },
            nodeB: { images: [b0, b1] },
        }
        const result = taskOutputs(outputs, 'prompt-cross-node')
        expect(result).toEqual([a0, a1])
        expect(result).not.toContainEqual(b0)
        expect(result).not.toContainEqual(b1)
    })

    it('firstOutput contract is unchanged: single descriptor for both a singleton and a batch cache entry', () => {
        const singleton = { filename: 'single.png', subfolder: '', type: 'output' }
        saveOutputCache('prompt-singleton', [singleton])
        expect(firstOutput({}, 'prompt-singleton')).toEqual(singleton)

        const batch = [
            { filename: 'batch0.png', subfolder: '', type: 'output' },
            { filename: 'batch1.png', subfolder: '', type: 'output' },
            { filename: 'batch2.png', subfolder: '', type: 'output' },
        ]
        saveOutputCache('prompt-batch', batch)
        expect(firstOutput({}, 'prompt-batch')).toEqual(batch[0])
    })
})
