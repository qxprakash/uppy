import Uppy from '@uppy/core'
import { page, userEvent } from '@vitest/browser/context'
import { expect, test, vi } from 'vitest'
import Dashboard from './Dashboard.js'
import MockUploader from './MockUploader.js'

// Normally you would use one of vitest's framework renderers, such as vitest-browser-react,
// but that's overkill for us so we write our own plain HTML renderer.
function render(html: string) {
  document.body.innerHTML = ''
  const root = document.createElement('main')
  root.innerHTML = html
  document.body.appendChild(root)
  return root
}

test('Basic Dashboard functionality works in the browser', async () => {
  render('<div id="uppy"></div>')
  new Uppy().use(Dashboard, {
    target: '#uppy',
    inline: true,
    metaFields: [{ id: 'license', name: 'License' }],
  })

  await expect.element(page.getByText('Drop files here')).toBeVisible()
  const fileInput = document.getElementsByClassName('uppy-Dashboard-input')[0]
  await userEvent.upload(fileInput, new File(['Hello, World!'], 'test.txt'))
  await expect.element(page.getByText('test.txt')).toBeVisible()
  await page.getByTitle('Edit file test.txt').click()
  const licenseInput = page.getByLabelText('License')
  await expect.element(licenseInput).toBeVisible()
  await userEvent.fill(licenseInput.element(), 'MIT')
  await page.getByText('Save changes').click()
})

test('Upload, pause, and resume functionality', async () => {
  vi.useFakeTimers()
  render('<div id="uppy"></div>')
  const uppy = new Uppy().use(Dashboard, {
    target: '#uppy',
    inline: true,
  })
  uppy.use(MockUploader, {
    shouldSucceed: true,
  })

  const fileInput = document.getElementsByClassName('uppy-Dashboard-input')[0]
  await userEvent.upload(
    fileInput,
    new File(['a'.repeat(1024)], 'test.txt'),
  )
  await page.getByRole('button', { name: 'Upload 1 file' }).click()

  await vi.advanceTimersByTimeAsync(150)
  await expect.element(page.getByText('uploading…')).toBeVisible()

  await page.getByRole('button', { name: 'Pause upload' }).click()
  await expect.element(page.getByText('Paused')).toBeVisible()

  await page.getByRole('button', { name: 'Resume upload' }).click()
  await vi.runAllTimersAsync()

  await expect.element(page.getByText('Complete')).toBeVisible()
  vi.useRealTimers()
})

test('Cancel button', async () => {
  vi.useFakeTimers()
  render('<div id="uppy"></div>')
  const uppy = new Uppy().use(Dashboard, {
    target: '#uppy',
    inline: true,
  })
  uppy.use(MockUploader, {
    shouldSucceed: true,
  })

  const fileInput = document.getElementsByClassName('uppy-Dashboard-input')[0]
  await userEvent.upload(
    fileInput,
    new File(['a'.repeat(1024)], 'test.txt'),
  )
  await page.getByRole('button', { name: 'Upload 1 file' }).click()

  await vi.advanceTimersByTimeAsync(150)
  await expect.element(page.getByText('39%')).toBeVisible()

  await page.getByRole('button', { name: 'Cancel upload' }).click()
  await expect.element(page.getByText('Upload cancelled')).toBeVisible()
  vi.useRealTimers()
})

test('Failing upload', async () => {
  vi.useFakeTimers()
  render('<div id="uppy"></div>')
  const uppy = new Uppy().use(Dashboard, {
    target: '#uppy',
    inline: true,
  })
  uppy.use(MockUploader, {
    shouldSucceed: false,
  })

  const fileInput = document.getElementsByClassName('uppy-Dashboard-input')[0]
  await userEvent.upload(
    fileInput,
    new File(['a'.repeat(1024)], 'test.txt'),
  )
  await page.getByRole('button', { name: 'Upload 1 file' }).click()

  await vi.runAllTimersAsync()

  await expect.element(page.getByText('Upload failed')).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Retry upload' })).toBeVisible()
  vi.useRealTimers()
})

