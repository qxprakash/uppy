import Uppy from '@uppy/core'
import Dashboard from '@uppy/dashboard'
import AwsS3 from '@uppy/aws-s3'
import '@uppy/core/dist/style.css';
import '@uppy/dashboard/dist/style.css';


const ENDPOINT = 'http://localhost:8080/'
function onUploadComplete(result) {
  console.log(
    'Upload complete! We’ve uploaded these files: ---->',
    result.successful,
  )
}
function onUploadSuccess(file, data) {
  console.log(
    'Upload success! We’ve uploaded this file:',
    file.meta['name'],
  )
}
{
  const uppy = new Uppy()
    .use(Dashboard, {
      inline: true,
      target: '#uppy-sign-on-server',
    })
    .use(AwsS3, {
      id: 'myAWSPlugin',
      endpoint: ENDPOINT,
    })

  uppy.on('complete', onUploadComplete)
  uppy.on('upload-success', onUploadSuccess)
  uppy.on('upload-error', (file, error, response) => {
    console.log('Upload error: -----> ', error)
    console.log('file: ------> ', file)
    console.log('response: ------> ', response)
  })
}
{
  const uppy = new Uppy()
    .use(Dashboard, {
      inline: true,
      target: '#uppy-sign-on-client',
    })
    .use(AwsS3, {
      id: 'myAWSPlugin',
      endpoint: ENDPOINT,
      getTemporarySecurityCredentials: typeof crypto?.subtle === 'object',
    })

  uppy.on('complete', onUploadComplete)
  uppy.on('upload-success', onUploadSuccess)
}