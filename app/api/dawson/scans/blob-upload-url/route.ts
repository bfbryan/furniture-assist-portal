// app/api/dawson/scans/blob-upload-url/route.ts
//
// Grants a signed upload token to the client so the browser can PUT a PDF
// directly to Vercel Blob, bypassing Vercel's 4.5 MB serverless function
// payload limit.
//
// Flow:
//   1. Browser calls this endpoint requesting an upload token
//   2. This endpoint verifies auth (Clerk) + Dawson access
//   3. Returns a scoped token that permits ONE upload of ONE PDF
//   4. Browser uploads the PDF directly to Blob using that token
//   5. Browser then calls /api/dawson/scans/upload with the resulting blob URL
//
// Security notes:
//   - Token is scoped to the specific pathname requested
//   - Content type restricted to application/pdf
//   - Max file size enforced at 100 MB
//   - Access is 'public' but URLs contain 128-bit random suffix (unguessable)
//   - PDFs are deleted immediately after OCR processing completes
// ============================================================

import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { requireDawsonAccess } from '@/lib/auth/dawson-access'

export const runtime = 'nodejs'

export async function POST(request: Request): Promise<NextResponse> {
  // ============================================================
  // Auth gate — matches pattern used across /api/dawson/*
  // ============================================================
  const denied = await requireDawsonAccess()
  if (denied) return denied

  const { userId } = await auth()

  // ============================================================
  // Blob upload token generation
  // ============================================================
  let body: HandleUploadBody
  try {
    body = (await request.json()) as HandleUploadBody
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // Restrict what can be uploaded
        return {
          allowedContentTypes: ['application/pdf'],
          maximumSizeInBytes: 100 * 1024 * 1024, // 100 MB
          addRandomSuffix: true, // append random chars to prevent URL guessing
          // Metadata surfaced to onUploadCompleted (not needed here but useful for future)
          tokenPayload: JSON.stringify({ userId, pathname }),
        }
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Fires server-side after the browser finishes the direct upload.
        // We don't need to do anything here — the subsequent call to
        // /api/dawson/scans/upload is what triggers OCR. This hook is
        // reserved for future use (audit logging, virus scan, etc.).
        console.log(`[BLOB UPLOAD] ${blob.pathname} completed`, {
          size: blob.contentType,
          payload: tokenPayload,
        })
      },
    })
    return NextResponse.json(jsonResponse)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('handleUpload failed:', msg)
    return NextResponse.json(
      { error: `Upload token generation failed: ${msg}` },
      { status: 400 },
    )
  }
}
