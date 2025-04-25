import Uppy from '@uppy/core';
import Dashboard from '@uppy/dashboard';
import Tus from '@uppy/tus';

import '@uppy/core/dist/style.css';
import '@uppy/dashboard/dist/style.css';

const TUS_ENDPOINT = 'https://tusd.tusdemo.net/files/';

const uppyDashboard = new Uppy({ debug: true }).use(Dashboard, {
  inline: true,
  target: '#app',
  showProgressDetails: true,
  proudlyDisplayPoweredByUppy: true,
});

uppyDashboard.use(Tus, { endpoint: TUS_ENDPOINT, limit: 6 });
window.uppy = uppyDashboard;

uppyDashboard.on('complete', (result) => {
  console.log('complete event payload:',result);
  if (result?.failed.length === 0) {
    console.log('Upload successful üòÄ');
  } else {
    console.warn('Upload failed üòû');
  }
  console.log('successful files:', result?.successful);
  console.log('failed files:', result?.failed);
});
