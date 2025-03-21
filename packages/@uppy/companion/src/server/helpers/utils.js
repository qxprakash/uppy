const crypto = require('node:crypto')

/**
 *
 * @param {string} value
 * @param {string[]} criteria
 * @returns {boolean}
 */
exports.hasMatch = (value, criteria) => {
  return criteria.some((i) => {
    return value === i || (new RegExp(i)).test(value)
  })
}

/**
 *
 * @param {object} data
 * @returns {string}
 */
exports.jsonStringify = (data) => {
  const cache = []
  return JSON.stringify(data, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (cache.indexOf(value) !== -1) {
        // Circular reference found, discard key
        return undefined
      }
      cache.push(value)
    }
    return value
  })
}

// all paths are assumed to be '/' prepended
/**
 * Returns a url builder
 *
 * @param {object} options companion options
 */
module.exports.getURLBuilder = (options) => {
  /**
   * Builds companion targeted url
   *
   * @param {string} subPath the tail path of the url
   * @param {boolean} isExternal if the url is for the external world
   * @param {boolean} [excludeHost] if the server domain and protocol should be included
   */
  const buildURL = (subPath, isExternal, excludeHost) => {
    let path = ''

    if (isExternal && options.server.implicitPath) {
      path += options.server.implicitPath
    }

    if (options.server.path) {
      path += options.server.path
    }

    path += subPath

    if (excludeHost) {
      return path
    }

    return `${options.server.protocol}://${options.server.host}${path}`
  }

  return buildURL
}

/**
 * Ensure that a user-provided `secret` is 32 bytes long (the length required
 * for an AES256 key) by hashing it with SHA256.
 *
 * @param {string|Buffer} secret
 */
function createSecret(secret) {
  const hash = crypto.createHash('sha256')
  hash.update(secret)
  return hash.digest()
}

/**
 * Create an initialization vector for AES256.
 *
 * @returns {Buffer}
 */
function createIv() {
  return crypto.randomBytes(16)
}

function urlEncode(unencoded) {
  return unencoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '~')
}

function urlDecode(encoded) {
  return encoded.replace(/-/g, '+').replace(/_/g, '/').replace(/~/g, '=')
}

/**
 * Encrypt a buffer or string with AES256 and a random iv.
 *
 * @param {string} input
 * @param {string|Buffer} secret
 * @returns {string} Ciphertext as a hex string, prefixed with 32 hex characters containing the iv.
 */
module.exports.encrypt = (input, secret) => {
  const iv = createIv()
  const cipher = crypto.createCipheriv('aes256', createSecret(secret), iv)
  let encrypted = cipher.update(input, 'utf8', 'base64')
  encrypted += cipher.final('base64')
  // add iv to encrypted string to use for decryption
  return iv.toString('hex') + urlEncode(encrypted)
}

/**
 * Decrypt an iv-prefixed or string with AES256. The iv should be in the first 32 hex characters.
 *
 * @param {string} encrypted
 * @param {string|Buffer} secret
 * @returns {string} Decrypted value.
 */
module.exports.decrypt = (encrypted, secret) => {
  // Need at least 32 chars for the iv
  if (encrypted.length < 32) {
    throw new Error('Invalid encrypted value. Maybe it was generated with an old Companion version?')
  }

  // NOTE: The first 32 characters are the iv, in hex format. The rest is the encrypted string, in base64 format.
  const iv = Buffer.from(encrypted.slice(0, 32), 'hex')
  const encryptionWithoutIv = encrypted.slice(32)

  let decipher
  try {
    decipher = crypto.createDecipheriv('aes256', createSecret(secret), iv)
  } catch (err) {
    if (err.code === 'ERR_CRYPTO_INVALID_IV') {
      throw new Error('Invalid initialization vector')
    } else {
      throw err
    }
  }

  let decrypted = decipher.update(urlDecode(encryptionWithoutIv), 'base64', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

module.exports.defaultGetKey = ({ filename }) => `${crypto.randomUUID()}-${filename}`

/**
 * Our own HttpError in cases where we can't use `got`'s `HTTPError`
 */
class HttpError extends Error {
  statusCode

  responseJson

  constructor({ statusCode, responseJson }) {
    super(`Request failed with status ${statusCode}`)
    this.statusCode = statusCode
    this.responseJson = responseJson
    this.name = 'HttpError'
  }
}

module.exports.HttpError = HttpError

module.exports.prepareStream = async (stream) => new Promise((resolve, reject) => {
  stream
    .on('response', (response) => {
      const contentLengthStr = response.headers['content-length']
      const contentLength = parseInt(contentLengthStr, 10);
      const size = !Number.isNaN(contentLength) && contentLength >= 0 ? contentLength : undefined;
      // Don't allow any more data to flow yet.
      // https://github.com/request/request/issues/1990#issuecomment-184712275
      stream.pause()
      resolve({ size })
    })
    .on('error', (err) => {
      // In this case the error object is not a normal GOT HTTPError where json is already parsed,
      // we use our own HttpError error for this scenario.
      if (typeof err.response?.body === 'string' && typeof err.response?.statusCode === 'number') {
        let responseJson
        try {
          responseJson = JSON.parse(err.response.body)
        } catch (err2) {
          reject(err)
          return
        }

        reject(new HttpError({ statusCode: err.response.statusCode, responseJson }))
        return
      }

      reject(err)
    })
})

module.exports.getBasicAuthHeader = (key, secret) => {
  const base64 = Buffer.from(`${key}:${secret}`, 'binary').toString('base64')
  return `Basic ${base64}`
}

const rfc2047Encode = (dataIn) => {
  const data = `${dataIn}`
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(data)) return data // we return ASCII as is
  return `=?UTF-8?B?${Buffer.from(data).toString('base64')}?=` // We encode non-ASCII strings
}

module.exports.rfc2047EncodeMetadata = (metadata) => (
  Object.fromEntries(Object.entries(metadata).map((entry) => entry.map(rfc2047Encode)))
)

/**
 * 
 * @param {{
 * bucketOrFn: string | ((a: {
 * req: import('express').Request,
 * metadata: Record<string, string>,
 * filename: string | undefined,
 * }) => string),
 * req: import('express').Request,
 * metadata?: Record<string, string>,
 * filename?: string,
 * }} param0 
 * @returns 
 */
module.exports.getBucket = ({ bucketOrFn, req, metadata, filename }) => {
  const bucket = typeof bucketOrFn === 'function' ? bucketOrFn({ req, metadata, filename }) : bucketOrFn

  if (typeof bucket !== 'string' || bucket === '') {
    // This means a misconfiguration or bug
    throw new TypeError('s3: bucket key must be a string or a function resolving the bucket string')
  }
  return bucket
}
