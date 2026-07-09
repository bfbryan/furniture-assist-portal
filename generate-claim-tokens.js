#!/usr/bin/env node
/**
 * generate-claim-tokens.js — Generate agency profile claim tokens.
 *
 * USAGE:
 *   node generate-claim-tokens.js                    # dry-run (safe, shows what would happen)
 *   node generate-claim-tokens.js --go               # executes for real: writes tokens to AT
 *
 * WHAT IT DOES:
 *   1. Fetches Agency Users where Send Claim Token = ✓ AND Claim Token is empty AND Email is set
 *   2. For each user, generates a random 48-char hex token
 *   3. Writes token + timestamp to their record, unchecks Send Claim Token
 *   4. Outputs a CSV: name,email,agency,url  →  claim-urls-<timestamp>.csv
 *
 * The output CSV is what you use to send emails (paste into Gmail merge,
 * upload to Zapier, or feed to Airtable's Send-email automation).
 *
 * TOKEN EXPIRY: 7 days from generation (enforced server-side by claim API).
 *
 * SAFETY:
 *   - Dry-run by default. Nothing changes until --go.
 *   - Skips users who already have a token (prevents accidental re-issue).
 *   - Skips users with no email address (nowhere to send it).
 *   - CSV writes to disk in both modes so you can preview URLs before --go.
 *
 * REQUIRES:
 *   - AIRTABLE_API_KEY and AIRTABLE_BASE_ID in .env.local
 *   - NEXT_PUBLIC_APP_URL in .env.local (base URL for claim links, e.g.
 *     https://portal.furnitureassist.org). Falls back to a placeholder
 *     if not set — you can find/replace the CSV before sending.
 */

// -------------------------------------------------------------------------
// Config / env
// -------------------------------------------------------------------------

try {
  require('dotenv').config({ path: '.env.local' })
} catch (_) {}

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const API_KEY = process.env.AIRTABLE_API_KEY
const BASE_ID = process.env.AIRTABLE_BASE_ID
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://portal.example.com'

if (!API_KEY || !BASE_ID) {
  console.error('❌ Missing AIRTABLE_API_KEY or AIRTABLE_BASE_ID env vars.')
  console.error('   Run from repo root so .env.local is loaded.')
  process.exit(1)
}

if (!process.env.NEXT_PUBLIC_APP_URL) {
  console.warn('⚠  NEXT_PUBLIC_APP_URL not set — URLs in CSV will use placeholder.')
  console.warn('   Add NEXT_PUBLIC_APP_URL=https://your-portal-domain to .env.local')
  console.warn('   or find/replace in the output CSV before sending.\n')
}

const LIVE = process.argv.includes('--go')
const HEADERS = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
}

// Filter: candidates for token generation
// Airtable formulas: {Send Claim Token} = 1 (checkbox true), {Claim Token} = "" (empty text)
const FILTER_FORMULA = `AND({Send Claim Token} = 1, {Claim Token} = "", {Email} != "")`

// -------------------------------------------------------------------------
// Airtable helpers
// -------------------------------------------------------------------------

async function atGetAll(table, params = '') {
  const all = []
  let offset = null
  do {
    const sep = params.includes('?') ? '&' : '?'
    const suffix = offset ? `${sep}offset=${offset}` : ''
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}${params}${suffix}`
    const res = await fetch(url, { headers: HEADERS })
    if (!res.ok) {
      throw new Error(`GET ${table} ${res.status}: ${await res.text()}`)
    }
    const data = await res.json()
    all.push(...(data.records || []))
    offset = data.offset
  } while (offset)
  return all
}

async function atPatch(table, recordId, fields) {
  if (!LIVE) {
    return { id: recordId, fields, dryRun: true }
  }
  const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}/${recordId}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({ fields }),
  })
  if (!res.ok) {
    throw new Error(`PATCH ${table}/${recordId} ${res.status}: ${await res.text()}`)
  }
  return res.json()
}

// -------------------------------------------------------------------------
// Token generation
// -------------------------------------------------------------------------

function generateToken() {
  // 24 bytes = 48 hex chars = 192 bits of entropy. Overkill but cheap.
  return crypto.randomBytes(24).toString('hex')
}

// -------------------------------------------------------------------------
// CSV helpers
// -------------------------------------------------------------------------

function csvEscape(val) {
  if (val === null || val === undefined) return ''
  const s = String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

function writeCsv(rows, outPath) {
  const header = ['name', 'email', 'agency', 'url', 'expires_at']
  const lines = [header.join(',')]
  for (const r of rows) {
    lines.push([r.name, r.email, r.agency, r.url, r.expiresAt].map(csvEscape).join(','))
  }
  fs.writeFileSync(outPath, lines.join('\n') + '\n')
}

// -------------------------------------------------------------------------
// Main
// -------------------------------------------------------------------------

async function main() {
  console.log('═'.repeat(72))
  console.log('  GENERATE CLAIM TOKENS')
  console.log(`  Mode: ${LIVE ? '🔴 LIVE' : '🟢 DRY-RUN'}`)
  console.log('═'.repeat(72))
  console.log()

  // --- Fetch candidates ---
  console.log('▸ Fetching Agency Users flagged for token generation...')
  const params = `?filterByFormula=${encodeURIComponent(FILTER_FORMULA)}`
  const users = await atGetAll('Agency Users', params)
  console.log(`   Found ${users.length} user(s) eligible.\n`)

  if (users.length === 0) {
    console.log('   Nothing to do. Check Send Claim Token boxes in Airtable first.')
    return
  }

  // --- Show what we'll process ---
  console.log('▸ Users queued for token generation:')
  for (const u of users) {
    const name = u.fields['Full Name'] || `${u.fields['First Name'] || ''} ${u.fields['Last Name'] || ''}`.trim() || '(no name)'
    const email = u.fields['Email']
    const agencyName = (u.fields['Agency Name (from Agency)'] || [])[0] || u.fields['Agency'] || '(no agency)'
    console.log(`     • ${name} <${email}> — ${agencyName}`)
  }
  console.log()

  // --- Generate tokens + patch records ---
  console.log('▸ Generating tokens and writing to Airtable...')
  const now = new Date()
  const nowIso = now.toISOString()
  const expiresIso = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const csvRows = []
  let successCount = 0
  const failures = []

  for (const u of users) {
    const token = generateToken()
    const name = u.fields['Full Name'] || `${u.fields['First Name'] || ''} ${u.fields['Last Name'] || ''}`.trim()
    const email = u.fields['Email']
    const agencyName = (u.fields['Agency Name (from Agency)'] || [])[0] || u.fields['Agency'] || ''
    const url = `${APP_URL}/agency/claim/${token}`

    try {
      await atPatch('Agency Users', u.id, {
        'Claim Token': token,
        'Claim Token Sent At': nowIso,
        'Send Claim Token': false,
      })
      csvRows.push({ name, email, agency: agencyName, url, expiresAt: expiresIso })
      successCount++
      const prefix = LIVE ? '   ✓' : '   [dry-run]'
      console.log(`${prefix} ${name} <${email}> → ${token.slice(0, 12)}...`)
    } catch (err) {
      failures.push({ user: u.id, name, email, error: err.message })
      console.error(`   ✗ ${name} <${email}>: ${err.message}`)
    }
  }
  console.log()

  // --- Write CSV ---
  const stamp = nowIso.replace(/[:.]/g, '-').slice(0, 19)
  const csvName = LIVE
    ? `claim-urls-${stamp}.csv`
    : `claim-urls-${stamp}-DRYRUN.csv`
  const csvPath = path.resolve(process.cwd(), csvName)
  writeCsv(csvRows, csvPath)
  console.log(`▸ Wrote CSV: ${csvPath}`)
  console.log()

  // --- Summary ---
  console.log('═'.repeat(72))
  if (LIVE) {
    console.log(`  ✅ TOKEN GENERATION COMPLETE`)
    console.log(`     ${successCount} tokens written to Airtable.`)
    if (failures.length) console.log(`     ${failures.length} failure(s) — see above.`)
    console.log(`     CSV: ${csvName}`)
    console.log(`     Expiry: ${expiresIso.slice(0, 10)} (7 days)`)
  } else {
    console.log(`  ✅ DRY-RUN COMPLETE — no changes made.`)
    console.log(`     ${users.length} user(s) would receive tokens.`)
    console.log(`     Preview URLs in: ${csvName}`)
    console.log(`     Re-run with --go to execute.`)
  }
  console.log('═'.repeat(72))
}

main().catch(err => {
  console.error('\n❌ ERROR:', err.message)
  process.exit(1)
})
