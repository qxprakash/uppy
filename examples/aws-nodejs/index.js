'use strict'

const path = require('node:path')
const crypto = require('node:crypto')
const { existsSync } = require('node:fs')

console.log('Loading environment variables...')
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') })

const express = require('express')
const app = express()
const port = process.env.PORT ?? 8080
const accessControlAllowOrigin = '*'
const bodyParser = require('body-parser')

console.log('Importing AWS SDK clients...')
const {
  S3Client,
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListPartsCommand,
  PutObjectCommand,
  UploadPartCommand,
} = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
const { STSClient, GetFederationTokenCommand } = require('@aws-sdk/client-sts')

console.log('Configuring AWS policy...')
const policy = {
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Action: ['s3:PutObject'],
      Resource: [
        `arn:aws:s3:::${process.env.COMPANION_AWS_BUCKET}/*`,
        `arn:aws:s3:::${process.env.COMPANION_AWS_BUCKET}`,
      ],
    },
  ],
}

let s3Client
let stsClient
const expiresIn = 900

function getS3Client() {
  if (!s3Client) {
    console.log('Initializing new S3 client...')
    console.log(`Using region: ${process.env.COMPANION_AWS_REGION}`)
    s3Client = new S3Client({
      region: process.env.COMPANION_AWS_REGION,
      credentials: {
        accessKeyId: process.env.COMPANION_AWS_KEY,
        secretAccessKey: process.env.COMPANION_AWS_SECRET,
      },
      forcePathStyle: process.env.COMPANION_AWS_FORCE_PATH_STYLE === 'true',
    })
    console.log('S3 client initialized successfully')
  }
  return s3Client
}

function getSTSClient() {
  if (!stsClient) {
    console.log('Initializing new STS client...')
    stsClient = new STSClient({
      region: process.env.COMPANION_AWS_REGION,
      credentials: {
        accessKeyId: process.env.COMPANION_AWS_KEY,
        secretAccessKey: process.env.COMPANION_AWS_SECRET,
      },
    })
    console.log('STS client initialized successfully')
  }
  return stsClient
}

app.use(bodyParser.urlencoded({ extended: true }), bodyParser.json())

app.get('/s3/sts', (req, res, next) => {
  console.log('Received STS token request')
  console.log('Request IP:', req.ip)

  getSTSClient()
    .send(
      new GetFederationTokenCommand({
        Name: '123user',
        DurationSeconds: expiresIn,
        Policy: JSON.stringify(policy),
      }),
    )
    .then((response) => {
      console.log('STS token generated successfully')
      console.log('Token expiration:', response.Credentials.Expiration)
      res.setHeader('Access-Control-Allow-Origin', accessControlAllowOrigin)
      res.setHeader('Cache-Control', `public,max-age=${expiresIn}`)
      res.json({
        credentials: response.Credentials,
        bucket: process.env.COMPANION_AWS_BUCKET,
        region: process.env.COMPANION_AWS_REGION,
      })
    }, (error) => {
      console.error('Error generating STS token:', error)
      next(error)
    })
})

const signOnServer = (req, res, next) => {
  console.log('=== S3 Signing Request Debug ===')
  console.log('1. Request Method:', req.method)
  console.log('2. Query Parameters:', req.query)
  console.log('3. Request Headers:', req.headers)
  console.log('4. Request URL:', req.url)
  console.log('5. Raw Body:', req.body)
  // const Key = `${crypto.randomUUID()}-${req.query.filename}`
  // console.log('Generated object key:', Key)
  console.log("request query file type is", req.query.type)
  let Key;
  let fileType;
  if (req.method === 'POST') {

    console.log("request method type POST =======")
    Key = `${crypto.randomUUID()}-${req.body.filename}`
    console.log('Generated object key:', Key)
    console.log("request body file type is", req.body.type)
    const fileType = req.body.type
  }else if (req.method === 'GET'){
    console.log("request method type GET =======")
    const fileType = req.query.type
    Key = `${crypto.randomUUID()}-${req.query.filename}`
    console.log('Generated object key:', Key)
    console.log("request query file type is", req.query.type)
  }
  getSignedUrl(
    getS3Client(),
    new PutObjectCommand({
      Bucket: process.env.COMPANION_AWS_BUCKET,
      Key,
      ContentType: fileType,
    }),
    { expiresIn },
  ).then((url) => {
    console.log('Generated signed URL successfully')
    res.setHeader('Access-Control-Allow-Origin', accessControlAllowOrigin)
    res.json({
      url,
      method: 'PUT',
    })
    res.end()
  }, (error) => {
    console.error('Error generating signed URL:', error)
    next(error)
  })
}
app.get('/s3/params', signOnServer)
app.post('/s3/sign', signOnServer)

//  === <S3 Multipart> ===
// You can remove those endpoints if you only want to support the non-multipart uploads.

app.post('/s3/multipart', (req, res, next) => {
  console.log('Received multipart upload initiation request')
  console.log('File details:', {
    filename: req.body.filename,
    type: req.body.type,
    metadata: req.body.metadata
  })

  const client = getS3Client()
  const Key = `${crypto.randomUUID()}-${req.body.filename}`
  console.log('Generated object key:', Key)

  const command = new CreateMultipartUploadCommand({
    Bucket: process.env.COMPANION_AWS_BUCKET,
    Key,
    ContentType: req.body.type,
    Metadata: req.body.metadata,
  })

  return client.send(command, (err, data) => {
    if (err) {
      console.error('Error creating multipart upload:', err)
      next(err)
      return
    }
    console.log('Multipart upload initiated:', {
      Key: data.Key,
      UploadId: data.UploadId
    })
    res.setHeader('Access-Control-Allow-Origin', accessControlAllowOrigin)
    res.json({
      key: data.Key,
      uploadId: data.UploadId,
    })
  })
})

function validatePartNumber(partNumber) {
  // eslint-disable-next-line no-param-reassign
  partNumber = Number(partNumber)
  return Number.isInteger(partNumber) && partNumber >= 1 && partNumber <= 10_000
}
app.get('/s3/multipart/:uploadId/:partNumber', (req, res, next) => {
  console.log('Received part signature request:', {
    uploadId: req.params.uploadId,
    partNumber: req.params.partNumber,
    key: req.query.key
  })

  const { uploadId, partNumber } = req.params
  const { key } = req.query

  if (!validatePartNumber(partNumber)) {
    console.error('Invalid part number:', partNumber)
    return res
      .status(400)
      .json({
        error: 's3: the part number must be an integer between 1 and 10000.',
      })
  }
  if (typeof key !== 'string') {
    return res
      .status(400)
      .json({
        error:
          's3: the object key must be passed as a query parameter. For example: "?key=abc.jpg"',
      })
  }

  return getSignedUrl(
    getS3Client(),
    new UploadPartCommand({
      Bucket: process.env.COMPANION_AWS_BUCKET,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: '',
    }),
    { expiresIn },
  ).then((url) => {
    console.log('Generated part upload URL for part:', partNumber)
    res.setHeader('Access-Control-Allow-Origin', accessControlAllowOrigin)
    res.json({ url, expires: expiresIn })
  }, (error) => {
    console.error('Error generating part upload URL:', error)
    next(error)
  })
})

app.get('/s3/multipart/:uploadId', (req, res, next) => {
  const client = getS3Client()
  const { uploadId } = req.params
  const { key } = req.query

  if (typeof key !== 'string') {
    res
      .status(400)
      .json({
        error:
          's3: the object key must be passed as a query parameter. For example: "?key=abc.jpg"',
      })
    return
  }

  const parts = []

  function listPartsPage(startsAt = undefined) {
    client.send(new ListPartsCommand({
      Bucket: process.env.COMPANION_AWS_BUCKET,
      Key: key,
      UploadId: uploadId,
      PartNumberMarker: startsAt,
    }), (err, data) => {
      if (err) {
        next(err)
        return
      }

        parts.push(...data.Parts)

      // continue to get list of all uploaded parts until the IsTruncated flag is false
      if (data.IsTruncated) {
        listPartsPage(data.NextPartNumberMarker)
      } else {
        res.json(parts)
      }
    })
  }
  listPartsPage()
})

function isValidPart(part) {
  return (
    part &&
    typeof part === 'object' &&
    Number(part.PartNumber) &&
    typeof part.ETag === 'string'
  )
}
app.post('/s3/multipart/:uploadId/complete', (req, res, next) => {
  const client = getS3Client()
  const { uploadId } = req.params
  const { key } = req.query
  const { parts } = req.body

  if (typeof key !== 'string') {
    return res
      .status(400)
      .json({
        error:
          's3: the object key must be passed as a query parameter. For example: "?key=abc.jpg"',
      })
  }
  if (!Array.isArray(parts) || !parts.every(isValidPart)) {
    return res
      .status(400)
      .json({
        error: 's3: `parts` must be an array of {ETag, PartNumber} objects.',
      })
  }

  return client.send(
    new CompleteMultipartUploadCommand({
      Bucket: process.env.COMPANION_AWS_BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts,
      },
    }),
    (err, data) => {
      if (err) {
        next(err)
        return
      }
      res.setHeader('Access-Control-Allow-Origin', accessControlAllowOrigin)
      res.json({
        location: data.Location,
      })
    },
  )
})

app.delete('/s3/multipart/:uploadId', (req, res, next) => {
  const client = getS3Client()
  const { uploadId } = req.params
  const { key } = req.query

  if (typeof key !== 'string') {
    return res
      .status(400)
      .json({
        error:
          's3: the object key must be passed as a query parameter. For example: "?key=abc.jpg"',
      })
  }

  return client.send(
    new AbortMultipartUploadCommand({
      Bucket: process.env.COMPANION_AWS_BUCKET,
      Key: key,
      UploadId: uploadId,
    }),
    (err) => {
      if (err) {
        next(err)
        return
      }
      res.json({})
    },
  )
})

// === </S3 MULTIPART> ===

// === <some plumbing to make the example work> ===

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html')
  const htmlPath = path.join(__dirname, 'public', 'index.html')
  res.sendFile(htmlPath)
})
app.get('/index.html', (req, res) => {
  res.setHeader('Location', '/').sendStatus(308).end()
})
app.get('/withCustomEndpoints.html', (req, res) => {
  res.setHeader('Content-Type', 'text/html')
  const htmlPath = path.join(__dirname, 'public', 'withCustomEndpoints.html')
  res.sendFile(htmlPath)
})

app.get('/uppy.min.mjs', (req, res) => {
  res.setHeader('Content-Type', 'text/javascript')
  const bundlePath = path.join(
    __dirname,
    '../..',
    'packages/uppy/dist',
    'uppy.min.mjs',
  )
  if (existsSync(bundlePath)) {
    res.sendFile(bundlePath)
  } else {
    console.warn(
      'No local JS bundle found, using the CDN as a fallback. Run `corepack yarn build` to make this warning disappear.',
    )
    res.end(
      'export * from "https://releases.transloadit.com/uppy/v4.0.0-beta.11/uppy.min.mjs";\n',
    )
  }
})
app.get('/uppy.min.css', (req, res) => {
  res.setHeader('Content-Type', 'text/css')
  const bundlePath = path.join(
    __dirname,
    '../..',
    'packages/uppy/dist',
    'uppy.min.css',
  )
  if (existsSync(bundlePath)) {
    res.sendFile(bundlePath)
  } else {
    console.warn(
      'No local CSS bundle found, using the CDN as a fallback. Run `corepack yarn build` to make this warning disappear.',
    )
    res.end(
      '@import "https://releases.transloadit.com/uppy/v4.0.0-beta.11/uppy.min.css";\n',
    )
  }
})

app.listen(port, () => {
  console.log('=================================')
  console.log(`Server started successfully`)
  console.log(`Port: ${port}`)
  console.log(`AWS Region: ${process.env.COMPANION_AWS_REGION}`)
  console.log(`S3 Bucket: ${process.env.COMPANION_AWS_BUCKET}`)
  console.log(`Visit: http://localhost:${port}/`)
  console.log('=================================')
})

// Add error handling middleware
app.use((err, req, res, next) => {
  console.error('Application error:', err)
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message
  })
})
// === </some plumbing to make the example work> ===
