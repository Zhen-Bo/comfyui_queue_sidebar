import { describe, it, expect, afterEach, vi } from 'vitest'
import { mediaType, showToast } from '../web/lib/helpers.js'

describe('mediaType', () => {
    it.each([
        ['photo.png', 'image'],
        ['photo.jpg', 'image'],
        ['photo.jpeg', 'image'],
        ['photo.gif', 'image'],
        ['photo.webp', 'image'],
        ['photo.avif', 'image'],
        ['photo.svg', 'image'],
    ])('returns "image" for %s', (filename, expected) => {
        expect(mediaType(filename)).toBe(expected)
    })

    it.each([
        ['clip.mp4', 'video'],
        ['clip.webm', 'video'],
        ['clip.ogg', 'video'],
        ['clip.mov', 'video'],
        ['clip.mkv', 'video'],
        ['clip.avi', 'video'],
    ])('returns "video" for %s', (filename, expected) => {
        expect(mediaType(filename)).toBe(expected)
    })

    it.each([
        ['track.mp3', 'audio'],
        ['track.wav', 'audio'],
        ['track.flac', 'audio'],
        ['track.m4a', 'audio'],
        ['track.aac', 'audio'],
    ])('returns "audio" for %s', (filename, expected) => {
        expect(mediaType(filename)).toBe(expected)
    })

    it('returns "unknown" for unrecognized extensions', () => {
        expect(mediaType('data.json')).toBe('unknown')
        expect(mediaType('readme.md')).toBe('unknown')
        expect(mediaType('model.safetensors')).toBe('unknown')
    })

    it('is case-insensitive', () => {
        expect(mediaType('PHOTO.PNG')).toBe('image')
        expect(mediaType('Clip.MP4')).toBe('video')
        expect(mediaType('Track.WAV')).toBe('audio')
    })

    it('handles filenames with multiple dots', () => {
        expect(mediaType('my.file.name.jpg')).toBe('image')
        expect(mediaType('output.v2.mp4')).toBe('video')
    })
})

describe('showToast', () => {
    afterEach(() => {
        vi.useRealTimers()
        document.body.innerHTML = ''
    })

    it('renders a dark-surface toast with a coloured text and border', () => {
        showToast('done', 1500, 'green')
        const toast = document.body.querySelector('div')
        expect(toast.textContent).toBe('done')
        expect(toast.style.color).toBe('green')
        expect(toast.style.border).toContain('green')
        expect(toast.style.backgroundColor).toContain('rgb(26, 26, 26)') // #1a1a1a
    })

    it('shows only one toast at a time (removes any existing toast first)', () => {
        showToast('first')
        showToast('second')
        const toasts = document.body.querySelectorAll('.queue-sidebar-toast')
        expect(toasts.length).toBe(1)
        expect(toasts[0].textContent).toBe('second')
    })

    it('starts below and transparent so it can slide up and fade in', () => {
        showToast('hi')
        // Synchronously after append (before the rAF that animates it into place).
        const toast = document.body.querySelector('.queue-sidebar-toast')
        expect(toast.style.opacity).toBe('0')
        expect(toast.style.transform).toContain('16px') // offset below resting position
    })

    it('removes the toast after the (halved) default duration', () => {
        vi.useFakeTimers()
        showToast('bye')
        expect(document.body.querySelector('div')).not.toBeNull()
        vi.advanceTimersByTime(1500) // default duration → begins fade-out
        vi.advanceTimersByTime(300) // fade transition → removal
        expect(document.body.querySelector('div')).toBeNull()
    })
})
