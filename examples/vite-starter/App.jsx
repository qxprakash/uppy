import React, { useState, useEffect } from 'react';
import Uppy from '@uppy/core';
import Tus from '@uppy/tus';
import { Dashboard } from '@uppy/react';
import ScreenCapture from '@uppy/screen-capture';

import '@uppy/core/dist/style.min.css';
import '@uppy/dashboard/dist/style.min.css';
import '@uppy/screen-capture/dist/style.min.css';

const TUS_ENDPOINT = 'https://tusd.tusdemo.net/files/';

// Check if browser supports screen capture
const isScreenCaptureSupported = () => {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
};

function App() {
  const [uppy] = useState(() => {
    const uppyInstance = new Uppy({
      debug: true,
      autoProceed: false,
      restrictions: {
        maxNumberOfFiles: 10,
        allowedFileTypes: null,
        requiredMetaFields: ['caption'], // <-- Add this
      },
    })
    .use(Tus, { endpoint: TUS_ENDPOINT, limit: 6, fieldName: 'files[]' })


    if (isScreenCaptureSupported()) {
      uppyInstance.use(ScreenCapture, {
        // target: Dashboard, // Dashboard is a component, not a plugin instance here
        preferredVideoMimeType: 'video/webm',
        displayMediaConstraints: {
          video: {
            width: 1280,
            height: 720,
            frameRate: {
              ideal: 3,
              max: 5,
            },
            cursor: 'always',
          },
          audio: false, // Disable audio for screenshots
        },
        enableScreenshots: true,
        preferredImageMimeType: 'image/webp',
      });
    } else {
      console.warn('Screen capture is not supported in this browser');
    }
    return uppyInstance;
  });


  useEffect(() => {
    // Log events for debugging
    uppy.on('file-added', (file) => {
      console.log('Added file', file);
    });

    uppy.on('file-removed', (file) => {
      console.log('Removed file', file);
    });

    uppy.on('upload-error', (file, error, response) => {
      console.log('error with file:', file.id);
      console.log('error message:', error);
      // Check if the error is due to missing caption
      if (file && !file.meta.caption) {
        // This is a simplified check. Uppy's actual error might be different.
        // We are trying to simulate the described scenario.
        uppy.info(
          {
            message: 'Missing required meta field: Caption. Edit image.',
            details: 'Please add a caption to the image before uploading.',
            id: file.id + '_caption_error' // Unique ID for the info message
          },
          'error',
          5000 // Display for 5 seconds
        );
      }
    });

    uppy.on('file-editor:complete', (updatedFile) => {
        console.log('File editor complete', updatedFile);
        // Attempt to clear the specific error message when caption is added
        // This is a conceptual approach; Uppy might not have a direct API to clear a specific error by ID.
        // We might need to rely on Uppy's internal logic to clear errors upon successful validation/retry.
        if (updatedFile.meta.caption) {
            const errors = uppy.getState().info;
            const errorIdToRemove = updatedFile.id + '_caption_error';
            const errorToRemove = errors.find(err => err.id === errorIdToRemove && err.type === 'error');
            if (errorToRemove) {
                // Uppy does not have a direct uppy.removeError() or similar.
                // This is a known limitation or area for improvement in Uppy.
                // The error might persist visually even if logically resolved.
                // For now, we'll log that we would clear it if possible.
                console.log('Caption added, attempting to clear related error message (conceptual).');
                // One workaround could be to re-validate or trigger an action that Uppy uses to clear errors.
                // For instance, if a retry mechanism clears errors, that's what would happen.
            }
        }
    });

    uppy.on('upload-success', (file, response) => {
      console.log('File uploaded successfully', file, response);
    });

    uppy.on('complete', (result) => {
      console.log('Upload complete!', result);
    });


    // Clean up when component unmounts
    return () => {
      uppy.close();
    };
  }, [uppy]);

  return (
    <div>
      <Dashboard
        uppy={uppy}
        plugins={isScreenCaptureSupported() ? ['ScreenCapture'] : []}
        metaFields={[
          { id: 'caption', name: 'Caption', placeholder: 'Enter caption here' },
        ]}
        note="Images and videos only. Max 10 files."
        height={470}
        width={'100%'}
        theme="light"
        proudlyDisplayPoweredByUppy={true}
        showProgressDetails={true}
        // Forcing a re-render or update might be needed if Uppy's UI doesn't refresh
        // This is an advanced scenario and might involve more complex state management
      />
    </div>
  );
}

export default App;
