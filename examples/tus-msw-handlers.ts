import { HttpResponse, http } from 'msw'

const TUS_ENDPOINT = 'https://tusd.tusdemo.net/files/'

// Track upload metadata so HEAD (resume) can return correct Upload-Length
const uploads = new Map<string, number>()

/**
 * MSW handlers that mock the Tus resumable upload protocol.
 * Used in example tests to avoid hitting the real tusd.tusdemo.net server,
 * which causes CI flakes due to network latency (see #6176).
 */
export const tusMswHandlers = [
  // POST creates the upload, returns Location header
  http.post(TUS_ENDPOINT, ({ request }) => {
    const uploadLength = Number(request.headers.get('Upload-Length') || '0')
    const id = `mock-upload-${Date.now()}`
    uploads.set(id, uploadLength)
    return new HttpResponse(null, {
      status: 201,
      headers: {
        Location: `${TUS_ENDPOINT}${id}`,
        'Tus-Resumable': '1.0.0',
      },
    })
  }),
  // PATCH sends the file data, returns cumulative Upload-Offset
  http.patch(`${TUS_ENDPOINT}:id`, async ({ request }) => {
    const currentOffset = Number(request.headers.get('Upload-Offset') || '0')
    const body = await request.arrayBuffer()
    return new HttpResponse(null, {
      status: 204,
      headers: {
        'Upload-Offset': String(currentOffset + body.byteLength),
        'Tus-Resumable': '1.0.0',
      },
    })
  }),
  // HEAD is used by tus-js-client when resuming a previous upload
  http.head(`${TUS_ENDPOINT}:id`, ({ params }) => {
    const id = params.id as string
    const uploadLength = uploads.get(id) ?? 0
    return new HttpResponse(null, {
      status: 200,
      headers: {
        'Upload-Offset': '0',
        'Upload-Length': String(uploadLength),
        'Tus-Resumable': '1.0.0',
      },
    })
  }),
]
