// Zoom gives each user an IANA time zone. Recordings are named after their
// start time in that zone, and listed per calendar month of that zone.

const offsetFormats = new Map<string, Intl.DateTimeFormat>()

// One formatter per zone; throws a RangeError for an unknown zone.
function getOffsetFormat(timeZone: string): Intl.DateTimeFormat {
  let format = offsetFormats.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    })
    offsetFormats.set(timeZone, format)
  }
  return format
}

/**
 * `timeZone` if it is a time zone name we know, otherwise UTC.
 */
export function getTimeZone(timeZone: string | undefined): string {
  // Intl also takes offsets such as "+05:30", which are not zone names.
  if (timeZone && !/^[+-]/.test(timeZone)) {
    try {
      getOffsetFormat(timeZone)
      return timeZone
    } catch {
      // unknown time zone
    }
  }
  return 'UTC'
}

/**
 * Offset of `timeZone` from UTC at `time`, in milliseconds.
 */
function getOffset(time: number, timeZone: string): number {
  // an invalid date (e.g. a year out of range) gives 'Invalid date' further on
  if (Number.isNaN(new Date(time).getTime())) return Number.NaN
  const name = getOffsetFormat(timeZone)
    .formatToParts(time)
    .find((part) => part.type === 'timeZoneName')?.value
  // "GMT" for UTC itself, otherwise e.g. "GMT+05:30" or "GMT-00:44:30"
  const match = /^GMT(?:([+-])(\d+):(\d+)(?::(\d+))?)?$/.exec(name ?? '')
  if (!match) throw new Error(`Unexpected time zone offset ${name}`)
  const [, sign, hours = 0, minutes = 0, seconds = 0] = match
  const offset =
    (Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000
  return sign === '-' ? -offset : offset
}

const DAY = 24 * 60 * 60 * 1000

/**
 * The time at which the clock in `timeZone` shows `wallTime` (the wall clock
 * time written as if it were UTC). Like moment-timezone, a wall time that
 * happens twice (clocks going back) gives the first, and one that is skipped
 * (clocks going forward) is moved forward by the size of the jump.
 */
function fromWallTime(wallTime: number, timeZone: string): number {
  const offsetBefore = getOffset(wallTime - DAY, timeZone)
  const offsetAfter = getOffset(wallTime + DAY, timeZone)
  const withBefore = wallTime - offsetBefore
  const withAfter = wallTime - offsetAfter
  if (getOffset(withBefore, timeZone) === offsetBefore) return withBefore
  if (getOffset(withAfter, timeZone) === offsetAfter) return withAfter
  return withBefore
}

// an ISO date, or date and time, without a UTC offset
const LOCAL_ISO_TIME =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/

/**
 * Parse `timestamp` (as sent by the Zoom API). A time without a UTC offset is
 * wall clock time in `timeZone`, not in the server's time zone.
 */
export function parseTime(timestamp: string, timeZone: string): number {
  if (!LOCAL_ISO_TIME.test(timestamp)) return Date.parse(timestamp)
  // a date on its own already parses as UTC
  const wallTime = Date.parse(
    timestamp.length > 10 ? `${timestamp.replace(' ', 'T')}Z` : timestamp,
  )
  return fromWallTime(wallTime, timeZone)
}

const pad = (value: number, length = 2) =>
  `${value < 0 ? '-' : ''}${String(Math.abs(value)).padStart(length, '0')}`

/**
 * `time` as shown by the clock in `timeZone`: `YYYY-MM-DD`, or
 * `YYYY-MM-DD, HH:mm` with `withTime`.
 */
export function formatTime(
  time: number,
  timeZone: string,
  { withTime = false } = {},
): string {
  const date = new Date(time + getOffset(time, timeZone))
  if (Number.isNaN(date.getTime())) return 'Invalid date'
  const day = `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  if (!withTime) return day
  return `${day}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}

/**
 * Year and month (0-11) that the clock in `timeZone` shows at `time`.
 */
export function getYearAndMonth(
  time: number,
  timeZone: string,
): { year: number; month: number } {
  const date = new Date(time + getOffset(time, timeZone))
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() }
}

/**
 * The UTC days (`YYYY-MM-DD`) on which `month` (0-11) of `year` in `timeZone`
 * starts and ends.
 */
export function getMonthInUtc(
  year: number,
  month: number,
  timeZone: string,
): { from: string; to: string } {
  // setUTCFullYear rather than Date.UTC, which reads years 0-99 as 1900-1999
  const start = new Date(0).setUTCFullYear(year, month, 1)
  const end = new Date(0).setUTCFullYear(year, month + 1, 1) - 1
  return {
    from: formatTime(fromWallTime(start, timeZone), 'UTC'),
    to: formatTime(fromWallTime(end, timeZone), 'UTC'),
  }
}
