import { Image, Link, StyleSheet, Text, View } from "@react-pdf/renderer";
import { extractInitials } from "@/lib/extract-initials";
import { brandColorReadableAsText, getContrastingTextColor } from "@/lib/color-contrast";

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
  // Fixed ~40pt height with auto width keeps the logo's aspect ratio for both
  // square and wide marks; objectFit "contain" guards against any overflow.
  logo: { height: 40, marginBottom: 6, objectFit: "contain" },
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
  // paddingRight, and minWidth 0 so a long value wraps inside its own column
  // instead of pushing the column wider than its share. Without the gutter,
  // wrapped text in one cell rendered flush against the next cell's text and
  // the two read as one garbled line on the statement of work.
  metaItem: { flex: 1, minWidth: 0, paddingRight: 8 },
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
  madeWith: { marginTop: 28, textAlign: "center", fontSize: 8, color: colors.subtle },
  madeWithLink: { color: colors.subtle, textDecoration: "none" },
});

// The UTM-tagged link customers follow from a document footer back to motko.
export const MADE_WITH_MOTKO_URL =
  "https://motko.app?utm_source=document&utm_medium=footer&utm_campaign=viral";

// Quiet maker's mark placed as the last flowing element on a document so it
// lands after all content on the final page. Understated, centred, muted —
// reads as a maker's mark, not an ad. The "motko" wordmark is a clickable link.
export const MadeWithMotko = () => (
  <Text style={sharedStyles.madeWith}>
    made with{" "}
    <Link src={MADE_WITH_MOTKO_URL} style={sharedStyles.madeWithLink}>
      motko
    </Link>
  </Text>
);

type PdfHeaderProps = {
  kind: string;
  // Absent on an unbranded document — a guest quote, rendered before the
  // trade has an account, has no business identity at all. The whole identity
  // column is then omitted rather than falling back to a monogram of nothing
  // or an empty company line: a quote may be unbranded, never fabricated.
  companyName?: string | null;
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
}: PdfHeaderProps) => {
  const initials = extractInitials(companyName ?? "");
  // The monogram fill can carry any colour: this picks initials that contrast
  // with whatever it is, so that role cannot fail.
  const textColor = getContrastingTextColor(brandColor);

  // The company name is the one place the brand colour PAINTS TEXT, and there
  // it can fail: #FEF7B8 on white paper is 1.1:1, so the trade's own name comes
  // out invisible on the customer's copy — worse on paper than on a backlit
  // screen, and invisible to the person who chose it, because they never see
  // the customer's copy.
  //
  // Constrain the design, not the input (decision, 2026-08-25): the colour is
  // stored exactly as the trade set it and still paints the monogram and the
  // accent bar. Only this role declines it, falling back to ink.
  const companyNameColor = brandColorReadableAsText(brandColor)
    ? brandColor
    : colors.ink;

  // headerRow is space-between over two columns; an empty left column keeps
  // the document title/reference block hard-right exactly where it sits on a
  // branded document, so omitting the identity doesn't reflow the header.
  if (!companyName) {
    return (
      <View style={sharedStyles.headerRow}>
        <View />
        <View>
          <Text style={sharedStyles.docTitle}>{kind}</Text>
          <Text style={sharedStyles.docMeta}>Ref {reference}</Text>
          <Text style={sharedStyles.docMeta}>{date}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={sharedStyles.headerRow}>
      <View>
        {logoUrl ? (
          // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf/renderer's Image, not an HTML img
          <Image src={logoUrl} style={sharedStyles.logo} />
        ) : (
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: brandColor,
              justifyContent: "center",
              alignItems: "center",
              marginBottom: 6,
            }}
          >
            <Text
              style={{
                fontSize: 16,
                fontFamily: "Helvetica-Bold",
                color: textColor,
              }}
            >
              {initials || "◆"}
            </Text>
          </View>
        )}
        <Text style={[sharedStyles.companyName, { color: companyNameColor }]}>
          {companyName}
        </Text>
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
};

// A 3pt brand-coloured rule that sits directly under the header. Takes the raw
// brand colour with no contrast floor, deliberately: it carries no text, so a
// pale one reads as an unbranded document rather than a broken one. That is a
// degradation, not a failure, and forcing a trade's livery darker to make a
// decorative bar louder would overrule their brand for no legibility gain.
//
// The consistent brand accent every redesigned document (SoW, Quote) opens
// with. Kept as its own component (rather than folded into PdfHeader) so
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
