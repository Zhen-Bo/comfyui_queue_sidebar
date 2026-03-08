import { describe, it, expect } from 'vitest'
import { mediaType } from '../web/lib/helpers.js'

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
