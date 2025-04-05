import Uppy from '@uppy/core';
import Dashboard from '@uppy/dashboard';
import AwsS3 from '@uppy/aws-s3';

import '@uppy/core/dist/style.css';
import '@uppy/dashboard/dist/style.css';
const ENDPOINT = 'https://localhost:8080/';
function onUploadComplete(result) {
  console.log(
    'Upload complete! We\'ve uploaded these files: ----> ',
    result.successful,
  )
}



function onUploadSuccess(file, data) {
  console.log(
    'Upload success! We\'ve uploaded this file:',
    file.meta['name'],
  )
}

// Initialize server-side signing instance
{
  const uppy = new Uppy({ debug: true })
    .use(Dashboard, {
      inline: true,
      target: '#uppy-sign-on-server',
      showProgressDetails: true,
      proudlyDisplayPoweredByUppy: true,
    })
    .use(AwsS3, {
      id: 'myAWSPlugin',
      endpoint: ENDPOINT,
    })

  uppy.on('complete', onUploadComplete)
  uppy.on('upload-success', onUploadSuccess)

  // Make uppy available in window scope for server-side signing
  window.uppyServerSign = uppy;
}

// Initialize client-side signing instance (if WebCrypto is available)
{
  const uppy = new Uppy({ debug: true })
    .use(Dashboard, {
      inline: true,
      target: '#uppy-sign-on-client',
      showProgressDetails: true,
      proudlyDisplayPoweredByUppy: true,
    })
    .use(AwsS3, {
      id: 'myAWSPlugin',
      endpoint: ENDPOINT,
      getTemporarySecurityCredentials: typeof crypto?.subtle === 'object',
    })

  uppy.on('complete', onUploadComplete)
  uppy.on('upload-success', onUploadSuccess)
  uppy.on('upload-error', (file, error) => {
    // <--- Log the error
    console.log("Upload error:", error);
    console.log("File:", file);
  });
  // Make uppy available in window scope for client-side signing
  window.uppyClientSign = uppy;
}

// Add global methods similar to your first example
window.uppyUpload = async () => {
  console.log(`uppy upload --> clicked`);
  console.error('start');
  try {
    // Try to upload with both instances
    const serverResults = await window.uppyServerSign.upload();
    console.log('Server upload results -->', serverResults);

    if (window.uppyClientSign) {
      const clientResults = await window.uppyClientSign.upload();
      console.log('Client upload results -->', clientResults);
    }
  } catch(err) {
    console.error('error occurred in uppy.upload()', err);
  }
};

window.uppyRetry = async () => {
  console.log('retry clicked');
  try {
    // Try to retry with both instances
    const serverResults = await window.uppyServerSign.retryAll();
    console.log('Server retry results -->', serverResults);

    if (window.uppyClientSign) {
      const clientResults = await window.uppyClientSign.retryAll();
      console.log('Client retry results -->', clientResults);
    }
  } catch(err) {
    console.error('error occurred in uppy.retryAll()', err);
  }
};

console.log('AWS Uppy example initialized');