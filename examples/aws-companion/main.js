import AwsS3 from '@uppy/aws-s3'
import Uppy from '@uppy/core'
import Dashboard from '@uppy/dashboard'
import GoogleDrive from '@uppy/google-drive'
import Webcam from '@uppy/webcam'

import '@uppy/core/css/style.css'
import '@uppy/dashboard/css/style.css'
import '@uppy/webcam/css/style.css'

const uppy = new Uppy({
  debug: true,
  autoProceed: false,
})

uppy.use(GoogleDrive, {
  companionUrl: 'http://localhost:3020',
})
uppy.use(Webcam)
uppy.use(Dashboard, {
  inline: true,
  target: 'body',
  plugins: ['GoogleDrive', 'Webcam'],
})
uppy.use(AwsS3, {
  s3Endpoint: "https://testbucketnewfix.s3.eu-north-1.amazonaws.com",
  companionEndpoint: 'http://localhost:3020',
})

uppy.on('upload-success', (file, data) => {
  console.log('Upload success:', file.name, data)
})
uppy.on('upload-error', (file, error) => {
  console.error('Upload error:', file?.name, error)
})
