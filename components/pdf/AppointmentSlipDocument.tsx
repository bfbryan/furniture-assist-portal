// components/pdf/AppointmentSlipDocument.tsx
//
// @react-pdf/renderer template for the client appointment slip, replicating
// the layout of "Copy of appointment_slip.docx" with the header treatment
// updated to match the two-tone branded style used in the reminder/
// confirmation emails. Renders server-side (in the Wednesday cron route, and
// again for reschedules) via renderToBuffer().
//
// Usage:
//   import { renderToBuffer } from '@react-pdf/renderer';
//   import { AppointmentSlipDocument } from '@/components/pdf/AppointmentSlipDocument';
//   const buffer = await renderToBuffer(<AppointmentSlipDocument data={data} />);

import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

// Intentionally using react-pdf's built-in Helvetica rather than a custom
// registered font (we tried Lato/Montserrat and reverted for full visual
// consistency with the emails, which stay on Arial/Helvetica for
// email-client compatibility). Bonus: built-in fonts don't go through
// react-pdf's ligature-substitution path, so this also sidesteps a known
// text-extraction bug with custom TTF fonts
// (https://github.com/diegomura/react-pdf/issues/1950) where visually
// correct text like "Springfield" would copy-paste as "Springfeld".

export type AppointmentSlipData = {
  appointmentDate: string; // pre-formatted, e.g. "Saturday, September 12, 2026"
  appointmentTime: string;
  clientFirstName: string;
  clientLastName: string;
  clientDOB: string;
  clientAddress: string;
  clientPhone: string;
  language: string; // not currently rendered — portal doesn't collect this yet
  householdMembers: string;
  numChildren: string;
  itemsRequested: string;
  notes: string;
  referringAgency: string;
  referringStaff: string;
};

const NAVY = '#1B2B4B';
const TEAL = '#2A7F6F';
const MUTED = '#7A8899';
const TEXT = '#2C3A4A';
const BORDER = '#EDE9E1';

// Same logo asset used in the reminder/confirmation emails.
const LOGO_URL =
  'https://furnitureassist.com/wp-content/uploads/2026/04/logo_header_optimized.png';

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    fontFamily: 'Helvetica',
    color: TEXT,
  },
  headerRow: {
    flexDirection: 'row',
    marginBottom: 14,
    borderBottomWidth: 2,
    borderBottomColor: TEAL,
  },
  headerLogo: {
    width: 90,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
  },
  headerLogoImage: {
    width: 64,
    height: 64,
    objectFit: 'contain',
  },
  headerBrandBox: {
    flex: 1,
    backgroundColor: NAVY,
    paddingVertical: 8,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBrandLine: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  headerBrandWhite: {
    fontSize: 20,
    fontWeight: 700,
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  headerBrandTeal: {
    fontSize: 20,
    fontWeight: 700,
    color: TEAL,
    letterSpacing: 1,
  },
  headerSubtitle: {
    fontSize: 10,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  section: {
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 700,
    color: TEAL,
    letterSpacing: 1.2,
    marginBottom: 6,
    paddingBottom: 4,
    textTransform: 'uppercase',
    borderBottomWidth: 2,
    borderBottomColor: TEAL,
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingVertical: 5,
  },
  label: {
    width: 140,
    fontSize: 9,
    fontWeight: 700,
    color: MUTED,
  },
  value: {
    flex: 1,
    fontSize: 10,
    color: TEXT,
  },
  reminderBox: {
    backgroundColor: '#FEF9EC',
    borderLeftWidth: 3,
    borderLeftColor: '#C9A84C',
    borderRadius: 4,
    padding: 10,
    marginBottom: 14,
  },
  reminderTitle: {
    fontSize: 10,
    fontWeight: 700,
    color: NAVY,
    marginBottom: 6,
    paddingBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
    borderBottomWidth: 2,
    borderBottomColor: TEAL,
  },
  reminderLine: {
    fontSize: 9,
    color: TEXT,
    marginBottom: 3,
    lineHeight: 1.4,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 8,
    textAlign: 'center',
    fontSize: 8,
    color: MUTED,
  },
});

// @react-pdf/renderer + custom TTF fonts (like the Lato/Montserrat we
// register above) have a documented bug: when the font's shaper forms a
// ligature glyph — "fi", "ff", "fl", "ffi", "ffl" — it renders correctly on
// screen, but the underlying PDF text layer maps that single ligature glyph
// back to the wrong character(s), silently dropping letters (e.g.
// "Springfield" -> "Springfeld" in the underlying text layer, though not
// visually). This ONLY happens with custom registered fonts — now that
// we're back on the built-in Helvetica, react-pdf doesn't run text through
// that ligature-substitution path at all, so the bug doesn't apply and the
// zero-width-non-joiner workaround isn't needed anymore. (Worth noting:
// that workaround also wouldn't have been safe to keep here regardless —
// Helvetica uses a standard WinAnsi-style encoding that doesn't include a
// zero-width non-joiner glyph, so it risked the same kind of
// missing-glyph problem we hit earlier with the "→" arrow character.)
// (https://github.com/diegomura/react-pdf/issues/1950)

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value || '—'}</Text>
    </View>
  );
}

export function AppointmentSlipDocument({ data }: { data: AppointmentSlipData }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <View style={styles.headerLogo}>
            <Image style={styles.headerLogoImage} src={LOGO_URL} />
          </View>
          <View style={styles.headerBrandBox}>
            <View style={styles.headerBrandLine}>
              <Text style={styles.headerBrandWhite}>Furniture </Text>
              <Text style={styles.headerBrandTeal}>Assist</Text>
            </View>
            <Text style={styles.headerSubtitle}>Client Appointment Slip</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Appointment Details</Text>
          <Row label="Date" value={data.appointmentDate} />
          <Row label="Time" value={data.appointmentTime} />
          <Row
            label="Location"
            value="Furniture Assist, 24 Commerce Street, Springfield, NJ 07081"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Client Information</Text>
          <Row
            label="Name"
            value={`${data.clientFirstName} ${data.clientLastName}`.trim()}
          />
          <Row label="Date of Birth" value={data.clientDOB} />
          <Row label="Address" value={data.clientAddress} />
          <Row label="Phone" value={data.clientPhone} />
          {/* Language intentionally hidden — not collected via the portal yet */}
          <Row
            label="Household"
            value={
              data.householdMembers || data.numChildren
                ? `${data.householdMembers} members, ${data.numChildren} children`
                : ''
            }
          />
          <Row label="Items Requested" value={data.itemsRequested} />
          {data.notes ? <Row label="Notes" value={data.notes} /> : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Referring Agency</Text>
          <Row label="Agency" value={data.referringAgency} />
          <Row label="Staff" value={data.referringStaff} />
        </View>

        <View style={styles.reminderBox}>
          <Text style={styles.reminderTitle}>Important Reminders</Text>
          <Text style={styles.reminderLine}>
            • Bring this appointment slip to your pickup appointment.
          </Text>
          <Text style={styles.reminderLine}>
            • You are responsible for arranging your own transportation to the
            warehouse.
          </Text>
          <Text style={styles.reminderLine}>
            • Review the Client Procedures at furnitureassist.com/client-procedures
            before your visit.
          </Text>
          <Text style={styles.reminderLine}>
            • If you cannot keep this appointment, notify your referring agency
            immediately.
          </Text>
          <Text style={styles.reminderLine}>
            • Questions? Contact us at agencies@furnitureassist.com or
            973-868-6007.
          </Text>
        </View>

        <Text style={styles.footer}>
          Furniture Assist, Inc.  |  furnitureassist.com  |
          agencies@furnitureassist.com  |  973-868-6007
        </Text>
      </Page>
    </Document>
  );
}
