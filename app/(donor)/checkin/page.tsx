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
// The hidden text input stays focused at all times and re-focuses after
// every result — outdoors, away from a desk, nobody can reliably tap back
// into a field. A fresh scan arriving while a result is still on screen
// supersedes it immediately, rather than requiring the "Next" tap first —
// a volunteer who scans the next donor without quite landing on the button
// should not get stuck.
//
// Four full-screen states, all visually distinct, large type / high
// contrast for arm's-length daylight reading: success (teal), already
// received (teal-adjacent, calm — NOT an error, a routine double scan),
// not found (red — a genuine problem), offline (grey — a connectivity
// state, not a data problem). "Offline" is never something the server
// says; it's the fetch itself failing to reach it.
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
// every result by hand. The "Next"/"Received" button still exists for
// anyone who'd rather not wait; this is the fallback, not a replacement
// for it. Applied uniformly across all four result states (success,
// already-received, not-found, offline) rather than only the success
// case — a volunteer with a queue doesn't want to get stuck on an error
// screen any more than a success one; they'll just scan again.
const AUTO_RETURN_MS = 2500

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
  const [result, setResult] = useState<ScanResult | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const busyRef = useRef(false) // avoids a stale closure in the scan loop's setInterval

  const refocus = useCallback(() => {
    // A brief delay lets a virtual keyboard, if one ever flashed up, close
    // first — focusing immediately can otherwise get fought by the OS.
    window.setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  const submitScan = useCallback(async (raw: string) => {
    if (busyRef.current || !raw.trim()) return
    busyRef.current = true
    setBusy(true)
    try {
      const res = await fetch('/api/donor-checkin', {
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
        setResult({ kind: 'already-received', donorName: body.donorName, receivedAt: body.receivedAt })
      } else {
        setResult({ kind: 'success', donorName: body.donorName })
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

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    const value = (e.target as HTMLInputElement).value
    ;(e.target as HTMLInputElement).value = ''
    setResult(null)
    void submitScan(value)
  }

  function dismiss() {
    setResult(null)
    refocus()
  }

  // Auto-return — see AUTO_RETURN_MS above. Cleared on unmount and
  // whenever `result` changes (a manual dismiss, or a fresh scan
  // superseding the current one), so it can never fire against a result
  // that's no longer on screen.
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
        setCameraError('Camera scanning isn’t available on this device. Use the keyboard scanner.')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      } catch {
        setCameraError('Couldn’t reach the camera. Use the keyboard scanner.')
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
        if (!busyRef.current && !result && videoRef.current && videoRef.current.readyState >= 2) {
          try {
            const codes = await detector.detect(videoRef.current)
            if (codes.length > 0) {
              const value = codes[0].rawValue as string
              setResult(null)
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

  const bg = backgroundFor(result)

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
            receive real input. */}
        <input
          ref={inputRef}
          onKeyDown={onKeyDown}
          onBlur={refocus}
          autoFocus
          style={{ position: 'absolute', top: '-9999px', left: '-9999px', width: '1px', height: '1px' }}
          aria-hidden="true"
          tabIndex={-1}
        />

        {!result && (
          <>
            {/* A first-time volunteer sees what this screen is (the
                heading) and what to do (the one instruction line) with
                nothing else to read. "Point the camera" is deliberately
                not "use your phone camera to scan" — the old GoDaddy page's
                wording described handing off to the native Camera app,
                which this page never does; scanning happens in-page. */}
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

        {result && (
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

function ResultScreen({ result, onDismiss }: { result: ScanResult; onDismiss: () => void }) {
  let heading: string
  let sub: string | null = null
  // "Received" only for the state it actually describes — the write
  // already happened server-side by the time this renders, but "tap
  // Received" is the mental model a volunteer confirming a donation
  // actually has. Every other state gets the generic "Next": nothing was
  // received in an already-received/error/offline result, so the button
  // shouldn't claim otherwise.
  let buttonLabel = 'Next'

  switch (result.kind) {
    case 'success':
      heading = result.donorName || 'Checked in'
      sub = 'Checked in'
      buttonLabel = 'Received'
      break
    case 'already-received':
      heading = result.donorName || 'Already checked in'
      sub = result.receivedAt ? `Already checked in at ${formatTime(result.receivedAt)}` : 'Already checked in'
      break
    case 'not-found':
      heading = 'Code not found'
      sub = 'Try scanning again, or use the search on the desk Chromebook.'
      break
    case 'invalid':
      heading = 'Couldn’t read that code'
      sub = 'Try scanning again.'
      break
    case 'offline':
      heading = 'No connection'
      sub = 'Check the network and try again.'
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
        {buttonLabel}
      </button>
    </div>
  )
}
