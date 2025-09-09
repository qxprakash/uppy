import "./style.css";
import "@uppy/core/css/style.css";
import "@uppy/dashboard/css/style.css";

import Uppy from "@uppy/core";
import Dashboard from "@uppy/dashboard";
import AwsS3 from "@uppy/aws-s3";
import GoldenRetriever from "@uppy/golden-retriever";

const SERVER_URL = "http://localhost:4000";

/**
 * This generator transforms a deep object into URL-encodable pairs
 * to work with `URLSearchParams` on the client and `body-parser` on the server.
 */
function* serializeSubPart(key, value) {
  if (typeof value !== 'object') {
    yield [key, value]
    return
  }
  if (Array.isArray(value)) {
    for (const val of value) {
      yield* serializeSubPart(`${key}[]`, val)
    }
    return
  }
  for (const [subkey, val] of Object.entries(value)) {
    yield* serializeSubPart(key ? `${key}[${subkey}]` : subkey, val)
  }
}

function serialize(data) {
  // If you want to avoid preflight requests, use URL-encoded syntax:
  return new URLSearchParams(serializeSubPart(null, data))
  // If you don't care about additional preflight requests, you can also use:
  // return JSON.stringify(data)
  // You'd also have to add `Content-Type` header with value `application/json`.
}

const app = document.querySelector("#app");
app.innerHTML = `
  <div style="max-width: 900px;margin: 24px auto;">
    <h2>Uppy AWS S3 + Golden Retriever Repro</h2>
    <div id="uppy"></div>
    <pre id="log" style="background:#fff;color:#eee;padding:12px;border-radius:6px;white-space:pre-wrap"></pre>
  </div>
`;

function onUploadComplete(result) {
  console.log(
    "Upload complete! We’ve uploaded these files:",
    result.successful
  );
}
function onUploadSuccess(file, data) {
  console.log("Upload success! We’ve uploaded this file:", file.meta["name"]);
}

const MiB = 0x10_00_00;

const uppy = new Uppy({
  debug: true,
  autoProceed: false,
})

uppy.use(Dashboard, {
    inline: true,
    target: "#uppy",
  })
  .use(AwsS3, {
    id: "myAWSPlugin",

    // Files that are more than 100MiB should be uploaded in multiple parts.
    shouldUseMultipart: (file) => file.size > 100 * MiB,

    /**
     * This method tells Uppy how to retrieve a temporary token for signing on the client.
     * Signing on the client is optional, you can also do the signing from the server.
     */
    async getTemporarySecurityCredentials({ signal }) {
      const response = await fetch(`${SERVER_URL}/s3/sts`, { signal })
      if (!response.ok)
        throw new Error('Unsuccessful request', { cause: response })
      return response.json()
    },

    // ========== Non-Multipart Uploads ==========

    /**
     * This method tells Uppy how to handle non-multipart uploads.
     * If for some reason you want to only support multipart uploads,
     * you don't need to implement it.
     */
    async getUploadParameters(file, options) {
      if (typeof crypto?.subtle === 'object') {
        // If WebCrypto is available, let's do signing from the client.
        return uppy
          .getPlugin('myAWSPlugin')
          .createSignedURL(file, options)
      }

      // Send a request to our Express.js signing endpoint.
      const response = await fetch(`${SERVER_URL}/s3/sign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          filename: file.name,
          type: file.type, // Note: server expects 'type', not 'contentType'
        }),
        signal: options.signal,
      })

      if (!response.ok)
        throw new Error('Unsuccessful request', { cause: response })

      // Parse the JSON response.
      const data = await response.json()

      // Return an object in the correct shape.
      return {
        method: data.method,
        url: data.url,
        fields: {}, // For presigned PUT uploads, this should be left empty.
        // Provide content type header required by S3
        headers: {
          'Content-Type': file.type,
        },
      }
    },

    // ========== Multipart Uploads ==========

    async createMultipartUpload(file, signal) {
      signal?.throwIfAborted()

      const metadata = {}

      Object.keys(file.meta || {}).forEach((key) => {
        if (file.meta[key] != null) {
          metadata[key] = file.meta[key].toString()
        }
      })

      const response = await fetch(`${SERVER_URL}/s3/multipart`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          filename: file.name,
          type: file.type,
          metadata,
        }),
        signal,
      })

      if (!response.ok)
        throw new Error('Unsuccessful request', { cause: response })

      // Parse the JSON response.
      const data = await response.json()

      return data
    },

    async abortMultipartUpload(file, { key, uploadId, signal }) {
      const filename = encodeURIComponent(key)
      const uploadIdEnc = encodeURIComponent(uploadId)
      const response = await fetch(
        `${SERVER_URL}/s3/multipart/${uploadIdEnc}?key=${filename}`,
        {
          method: 'DELETE',
          signal,
        },
      )

      if (!response.ok)
        throw new Error('Unsuccessful request', { cause: response })
    },

    async signPart(file, options) {
      if (typeof crypto?.subtle === 'object') {
        // If WebCrypto, let's do signing from the client.
        return uppy
          .getPlugin('myAWSPlugin')
          .createSignedURL(file, options)
      }

      const { uploadId, key, partNumber, signal } = options

      signal?.throwIfAborted()

      if (uploadId == null || key == null || partNumber == null) {
        throw new Error(
          'Cannot sign without a key, an uploadId, and a partNumber',
        )
      }

      const filename = encodeURIComponent(key)
      const response = await fetch(
        `${SERVER_URL}/s3/multipart/${uploadId}/${partNumber}?key=${filename}`,
        { signal },
      )

      if (!response.ok)
        throw new Error('Unsuccessful request', { cause: response })

      const data = await response.json()

      return data
    },

    async listParts(file, { key, uploadId }, signal) {
      console.log("listParts called ----> with:", { key, uploadId });
      signal?.throwIfAborted()

      const filename = encodeURIComponent(key)
      const response = await fetch(
        `${SERVER_URL}/s3/multipart/${uploadId}?key=${filename}`,
        { signal },
      )

      if (!response.ok)
        throw new Error('Unsuccessful request', { cause: response })

      const data = await response.json()

      return data
    },

    async completeMultipartUpload(
      file,
      { key, uploadId, parts },
      signal,
    ) {
      signal?.throwIfAborted()

      const filename = encodeURIComponent(key)
      const uploadIdEnc = encodeURIComponent(uploadId)
      const response = await fetch(
        `${SERVER_URL}/s3/multipart/${uploadIdEnc}/complete?key=${filename}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({ parts }),
          signal,
        },
      )

      if (!response.ok)
        throw new Error('Unsuccessful request', { cause: response })

      const data = await response.json()

      return data
    },
  })
  .use(GoldenRetriever, {
    serviceWorker: true
  });


// Enhanced debugging
uppy.on('complete', (result) => {
  console.log('🔍 COMPLETE EVENT DEBUG:')
  console.log('- Successful files:', result.successful?.length || 0)
  console.log('- Failed files:', result.failed?.length || 0)
  console.log('- localStorage state exists:', !!localStorage.getItem('uppyState:uppy'))

  // Check if this is a premature firing due to aborts
  const hasAbortedFiles = result.failed?.some(file =>
    file.error && file.error.toString().includes('Aborted')
  )
  console.log('- Has aborted files:', hasAbortedFiles)
  console.log('- Should preserve state:', hasAbortedFiles && result.successful?.length === 0)

  // Call original handler
  onUploadComplete(result);
})

uppy.on('upload-error', (file, error, response) => {
  console.log('❌ UPLOAD ERROR:', {
    fileName: file?.name,
    errorName: error?.name,
    errorMessage: error?.message,
    isAbortError: error?.name === 'AbortError' || error?.message?.includes('Aborted')
  })
})

uppy.on("upload-success", onUploadSuccess);

if ('serviceWorker' in navigator) {
	navigator.serviceWorker
		.register('/sw.js') // path to your bundled service worker with GoldenRetriever service worker
		.then((registration) => {
			console.log(
				'ServiceWorker registration successful with scope: ',
				registration.scope,
			);

			// Debug: Check if controller is available
			// console.log('ServiceWorker controller:', navigator.serviceWorker.controller);

			// Listen for controller changes
			navigator.serviceWorker.addEventListener('controllerchange', () => {
				console.log('ServiceWorker controller changed:', navigator.serviceWorker.controller);
			});
		})
		.catch((error) => {
			console.log(`Registration failed with ${error}`);
		});
}