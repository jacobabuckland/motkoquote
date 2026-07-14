import { Image, StyleSheet, Text, View } from "@react-pdf/renderer";

export const colors = {
  ink: "#111827",
  subtle: "#6b7280",
  border: "#e5e7eb",
  panel: "#f9fafb",
};

export const sharedStyles = StyleSheet.create({
  page: { padding: 40, paddingBottom: 72, fontSize: 9.5, fontFamily: "Helvetica", color: colors.ink },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  logo: { width: 36, height: 36, marginBottom: 6, objectFit: "contain" },
  companyName: { fontSize: 17, fontFamily: "Helvetica-Bold" },
  companyMeta: { fontSize: 8, color: colors.subtle, marginTop: 2 },
  docTitle: { fontSize: 19, fontFamily: "Helvetica-Bold", textAlign: "right", letterSpacing: 0.5 },
  docMeta: { fontSize: 8, color: colors.subtle, textAlign: "right", marginTop: 2 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 16 },
  // A 3pt brand-coloured rule under the header — a stronger, more
  // deliberate accent than the plain grey divider it replaces on the
  // redesigned documents (see PdfAccentBar below).
  accentBar: { height: 3, marginBottom: 18 },
  partiesRow: { flexDirection: "row", marginBottom: 16 },
  partyBlock: { flex: 1, marginRight: 16 },
  partyLabel: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: colors.subtle,
    textTransform: "uppercase",
    letterSpacing: 0.75,
    marginBottom: 3,
  },
  partyName: { fontSize: 10, fontFamily: "Helvetica-Bold", marginBottom: 1 },
  partyLine: { fontSize: 8.5, color: colors.subtle, lineHeight: 1.4 },
  metaRow: {
    flexDirection: "row",
    backgroundColor: colors.panel,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 18,
  },
  metaItem: { flex: 1 },
  metaLabel: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    color: colors.subtle,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  metaValue: { fontSize: 9 },
  sectionTitle: {
    fontSize: 9.5,
    fontFamily: "Helvetica-Bold",
    color: colors.ink,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 16,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 4,
  },
  footer: {
    position: "absolute",
    bottom: 32,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  footerText: { fontSize: 7.5, color: colors.subtle },
  pageNumber: { position: "absolute", bottom: 32, right: 40, fontSize: 7.5, color: colors.subtle },
});

type PdfHeaderProps = {
  kind: string;
  companyName: string;
  trade?: string | null;
  companyNumber?: string | null;
  vatNumber?: string | null;
  brandColor?: string;
  logoUrl?: string;
  reference: string;
  date: string;
};

export const PdfHeader = ({
  kind,
  companyName,
  trade,
  companyNumber,
  vatNumber,
  brandColor = "#111827",
  logoUrl,
  reference,
  date,
}: PdfHeaderProps) => (
  <View style={sharedStyles.headerRow}>
    <View>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer's Image, not an HTML img */}
      {logoUrl && <Image src={logoUrl} style={sharedStyles.logo} />}
      <Text style={[sharedStyles.companyName, { color: brandColor }]}>{companyName}</Text>
      {(trade || companyNumber || vatNumber) && (
        <Text style={sharedStyles.companyMeta}>
          {[trade, companyNumber ? `Co. No. ${companyNumber}` : null, vatNumber ? `VAT ${vatNumber}` : null]
            .filter(Boolean)
            .join("   ·   ")}
        </Text>
      )}
    </View>
    <View>
      <Text style={sharedStyles.docTitle}>{kind}</Text>
      <Text style={sharedStyles.docMeta}>Ref {reference}</Text>
      <Text style={sharedStyles.docMeta}>{date}</Text>
    </View>
  </View>
);

// A 3pt brand-coloured rule that sits directly under the header — the
// consistent brand accent every redesigned document (SoW, Quote) opens
// with. Kept as its own component (rather than folded into PdfHeader) so
// documents that haven't been redesigned yet (e.g. contract-pdf.tsx, which
// still renders its own plain `divider`) are unaffected.
export const PdfAccentBar = ({ brandColor = "#111827" }: { brandColor?: string }) => (
  <View style={[sharedStyles.accentBar, { backgroundColor: brandColor }]} />
);

type PartyBlockProps = {
  label: string;
  name?: string | null;
  lines?: (string | null | undefined)[];
};

// One column of a parties row — "Business", "Customer", "Site" etc. Renders
// nothing but the label if name/lines are all empty, so callers can pass a
// block through unconditionally without checking emptiness themselves.
export const PartyBlock = ({ label, name, lines = [] }: PartyBlockProps) => (
  <View style={sharedStyles.partyBlock}>
    <Text style={sharedStyles.partyLabel}>{label}</Text>
    {name && <Text style={sharedStyles.partyName}>{name}</Text>}
    {lines
      .filter((line): line is string => Boolean(line))
      .map((line, i) => (
        <Text style={sharedStyles.partyLine} key={i}>
          {line}
        </Text>
      ))}
  </View>
);

// A panel row of label/value pairs directly under the parties block — e.g.
// job type, reference, date — replacing the old two-box "info bar" pattern
// with one consistent strip used across documents.
export const MetaRow = ({ items }: { items: { label: string; value: string }[] }) => (
  <View style={sharedStyles.metaRow}>
    {items.map((item, i) => (
      <View style={sharedStyles.metaItem} key={i}>
        <Text style={sharedStyles.metaLabel}>{item.label}</Text>
        <Text style={sharedStyles.metaValue}>{item.value}</Text>
      </View>
    ))}
  </View>
);

export const PdfFooter = ({ note }: { note?: string }) => (
  <View style={sharedStyles.footer} fixed>
    {note && <Text style={sharedStyles.footerText}>{note}</Text>}
    <Text style={sharedStyles.footerText}>Generated by Motko</Text>
  </View>
);
