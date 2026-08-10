'use client'



import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import AddAgencyStaffModal, { type AddStaffResult } from '@/components/dawson/modals/AddAgencyStaffModal'
import DuplicateClientBanner, { type ClientMatch } from '@/components/dawson/modals/DuplicateClientModal'



// LOCKED to the post–June 2026 schema. Client Referrals.Items Requested
// is a multi-select with EXACTLY these six options (verified in Airtable
// 06/30/26). Any other string will be rejected by Airtable as an invalid
// option. Display order chosen for the form UI; storage order is unordered.
const ITEMS = [
  'Bedroom Furniture',
  'Dining Room Furniture',
  'Living Room Furniture',
  'Household Items (including kitchen & linens)',
  'Clothes',
  'Baby Items',
]



// Per-slot capacities — MUST match at-auto-schedule-script.js TIME_CAPS,
// components/dawson/modals/RescheduleModal.tsx SLOT_CAP, and the SLOT_MAX
// constant on app/dawson/schedule/page.tsx.
type TimeSlot = '9am' | '10am' | '11am' | '12pm' | '1pm'
const SLOT_CAP: Record<TimeSlot, number> = {
  '9am': 5,
  '10am': 14,
  '11am': 14,
  '12pm': 14,
  '1pm': 3,
}
const TIME_SLOTS: TimeSlot[] = ['9am', '10am', '11am', '12pm', '1pm']



function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 10)
  if (d.length >= 7) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  if (d.length >= 4) return `(${d.slice(0,3)}) ${d.slice(3)}`
  if (d.length > 0) return `(${d}`
  return ''
}



const LABEL: React.CSSProperties = {
  fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.07em', color: '#1B2B4B', marginBottom: '6px', display: 'block',
}



const INPUT: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: '7px',
  border: '1px solid #EDE9E1', fontSize: '14px', color: '#2C3A4A',
  background: 'white', outline: 'none',
}



const SECTION: React.CSSProperties = {
  fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13px',
  color: '#2A7F6F', textTransform: 'uppercase', letterSpacing: '0.08em',
  marginBottom: '16px', marginTop: '8px',
}



const SUBPANEL: React.CSSProperties = {
  background: '#FAF8F4', border: '1px solid #EDE9E1', borderRadius: '8px',
  padding: '16px', marginBottom: '24px',
}



// Agency type — post-migration `email` comes from the Primary Admin lookup
// chain and is null for Unclaimed agencies. We keep it for display only;
// the API route does NOT use it to write to the referral (those columns
// are computed lookups now — see lib/referrals/create.ts).
type Agency = {
  id: string
  name: string
  email: string | null
  contactName: string
  status: string
}



type StaffMember = {
  id: string
  firstName: string
  lastName: string
  name: string
  email: string
  phone: string
  status: string
  displayName: string
}



// A staff hit from the cross-agency search. Same shape as StaffMember
// plus the agency the person belongs to, so picking one result fills
// in BOTH sides of the referral in a single click.
type StaffSearchResult = StaffMember & {
  agencyId: string | null
  agencyName: string
  agencyStatus: string
}



type AvailableDate = {
  date: string
  slotsRemaining: number
  slots9am?: number
  slots10am?: number
  slots11am?: number
  slots12pm?: number
  slots1pm?: number
}



function bookedForSlot(d: AvailableDate | undefined, slot: TimeSlot): number {
  if (!d) return 0
  switch (slot) {
    case '9am':  return d.slots9am  ?? 0
    case '10am': return d.slots10am ?? 0
    case '11am': return d.slots11am ?? 0
    case '12pm': return d.slots12pm ?? 0
    case '1pm':  return d.slots1pm  ?? 0
  }
}



export default function DawsonAddReferralPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [isDuplicate, setIsDuplicate] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Duplicate-check step (app/api/dawson/referrals/check-duplicate) and the
  // inline banner it can surface (DuplicateClientBanner -- not a popup,
  // rendered directly in the page flow). See lib/referrals/match.ts for the
  // matching logic and the confirmed lookback windows (Completed 12mo,
  // Cancelled 12mo, No Show 25 days). This fires EARLY -- as soon as
  // First/Last/DOB are filled in, well before Submit -- specifically so
  // that a "book new appointment" prefill actually saves Dawson from
  // retyping identifying info, and so the banner is already in view by
  // the time he reaches Address to compare against.
  const [checkingDuplicate, setCheckingDuplicate] = useState(false)
  const [duplicateMatches, setDuplicateMatches] = useState<ClientMatch[]>([])
  // "Same person, do not book" or "none of these" -- hides the banner
  // without a resolution. Reset the moment identity fields change again.
  const [bannerDismissed, setBannerDismissed] = useState(false)
  // The exact firstName|lastName|dob|phone combo the check has already run
  // for, so the debounced effect below doesn't re-fire on every unrelated
  // re-render, and so we know whether it's safe to tell the API route to
  // skip its own fallback check at Submit time.
  const [checkedKey, setCheckedKey] = useState<string | null>(null)
  // What the banner resolved to, if anything: clientId links a new
  // referral to an existing Client (clientName is just for the collapsed
  // confirmation strip's copy). Cleared automatically the moment the
  // identity fields change again, since a stale resolution shouldn't carry
  // over to a now-different person.
  const [matchResolution, setMatchResolution] = useState<{ clientId: string; clientName: string } | null>(null)
  // Set when staff choose "reschedule their no-show" -- switches the page
  // into a stripped-down reschedule-only view (just pick a new date/time)
  // since nothing else about the record needs to change.
  const [rescheduleMode, setRescheduleMode] = useState<{ referralId: string; clientName: string } | null>(null)



  const [agencies, setAgencies] = useState<Agency[]>([])
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([])
  const [selectedAgency, setSelectedAgency] = useState<Agency | null>(null)
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null)
  const [agenciesLoading, setAgenciesLoading] = useState(true)
  const [staffLoading, setStaffLoading] = useState(false)



  // Combobox state. One box searches BOTH people and agencies — Dawson
  // usually remembers the caseworker's name, not which agency they sit in.
  const [agencyQuery, setAgencyQuery] = useState('')
  const [agencyDropdownOpen, setAgencyDropdownOpen] = useState(false)
  const agencyComboRef = useRef<HTMLDivElement>(null)



  // Cross-agency staff search (debounced, server-side)
  const [staffResults, setStaffResults] = useState<StaffSearchResult[]>([])
  const [staffSearching, setStaffSearching] = useState(false)



  // "Add staff member" modal, opened when a search comes up empty
  const [showAddStaffModal, setShowAddStaffModal] = useState(false)



  // Picking a staff result sets the agency AND the staff member in the
  // same tick. The [selectedAgency] effect below would normally wipe the
  // staff selection on any agency change, so this ref tells it to stand
  // down for that one render.
  const skipStaffResetRef = useRef(false)



  // New agency inline panel
  const [newAgencyMode, setNewAgencyMode] = useState(false)
  const [newAgency, setNewAgency] = useState({ name: '', email: '' })



  // New staff inline panel (for existing agency)
  const [newStaffMode, setNewStaffMode] = useState(false)
  const [newStaff, setNewStaff] = useState({ firstName: '', lastName: '', email: '', phone: '' })



  const [availableDates, setAvailableDates] = useState<AvailableDate[]>([])
  const [availabilityLoading, setAvailabilityLoading] = useState(true)

  // City autocomplete -- most-common values already on file, fetched once
  // and offered via a native <datalist> on the City field. No per-keystroke
  // querying; the browser handles prefix-filtering itself.
  const [commonCities, setCommonCities] = useState<string[]>([])



  const [form, setForm] = useState({
    firstName: '', lastName: '',
    address: '', address2: '', city: '', state: 'NJ', zip: '',
    phone: '',
    hhSize: '', children: '',
    dob: '',
    language: 'English',
    items: [] as string[],
    notes: '',
    preferredDate: '',
    appointmentTime: null as TimeSlot | null,
  })



  // Load Approved + Unclaimed agencies
  useEffect(() => {
    fetch('/api/dawson/agencies?status=Approved,Unclaimed')
      .then(r => r.json())
      .then(data => { setAgencies(Array.isArray(data) ? data : []); setAgenciesLoading(false) })
      .catch(() => setAgenciesLoading(false))
  }, [])



  // Debounced cross-agency staff search.
  //
  // Runs off the same query box as the agency filter. Skipped once an
  // agency is locked in — at that point the per-agency staff dropdown
  // takes over and a global search would just be noise.
  useEffect(() => {
    const q = agencyQuery.trim()
    if (q.length < 2 || selectedAgency || newAgencyMode) {
      setStaffResults([])
      setStaffSearching(false)
      return
    }

    let cancelled = false
    setStaffSearching(true)

    const timer = setTimeout(() => {
      fetch(`/api/dawson/staff/search?q=${encodeURIComponent(q)}`)
        .then(r => (r.ok ? r.json() : []))
        .then(data => {
          if (cancelled) return
          setStaffResults(Array.isArray(data) ? data : [])
          setStaffSearching(false)
        })
        .catch(() => {
          if (!cancelled) { setStaffResults([]); setStaffSearching(false) }
        })
    }, 250)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [agencyQuery, selectedAgency, newAgencyMode])



  // Load staff when an existing agency is selected
  useEffect(() => {
    if (!selectedAgency) { setStaffMembers([]); setSelectedStaff(null); return }

    // Honour a staff pick that arrived together with the agency.
    const skipReset = skipStaffResetRef.current
    skipStaffResetRef.current = false

    setStaffLoading(true)
    if (!skipReset) {
      setSelectedStaff(null)
      setNewStaffMode(false)
      setNewStaff({ firstName: '', lastName: '', email: '', phone: '' })
    }
    fetch(`/api/dawson/agencies/${selectedAgency.id}/staff`)
      .then(r => r.json())
      .then(data => { setStaffMembers(Array.isArray(data) ? data : []); setStaffLoading(false) })
      .catch(() => setStaffLoading(false))
  }, [selectedAgency])



  // Load available Saturdays
const loadAvailability = () => {
  setAvailabilityLoading(true)
  fetch('/api/dawson/schedule/available?weeks=8')
    .then(r => r.json())
    .then(data => {
      setAvailableDates(Array.isArray(data) ? data : [])
      setAvailabilityLoading(false)
    })
    .catch(() => setAvailabilityLoading(false))
}



useEffect(() => {
  loadAvailability()
}, [])



  // Load the most-common City values once, for the datalist autocomplete.
  useEffect(() => {
    fetch('/api/dawson/clients/cities')
      .then(r => r.json())
      .then(data => setCommonCities(Array.isArray(data.cities) ? data.cities : []))
      .catch(() => setCommonCities([]))
  }, [])



  // Fires the duplicate check as soon as First/Last/DOB are filled in --
  // Agency & Staff is the first section on the form, so by the time
  // someone reaches Client Information the current agency is already
  // known (needed for the no-show "reschedule" same-agency gate).
  // Debounced so it doesn't fire on every keystroke.
  useEffect(() => {
    const first = form.firstName.trim()
    const last = form.lastName.trim()
    if (!first || !last || !form.dob) return

    const key = `${first.toLowerCase()}|${last.toLowerCase()}|${form.dob}|${form.phone.replace(/\D/g, '')}`
    if (key === checkedKey) return

    // Identity changed since whatever was last checked/resolved -- any
    // earlier resolution no longer applies to whoever is typed in now.
    setMatchResolution(null)
    setRescheduleMode(null)
    setBannerDismissed(false)

    let cancelled = false
    const timer = setTimeout(() => {
      setCheckingDuplicate(true)
      fetch('/api/dawson/referrals/check-duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: first, lastName: last, dob: form.dob, phone: form.phone }),
      })
        .then(r => r.json())
        .then(data => {
          if (cancelled) return
          const matches: ClientMatch[] = Array.isArray(data.matches) ? data.matches : []
          setCheckedKey(key)
          setCheckingDuplicate(false)
          setDuplicateMatches(matches)
        })
        .catch(() => {
          if (!cancelled) { setCheckedKey(key); setCheckingDuplicate(false); setDuplicateMatches([]) }
        })
    }, 600)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [form.firstName, form.lastName, form.dob, form.phone, checkedKey])



  // Close agency dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (agencyComboRef.current && !agencyComboRef.current.contains(e.target as Node)) {
        setAgencyDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])



  const set = (field: string, value: any) => setForm(prev => ({ ...prev, [field]: value }))



  const toggleItem = (item: string) => {
    setForm(prev => ({
      ...prev,
      items: prev.items.includes(item)
        ? prev.items.filter(i => i !== item)
        : [...prev.items, item],
    }))
  }



  const filteredAgencies = agencyQuery.trim()
    ? agencies.filter(a => a.name.toLowerCase().includes(agencyQuery.toLowerCase()))
    : agencies



  const exactMatch = agencies.some(a => a.name.toLowerCase() === agencyQuery.trim().toLowerCase())



  const pickAgency = (agency: Agency) => {
    setSelectedAgency(agency)
    setAgencyQuery(agency.name)
    setAgencyDropdownOpen(false)
    setNewAgencyMode(false)
    setNewAgency({ name: '', email: '' })
  }



  // Picking a person fills in the agency and the staff member together.
  const pickStaffResult = (r: StaffSearchResult) => {
    if (!r.agencyId) return

    // Prefer the fully-loaded agency record; fall back to what the
    // search returned if the agency is outside the loaded set (e.g. a
    // status other than Approved/Unclaimed).
    const agency: Agency =
      agencies.find(a => a.id === r.agencyId) ?? {
        id: r.agencyId,
        name: r.agencyName,
        email: null,
        contactName: '',
        status: r.agencyStatus,
      }

    skipStaffResetRef.current = true
    setSelectedAgency(agency)
    setSelectedStaff(r)
    setAgencyQuery(agency.name)
    setAgencyDropdownOpen(false)
    setNewAgencyMode(false)
    setNewAgency({ name: '', email: '' })
    setNewStaffMode(false)
    setStaffResults([])
  }



  const openAddStaffModal = () => {
    setAgencyDropdownOpen(false)
    setShowAddStaffModal(true)
  }



  // The modal does not write to Airtable. It just puts the form into the
  // right "new agency" / "new staff" mode with the fields prefilled, so
  // the existing submit payload and the inline confirmation panels keep
  // working untouched.
  const handleAddStaffSave = (result: AddStaffResult) => {
    if (result.mode === 'existingAgency') {
      skipStaffResetRef.current = true
      setSelectedAgency(result.agency)
      setAgencyQuery(result.agency.name)
      setNewAgencyMode(false)
      setNewAgency({ name: '', email: '' })
      setSelectedStaff(null)
      setNewStaffMode(true)
      setNewStaff(result.staff)
    } else {
      setSelectedAgency(null)
      setStaffMembers([])
      setSelectedStaff(null)
      setNewStaffMode(false)
      setNewAgencyMode(true)
      setNewAgency(result.newAgency)
      setNewStaff(result.staff)
      setAgencyQuery(result.newAgency.name)
    }
    setStaffResults([])
    setAgencyDropdownOpen(false)
    setShowAddStaffModal(false)
  }



  const clearAgency = () => {
    setSelectedAgency(null)
    setSelectedStaff(null)
    setNewAgencyMode(false)
    setNewStaffMode(false)
    setAgencyQuery('')
    setStaffResults([])
    setNewAgency({ name: '', email: '' })
    setNewStaff({ firstName: '', lastName: '', email: '', phone: '' })
  }



  const pickStaff = (id: string) => {
    if (id === '__new__') {
      setSelectedStaff(null)
      setNewStaffMode(true)
      return
    }
    const staff = staffMembers.find(s => s.id === id) ?? null
    setSelectedStaff(staff)
    setNewStaffMode(false)
  }



  const selectedDate = availableDates.find(d => d.date === form.preferredDate)
  const isOverride =
    form.appointmentTime !== null &&
    selectedDate !== undefined &&
    bookedForSlot(selectedDate, form.appointmentTime) >= SLOT_CAP[form.appointmentTime]



  // Actually posts the referral. Called either directly (no duplicate
  // concerns) or after the duplicate-check modal has been resolved one
  // way or another. `extra` carries whatever the modal step decided:
  // clientId (link to an existing Client), rescheduleReferralId (reopen an
  // existing no-show instead of creating anything new), and
  // skipDuplicateCheck (tells the API route this has already been
  // resolved client-side, so it shouldn't re-run its own check).
  const submitReferral = async (extra: {
    clientId?: string
    rescheduleReferralId?: string
    skipDuplicateCheck?: boolean
  }) => {
    // Build payload — three agency/staff cases.
    //
    // Post-migration (June 2026): the API route must NOT write to
    //   Referring Agency / Referring Staff / Agency Email / Staff Phone
    // on the Client Referrals record (those are Lookups via Referring
    // Staff Link). Instead it writes Referring Staff Link = [userId].
    //
    // We only send the IDs and (for new-staff cases) the data needed to
    // create the Agency User. The API route is responsible for the
    // find-or-create logic and for setting Referring Staff Link.
    const payload: any = {
      ...form,
      preferredDate: form.preferredDate,
      appointmentTime: form.appointmentTime,
      ...extra,
    }



    // Rescheduling an existing no-show record touches nothing about
    // agency/staff -- the submit route short-circuits before it would
    // even look at these fields -- so skip resolving them entirely rather
    // than risk a null-selectedAgency crash on a path that doesn't need it.
    if (!extra.rescheduleReferralId) {
      if (newAgencyMode) {
        // Case 3: brand new agency + new staff
        payload.newAgency = {
          name: newAgency.name.trim(),
          email: newAgency.email.trim(),
        }
        payload.newStaff = {
          firstName: newStaff.firstName.trim(),
          lastName: newStaff.lastName.trim(),
          email: newStaff.email.trim(),
          phone: newStaff.phone.trim(),
        }
      } else if (newStaffMode) {
        // Case 2: existing agency + new staff
        if (!selectedAgency) { setError('Please select an agency.'); return }
        payload.agencyId = selectedAgency.id
        payload.newStaff = {
          firstName: newStaff.firstName.trim(),
          lastName: newStaff.lastName.trim(),
          email: newStaff.email.trim(),
          phone: newStaff.phone.trim(),
        }
      } else {
        // Case 1: both exist — just send the IDs; the API route resolves
        // everything else from Airtable via the Referring Staff Link lookup.
        if (!selectedAgency || !selectedStaff) {
          setError('Please select an agency and staff member.')
          return
        }
        payload.agencyId = selectedAgency.id
        payload.staffId = selectedStaff.id
      }
    }



    setLoading(true)
    try {
      const res = await fetch('/api/dawson/referrals/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
            const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Submission failed')
      setIsDuplicate(!!data.duplicate)
      setSubmitted(true)
      loadAvailability()  // refresh slot counts for next referral
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }



  // Resolution handlers for DuplicateClientBanner (inline, not a popup --
  // see that file). Nothing has been written to Airtable up to this point
  // — check-duplicate is read-only — so every path here is safe to walk
  // away from with no cleanup needed. This no longer submits anything
  // directly -- it fires early, well before the rest of the form is
  // filled in, so it just records the resolution (or switches into
  // reschedule-only mode) and lets Dawson keep going.
  const handleDuplicateResolve = (action: 'reschedule' | 'book-new', match: ClientMatch) => {
    if (action === 'reschedule') {
      const noShow = match.scenarios.find(s => s.type === 'no-show')
      if (!noShow) return // button is only ever shown when this exists
      setRescheduleMode({
        referralId: noShow.referral.id,
        clientName: `${match.client.firstName} ${match.client.lastName}`.trim(),
      })
      return
    }

    // book-new: link the eventual new referral to this existing Client.
    // Prefill DOB/phone/address/city/state/zip/language from the matched
    // Client record so Dawson isn't retyping who they already are -- but
    // leave every field editable, and leave Items Requested, Household
    // size, Children, and Internal Notes blank. This is a new
    // appointment, not a copy of an old one -- those details get filled
    // in fresh. (If Dawson edits DOB/phone/address enough that it no
    // longer matches this Client's record on file, the submit route
    // detects that and creates a new Client instead of linking to this
    // one -- see clientDataDiverges in lib/referrals/match.ts.) The banner
    // collapses to a one-line confirmation strip once this resolves.
    setMatchResolution({
      clientId: match.client.id,
      clientName: `${match.client.firstName} ${match.client.lastName}`.trim(),
    })
    setForm(prev => ({
      ...prev,
      address: match.client.address || prev.address,
      address2: match.client.address2 || prev.address2,
      city: match.client.city || prev.city,
      state: match.client.state || prev.state,
      zip: match.client.zip || prev.zip,
      language: match.client.language || prev.language,
    }))
  }

  const handleDuplicateDecline = () => {
    // "Same person — do not book." No-op today: just hides the banner and
    // leaves the form as Dawson left it. Kept as its own handler (distinct
    // from onDismiss) in case a backend hook gets added here later.
    setBannerDismissed(true)
  }

  const handleDuplicateDismiss = () => {
    // "None of these are the same person" -- proceed as a genuinely new client.
    setBannerDismissed(true)
    setMatchResolution(null)
  }

  // "Change" on the collapsed confirmation strip -- reopens the full
  // match list so Dawson can pick a different match, reschedule instead,
  // or back out entirely. Doesn't touch whatever got prefilled; he can
  // just edit those fields directly if he picks someone else.
  const handleReopenBanner = () => {
    setMatchResolution(null)
  }

  const handleRescheduleConfirm = async () => {
    setError(null)
    if (!form.preferredDate) {
      setError('Please select a preferred Saturday.')
      return
    }
    if (!rescheduleMode) return
    await submitReferral({ rescheduleReferralId: rescheduleMode.referralId, skipDuplicateCheck: true })
  }



  const handleSubmit = async () => {
    setError(null)



    // Agency validation
    if (newAgencyMode) {
      if (!newAgency.name.trim()) { setError('Please enter the new agency name.'); return }
      if (!newAgency.email.trim()) { setError('Please enter the new agency email.'); return }
    } else if (!selectedAgency) {
      setError('Please select an agency.'); return
    }



    // Staff validation
    if (newAgencyMode || newStaffMode) {
      if (!newStaff.firstName.trim() || !newStaff.lastName.trim()) {
        setError('Please enter the staff first and last name.'); return
      }
      if (!newStaff.email.trim()) {
        setError('Please enter the staff email.'); return
      }
    } else if (!selectedStaff) {
      setError('Please select a staff member.'); return
    }



    // Name the missing fields explicitly -- a generic "fill in all required
    // fields" message sends you hunting, especially when a date input looks
    // filled but holds an empty value.
    const REQUIRED_LABELS: Record<string, string> = {
      firstName: 'First Name',
      lastName: 'Last Name',
      address: 'Address',
      city: 'City',
      state: 'State',
      zip: 'Zip',
      hhSize: '# in Household',
      children: '# of Children',
      dob: 'Date of Birth',
    }
    const missing = Object.keys(REQUIRED_LABELS).filter(
      f => !String(form[f as keyof typeof form] ?? '').trim()
    )
    if (missing.length > 0) {
      setError(
        `Missing required ${missing.length === 1 ? 'field' : 'fields'}: ` +
        missing.map(f => REQUIRED_LABELS[f]).join(', ')
      )
      return
    }
    if (form.items.length === 0) {
      setError('Please select at least one item.')
      return
    }
    if (!form.preferredDate) {
      setError('Please select a preferred Saturday.')
      return
    }



    // The duplicate check already ran earlier (right after First/Last/DOB
    // were filled in) via the debounced effect above -- this just uses
    // whatever it resolved to. `checkedKey` matching the current identity
    // fields means it's safe to tell the API route to trust that rather
    // than re-run its own fallback check.
    const currentKey = `${form.firstName.trim().toLowerCase()}|${form.lastName.trim().toLowerCase()}|${form.dob}|${form.phone.replace(/\D/g, '')}`
    await submitReferral({
      clientId: matchResolution?.clientId,
      skipDuplicateCheck: checkedKey === currentKey,
    })
  }



  if (submitted) {
    return (
      <div style={{ background: '#F7F5F1', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: 'white', borderRadius: '12px', padding: '48px', textAlign: 'center', maxWidth: '480px', boxShadow: '0 2px 12px rgba(27,43,75,0.07)' }}>
          <div style={{ width: '56px', height: '56px', background: '#EAF4F2', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2A7F6F" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <h2 style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '20px', color: '#1B2B4B', marginBottom: '10px' }}>
            {rescheduleMode ? 'Appointment Rescheduled' : 'Referral Submitted'}
          </h2>
          {isDuplicate && !rescheduleMode && (
            <div style={{ background: '#FEF9EC', border: '1px solid #C9A84C', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', fontSize: '13px', color: '#2C3A4A' }}>
              ⚠️ This client may already be in our system. Review before processing.
            </div>
          )}
          <p style={{ fontSize: '14px', color: '#7A8899', lineHeight: 1.7, marginBottom: '28px' }}>
            {rescheduleMode
              ? `${rescheduleMode.clientName}'s appointment has been rescheduled — no new referral was created.`
              : `Referral for ${form.firstName} ${form.lastName} has been submitted successfully.`}
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <button onClick={() => {
  setSubmitted(false)
  clearAgency()
  setForm({ firstName: '', lastName: '', address: '', address2: '', city: '', state: 'NJ', zip: '', phone: '', hhSize: '', children: '', dob: '', language: 'English', items: [], notes: '', preferredDate: '', appointmentTime: null })
  setRescheduleMode(null)
  setMatchResolution(null)
  setCheckedKey(null)
  setDuplicateMatches([])
  setBannerDismissed(false)
  loadAvailability()
}}
              style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid #EDE9E1', background: 'white', color: '#2C3A4A', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              Add Another
            </button>
            <button onClick={() => router.push('/dawson/referrals/scheduled')}
              style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', background: '#2A7F6F', color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>
              View Scheduled
            </button>
          </div>
        </div>
      </div>
    )
  }



  // Reschedule-only view: shown once staff pick "reschedule their
  // no-show" in the duplicate-check modal. Nothing else about the
  // existing Client Referrals record changes -- items, household,
  // agency, notes all stay exactly as they were -- so the only thing
  // left to collect is the new date/time. Reuses the same
  // availableDates/preferredDate/appointmentTime state as the full form.
  if (rescheduleMode) {
    const rSelectedDate = availableDates.find(d => d.date === form.preferredDate)
    const rIsOverride =
      form.appointmentTime !== null &&
      rSelectedDate !== undefined &&
      bookedForSlot(rSelectedDate, form.appointmentTime) >= SLOT_CAP[form.appointmentTime]

    return (
      <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>
        <header style={{ background: 'white', borderBottom: '1px solid #EDE9E1', padding: '0 32px', height: '60px', display: 'flex', alignItems: 'center', position: 'sticky', top: 0, zIndex: 50 }}>
          <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B' }}>
            Reschedule No-Show
          </div>
        </header>

        <div style={{ maxWidth: '600px', margin: '0 auto', padding: '32px' }}>
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', padding: '32px' }}>
            <div style={SECTION}>Reschedule No-Show</div>
            <p style={{ fontSize: '13.5px', color: '#2C3A4A', lineHeight: 1.6, marginBottom: '24px' }}>
              Rescheduling {rescheduleMode.clientName}'s missed appointment. This reuses their existing
              referral — no new record is created, and everything else on file (items, household, notes,
              agency) stays as it was. Just pick the new date and time.
            </p>

            <div style={{ marginBottom: '16px' }}>
              <label style={LABEL}>New Saturday *</label>
              <select
                style={{ ...INPUT, cursor: 'pointer' }}
                value={form.preferredDate}
                onChange={e => {
                  set('preferredDate', e.target.value)
                  set('appointmentTime', null)
                }}
                disabled={availabilityLoading}
              >
                <option value="">
                  {availabilityLoading ? 'Loading dates...' : 'Select a Saturday...'}
                </option>
                {availableDates.map(d => {
                  const dateObj = new Date(d.date + 'T00:00:00')
                  const label = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
                  return (
                    <option key={d.date} value={d.date}>
                      {label} — {d.slotsRemaining} slot{d.slotsRemaining === 1 ? '' : 's'}
                    </option>
                  )
                })}
              </select>
            </div>

            {form.preferredDate && (
              <div style={{ marginBottom: '20px' }}>
                <label style={LABEL}>Time (optional — leave blank to auto-schedule)</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
                  {TIME_SLOTS.map(slot => {
                    const booked = bookedForSlot(rSelectedDate, slot)
                    const cap = SLOT_CAP[slot]
                    const full = booked >= cap
                    const selected = form.appointmentTime === slot
                    return (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => set('appointmentTime', selected ? null : slot)}
                        style={{
                          padding: '10px 6px', borderRadius: '8px',
                          border: selected ? '2px solid #2A7F6F' : full ? '1px solid #F0C4BE' : '1px solid #EDE9E1',
                          background: selected ? '#2A7F6F' : full ? '#FDEDEC' : 'white',
                          color: selected ? 'white' : full ? '#C0392B' : '#2C3A4A',
                          cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
                          fontFamily: 'var(--font-montserrat)',
                        }}
                      >
                        <span style={{ fontSize: '13px', fontWeight: 800, lineHeight: 1 }}>{slot}</span>
                        <span style={{ fontSize: '11px', fontWeight: 600, opacity: selected ? 0.85 : 1, lineHeight: 1 }}>
                          {booked}/{cap}
                        </span>
                      </button>
                    )
                  })}
                </div>
                {rIsOverride && form.appointmentTime && (
                  <div style={{ fontSize: '12px', color: '#8A6A00', marginTop: '10px' }}>
                    Override — {form.appointmentTime} is at capacity ({bookedForSlot(rSelectedDate, form.appointmentTime)}/{SLOT_CAP[form.appointmentTime]} booked)
                  </div>
                )}
              </div>
            )}

            {error && (
              <div style={{ background: '#FDEDEC', border: '1px solid #C0392B', borderRadius: '8px', padding: '12px 16px', marginBottom: '20px', fontSize: '13px', color: '#C0392B' }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setRescheduleMode(null)}
                style={{ flex: 1, padding: '13px', borderRadius: '8px', border: '1px solid #EDE9E1', background: 'white', color: '#2C3A4A', fontFamily: 'var(--font-montserrat)', fontWeight: 700, fontSize: '13.5px', cursor: 'pointer' }}
              >
                Back
              </button>
              <button
                onClick={handleRescheduleConfirm}
                disabled={loading}
                style={{ flex: 2, padding: '13px', borderRadius: '8px', border: 'none', background: loading ? '#7A8899' : '#2A7F6F', color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '13.5px', cursor: loading ? 'not-allowed' : 'pointer' }}
              >
                {loading ? 'Rescheduling...' : 'Confirm Reschedule'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }



  return (
    <div style={{ background: '#F7F5F1', minHeight: '100vh' }}>
      <header style={{ background: 'white', borderBottom: '1px solid #EDE9E1', padding: '0 32px', height: '60px', display: 'flex', alignItems: 'center', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '16px', color: '#1B2B4B' }}>
          Add Referral
        </div>
      </header>



      <div style={{ maxWidth: '780px', margin: '0 auto', padding: '32px' }}>
        <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 2px 8px rgba(27,43,75,0.06)', padding: '32px' }}>



          {/* Agency + Staff Selection */}
          <div style={SECTION}>Agency & Staff</div>



          {/* Agency combobox */}
          <div style={{ marginBottom: '16px' }}>
            <label style={LABEL}>Agency or Staff Member *</label>
            <div ref={agencyComboRef} style={{ position: 'relative' }}>
              <input
                style={INPUT}
                value={agencyQuery}
                onChange={e => {
                  setAgencyQuery(e.target.value)
                  setAgencyDropdownOpen(true)
                  if (selectedAgency && e.target.value !== selectedAgency.name) {
                    setSelectedAgency(null)
                  }
                  if (newAgencyMode) {
                    setNewAgencyMode(false)
                  }
                }}
                onFocus={() => setAgencyDropdownOpen(true)}
                placeholder={agenciesLoading ? 'Loading agencies...' : 'Type a staff name, email, or agency...'}
                disabled={agenciesLoading}
              />
              {(selectedAgency || newAgencyMode || agencyQuery) && (
                <button
                  type="button"
                  onClick={clearAgency}
                  style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: '#7A8899', fontSize: '18px', padding: '4px 8px' }}
                >×</button>
              )}
              {agencyDropdownOpen && !agenciesLoading && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #EDE9E1', borderRadius: '7px', marginTop: '4px', maxHeight: '280px', overflowY: 'auto', zIndex: 100, boxShadow: '0 4px 12px rgba(27,43,75,0.08)' }}>
                  {/* Staff matches first — this is the path Dawson uses most */}
                  {staffSearching && staffResults.length === 0 && agencyQuery.trim().length >= 2 && (
                    <div style={{ padding: '12px 14px', fontSize: '13px', color: '#7A8899' }}>
                      Searching staff...
                    </div>
                  )}

                  {staffResults.length > 0 && (
                    <div style={{ padding: '7px 14px 5px', fontSize: '10px', fontWeight: 800, color: '#7A8899', textTransform: 'uppercase', letterSpacing: '0.08em', background: '#FCFBF9' }}>
                      Staff Members
                    </div>
                  )}
                  {staffResults.map(s => (
                    <div
                      key={s.id}
                      onClick={() => pickStaffResult(s)}
                      style={{ padding: '9px 14px', cursor: 'pointer', borderBottom: '1px solid #F7F5F1' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#FAF8F4')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'white')}
                    >
                      <div style={{ fontSize: '13px', color: '#2C3A4A', fontWeight: 600 }}>
                        {s.name || s.email}
                        {s.status === 'Unclaimed' && (
                          <span style={{ marginLeft: '8px', fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '10px', background: 'rgba(122,136,153,0.15)', color: '#7A8899', letterSpacing: '0.04em' }}>
                            UNCLAIMED
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '11.5px', color: '#7A8899', marginTop: '2px' }}>
                        {s.name && s.email ? `${s.email} · ` : ''}
                        {s.agencyName || 'No agency on file'}
                      </div>
                    </div>
                  ))}

                  {filteredAgencies.length > 0 && staffResults.length > 0 && (
                    <div style={{ padding: '7px 14px 5px', fontSize: '10px', fontWeight: 800, color: '#7A8899', textTransform: 'uppercase', letterSpacing: '0.08em', background: '#FCFBF9', borderTop: '1px solid #EDE9E1' }}>
                      Agencies
                    </div>
                  )}
                  {filteredAgencies.length === 0 && !agencyQuery.trim() && (
                    <div style={{ padding: '12px 14px', fontSize: '13px', color: '#7A8899' }}>No agencies</div>
                  )}
                  {filteredAgencies.map(a => (
                    <div
                      key={a.id}
                      onClick={() => pickAgency(a)}
                      style={{ padding: '10px 14px', fontSize: '13px', color: '#2C3A4A', cursor: 'pointer', borderBottom: '1px solid #F7F5F1' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#FAF8F4')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'white')}
                    >
                      {a.name}
                      {a.status === 'Unclaimed' && (
                        <span style={{ marginLeft: '8px', fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '10px', background: 'rgba(122,136,153,0.15)', color: '#7A8899', letterSpacing: '0.04em' }}>
                          UNCLAIMED
                        </span>
                      )}
                    </div>
                  ))}
                  {/* Nothing matched at all */}
                  {agencyQuery.trim().length >= 2 &&
                    !staffSearching &&
                    staffResults.length === 0 &&
                    filteredAgencies.length === 0 && (
                      <div style={{ padding: '12px 14px', fontSize: '13px', color: '#7A8899' }}>
                        No staff or agency matches "{agencyQuery.trim()}"
                      </div>
                    )}

                  {agencyQuery.trim() && !exactMatch && (
                    <div
                      onClick={openAddStaffModal}
                      style={{ padding: '10px 14px', fontSize: '13px', color: '#2A7F6F', cursor: 'pointer', fontWeight: 600, background: '#EAF4F2', borderTop: (filteredAgencies.length > 0 || staffResults.length > 0) ? '1px solid #EDE9E1' : 'none' }}
                    >
                      + Add new staff member or agency
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>



          {/* New agency inline panel */}
          {newAgencyMode && (
            <div style={SUBPANEL}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#2A7F6F', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                New Agency Details
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={LABEL}>Agency Name *</label>
                  <input style={INPUT} value={newAgency.name} onChange={e => setNewAgency({ ...newAgency, name: e.target.value })} placeholder="Agency name" />
                </div>
                <div>
                  <label style={LABEL}>Agency Email *</label>
                  <input style={INPUT} type="email" value={newAgency.email} onChange={e => setNewAgency({ ...newAgency, email: e.target.value })} placeholder="agency@example.com" />
                </div>
              </div>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#2A7F6F', marginBottom: '12px', marginTop: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Referring Staff Member
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={LABEL}>First Name *</label>
                  <input style={INPUT} value={newStaff.firstName} onChange={e => setNewStaff({ ...newStaff, firstName: e.target.value })} />
                </div>
                <div>
                  <label style={LABEL}>Last Name *</label>
                  <input style={INPUT} value={newStaff.lastName} onChange={e => setNewStaff({ ...newStaff, lastName: e.target.value })} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={LABEL}>Staff Email *</label>
                  <input style={INPUT} type="email" value={newStaff.email} onChange={e => setNewStaff({ ...newStaff, email: e.target.value })} placeholder="staff@example.com" />
                </div>
                <div>
                  <label style={LABEL}>Staff Phone</label>
                  <input style={INPUT} value={newStaff.phone} onChange={e => setNewStaff({ ...newStaff, phone: formatPhone(e.target.value) })} placeholder="(000) 000-0000" />
                </div>
              </div>
            </div>
          )}



          {/* Staff selection (only if existing agency is picked) */}
          {selectedAgency && !newAgencyMode && (
            <div style={{ marginBottom: '16px' }}>
              <label style={LABEL}>Staff Member *</label>
              <select
                style={INPUT}
                value={newStaffMode ? '__new__' : (selectedStaff?.id ?? '')}
                onChange={e => pickStaff(e.target.value)}
                disabled={staffLoading}
              >
                <option value="">{staffLoading ? 'Loading...' : 'Select staff member...'}</option>
                {/* Keep a picked-from-search person visible while the
                    per-agency list is still loading in behind them. */}
                {selectedStaff && !staffMembers.some(m => m.id === selectedStaff.id) && (
                  <option value={selectedStaff.id}>{selectedStaff.displayName}</option>
                )}
                {staffMembers.map(s => (
  <option key={s.id} value={s.id}>{s.displayName}</option>
))}
                <option value="__new__">+ Add new staff member</option>
              </select>
            </div>
          )}



          {/* New staff inline panel (for existing agency) */}
          {selectedAgency && newStaffMode && (
            <div style={SUBPANEL}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#2A7F6F', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                New Staff Member
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={LABEL}>First Name *</label>
                  <input style={INPUT} value={newStaff.firstName} onChange={e => setNewStaff({ ...newStaff, firstName: e.target.value })} />
                </div>
                <div>
                  <label style={LABEL}>Last Name *</label>
                  <input style={INPUT} value={newStaff.lastName} onChange={e => setNewStaff({ ...newStaff, lastName: e.target.value })} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={LABEL}>Staff Email *</label>
                  <input style={INPUT} type="email" value={newStaff.email} onChange={e => setNewStaff({ ...newStaff, email: e.target.value })} placeholder="staff@example.com" />
                </div>
                <div>
                  <label style={LABEL}>Staff Phone</label>
                  <input style={INPUT} value={newStaff.phone} onChange={e => setNewStaff({ ...newStaff, phone: formatPhone(e.target.value) })} placeholder="(000) 000-0000" />
                </div>
              </div>
            </div>
          )}



          <div style={{ marginBottom: '12px' }} />



          {/* Client Info */}
          <div style={SECTION}>Client Information</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={LABEL}>First Name *</label>
              <input style={INPUT} value={form.firstName} onChange={e => set('firstName', e.target.value)} placeholder="First name" />
            </div>
            <div>
              <label style={LABEL}>Last Name *</label>
              <input style={INPUT} value={form.lastName} onChange={e => set('lastName', e.target.value)} placeholder="Last name" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={LABEL}>Date of Birth *</label>
              <input style={INPUT} type="date" value={form.dob} onChange={e => set('dob', e.target.value)} />
            </div>
            <div>
              <label style={LABEL}>Cell Phone</label>
              <input style={INPUT} value={form.phone} onChange={e => set('phone', formatPhone(e.target.value))} placeholder="(000) 000-0000 (optional)" />
            </div>
            <div>
              <label style={LABEL}>Preferred Language</label>
              <select style={INPUT} value={form.language} onChange={e => set('language', e.target.value)}>
                <option>English</option>
                <option>Spanish</option>
                <option>Creole</option>
              </select>
            </div>
          </div>

          {/* Inline duplicate-client banner -- not a popup. Appears here,
              right after the identity fields that trigger it and right
              before Address, so it's in view both immediately (comparing
              DOB/phone) and as Dawson keeps filling in Address below (live
              compare updates as he types). */}
          {duplicateMatches.length > 0 && !bannerDismissed && (
            <DuplicateClientBanner
              matches={duplicateMatches}
              currentAgencyName={newAgencyMode ? newAgency.name : (selectedAgency?.name || '')}
              form={{
                dob: form.dob, phone: form.phone,
                address: form.address, address2: form.address2,
                city: form.city, state: form.state, zip: form.zip,
              }}
              resolved={matchResolution}
              onResolve={handleDuplicateResolve}
              onDecline={handleDuplicateDecline}
              onDismiss={handleDuplicateDismiss}
              onReopen={handleReopenBanner}
            />
          )}



          {/* Address */}
          <div style={{ ...SECTION, marginTop: '24px' }}>Address</div>
          <div style={{ marginBottom: '16px' }}>
            <label style={LABEL}>Street Address *</label>
            <input style={INPUT} value={form.address} onChange={e => set('address', e.target.value)} placeholder="123 Main Street" />
          </div>
          <div style={{ marginBottom: '16px' }}>
            <label style={LABEL}>Address Line 2</label>
            <input style={INPUT} value={form.address2} onChange={e => set('address2', e.target.value)} placeholder="Apt, Suite, Unit (optional)" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 120px', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={LABEL}>City *</label>
              <input
                style={INPUT}
                value={form.city}
                onChange={e => set('city', e.target.value)}
                placeholder="City"
                list="common-cities"
                autoComplete="off"
              />
              <datalist id="common-cities">
                {commonCities.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <label style={LABEL}>State *</label>
              <input style={INPUT} value={form.state} onChange={e => set('state', e.target.value)} />
            </div>
            <div>
              <label style={LABEL}>Zip *</label>
              <input style={INPUT} value={form.zip} onChange={e => set('zip', e.target.value)} placeholder="07090" />
            </div>
          </div>



          {/* Household */}
          <div style={{ ...SECTION, marginTop: '24px' }}>Household</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={LABEL}>Household Size *</label>
              <input style={INPUT} type="number" min="1" value={form.hhSize} onChange={e => set('hhSize', e.target.value)} placeholder="Total people in household" />
            </div>
            <div>
              <label style={LABEL}>Number of Children *</label>
              <input style={INPUT} type="number" min="0" value={form.children} onChange={e => set('children', e.target.value)} placeholder="Children under 18" />
            </div>
          </div>



          {/* Items */}
          <div style={{ ...SECTION, marginTop: '24px' }}>Items Requested *</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '24px' }}>
            {ITEMS.map(item => (
              <label key={item} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '10px 14px', borderRadius: '8px', border: `1px solid ${form.items.includes(item) ? '#2A7F6F' : '#EDE9E1'}`, background: form.items.includes(item) ? '#EAF4F2' : 'white', transition: 'all 0.15s' }}>
                <input type="checkbox" checked={form.items.includes(item)} onChange={() => toggleItem(item)} style={{ display: 'none' }} />
                <div style={{ width: '18px', height: '18px', borderRadius: '4px', border: `2px solid ${form.items.includes(item) ? '#2A7F6F' : '#EDE9E1'}`, background: form.items.includes(item) ? '#2A7F6F' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all 0.15s' }}>
                  {form.items.includes(item) && (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  )}
                </div>
                <span style={{ fontSize: '13px', color: '#2C3A4A', fontWeight: form.items.includes(item) ? 600 : 400 }}>{item}</span>
              </label>
            ))}
          </div>



          {/* Preferred Appointment */}
          <div style={{ ...SECTION, marginTop: '8px' }}>Preferred Appointment</div>
          <div style={{ marginBottom: '16px' }}>
            <label style={LABEL}>Preferred Saturday *</label>
            <select
              style={{ ...INPUT, cursor: 'pointer' }}
              value={form.preferredDate}
              onChange={e => {
                set('preferredDate', e.target.value)
                set('appointmentTime', null)
              }}
              disabled={availabilityLoading}
            >
              <option value="">
                {availabilityLoading ? 'Loading dates...' : 'Select a Saturday...'}
              </option>
              {availableDates.map(d => {
                const dateObj = new Date(d.date + 'T00:00:00')
                const label = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
                return (
                  <option key={d.date} value={d.date}>
                    {label} — {d.slotsRemaining} slot{d.slotsRemaining === 1 ? '' : 's'}
                  </option>
                )
              })}
            </select>
          </div>



          {/* Time-slot pills — visible whenever a Saturday is picked */}
          {form.preferredDate && (
            <div style={{ marginBottom: '16px' }}>
              <label style={LABEL}>
                Time (optional — leave blank to auto-schedule)
              </label>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, 1fr)',
                  gap: '8px',
                }}
              >
                {TIME_SLOTS.map(slot => {
                  const booked = bookedForSlot(selectedDate, slot)
                  const cap = SLOT_CAP[slot]
                  const full = booked >= cap
                  const selected = form.appointmentTime === slot
                  return (
                    <button
                      key={slot}
                      type="button"
                      onClick={() =>
                        set('appointmentTime', selected ? null : slot)
                      }
                      style={{
                        padding: '10px 6px',
                        borderRadius: '8px',
                        border: selected
                          ? '2px solid #2A7F6F'
                          : full
                            ? '1px solid #F0C4BE'
                            : '1px solid #EDE9E1',
                        background: selected
                          ? '#2A7F6F'
                          : full
                            ? '#FDEDEC'
                            : 'white',
                        color: selected ? 'white' : full ? '#C0392B' : '#2C3A4A',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '3px',
                        fontFamily: 'var(--font-montserrat)',
                      }}
                    >
                      <span style={{ fontSize: '13px', fontWeight: 800, lineHeight: 1 }}>
                        {slot}
                      </span>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          opacity: selected ? 0.85 : 1,
                          lineHeight: 1,
                        }}
                      >
                        {booked}/{cap}
                      </span>
                    </button>
                  )
                })}
              </div>
              {isOverride && form.appointmentTime && (
                <div
                  style={{
                    fontSize: '12px',
                    color: '#8A6A00',
                    marginTop: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#C9A84C"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  Override — {form.appointmentTime} is at capacity (
                  {bookedForSlot(selectedDate, form.appointmentTime)}/
                  {SLOT_CAP[form.appointmentTime]} booked)
                </div>
              )}
            </div>
          )}



          <div style={{ marginBottom: '8px' }} />



          {/* Notes */}
          <div style={{ ...SECTION, marginTop: '8px' }}>Additional Notes</div>
          <textarea
            style={{ ...INPUT, height: '90px', resize: 'vertical', marginBottom: '28px' }}
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder="Any special circumstances or additional information..."
          />



          {error && (
            <div style={{ background: '#FDEDEC', border: '1px solid #C0392B', borderRadius: '8px', padding: '12px 16px', marginBottom: '20px', fontSize: '13px', color: '#C0392B' }}>
              {error}
            </div>
          )}



          <button onClick={handleSubmit} disabled={loading || checkingDuplicate}
            style={{ width: '100%', padding: '14px', borderRadius: '8px', border: 'none', background: (loading || checkingDuplicate) ? '#7A8899' : '#2A7F6F', color: 'white', fontFamily: 'var(--font-montserrat)', fontWeight: 800, fontSize: '14px', cursor: (loading || checkingDuplicate) ? 'not-allowed' : 'pointer', letterSpacing: '0.02em' }}>
            {checkingDuplicate ? 'Checking for existing client...' : loading ? 'Submitting...' : 'Submit Referral'}
          </button>



        </div>
      </div>



      {showAddStaffModal && (
        <AddAgencyStaffModal
          agencies={agencies}
          initialQuery={agencyQuery}
          initialAgency={selectedAgency}
          onClose={() => setShowAddStaffModal(false)}
          onSave={handleAddStaffSave}
        />
      )}
    </div>
  )
}
