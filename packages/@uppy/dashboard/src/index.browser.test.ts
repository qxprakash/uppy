import Uppy from '@uppy/core'
import { page, userEvent } from '@vitest/browser/context'
import { expect, test, vi } from 'vitest'
import Dashboard from './Dashboard.js'
import Tus from '@uppy/tus'
import '@uppy/core/dist/style.css';
import '@uppy/dashboard/dist/style.css';

// Normally you would use one of vitest's framework renderers, such as vitest-browser-react,
// but that's overkill for us so we write our own plain HTML renderer.
function render(html: string) {
  document.body.innerHTML = ''
  const root = document.createElement('main')
  root.innerHTML = html
  document.body.appendChild(root)
  return root
}


test('Upload, pause, and resume functionality', async () => {
  render('<div id="uppy"></div>')

  const TUS_ENDPOINT = 'https://tusd.tusdemo.net/files/'

  const uppy = new Uppy().use(Dashboard, {
    target: '#uppy',
    inline: true,
  })
  uppy.use(Tus, {
    endpoint: TUS_ENDPOINT,
  })

  const fileInput = document.getElementsByClassName('uppy-Dashboard-input')[0]
  // Use a much larger file to ensure upload takes a reasonable amount of time
  await userEvent.upload(
    fileInput,
    new File(['a'.repeat(500000)], 'test.txt'), // 500KB file for slower upload
  )

  // Wait for file to be added and upload button to appear
  await expect.element(page.getByText('test.txt')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Upload 1 file' }),
  ).toBeInTheDocument()

  // Start the upload
  await page.getByRole('button', { name: 'Upload 1 file' }).click()

  // Give a moment for the upload to start and UI to update
  await new Promise(resolve => setTimeout(resolve, 1000))

  // Verify upload has started by checking StatusBar state
  const statusBar = document.querySelector('.uppy-StatusBar')
  const hasUploadingClass = statusBar?.classList.contains('is-uploading')

  if (!hasUploadingClass) {
    throw new Error('Upload state not detected - StatusBar should have is-uploading class')
  }

  // Find and click pause button
  const pauseButton = document.querySelector('button[title="Pause"]')
  if (!pauseButton) {
    throw new Error('Pause button not found')
  }
  pauseButton.click()

  // Wait a moment for the button to change to resume
  await new Promise(resolve => setTimeout(resolve, 200))

  // Find and click resume button
  const resumeButton = document.querySelector('button[title="Resume"]') || document.querySelector('button[aria-label="Resume"]')
  if (!resumeButton) {
    throw new Error('Resume button not found')
  }
  resumeButton.click()

  // Verify upload is still in progress after pause/resume cycle
  const finalStatusBar = document.querySelector('.uppy-StatusBar')
  const finalStatusText = document.querySelector('.uppy-StatusBar-statusPrimary')?.textContent || ''

  // The upload should still be in uploading state (showing progress or "Uploading")
  const isStillUploading = finalStatusBar?.classList.contains('is-uploading') ||
                          finalStatusText.includes('Uploading') ||
                          finalStatusText.match(/\d+%/)

  if (!isStillUploading) {
    throw new Error('Upload should still be in progress after pause/resume cycle')
  }

  // Test passed! We successfully verified:
  // 1. Upload starts and shows uploading state
  // 2. Pause button is available and clickable
  // 3. Resume button appears after pause and is clickable
  // 4. Upload continues after resume
})

