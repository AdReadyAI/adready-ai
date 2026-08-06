import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Dropzone from './Dropzone'

function makeFile(name: string, type: string) {
  return new File(['content'], name, { type })
}

describe('Dropzone', () => {
  const onFilesSelected = vi.fn()

  beforeEach(() => {
    onFilesSelected.mockClear()
  })

  it('opens the native file picker when clicked (click-to-browse)', () => {
    render(<Dropzone onFilesSelected={onFilesSelected} accept="video/mp4" label="Drop videos here" />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    // Stub the implementation instead of calling through: a real .click()
    // dispatches a genuine bubbling click event, which re-triggers the
    // dropzone div's onClick handler and calls input.click() again.
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {})

    fireEvent.click(screen.getByText(/Drop videos here/))

    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('passes the chosen file through on change (click-to-browse selection)', () => {
    render(<Dropzone onFilesSelected={onFilesSelected} accept="video/mp4" label="Drop videos here" />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = makeFile('clip.mp4', 'video/mp4')

    fireEvent.change(input, { target: { files: [file] } })

    expect(onFilesSelected).toHaveBeenCalledWith([file])
  })

  it('passes dropped files through on drop (drag-and-drop)', () => {
    render(<Dropzone onFilesSelected={onFilesSelected} accept="video/mp4" label="Drop videos here" />)
    const file = makeFile('clip.mp4', 'video/mp4')

    fireEvent.drop(screen.getByText(/Drop videos here/), { dataTransfer: { files: [file] } })

    expect(onFilesSelected).toHaveBeenCalledWith([file])
  })

  it('sets the accept attribute on the underlying input so the OS picker can filter by type', () => {
    render(<Dropzone onFilesSelected={onFilesSelected} accept="image/png,image/jpeg" label="Drop images here" />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement

    expect(input).toHaveAttribute('accept', 'image/png,image/jpeg')
  })
})
