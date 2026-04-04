# Furniture Assist Agency Portal
## Admin Management Page — Build Spec
**Page:** `/admin`
**Access:** Org admin role only (`org:admin` in Clerk)
**Last Updated:** March 2026

---

## Overview

The `/admin` page is accessible only to agency users with the `org:admin` role in Clerk. It gives the primary contact (admin) full visibility into their agency's staff members and the ability to invite new staff and remove existing ones. Staff members with the `org:member` role do not have access to this page.

---

## Access Control

- Check Clerk session for `org:admin` role on page load
- If user is `org:member` → redirect to `/dashboard`
- If user is not authenticated → redirect to `/sign-in`

---

## Page Layout

### Header
- Page title: **"Team Management"**
- Subtitle: Agency name pulled from Clerk org
- Right side: **"Invite Staff Member"** button (teal, opens invite form)

---

## Section 1 — Staff Members List

Display a card-based or table list of all current staff members in the organization.

### Data Source
Pull from Clerk using:
```
GET /v1/organizations/{org_id}/memberships
```

### Fields to Display Per Member
| Field | Source |
|---|---|
| First Name + Last Name | Clerk user profile |
| Email Address | Clerk user profile |
| Role | Clerk membership role (`org:admin` or `org:member`) |
| Date Added | Clerk membership `created_at` |
| Status | Active / Pending (if invitation not yet accepted) |

### Actions Per Member
- **Remove** — removes from Clerk org + updates AT Agency Users record status to Inactive
- **Make Admin / Remove Admin** — toggles role between `org:admin` and `org:member` (optional phase 2)

### Display Rules
- Current logged-in user row should be marked **(You)** and cannot be removed
- Sort by Date Added, newest first
- Pending invitations (not yet accepted) shown with a "Pending" badge

---

## Section 2 — Invite Staff Member Form

Inline form that appears below the staff list or in a modal when "Invite Staff Member" is clicked.

### Form Fields
| Field | Type | Required | Notes |
|---|---|---|---|
| First Name | Text | Yes | |
| Last Name | Text | Yes | |
| Work Email | Email | Yes | Must be unique in Clerk |
| Role | Select | Yes | Options: Staff Member, Admin |

### On Submit
1. POST to `/api/admin/invite` (new API route — see below)
2. API route calls Clerk to create user + add to org
3. API route creates record in Airtable Agency Users table
4. Zapier or AT automation sends invitation email with magic link
5. Show success message: *"Invitation sent to [email]. They will receive an email with a secure link to access the portal."*
6. New member appears in staff list with "Pending" status

### Validation
- Email format validation
- Check if email already exists in org — show error if duplicate
- All fields required before submit

---

## Section 3 — Remove Staff Member

### Flow
1. Admin clicks **Remove** on a staff member row
2. Confirmation dialog: *"Are you sure you want to remove [Name] from the portal? They will lose access immediately."*
3. On confirm:
   - Remove membership from Clerk org via `DELETE /v1/organizations/{org_id}/memberships/{user_id}`
   - Update AT Agency Users record: set Status = Inactive, set Removed Date = today
4. Member disappears from the staff list

---

## API Routes Required

### `POST /api/admin/invite`
Creates a new Clerk user, adds them to the org, creates AT record.

**Request body:**
```json
{
  "first_name": "string",
  "last_name": "string",
  "email": "string",
  "role": "org:admin | org:member"
}
```

**Steps:**
1. Create Clerk user (email, first name, last name, external_id = AT record ID)
2. Add user to Clerk org as specified role
3. Generate sign_in_token → get magic link URL
4. Create record in AT Agency Users table (see fields below)
5. Send invitation email via Zapier webhook or directly (TBD)
6. Return success + new user data

### `DELETE /api/admin/remove`
Removes a staff member from the org.

**Request body:**
```json
{
  "clerk_user_id": "string",
  "at_record_id": "string"
}
```

**Steps:**
1. Delete Clerk org membership
2. Update AT Agency Users record: Status = Inactive, Removed Date = today
3. Return success

---

## Airtable — Agency Users Table

When a staff member is invited, create a record in the **Agency Users** table with these fields:

| AT Field | Value | Notes |
|---|---|---|
| First Name | From invite form | |
| Last Name | From invite form | |
| Email | From invite form | |
| Role | Admin or Staff | Maps from Clerk role |
| Agency | Link to Agencies record | Use org's AT record ID |
| Clerk User ID | From Clerk create user response | |
| Status | Pending | Changes to Active when they first sign in |
| Invited Date | Today | |
| Invited By | Current admin's name | |
| Removed Date | blank | Set when removed |

---

## UI Design Notes

- **Use the exact same card format and style as the referral dashboard** — same card dimensions, spacing, shadows, and color treatment for consistency across the portal
- **Three staff status tabs or filter** matching the referral dashboard pattern: **Active | Pending | Inactive**
- Role badge: Admin = navy pill, Staff = grey pill
- Status badge colors:
  - Active = teal (same as approved referral)
  - Pending = gold (same as pending referral — invitation sent, not yet accepted)
  - Inactive = grey (removed or deactivated)
- Remove button: red text, no background — destructive action
- Invite form: same field styling as referral form
- Empty state per tab:
  - Active: *"No active staff members yet. Invite your first team member above."*
  - Pending: *"No pending invitations."*
  - Inactive: *"No inactive staff members."*

---

## Phase 2 (Not in this build)
- Change role (promote/demote between admin and staff)
- View individual staff member's referral history from this page
- Bulk invite via CSV upload
- Staff member profile edit

---

## Dependencies
- Clerk org membership API
- Airtable Agency Users table (must exist with fields above)
- Magic link generation (same sign_in_tokens POST used in approval Zap)
- Invitation email template (TBD — Zapier or direct)
