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
    const clickSpy = vi.spyOn(input, 'click')

    // The label shares its element with a leading arrow glyph ("↑  {label}"),
    // so the element's exact text isn't "Drop videos here" — match on
    // substring instead of an exact string.
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
