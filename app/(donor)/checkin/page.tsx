'use client'

// app/(donor)/checkin/page.tsx — the URL is /checkin, not /donor/checkin;
// (donor) is a route group and doesn't appear in the path. Auth lives in
// app/(donor)/layout.tsx, shared with desk/, not here.
//
// The phone kiosk. One job: scan, confirm, next. Two inputs feed one
// handler — the camera (BarcodeDetector, native on the target Android
// Chrome device, no third-party QR library) and a Bluetooth HID scanner
// (types the decoded string, presses Enter, indistinguishable from a very
// fast typist). Both end up calling submitScan() with whatever string they
// produced; lib/donors/parse-scan-input.ts (also used server-side,
// authoritatively) extracts the id from either a full Check-in URL or a
// bare record id.
//
// SCAN AND CONFIRM ARE TWO SEPARATE CALLS. This page used to write
// Status: 'Received' the instant a code was decoded, inside the scan
// handler itself, with the "Received" button underneath it doing nothing
// but dismiss a write that had already happened. That defeated the whole
// reason a phone-with-a-screen was chosen over a beep-only handheld
// scanner: the tap is the volunteer confirming the name on screen matches
// the person standing in front of them, and a scan that writes on its own
// skips that check entirely — a misscan or a stale code got silently
// marked Received with nobody having looked at anything.
//
// The fix is a genuine two-call split:
//   - submitScan() calls POST /api/donor-checkin/lookup — read-only. It
//     resolves the scan to a donor name (and an id) and writes nothing.
//   - confirmReceived() calls POST /api/donor-checkin — the only write on
//     this page, and it fires from exactly one place: the "Received"
//     button on the pending screen below.
//
// Between those two calls sits `pending`: donor name held on screen,
// large, next to a Received button, waiting for the tap. There is no
// timer on this state — none. A volunteer who gets interrupted
// mid-transaction (a phone call, another donor walking up) must find the
// exact same pending screen when they look back, not a scanner that
// silently gave up and forgot who it had found. Neither input path (the
// camera loop or the hidden HID input) accepts a new scan while `pending`
// is set, for the same reason — a second scan arriving mid-confirmation
// must not silently bump the donor already on screen.
//
// The pending screen also has to make the tap feel required, not
// optional — the real failure mode isn't a wrong tap, it's no tap at
// all: a volunteer who walks away without confirming leaves the
// donation sitting Pending, and six weeks later the no-show script
// flips it and emails the donor to say their donation never arrived.
// So the screen asks the question the volunteer is actually answering
// ("Is this the donor in front of you?"), then states the stakes in
// plain terms ("Nothing is recorded until you tap Received") — not
// "tap to confirm," which reads as optional when it isn't.
//
// A donor whose code scans but who turns out to be the wrong person, or a
// code scanned by accident, needs a way out that writes nothing — "Not
// this donor" does that. It's deliberately smaller, lower, and lighter
// than Received, on the opposite side of real spacing, so a volunteer
// moving quickly can't tap it by mistake.
//
// Already-received is resolved entirely at lookup time and never reaches
// the pending screen at all — there is nothing to confirm and nothing to
// write, so it goes straight to a dismiss-only informational screen with
// no Received button on it (a Received tap there would just be a second,
// pointless write of the same value).
//
// Every state has its own background so two of them can never be
// mistaken for each other at a glance: idle scanning is white, pending
// is navy (an answer is owed, not yet settled either way), a completed
// write is teal, already-received is gold, not-found/invalid are red,
// offline is grey. Pending, done, and already-received in particular
// have to read as different at a distance, without anyone reading the
// words — navy vs. teal vs. gold are three different hues, not shades
// of the same one. The 2.5s auto-return applies to the five settled
// results, starting only once the state is reached — for a completed
// write specifically, that means after the write succeeds, never after
// the scan or lookup. It never applies to `pending`.
//
// The target experience this page serves: pick up the phone, it's
// already on the scanner, point it at the QR code, the donor's name
// fills the screen, tap Received, back to scanning. Nothing here should
// need explaining to a volunteer who's never seen it — the navy header
// (logo + wordmark, nothing else) and the one instruction line under the
// heading are the whole onboarding. No Log Out, no nav, no account chip
// — a kiosk; a volunteer tapping one strands the device until Ben
// reprovisions it. SessionPill at the foot is a passive status light,
// not a control.

import { useCallback, useEffect, useRef, useState } from 'react'
import BrandMark from '@/components/donor/BrandMark'
import SessionPill from '@/components/donor/SessionPill'

// 2.5s, matching the old GoDaddy page's own timing — right for a
// volunteer working through a queue, who shouldn't have to tap through
// every settled screen by hand. The "Next" button still exists for anyone
// who'd rather not wait; this is the fallback, not a replacement for it.
// Applies only to the five settled result states below — never to
// `pending`, which waits for the tap no matter how long that takes.
const AUTO_RETURN_MS = 2500

type Pending = { id: string; donorName: string }

type ScanResult =
  | { kind: 'success'; donorName: string }
  | { kind: 'already-received'; donorName: string; receivedAt: string | null }
  | { kind: 'not-found' }
  | { kind: 'invalid' }
  | { kind: 'offline' }

const NAVY = '#1B2B4B'
const TEAL = '#2A7F6F'
const GOLD = '#C9A84C'
const RED = '#C0392B'
const GREY = '#7A8899'
const CREAM = '#F7F5F1'

function backgroundFor(result: ScanResult | null): string {
  if (!result) return '#ffffff'
  switch (result.kind) {
    case 'success': return TEAL
    case 'already-received': return GOLD
    case 'not-found': return RED
    case 'invalid': return RED
    case 'offline': return GREY
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
}

export default function DonorCheckinPage() {
  const [pending, setPending] = useState<Pending | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const busyRef = useRef(false) // avoids a stale closure in the scan loop's setInterval
  const pendingRef = useRef<Pending | null>(null) // same reason — the camera loop reads this every frame

  const refocus = useCallback(() => {
    // A brief delay lets a virtual keyboard, if one ever flashed up, close
    // first — focusing immediately can otherwise get fought by the OS.
    window.setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  // Scan → lookup only. Never writes. Resolves to either a settled result
  // (already-received / not-found / invalid / offline) or a `pending`
  // confirmation waiting on the tap.
  const submitScan = useCallback(async (raw: string) => {
    if (busyRef.current || pendingRef.current || !raw.trim()) return
    busyRef.current = true
    setBusy(true)
    try {
      const res = await fetch('/api/donor-checkin/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: raw }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 404) {
        setResult({ kind: 'not-found' })
      } else if (res.status === 400) {
        setResult({ kind: 'invalid' })
      } else if (!res.ok) {
        setResult({ kind: 'not-found' })
      } else if (body.alreadyReceived) {
        // Nothing to confirm and nothing to write — resolved entirely
        // here, never becomes a pending screen.
        setResult({ kind: 'already-received', donorName: body.donorName, receivedAt: body.receivedAt })
      } else {
        setPending({ id: body.id, donorName: body.donorName })
      }
    } catch {
      // fetch threw — no response reached us at all. This is the one case
      // that means "offline," not "the server said no."
      setResult({ kind: 'offline' })
    } finally {
      busyRef.current = false
      setBusy(false)
      refocus()
    }
  }, [refocus])

  // Tap → the only write on this page. Fires from exactly one place: the
  // Received button on the pending screen.
  async function confirmReceived() {
    if (!pending || confirming) return
    setConfirming(true)
    setConfirmError(null)
    try {
      const res = await fetch('/api/donor-checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pending.id }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.alreadyReceived) {
        // Someone else (another phone, the desk) confirmed this same
        // donor in the seconds between this device's lookup and its tap.
        // Routine, not an error — same "already received" screen the
        // lookup path itself would have shown.
        setPending(null)
        setResult({ kind: 'already-received', donorName: body.donorName, receivedAt: body.receivedAt })
        refocus()
      } else if (res.ok) {
        setPending(null)
        setResult({ kind: 'success', donorName: body.donorName })
        refocus()
      } else {
        // A genuine problem with this id (not found / malformed) — re-
        // scanning is the right recovery, not retrying the same write.
        setPending(null)
        setResult({ kind: 'not-found' })
        refocus()
      }
    } catch {
      // The write itself didn't reach the server. Stay on the pending
      // screen exactly as it was rather than losing the donor's name —
      // tapping Received again once connectivity's back just retries the
      // same write. No re-scan needed.
      setConfirmError('Couldn’t save — check the connection and try again.')
    } finally {
      setConfirming(false)
    }
  }

  // Writes nothing. For the wrong person, or a code scanned by accident.
  function dismissPending() {
    setPending(null)
    setConfirmError(null)
    refocus()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    const value = (e.target as HTMLInputElement).value
    ;(e.target as HTMLInputElement).value = ''
    void submitScan(value)
  }

  function dismiss() {
    setResult(null)
    refocus()
  }

  useEffect(() => {
    pendingRef.current = pending
  }, [pending])

  // Auto-return — see AUTO_RETURN_MS above. Only ever runs against the
  // five settled result states, never against `pending`: this effect is
  // keyed on `result`, and setPending() never touches `result`, so a
  // fresh pending confirmation can't inherit a timer left over from
  // anything. Cleared on unmount and whenever `result` changes (a manual
  // dismiss, or a fresh settled result superseding the current one), so
  // it can never fire against a result that's no longer on screen.
  useEffect(() => {
    if (!result) return
    const id = window.setTimeout(dismiss, AUTO_RETURN_MS)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  // Keep the hidden input focused. Runs on mount and any time the page
  // regains focus/visibility (switching back from another app, screen
  // waking) — a kiosk left alone for a while should still be ready
  // without anyone tapping anything.
  useEffect(() => {
    refocus()
    const onVisible = () => { if (document.visibilityState === 'visible') refocus() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', refocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', refocus)
    }
  }, [refocus])

  // Camera + BarcodeDetector. Native on Android Chrome, the confirmed
  // target device — no bundled QR library. If a specific device's Chrome
  // build doesn't have it, the HID scanner is still a full fallback (Ray
  // already has one) rather than a broken page.
  const [cameraError, setCameraError] = useState<string | null>(null)
  useEffect(() => {
    let stream: MediaStream | null = null
    let stop = false
    let raf = 0

    async function start() {
      if (!('BarcodeDetector' in window)) {
        setCameraError('Camera scanning isn’t available on this device. Use the handheld scanner, or check this donor in at the desk.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      } catch {
        setCameraError('Couldn’t reach the camera. Use the handheld scanner, or check this donor in at the desk.')
        return
      }
      if (stop) { stream.getTracks().forEach(t => t.stop()); return }
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      // @ts-expect-error — BarcodeDetector isn't in the default TS lib yet.
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] })
      const loop = async () => {
        if (stop) return
        if (!busyRef.current && !pendingRef.current && videoRef.current && videoRef.current.readyState >= 2) {
          try {
            const codes = await detector.detect(videoRef.current)
            if (codes.length > 0) {
              const value = codes[0].rawValue as string
              void submitScan(value)
            }
          } catch {
            // A single failed detect() shouldn't kill the loop — keep trying.
          }
        }
        raf = window.requestAnimationFrame(loop)
      }
      raf = window.requestAnimationFrame(loop)
    }

    void start()
    return () => {
      stop = true
      if (raf) window.cancelAnimationFrame(raf)
      stream?.getTracks().forEach(t => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Pending gets its own full-navy background — not white (shared with
  // idle scanning) and not teal or gold (the two settled outcomes it
  // must never be mistaken for from across a room). See PendingScreen's
  // own header for why.
  const bg = pending ? NAVY : backgroundFor(result)

  return (
    <div style={{
      minHeight: '100dvh', width: '100%', display: 'flex', flexDirection: 'column',
      fontFamily: 'var(--font-montserrat), Arial, sans-serif', boxSizing: 'border-box',
    }}>
      {/* Navy header band — logo + wordmark, nothing else. No title, no
          nav, no account chip: this screen has exactly one job and
          nothing here should look tappable except the confirm button
          three states down. Height and the teal bottom rule match
          DawsonPageBar's own top-bar convention, the closest existing
          "internal portal header" in this app — reused, not a new size. */}
      <div style={{
        minHeight: '64px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: NAVY, borderBottom: '4px solid #2A7F6F', flexShrink: 0,
      }}>
        <BrandMark />
      </div>

      <div style={{
        flex: 1, width: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', background: bg,
        transition: 'background 0.15s', padding: '24px', boxSizing: 'border-box',
      }}>
        {/* Hidden-but-real input — always mounted, always focused, catches the
            HID scanner's typed-and-Enter string. Not visually hidden via
            display:none (some input methods behave oddly on a display:none
            field); moved off-screen instead, same technique as a form
            honeypot but for the opposite reason — this one must always
            receive real input. submitScan() itself ignores anything typed
            while `pending` is set, so a scan arriving mid-confirmation
            can't bump the donor already on screen. */}
        <input
          ref={inputRef}
          onKeyDown={onKeyDown}
          onBlur={refocus}
          autoFocus
          style={{ position: 'absolute', top: '-9999px', left: '-9999px', width: '1px', height: '1px' }}
          aria-hidden="true"
          tabIndex={-1}
        />

        {!pending && !result && (
          <>
            {/* A first-time volunteer sees what this screen is (the
                heading) and what to do (the one instruction line) with
                nothing else to read. "Point the camera" is deliberately
                not "use your phone camera to scan" — the old GoDaddy page's
                wording described handing off to the native Camera app,
                which this page never does; scanning happens in-page.

                Same standard applied to every other user-facing string on
                this page: name the physical thing (camera, handheld
                scanner, the desk) and say what to do, never the mechanism
                behind it. */}
            <div style={{ fontSize: '20px', fontWeight: 800, color: NAVY, textAlign: 'center', marginBottom: '6px' }}>
              Donor Check-In
            </div>
            <div style={{ fontSize: '15px', fontWeight: 600, color: GREY, textAlign: 'center', marginBottom: '20px' }}>
              Point the camera at the donor’s QR code.
            </div>

            <div style={{ width: '100%', maxWidth: '420px', aspectRatio: '1', borderRadius: '16px', overflow: 'hidden', background: '#000', position: 'relative' }}>
              <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <div style={{
                position: 'absolute', inset: '10%', border: '3px solid rgba(255,255,255,0.85)', borderRadius: '16px', pointerEvents: 'none',
              }} />
            </div>
            <div style={{ marginTop: '28px', fontSize: '22px', fontWeight: 700, color: NAVY, textAlign: 'center' }}>
              {busy ? 'Checking…' : ' '}
            </div>
            {cameraError && (
              <div style={{ marginTop: '14px', fontSize: '16px', color: GREY, textAlign: 'center', maxWidth: '380px' }}>
                {cameraError}
              </div>
            )}
          </>
        )}

        {pending && (
          <PendingScreen
            pending={pending}
            confirming={confirming}
            confirmError={confirmError}
            onConfirm={confirmReceived}
            onDismiss={dismissPending}
          />
        )}

        {!pending && result && (
          <ResultScreen result={result} onDismiss={dismiss} />
        )}
      </div>

      {/* Fixed navy, not the state color — the pill's own contrast (white
          text/dot at low opacity) assumes a dark backdrop, and the idle
          scanning state's background is white. Bookends the page with the
          header rather than shifting with each result. */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '14px', background: NAVY, flexShrink: 0 }}>
        <SessionPill />
      </div>
    </div>
  )
}

// The waiting screen. Sits between a scan and a write, for as long as it
// takes — no timer, no auto-return, nothing here dismisses itself. A
// volunteer who steps away mid-transaction finds this exact screen again,
// not a scanner that moved on without them.
//
// Full navy background — not white (shared with idle scanning, which
// would make this screen read as "nothing's happening yet" when
// something very much is) and not teal or gold (the two settled
// outcomes below, which this must never be mistaken for at a glance).
// White-on-navy text reuses the same contrast pattern ResultScreen
// already uses for every settled state, just on a fourth background.
//
// Three lines, top to bottom: the question the volunteer is actually
// answering, the donor's name (the thing they're checking against the
// person in front of them), and the stakes of not answering it. That
// last line exists because the real failure isn't a volunteer who taps
// the wrong button — it's one who doesn't tap anything at all, walks
// away, and the donation sits Pending until the six-week no-show script
// flips it and emails the donor to say their donation never arrived.
// "Tap to confirm" was considered and dropped — it reads as optional.
// "Nothing is recorded until you tap Received" says plainly what's true:
// no tap, no record, regardless of how sure the volunteer already feels.
//
// Received is the large, primary action. "Not this donor" is
// deliberately smaller, lighter, and set apart with real space below it
// — different position, different weight — so a volunteer moving
// quickly can tap Received without a stray tap anywhere near it landing
// on the exit instead.
function PendingScreen({
  pending, confirming, confirmError, onConfirm, onDismiss,
}: {
  pending: Pending
  confirming: boolean
  confirmError: string | null
  onConfirm: () => void
  onDismiss: () => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', width: '100%' }}>
      <div style={{ fontSize: '19px', fontWeight: 700, color: 'rgba(255,255,255,0.85)', textAlign: 'center' }}>
        Is this the donor in front of you?
      </div>

      <div style={{ fontSize: '44px', fontWeight: 800, color: '#ffffff', textAlign: 'center', lineHeight: 1.15 }}>
        {pending.donorName || 'Donor'}
      </div>

      <div style={{ fontSize: '16px', fontWeight: 600, color: 'rgba(255,255,255,0.85)', textAlign: 'center', maxWidth: '340px' }}>
        Nothing is recorded until you tap Received.
      </div>

      <button
        onClick={onConfirm}
        disabled={confirming}
        style={{
          marginTop: '16px', padding: '22px 64px', borderRadius: '14px', border: 'none', background: TEAL,
          color: 'white', fontFamily: 'var(--font-montserrat), Arial, sans-serif', fontWeight: 800,
          fontSize: '26px', cursor: confirming ? 'default' : 'pointer', opacity: confirming ? 0.7 : 1,
        }}
      >
        {confirming ? 'Saving…' : 'Received'}
      </button>

      {confirmError && (
        <div style={{ fontSize: '14px', color: RED, textAlign: 'center', maxWidth: '340px' }}>
          {confirmError}
        </div>
      )}

      {/* Muted white on navy, the same treatment SessionPill already
          uses in this page's own footer — not a new grey-on-navy
          pattern invented for this one button. */}
      <button
        onClick={onDismiss}
        disabled={confirming}
        style={{
          marginTop: '4px', padding: '10px 20px', borderRadius: '8px', border: 'none', background: 'transparent',
          color: 'rgba(255,255,255,0.6)', fontFamily: 'var(--font-montserrat), Arial, sans-serif', fontWeight: 700,
          fontSize: '15px', textDecoration: 'underline', cursor: confirming ? 'default' : 'pointer',
        }}
      >
        Not this donor
      </button>
    </div>
  )
}

function ResultScreen({ result, onDismiss }: { result: ScanResult; onDismiss: () => void }) {
  let heading: string
  let sub: string | null = null

  switch (result.kind) {
    case 'success':
      heading = result.donorName || 'Donation received'
      sub = 'Donation received'
      break
    case 'already-received':
      heading = result.donorName || 'Already checked in'
      sub = result.receivedAt ? `Already checked in at ${formatTime(result.receivedAt)}` : 'Already checked in'
      break
    case 'not-found':
      heading = 'Code not found'
      sub = 'Try scanning again, or check in at the desk.'
      break
    case 'invalid':
      heading = 'Couldn’t read that code'
      sub = 'Try scanning again.'
      break
    case 'offline':
      heading = 'No connection'
      sub = 'Try again in a moment.'
      break
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '32px', width: '100%' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '44px', fontWeight: 800, color: '#ffffff', lineHeight: 1.15 }}>{heading}</div>
        {sub && <div style={{ marginTop: '12px', fontSize: '20px', fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>{sub}</div>}
      </div>
      <button
        onClick={onDismiss}
        style={{
          padding: '20px 56px', borderRadius: '14px', border: 'none', background: CREAM,
          color: NAVY, fontFamily: 'var(--font-montserrat), Arial, sans-serif', fontWeight: 800,
          fontSize: '24px', cursor: 'pointer',
        }}
      >
        Next
      </button>
    </div>
  )
}
