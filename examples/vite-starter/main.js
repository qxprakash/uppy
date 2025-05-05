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
    screenshotQuality: 0.8,
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
