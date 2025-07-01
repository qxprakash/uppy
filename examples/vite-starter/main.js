import Uppy from '@uppy/core';
import Dashboard from '@uppy/dashboard';
import XHRUpload from '@uppy/xhr-upload';
import Webcam from '@uppy/webcam';
import '@uppy/core/dist/style.css';
import '@uppy/dashboard/dist/style.css';
import '@uppy/webcam/dist/style.css';
import Tus from '@uppy/tus';

const TUS_ENDPOINT = 'https://tusd.tusdemo.net/files/';

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

// Add Webcam plugin
uppyDashboard.use(Webcam, {
  target: Dashboard,
  mirror: true,
  showRecordingLength: true,
  modes: ['video-audio', 'picture'],
  preferredVideoMimeType: 'video/webm',
  preferredImageMimeType: 'image/jpeg',
  facingMode: 'user',
  countdown: true,
  locale: {
    strings: {
      smile: 'Smile!'
    }
  }
});

uppyDashboard.use(Tus, { endpoint: TUS_ENDPOINT, limit: 6 });

// Make uppy available globally for debugging
window.uppy = uppyDashboard;
