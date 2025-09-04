import './style.css'
import '@uppy/core/css/style.min.css'
import '@uppy/dashboard/css/style.min.css'

import { Uppy } from '@uppy/core'
import Dashboard from '@uppy/dashboard'
import Tus from '@uppy/tus'
import  GoldenRetriever  from '@uppy/golden-retriever'

// Initialize Uppy
const uppy = new Uppy({
  debug: true,
  autoProceed: false,
})

// Add the Dashboard plugin
uppy.use(Dashboard, {
  target: '#uppy-dashboard',
  inline: true,
  width: 750,
  height: 550,
  showProgressDetails: true,
  proudlyDisplayPoweredByUppy: true,
  note: 'Upload files using the golden retriever! Max file size: 100MB'
})

// Add TUS uploader
uppy.use(Tus, {
  endpoint: 'https://tusd.tusdemo.net/files/', // Demo TUS server
})

uppy.use(GoldenRetriever)

// Event listeners
uppy.on('complete', (result) => {
  console.log('Upload complete! We uploaded these files:', result.successful)

  if (result.successful.length > 0) {
    // Show success message
    const successDiv = document.createElement('div')
    successDiv.style.cssText = `
      margin-top: 20px;
      padding: 15px;
      background-color: #d4edda;
      border: 1px solid #c3e6cb;
      border-radius: 5px;
      color: #155724;
    `
    successDiv.innerHTML = `
      <strong>✅ Upload Complete!</strong><br>
      Successfully uploaded ${result.successful.length} file(s)
    `

    const existingSuccess = document.querySelector('.upload-success')
    if (existingSuccess) {
      existingSuccess.remove()
    }

    successDiv.className = 'upload-success'
    document.querySelector('#app').appendChild(successDiv)
  }
})

uppy.on('upload-error', (file, error, response) => {
  console.error('Upload error:', error)

  // Show error message
  const errorDiv = document.createElement('div')
  errorDiv.style.cssText = `
    margin-top: 20px;
    padding: 15px;
    background-color: #f8d7da;
    border: 1px solid #f5c6cb;
    border-radius: 5px;
    color: #721c24;
  `
  errorDiv.innerHTML = `
    <strong>❌ Upload Error!</strong><br>
    Failed to upload ${file.name}: ${error.message}
  `

  const existingError = document.querySelector('.upload-error')
  if (existingError) {
    existingError.remove()
  }

  errorDiv.className = 'upload-error'
  document.querySelector('#app').appendChild(errorDiv)
})

uppy.on('upload-progress', (file, progress) => {
  console.log(`Upload progress for ${file.name}: ${progress.bytesUploaded}/${progress.bytesTotal}`)
})

console.log('Golden Retriever Uppy instance initialized!')