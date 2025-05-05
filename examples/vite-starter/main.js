import Uppy from '@uppy/core';
import Dashboard from '@uppy/dashboard';
import XHRUpload from '@uppy/xhr-upload';
import ScreenCapture from '@uppy/screen-capture';
import '@uppy/core/dist/style.css';
import '@uppy/dashboard/dist/style.css';
import '@uppy/screen-capture/dist/style.css';
import Tus from '@uppy/tus';

const TUS_ENDPOINT = 'https://tusd.tusdemo.net/files/';

// Check if browser supports screen capture
const isScreenCaptureSupported = () => {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
};

const uppyDashboard = new Uppy({
  debug: true,
  autoProceed: false,
  restrictions: {
    maxNumberOfFiles: 10,
    allowedFileTypes: null
  }
}).use(Dashboard, {
  inline: true,
  target: '#app',
  showProgressDetails: true,
  proudlyDisplayPoweredByUppy: true,
  height: 470,
  width: '100%',
  theme: 'light'
});

// Add Screen Capture plugin with proper configuration
if (isScreenCaptureSupported()) {
  uppyDashboard.use(ScreenCapture, {
    target: Dashboard,
    preferredVideoMimeType: 'video/webm',
    displayMediaConstraints: {
      video: {
        width: 1280,
        height: 720,
        frameRate: {
          ideal: 3,
          max: 5,
        },
        cursor: 'always'
      },
      audio: false // Disable audio for screenshots
    },
    enableScreenshots: true,
    screenshotQuality: 0.5,
    preferredImageMimeType: 'image/jpeg',
  });
} else {
  console.warn('Screen capture is not supported in this browser');
}

// // Add XHR Upload plugin
// uppyDashboard.use(XHRUpload, {
//   endpoint: XHR_ENDPOINT,
//   formData: true,
//   fieldName: 'files[]',
//   limit: 6,
//   bundle: true,
//   headers: {
//     'X-Requested-With': 'XMLHttpRequest'
//   },
//   timeout: 60000, // Increase timeout for large video files
// });


uppyDashboard.use(Tus, { endpoint: TUS_ENDPOINT, limit: 6 });

// Make uppy available globally for debugging
window.uppy = uppyDashboard;

// Event listeners
uppyDashboard.on('file-added', (file) => {
  console.log('File added:', file.name);
  // Log specific details for screenshots
  if (file.meta && file.meta.type === 'screenshot') {
    console.log('Screenshot captured:', {
      name: file.name,
      type: file.type,
      size: file.size
    });
  }
});

uppyDashboard.on('upload', () => {
  console.log('Starting upload...');
});

uppyDashboard.on('upload-success', (file, response) => {
  console.log(`File ${file.name} uploaded successfully:`, response);
});

uppyDashboard.on('upload-error', (file, error, response) => {
  console.error(`Error uploading ${file.name}:`, error, response);
});

uppyDashboard.on('complete', (result) => {
  console.log("Upload complete! Result:", result);

  // Separate successful uploads into screenshots and recordings
  const successfulScreenshots = result.successful.filter(
    file => file.meta && file.meta.type === 'screenshot'
  );
  const successfulRecordings = result.successful.filter(
    file => file.meta && file.meta.type === 'recording'
  );

  if (result.failed.length === 0) {
    console.log('All uploads successful ✅');
    if (successfulScreenshots.length > 0) {
      console.log('Successful screenshots:', successfulScreenshots);
    }
    if (successfulRecordings.length > 0) {
      console.log('Successful recordings:', successfulRecordings);
    }
  } else {
    console.warn('Some uploads failed ❌');
  }
  console.log('Successful files:', result.successful);
  console.log('Failed files:', result.failed);
});

uppyDashboard.on('error', (error) => {
  console.error('Uppy error:', error);
});

console.log('Uppy initialized with Screen Capture support');

// Expose functions for manual triggering
window.uppyUpload = async () => {
  console.log('Starting manual upload...');
  try {
    const results = await uppy.upload();
    console.log('Upload results:', results);
    return results;
  } catch (err) {
    console.error('Error during upload:', err);

    // Get detailed file errors
    const failedFiles = uppy.getFiles().filter(file => file.error || file.status === 'error');
    failedFiles.forEach(file => {
      console.error(`File ${file.name} failed:`, file.error);
    });

    throw err;
  }
};

window.uppyRetry = async () => {
  console.log('Retrying failed uploads...');
  try {
    const results = await uppy.retryAll();
    console.log('Retry results:', results);
    return results;
  } catch (err) {
    console.error('Error during retry:', err);
    throw err;
  }
};

// Function to cancel all uploads
window.uppyCancelAll = () => {
  uppy.cancelAll();
  console.log('All uploads canceled');
};

// Function to reset the uploader (remove all files)
window.uppyReset = () => {
  uppy.reset();
  console.log('Uppy reset - all files removed');
};

// Additional helper functions for screenshots
window.uppyTakeScreenshot = async () => {
  if (!isScreenCaptureSupported()) {
    console.error('Screen capture is not supported in this browser');
    return;
  }

  try {
    const screenCapturePlugin = uppyDashboard.getPlugin('ScreenCapture');
    if (!screenCapturePlugin) {
      throw new Error('ScreenCapture plugin not initialized');
    }

    await screenCapturePlugin.captureScreenshot();
    console.log('Screenshot captured successfully');
  } catch (err) {
    console.error('Error capturing screenshot:', err);
    // Show error to user
    uppyDashboard.info({
      message: 'Failed to capture screenshot: ' + (err.message || 'Unknown error'),
      type: 'error',
      duration: 5000
    });
  }
};

// Function to get all captured screenshots
window.uppyGetScreenshots = () => {
  return uppyDashboard.getFiles().filter(
    file => file.meta && file.meta.type === 'screenshot'
  );
};