// Validation logic only, per task scope — the submit handler itself is
// intentionally not exercised here since it's about to change.

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CampaignForm from './CampaignForm'
import type { UploadedVideo, UploadedImage } from '../../../pages/UploadPage'

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

function makeVideo(status: UploadedVideo['status']): UploadedVideo {
  return {
    id: crypto.randomUUID(),
    file: new File(['x'], 'video.mp4', { type: 'video/mp4' }),
    filename: 'video.mp4',
    storagePath: status === 'done' ? 'path/video.mp4' : null,
    status,
  }
}

const noImages: UploadedImage[] = []

async function fillCreateFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Product URL'), 'https://example.com')
  await user.selectOptions(screen.getByLabelText('Campaign Goal'), 'Brand Awareness')
  await user.type(screen.getByLabelText('Creative Brief'), 'A great ad about a great product.')
}

function submitButton() {
  return screen.getByRole('button', { name: /Run AdReady Review/i })
}

describe('CampaignForm validation', () => {
  it('disables submit when nothing has been filled in', () => {
    render(<CampaignForm videos={[]} images={noImages} requestId="req-1" />)
    expect(submitButton()).toBeDisabled()
  })

  it('stays disabled when required fields are filled but no video is done', async () => {
    const user = userEvent.setup()
    render(<CampaignForm videos={[makeVideo('uploading')]} images={noImages} requestId="req-1" />)

    await fillCreateFields(user)

    expect(submitButton()).toBeDisabled()
  })

  it('stays disabled while any video is still uploading, even if another video is done', async () => {
    const user = userEvent.setup()
    render(
      <CampaignForm
        videos={[makeVideo('done'), makeVideo('uploading')]}
        images={noImages}
        requestId="req-1"
      />,
    )

    await fillCreateFields(user)

    expect(submitButton()).toBeDisabled()
  })

  it('enables submit once required fields are filled and every video is done', async () => {
    const user = userEvent.setup()
    render(<CampaignForm videos={[makeVideo('done')]} images={noImages} requestId="req-1" />)

    await fillCreateFields(user)

    expect(submitButton()).toBeEnabled()
  })

  it('validates the existing-campaign path against the campaign selector instead', async () => {
    const user = userEvent.setup()
    render(<CampaignForm videos={[makeVideo('done')]} images={noImages} requestId="req-1" />)

    await user.click(screen.getByRole('button', { name: 'Use existing campaign' }))
    expect(submitButton()).toBeDisabled()

    await user.selectOptions(screen.getByLabelText('Select campaign'), 'Summer Sale 2026')

    expect(submitButton()).toBeEnabled()
  })
})
