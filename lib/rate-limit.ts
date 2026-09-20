// lib/rate-limit.ts
//
// A best-effort, in-process rate limiter. There is no Redis/Upstash or
// equivalent anywhere in this codebase (checked — nothing), and this
// nonprofit expects a handful of agency registrations a month, not
// login-endpoint traffic, so a real distributed store would be new
// infrastructure bought for a threat that doesn't match the volume.
//
// THE HONEST LIMITATION: this is a module-level Map, scoped to one
// serverless instance. Vercel can run several instances of the same route
// concurrently and recycles instances on its own schedule, so this is a
// deterrent against a single client hammering the endpoint, not a
// guarantee across the whole deployment — a request spread across enough
// instances, or arriving after a cold start, resets the count. Good enough
// for "slow down an accidental double-submit or a naive script"; not
// good enough for anything that actually needs enforcing. If that ever
// stops being true, the fix is a real store (Upstash's free tier is the
// obvious one), not a bigger Map.
//
// Currently used by app/api/agency/register — the first route in this app
// that is both public and writeable.

const WINDOW_MS = 60 * 60 * 1000 // 1 hour
const MAX_PER_WINDOW = 5

const hits = new Map<string, number[]>()

/** true = allowed, false = over the limit for this key in the current window. */
export function checkRateLimit(key: string, maxPerWindow: number = MAX_PER_WINDOW): boolean {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter(t => now - t < WINDOW_MS)
  if (recent.length >= maxPerWindow) {
    hits.set(key, recent)
    return false
  }
  recent.push(now)
  hits.set(key, recent)
  return true
}

/** Best-effort client IP from the headers Vercel sets. 'unknown' groups
 *  every request whose IP can't be determined into one bucket — safer
 *  than skipping the check entirely for them. */
export function clientIpFrom(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}
