import request from 'supertest'
import { expect, test } from 'vitest'
import packageJson from '../package.json' with { type: 'json' }
import { getServer } from './mockserver.js'

test('exposes prometheus metrics', async () => {
  const server = await getServer()
  await request(server).get('/health').expect(200)
  await request(server).get('/does-not-exist').expect(404)

  const res = await request(server).get('/metrics').expect(200)
  expect(res.headers['content-type']).toBe('text/plain')
  const lines = res.text.split('\n')

  expect(lines).toContain(
    '# HELP http_request_duration_seconds duration histogram of http responses labeled with: status_code, method',
  )
  expect(lines).toContain('# TYPE http_request_duration_seconds histogram')
  for (const le of ['0.003', '0.03', '0.1', '0.3', '1.5', '10', '+Inf']) {
    expect(lines).toContainEqual(
      expect.stringMatching(
        `^http_request_duration_seconds_bucket\\{le="${le.replace('+', '\\+')}",status_code="200",method="GET"\\} `,
      ),
    )
  }
  expect(lines).toContain(
    'http_request_duration_seconds_count{status_code="200",method="GET"} 1',
  )
  expect(lines).toContain(
    'http_request_duration_seconds_count{status_code="404",method="GET"} 1',
  )
  expect(lines).toContain('up 1')
  expect(lines).toContain(
    `companion_version ${Number(packageJson.version.replace(/\D/g, ''))}`,
  )
  expect(lines).toContain('# TYPE process_cpu_user_seconds_total counter')

  // the metrics endpoint itself is not recorded
  const again = await request(server).get('/metrics/').expect(200)
  expect(again.text).toContain(
    'http_request_duration_seconds_count{status_code="200",method="GET"} 1',
  )
})
