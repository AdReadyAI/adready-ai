import { describe, expect, it } from 'vitest'
import { sanitizeFilename } from './sanitizeFilename'

describe('sanitizeFilename', () => {
  it('strips diacritics down to their base letter', () => {
    expect(sanitizeFilename('café.mp4')).toBe('cafe.mp4')
  })

  it('replaces "#" and other unsafe characters with underscores', () => {
    expect(sanitizeFilename('video#1.mp4')).toBe('video_1.mp4')
  })

  it('collapses repeated underscores into one', () => {
    expect(sanitizeFilename('my   video   clip.mp4')).toBe('my_video_clip.mp4')
  })

  it('preserves the file extension', () => {
    expect(sanitizeFilename('naïve résumé.MP4')).toBe('naive_resume.MP4')
  })
})
