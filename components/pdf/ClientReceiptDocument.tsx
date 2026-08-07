// components/pdf/ClientReceiptDocument.tsx
//
// @react-pdf/renderer template for the post-appointment client receipt,
// replacing the "Client_Receipt_Updated.docx" DocsAutomator template. Same
// branded header/footer treatment as AppointmentSlipDocument, built on
// Helvetica (see that file for why — consistency with emails, and it
// sidesteps a react-pdf ligature bug with custom fonts).
//
// The old docx used per-category Airtable formula fields (e.g. "BR Help")
// as a workaround so DocsAutomator could hide a category when it was
// empty. We don't need that indirection here — CategoryBox below checks
// the actual item values directly and renders nothing if none are set.
//
// Usage:
//   import { renderToBuffer } from '@react-pdf/renderer';
//   import { ClientReceiptDocument } from '@/components/pdf/ClientReceiptDocument';
//   const buffer = await renderToBuffer(<ClientReceiptDocument data={data} />);

import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';

export type ReceiptItem = {
  label: string;
  value: number | null | undefined;
};

export type ReceiptCategory = {
  title: string;
  items: ReceiptItem[];
};

export type ClientReceiptData = {
  appointmentDate: string; // pre-formatted, e.g. "Saturday, September 12, 2026"
  appointmentTime: string;
  referringAgency: string;
  referringStaff: string;
  clientFirstName: string;
  clientLastName: string;
  clientAddress: string;
  clientPhone: string;
  leftCategories: ReceiptCategory[]; // Bedroom, Living Room, Dining Room
  rightCategories: ReceiptCategory[]; // Kitchen/Household, Baby/Kids, Clothes
  otherItems: string; // free text, separate from the itemized categories
};

const NAVY = '#1B2B4B';
const TEAL = '#2A7F6F';
const MUTED = '#7A8899';
const TEXT = '#2C3A4A';
const BORDER = '#EDE9E1';

// Same logo asset used across the emails and the appointment slip.
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
  // ---- Items Received: two-column grid of category boxes ----
  itemsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  itemsColumn: {
    flex: 1,
  },
  categoryBox: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 4,
    marginBottom: 12,
  },
  categoryHeaderRow: {
    flexDirection: 'row',
    backgroundColor: NAVY,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  categoryHeaderLabel: {
    flex: 1,
    fontSize: 9,
    fontWeight: 700,
    color: '#FFFFFF',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  categoryHeaderQty: {
    width: 32,
    fontSize: 9,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.6)',
    textTransform: 'uppercase',
    textAlign: 'right',
  },
  itemRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  itemRowLast: {
    borderBottomWidth: 0,
  },
  itemLabel: {
    flex: 1,
    fontSize: 9,
    color: TEXT,
  },
  itemQty: {
    width: 32,
    fontSize: 9,
    fontWeight: 700,
    color: TEXT,
    textAlign: 'right',
  },
  otherItemsBox: {
    backgroundColor: '#F7F5F1',
    borderLeftWidth: 3,
    borderLeftColor: TEAL,
    borderRadius: 4,
    padding: 12,
    marginTop: 2,
  },
  otherItemsTitle: {
    fontSize: 9,
    fontWeight: 700,
    color: TEAL,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  otherItemsText: {
    fontSize: 9,
    color: TEXT,
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

function hasValue(value: number | null | undefined): value is number {
  return typeof value === 'number' && value > 0;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value || '—'}</Text>
    </View>
  );
}

// Renders nothing at all if none of the category's items have a value —
// this is the direct replacement for the old "{{XX Help}}" formula-field
// workaround. Also drops individual zero/blank line items within a
// category that IS shown, since a receipt listing "Dishes: 0" doesn't
// read as useful information.
function CategoryBox({ category }: { category: ReceiptCategory }) {
  const items = category.items.filter((item) => hasValue(item.value));
  if (items.length === 0) return null;

  return (
    <View style={styles.categoryBox} wrap={false}>
      <View style={styles.categoryHeaderRow}>
        <Text style={styles.categoryHeaderLabel}>{category.title}</Text>
        <Text style={styles.categoryHeaderQty}>QTY</Text>
      </View>
      {items.map((item, i) => (
        <View
          key={item.label}
          style={[
            styles.itemRow,
            ...(i === items.length - 1 ? [styles.itemRowLast] : []),
          ]}
        >
          <Text style={styles.itemLabel}>{item.label}</Text>
          <Text style={styles.itemQty}>{item.value}</Text>
        </View>
      ))}
    </View>
  );
}

export function ClientReceiptDocument({ data }: { data: ClientReceiptData }) {
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
            <Text style={styles.headerSubtitle}>Client Receipt</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Appointment Details</Text>
          <Row label="Date" value={data.appointmentDate} />
          <Row label="Time" value={data.appointmentTime} />
          <Row label="Agency" value={data.referringAgency} />
          <Row label="Staff" value={data.referringStaff} />
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
          <Row label="Address" value={data.clientAddress} />
          <Row label="Phone" value={data.clientPhone} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Items Received</Text>
          <View style={styles.itemsGrid}>
            <View style={styles.itemsColumn}>
              {data.leftCategories.map((cat) => (
                <CategoryBox key={cat.title} category={cat} />
              ))}
            </View>
            <View style={styles.itemsColumn}>
              {data.rightCategories.map((cat) => (
                <CategoryBox key={cat.title} category={cat} />
              ))}
            </View>
          </View>

          {data.otherItems ? (
            <View style={styles.otherItemsBox}>
              <Text style={styles.otherItemsTitle}>Other Items</Text>
              <Text style={styles.otherItemsText}>{data.otherItems}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.footer}>
          Furniture Assist, Inc.  |  furnitureassist.com  |
          agencies@furnitureassist.com  |  973-868-6007
        </Text>
      </Page>
    </Document>
  );
}
