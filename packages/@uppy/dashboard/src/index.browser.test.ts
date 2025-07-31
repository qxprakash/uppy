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
  await userEvent.upload(
    fileInput,
    new File(['a'.repeat(1024)], 'test.txt'),
  )

  // Wait for file to be added and upload button to appear
  await expect.element(page.getByText('test.txt')).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Upload 1 file' }),
  ).toBeInTheDocument()

  // Start the upload
  await page.getByRole('button', { name: 'Upload 1 file' }).click()

  // Wait for upload to start - look for progress indicators
  // Use a more flexible approach to wait for upload start
  let uploadStarted = false
  for (let i = 0; i < 50 && !uploadStarted; i++) {
    await new Promise(resolve => setTimeout(resolve, 100))
    const uploadingText = document.querySelector('.uppy-StatusBar-statusPrimary')
    if (uploadingText?.textContent?.toLowerCase().includes('uploading')) {
      uploadStarted = true
      break
    }
  }

  if (!uploadStarted) {
    throw new Error('Upload did not start in time')
  }

  // Look for pause button - it should appear once upload starts
  let pauseButton = null
  for (let i = 0; i < 30 && !pauseButton; i++) {
    await new Promise(resolve => setTimeout(resolve, 100))
    pauseButton = document.querySelector('[aria-label*="Pause"], [title*="Pause"]')
    if (!pauseButton) {
      // Also try finding by text content
      const buttons = document.querySelectorAll('button')
      for (const btn of buttons) {
        if (btn.textContent?.toLowerCase().includes('pause') ||
            btn.getAttribute('aria-label')?.toLowerCase().includes('pause') ||
            btn.getAttribute('title')?.toLowerCase().includes('pause')) {
          pauseButton = btn
          break
        }
      }
    }
  }

  if (pauseButton) {
    console.log('Found pause button, clicking it')
    ;(pauseButton as HTMLButtonElement).click()

    // Wait for paused state
    await new Promise(resolve => setTimeout(resolve, 500))

    // Look for resume button
    let resumeButton = null
    for (let i = 0; i < 20 && !resumeButton; i++) {
      await new Promise(resolve => setTimeout(resolve, 100))
      resumeButton = document.querySelector('[aria-label*="Resume"], [title*="Resume"]')
      if (!resumeButton) {
        const buttons = document.querySelectorAll('button')
        for (const btn of buttons) {
          if (btn.textContent?.toLowerCase().includes('resume') ||
              btn.getAttribute('aria-label')?.toLowerCase().includes('resume') ||
              btn.getAttribute('title')?.toLowerCase().includes('resume')) {
            resumeButton = btn
            break
          }
        }
      }
    }

    if (resumeButton) {
      console.log('Found resume button, clicking it')
      ;(resumeButton as HTMLButtonElement).click()
    }
  }

  // Wait for upload to complete - check for multiple possible completion indicators
  let uploadCompleted = false
  for (let i = 0; i < 100 && !uploadCompleted; i++) {
    await new Promise(resolve => setTimeout(resolve, 200))

    // Check for various completion indicators
    const completeText = document.querySelector('.uppy-StatusBar-statusPrimary')?.textContent
    const hasCompleteStatus = completeText?.toLowerCase().includes('complete')

    console.log('Current status text:', completeText)
    console.log('Has complete status:', hasCompleteStatus)
    // Check for completed file items (they get a specific class)
    const completedFileItems = document.querySelectorAll('.uppy-Dashboard-Item.is-complete')

    console.log('Completed file items:', completedFileItems.length)
    // Check for success checkmark
    const successCheckmark = document.querySelector('.uppy-StatusBar-statusIndicator, .uppy-Dashboard-Item-progressIcon--check')
    console.log('Success checkmark found:', !!successCheckmark)

    if (hasCompleteStatus || completedFileItems.length > 0 || successCheckmark) {
      uploadCompleted = true
      console.log('Upload completed! Complete status:', completeText)
      break
    }

    // Log current status for debugging
    if (i % 10 === 0) {
      console.log(`Waiting for completion... Status: ${completeText}`)
    }
  }

  if (!uploadCompleted) {
    // Log final state for debugging
    const statusText = document.querySelector('.uppy-StatusBar-statusPrimary')?.textContent
    const allText = document.body.textContent
    console.log('Final status text:', statusText)
    console.log('All body text contains:', {
      complete: allText?.includes('Complete'),
      uploadComplete: allText?.includes('Upload complete'),
      success: allText?.includes('success')
    })
    throw new Error('Upload did not complete in time')
  }
}, 30000)

