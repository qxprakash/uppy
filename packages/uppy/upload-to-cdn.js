#!/usr/bin/env node

// Upload Uppy releases to releases.transloadit.com via Cloudflare R2/BunnyCDN.
//
// This file:
//
//  - Assumes the following env vars are available: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
//    AWS_REGION=auto, S3_ENDPOINT, S3_BUCKET (see the CDN migration docs for the exact values).
//  - Assumes a fully built uppy is in root dir (unless a specific tag was specified, then it's fetched from npm)
//  - Collects dist/ files that would be in an npm package release, and uploads to
//    eg. https://releases.transloadit.com/uppy/v1.0.1/uppy.css
//  - Uses local package by default, if [version] argument was specified, takes package from npm
//
// Run as:
//
//  yarn uploadcdn <package-name> [version]
//
// To override an existing release (DANGER!)
//
//  yarn uploadcdn <package-name> [version] -- --force
//
// Authors:
//
//  - Kevin van Zonneveld <kevin@transloadit.com>

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync, gunzipSync } from 'node:zlib'
import {
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import mime from 'mime-types'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const AWS_REGION = process.env.AWS_REGION ?? 'auto'
const AWS_BUCKET = process.env.S3_BUCKET

/**
 * Read the regular files from an uncompressed tar archive (ustar, with pax
 * `path` headers). Any other entry type, except directories, is an error.
 *
 * @param {Buffer} tar
 * @returns a Map<string, Buffer>, path → content
 */
function readTarFiles(tar) {
  const files = new Map()
  let paxPath
  let offset = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break

    const field = (start, length) => {
      const value = header.subarray(start, start + length)
      const end = value.indexOf(0)
      return value.subarray(0, end === -1 ? length : end).toString('utf8')
    }
    const sizeField = field(124, 12).trim()
    if (!/^[0-7]+$/.test(sizeField)) throw new Error('Invalid tar entry size')
    const size = Number.parseInt(sizeField, 8)
    const start = offset + 512
    const body = tar.subarray(start, start + size)
    if (body.length !== size) throw new Error('Truncated tar archive')
    offset = start + Math.ceil(size / 512) * 512

    const type = field(156, 1)
    if (type === 'x') {
      paxPath = undefined
      // pax records look like "<length> <key>=<value>\n"
      for (let pos = 0; pos < body.length; ) {
        const space = body.indexOf(0x20, pos)
        const length = Number(body.subarray(pos, space).toString())
        if (space === -1 || !(length > 0)) {
          throw new Error('Invalid pax header')
        }
        const record = body.subarray(space + 1, pos + length - 1).toString()
        if (record.startsWith('path=')) paxPath = record.slice(5)
        pos += length
      }
    } else if (type === '0' || type === '') {
      const prefix = field(257, 6) === 'ustar' ? field(345, 155) : ''
      const name = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100)
      files.set(paxPath ?? name, body)
      paxPath = undefined
    } else if (type === '5') {
      paxPath = undefined
    } else if (type !== 'g') {
      throw new Error(`Unsupported tar entry type "${type}"`)
    }
  }
  return files
}

/**
 * Get remote dist/ files by fetching the tarball for the given version
 * from npm, verifying its integrity, and filtering it down to package/dist/ files.
 *
 * @param {string} packageName eg. @uppy/robodog
 * @param {string} version eg. 1.8.0
 * @returns a Map<string, Buffer>, filename → content
 */
async function getRemoteDistFiles(packageName, version) {
  console.log('Using npm package', `${packageName}@${version}`)

  const res = await fetch(
    `https://registry.npmjs.org/${packageName.replace('/', '%2F')}`,
    { headers: { accept: 'application/vnd.npm.install-v1+json' } },
  )
  if (!res.ok) {
    throw new Error(`Fetching ${packageName} from npm failed: ${res.status}`)
  }
  const { dist } = (await res.json()).versions?.[version] ?? {}
  if (!dist) throw new Error(`${packageName}@${version} not found on npm`)
  const integrity = dist.integrity
    ?.split(/\s+/)
    .find((hash) => hash.startsWith('sha512-'))
  if (!integrity || !dist.tarball?.startsWith('https://')) {
    throw new Error(`No sha512 integrity or tarball for ${packageName}`)
  }

  const tarballRes = await fetch(dist.tarball)
  if (!tarballRes.ok) {
    throw new Error(`Fetching ${dist.tarball} failed: ${tarballRes.status}`)
  }
  const tarball = Buffer.from(await tarballRes.arrayBuffer())
  const digest = createHash('sha512').update(tarball).digest('base64')
  if (`sha512-${digest}` !== integrity) {
    throw new Error(`Integrity check failed for ${dist.tarball}`)
  }

  const files = new Map()
  for (const [name, content] of readTarFiles(gunzipSync(tarball))) {
    if (!name.startsWith('package/dist/') || name.endsWith('/')) continue
    const filename = name.slice('package/dist/'.length)
    if (filename.split('/').some((part) => ['', '.', '..'].includes(part))) {
      throw new Error(`Unexpected path in tarball: ${name}`)
    }
    files.set(filename, content)
  }
  return files
}

// Files npm never publishes, see npm-packlist.
const npmIgnored =
  /^(\.npmignore|\.gitignore|\.git|\.svn|\.hg|CVS|npm-debug\.log|\.npmrc|\..*\.swp|\.DS_Store|\._.*|.*\.orig)$/

// npm-packlist's file order: extension, then basename, then path.
function npmSort(a, b) {
  const key = (file) => [path.extname(file), path.basename(file), file]
  const [keyA, keyB] = [key(a.toLowerCase()), key(b.toLowerCase())]
  return (
    keyA[0].localeCompare(keyB[0], 'en') ||
    keyA[1].localeCompare(keyB[1], 'en') ||
    a.localeCompare(b, 'en')
  )
}

/**
 * Get local dist/ files, i.e. the dist/ files npm would publish
 * (every package uploaded here lists dist in its "files").
 *
 * @param {string} packageName Name of package, eg. @uppy/locales
 * @returns a Map<string, Buffer>, filename → content
 */
async function getLocalDistFiles(packageName) {
  // Base file path of the package, eg. ./packages/@uppy/locales or ./packages/uppy
  const packagePath = packageName.startsWith('@uppy/')
    ? path.join(__dirname, '..', packageName)
    : path.join(__dirname)

  console.log('Making local package from', packagePath)

  const distPath = path.join(packagePath, 'dist')
  const files = (
    await readdir(distPath, { recursive: true, withFileTypes: true })
  )
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(distPath, path.join(entry.parentPath, entry.name)),
    )
    .map((file) => file.split(path.sep).join('/'))
    .filter((file) => !file.split('/').some((part) => npmIgnored.test(part)))
    .sort(npmSort)

  const entries = await Promise.all(
    files.map(async (f) => [f, await readFile(path.join(distPath, f))]),
  )

  return new Map(entries)
}

/**
 * Build a zip archive (deflate, no zip64) from a Map<string, Buffer>,
 * with entries sorted by lowercased name.
 */
function createZip(files) {
  const filenames = [...files.keys()].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase()),
  )
  const now = new Date()
  const time =
    (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
  const date =
    ((now.getFullYear() - 1980) << 9) |
    ((now.getMonth() + 1) << 5) |
    now.getDate()

  const parts = []
  const central = []
  let offset = 0
  for (const filename of filenames) {
    const content = files.get(filename)
    const name = Buffer.from(filename)
    const data = deflateRawSync(content)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // local file header signature
    local.writeUInt16LE(20, 4) // version needed to extract
    local.writeUInt16LE(0x0800, 6) // flags: UTF-8 file name
    local.writeUInt16LE(8, 8) // method: deflate
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc32(content), 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(name.length, 26)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0) // central directory header signature
    header.writeUInt16LE(0x0314, 4) // version made by: Unix, 2.0
    local.copy(header, 6, 4, 30) // same fields as the local header
    header.writeUInt32LE(0o100644 * 0x10000, 38) // external attributes: -rw-r--r--
    header.writeUInt32LE(offset, 42)

    parts.push(local, name, data)
    central.push(header, name)
    offset += local.length + name.length + data.length
  }

  const centralDirectory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0) // end of central directory signature
  end.writeUInt16LE(files.size, 8)
  end.writeUInt16LE(files.size, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...parts, centralDirectory, end])
}

async function main(packageName, version) {
  if (!packageName) {
    console.error('usage: upload-to-cdn <packagename> [version]')
    console.error('Must provide a package name')
    process.exit(1)
  }

  const requiredEnvVars = [
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'S3_ENDPOINT',
    'S3_BUCKET',
  ]
  const missingEnvVars = requiredEnvVars.filter(
    (envVar) => !process.env[envVar],
  )

  if (missingEnvVars.length > 0) {
    console.error(
      `Missing required env variables (${missingEnvVars.join(', ')}), bailing`,
    )
    process.exit(1)
  }

  // version should only be a positional arg and semver string
  // this deals with usage like `npm run uploadcdn uppy -- --force`
  // where we force push a local build
  let resolvedVersion = version?.startsWith('-') ? undefined : version

  const s3Client = new S3Client({
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
    region: AWS_REGION,
    endpoint: process.env.S3_ENDPOINT,
    // Cloudflare R2 requires path-style addressing when using the account endpoint.
    forcePathStyle: true,
  })

  const remote = !!resolvedVersion

  console.log('Using', remote ? 'Remote' : 'Local', 'build')
  if (!remote) {
    // Updated path logic: now running from packages/uppy, need to reference the package directly
    const packagePath = packageName.startsWith('@uppy/')
      ? path.join(__dirname, '..', packageName)
      : path.join(__dirname)

    const packageJsonContent = await readFile(
      path.join(packagePath, 'package.json'),
      'utf8',
    )
    resolvedVersion = JSON.parse(packageJsonContent).version
  }

  // Warn if uploading a local build not from CI:
  // - If we're on CI, this should be a release commit.
  // - If we're local, normally we should upload a released version, not a local build.
  if (!remote && !process.env.CI) {
    console.log(
      'Warning, writing a local build to the CDN, this is usually not what you want. Sleeping 3s. Press CTRL+C!',
    )
    await delay(3000)
  }

  // uppy → releases/uppy/
  // @uppy/robodog → releases/uppy/robodog/
  // @uppy/locales → releases/uppy/locales/
  const dirName = packageName.startsWith('@uppy/')
    ? packageName.replace(/^@/, '')
    : 'uppy'

  const s3Dir = path.posix.join(dirName, `v${resolvedVersion}`)

  const { Contents: existing } = await s3Client.send(
    new ListObjectsV2Command({
      Bucket: AWS_BUCKET,
      Prefix: s3Dir,
    }),
  )

  if (existing?.length > 0) {
    if (process.argv.includes('--force')) {
      console.warn(
        `WARN Release files for ${dirName} v${resolvedVersion} already exist, overwriting...`,
      )
    } else {
      console.error(
        `Release files for ${dirName} v${resolvedVersion} already exist, exiting...`,
      )
      process.exit(0)
    }
  }

  const files = remote
    ? await getRemoteDistFiles(packageName, resolvedVersion)
    : await getLocalDistFiles(packageName)

  if (files.size === 0) throw new Error('No files to upload')

  if (packageName === 'uppy') {
    console.log('Creating downloadable zip archive')
    files.set(`uppy-v${resolvedVersion}.zip`, createZip(files))
  }

  for (const [filename, buffer] of files.entries()) {
    const key = path.posix.join(s3Dir, filename)
    console.log(`pushing s3://${AWS_BUCKET}/${key}`)
    await s3Client.send(
      new PutObjectCommand({
        Bucket: AWS_BUCKET,
        Key: key,
        ContentType: mime.lookup(filename),
        Body: buffer,
      }),
    )
  }
}

main(...process.argv.slice(2)).catch((err) => {
  console.error(err)
  process.exit(1)
})
