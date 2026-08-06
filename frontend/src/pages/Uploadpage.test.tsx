// VideoCard/removeVideo and ImageUploadSection's logo-vs-product_image
// classification are exercised here rather than in isolated component
// tests, since the actual state and handlers they depend on (storage
// upload/remove calls, kind classification) live in UploadPage, not in
// those presentational components themselves.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import UploadPage from './UploadPage'

const { uploadMock, removeMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  removeMock: vi.fn(),
}))

vi.mock('../lib/supabaseClient', () => ({
  supabase: {
    storage: {
      from: () => ({ upload: uploadMock, remove: removeMock }),
    },
  },
}))

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-123' } }),
}))

// UploadPage renders CampaignSection -> CampaignForm, which calls
// useNavigate(). Mock it here too so the full page tree can render without
// a real <Router> around it.
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

// user-123/<batchId uuid>/video/<video id uuid>/<filename>
const VIDEO_PATH_PATTERN = /^user-123\/[0-9a-f-]{36}\/video\/[0-9a-f-]{36}\/ad\.mp4$/

function makeFile(name: string, type: string) {
  return new File(['content'], name, { type })
}

function getVideoInput() {
  return document.querySelectorAll('input[type="file"]')[0] as HTMLInputElement
}

function getImageInput() {
  return document.querySelectorAll('input[type="file"]')[1] as HTMLInputElement
}

// Sidebar (rendered alongside the upload sections) has its own static "✓"
// checkmarks in its "What we'll analyze" list, unrelated to upload status —
// so a page-wide getByText('✓') is ambiguous. Scope to the specific card
// via its remove button instead.
function getVideoCard(filename: string) {
  return screen.getByRole('button', { name: `Remove ${filename}` }).closest('.bg-white') as HTMLElement
}

describe('UploadPage', () => {
  beforeEach(() => {
    uploadMock.mockReset()
    removeMock.mockReset()
  })

  it('filters out non-video files selected in the video dropzone', () => {
    render(<UploadPage />)
    const notVideo = makeFile('photo.png', 'image/png')

    fireEvent.change(getVideoInput(), { target: { files: [notVideo] } })

    expect(screen.queryByText('photo.png')).not.toBeInTheDocument()
  })

  it('filters out non-image files selected in the image dropzone', () => {
    render(<UploadPage />)
    const notImage = makeFile('clip.mp4', 'video/mp4')

    fireEvent.change(getImageInput(), { target: { files: [notImage] } })

    expect(screen.queryByText('clip.mp4')).not.toBeInTheDocument()
  })

  it('transitions a video from uploading to done on a successful upload', async () => {
    uploadMock.mockResolvedValue({ error: null })
    render(<UploadPage />)
    const file = makeFile('ad.mp4', 'video/mp4')

    fireEvent.change(getVideoInput(), { target: { files: [file] } })

    // Synchronous: the "uploading" state is set before the upload promise
    // resolves, so the spinner should already be visible here.
    expect(screen.getByText('ad.mp4')).toBeInTheDocument()
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()

    await waitFor(() => expect(within(getVideoCard('ad.mp4')).getByText('✓')).toBeInTheDocument())
    expect(uploadMock).toHaveBeenCalledWith(
      expect.stringMatching(VIDEO_PATH_PATTERN),
      file,
      { contentType: 'video/mp4' },
    )
  })

  it('transitions a video from uploading to error on a failed upload', async () => {
    uploadMock.mockResolvedValue({ error: { message: 'network error' } })
    render(<UploadPage />)
    const file = makeFile('ad.mp4', 'video/mp4')

    fireEvent.change(getVideoInput(), { target: { files: [file] } })

    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('!')).toBeInTheDocument())
  })

  it('calls storage.remove with the correct path and drops the video from state', async () => {
    uploadMock.mockResolvedValue({ error: null })
    removeMock.mockResolvedValue({ error: null })
    render(<UploadPage />)
    const file = makeFile('ad.mp4', 'video/mp4')

    fireEvent.change(getVideoInput(), { target: { files: [file] } })
    await waitFor(() => expect(within(getVideoCard('ad.mp4')).getByText('✓')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Remove ad.mp4' }))

    await waitFor(() => expect(screen.queryByText('ad.mp4')).not.toBeInTheDocument())
    expect(removeMock).toHaveBeenCalledWith([expect.stringMatching(VIDEO_PATH_PATTERN)])
  })

  it('sanitizes accented and unsafe characters in the uploaded filename before building the storage path', async () => {
    uploadMock.mockResolvedValue({ error: null })
    render(<UploadPage />)
    const file = makeFile('café #1.mp4', 'video/mp4')

    fireEvent.change(getVideoInput(), { target: { files: [file] } })

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(1))
    const path = uploadMock.mock.calls[0][0] as string
    expect(path.endsWith('/cafe_1.mp4')).toBe(true)
    expect(path).not.toContain('é')
    expect(path).not.toContain('#')
  })

  it('classifies a file named "logo.<ext>" as logo, and everything else as product_image', async () => {
    uploadMock.mockResolvedValue({ error: null })
    render(<UploadPage />)
    const logoFile = makeFile('logo.png', 'image/png')
    const bannerFile = makeFile('banner.png', 'image/png')

    fireEvent.change(getImageInput(), { target: { files: [logoFile, bannerFile] } })

    await waitFor(() => expect(uploadMock).toHaveBeenCalledTimes(2))

    const paths = uploadMock.mock.calls.map((call) => call[0] as string)
    expect(paths.some((p) => p.includes('/logo/'))).toBe(true)
    expect(paths.some((p) => p.includes('/product_image/'))).toBe(true)
  })
})
