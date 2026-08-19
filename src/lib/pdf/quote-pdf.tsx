import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { LineItem } from "@/lib/schemas/job";
import { lineItemTotal } from "@/lib/quote-math";
import { formatGBP, formatMaterialsSentence } from "@/lib/format";
import { PdfHeader, PdfAccentBar, PdfFooter, MadeWithMotko, PartyBlock, MetaRow, sharedStyles, colors } from "./shared";
import type { QuoteScope } from "@/lib/pdf/quote-payload";

const styles = StyleSheet.create({
  tableHeader: {
    flexDirection: "row",
    backgroundColor: colors.panel,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableHeaderText: { fontSize: 8, fontFamily: "Helvetica-Bold", color: colors.subtle, textTransform: "uppercase" },
  categoryLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: colors.subtle,
    textTransform: "uppercase",
    marginTop: 10,
    marginBottom: 2,
    paddingHorizontal: 8,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  descCol: { flex: 4 },
  qtyCol: { flex: 1.4, textAlign: "right" },
  priceCol: { flex: 1.4, textAlign: "right" },
  totalCol: { flex: 1.4, textAlign: "right" },
  assumptionNote: { fontSize: 8, color: colors.subtle, fontStyle: "italic", marginTop: 2 },
  // An unpriced line's amount cells. Deliberately not styled like a figure:
  // a customer skimming the money column must not read it as one.
  unpricedCell: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: colors.ink },
  unpricedNote: { fontSize: 8, fontFamily: "Helvetica-Bold", color: colors.ink, marginTop: 2 },
  incompleteNote: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: colors.ink,
    marginTop: 6,
    textAlign: "right",
  },
  subBullet: { fontSize: 8, color: colors.subtle, marginTop: 2 },
  totals: { marginTop: 16, alignSelf: "flex-end", width: 200 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totalsLabel: { fontSize: 9, color: colors.subtle },
  totalsValue: { fontSize: 9 },
  grandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 8,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: colors.ink,
  },
  grandLabel: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  grandValue: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  overviewText: { fontSize: 9.5, lineHeight: 1.5, marginBottom: 4 },
  room: { marginBottom: 8 },
  roomName: { fontSize: 10, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  roomSentence: { fontSize: 9.5, lineHeight: 1.5 },
  columns: { flexDirection: "row" },
  column: { flex: 1, marginRight: 20 },
  columnLast: { marginRight: 0 },
  columnHeading: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: colors.subtle,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  bulletRow: { flexDirection: "row", marginBottom: 3 },
  bullet: { width: 10, fontSize: 9.5 },
  bulletText: { flex: 1, fontSize: 9.5, lineHeight: 1.4 },
  materialsPanel: { backgroundColor: colors.panel, padding: 10 },
  materialsText: { fontSize: 9.5, lineHeight: 1.5 },
  assumptionsPanel: { backgroundColor: colors.panel, padding: 12 },
  assumptionsIntro: { fontSize: 8, color: colors.subtle, marginBottom: 6 },
  assumptionRow: { flexDirection: "row", marginBottom: 4 },
  assumptionText: { flex: 1, fontSize: 9.5, lineHeight: 1.4 },
  treatmentTag: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: colors.subtle,
    textTransform: "uppercase",
    marginLeft: 6,
  },
});

const CATEGORY_LABELS: Record<LineItem["category"], string> = {
  labour: "Labour",
  materials: "Materials",
  travel: "Travel",
  callout: "Callout",
  other: "Other",
};

const CATEGORY_ORDER: LineItem["category"][] = ["labour", "materials", "travel", "callout", "other"];

const TREATMENT_LABEL: Record<QuoteScope["assumptions"][number]["treatment"], string> = {
  excluded: "Excluded",
  provisional_sum: "Provisional sum",
  assumed_ok: "Assumed OK",
};

// A room's work items rendered as one flowing sentence
const roomSentence = (room: QuoteScope["rooms"][number]): string => {
  const items = room.work_items.join("; ");
  return items.endsWith(".") ? items : `${items}.`;
};

// A plain-language sentence for who's supplying what
const materialsSupplySentence = (supply: QuoteScope["materialsSupply"]): string | null => {
  if (!supply) return null;
  const parts: string[] = [];
  if (supply.contractor_supplied.length > 0) {
    parts.push(`Supplied by contractor: ${supply.contractor_supplied.join(", ")}`);
  }
  if (supply.customer_supplied.length > 0) {
    parts.push(`Supplied by customer: ${supply.customer_supplied.join(", ")}`);
  }
  return parts.length > 0 ? parts.join(". ") + "." : null;
};

type Props = {
  // Absent on a guest quote — see PdfHeader. The identity block is omitted
  // wholesale rather than rendered with placeholders.
  companyName?: string | null;
  trade?: string | null;
  companyNumber?: string | null;
  vatNumber?: string | null;
  brandColor?: string;
  logoUrl?: string;
  footerTerms?: string;
  reference: string;
  date: string;
  jobType?: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  siteAddress?: string;
  lineItems: LineItem[];
  subtotal: number;
  vat: number;
  total: number;
  vatRegistered: boolean;
  scope?: QuoteScope | null;
};

export const QuotePdf = ({
  companyName,
  trade,
  companyNumber,
  vatNumber,
  brandColor = "#111827",
  logoUrl,
  footerTerms,
  reference,
  date,
  jobType,
  customerName,
  customerEmail,
  customerPhone,
  siteAddress,
  lineItems,
  subtotal,
  vat,
  total,
  vatRegistered,
  scope,
}: Props) => {
  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    items: lineItems.filter((item) => item.category === category),
  })).filter((group) => group.items.length > 0);

  const metaItems = [
    { label: "Reference", value: reference },
    { label: "Date", value: date },
  ];
  if (jobType) metaItems.unshift({ label: "Job type", value: jobType });
  if (scope?.timeline) metaItems.push({ label: "Timeline", value: scope.timeline });

  // A guest quote may have captured no customer at all. PartyBlock renders its
  // label unconditionally, so passing an empty block through would print a bare
  // "CUSTOMER" heading with nothing under it — an empty label is exactly what
  // an unbranded draft must not show. Omit the block instead.
  const hasCustomer = Boolean(customerName || customerPhone || customerEmail);

  // Lines whose amount is absent rather than zero. Their presence changes what
  // the totals block is allowed to claim.
  const unpricedCount = lineItems.filter((item) => item.unpriced).length;
  const hasUnpriced = unpricedCount > 0;

  const sectionTitleAccent = [sharedStyles.sectionTitle, { borderBottomColor: brandColor }];

  return (
    <Document>
      <Page size="A4" style={sharedStyles.page}>
        <PdfHeader
          kind="QUOTE"
          companyName={companyName}
          trade={trade}
          companyNumber={companyNumber}
          vatNumber={vatNumber}
          brandColor={brandColor}
          logoUrl={logoUrl}
          reference={reference}
          date={date}
        />
        <PdfAccentBar brandColor={brandColor} />

        {(hasCustomer || siteAddress) && (
          <View style={sharedStyles.partiesRow}>
            {hasCustomer && (
              <PartyBlock label="Customer" name={customerName} lines={[customerPhone, customerEmail]} />
            )}
            {siteAddress && <PartyBlock label="Site address" lines={[siteAddress]} />}
          </View>
        )}

        <MetaRow items={metaItems} />

        {scope !== null && scope !== undefined && (
          <View>
            <Text style={sectionTitleAccent}>Scope of work</Text>

            {scope.overviewNarrative && (
              <Text style={styles.overviewText}>{scope.overviewNarrative}</Text>
            )}

            {scope.rooms.length > 0 && (
              <View>
                {scope.rooms.map((room, i) => (
                  <View style={styles.room} key={i} wrap={false}>
                    <Text style={styles.roomName}>
                      {room.name}
                      {room.dimensions ? ` (${room.dimensions})` : ""}
                    </Text>
                    <Text style={styles.roomSentence}>{roomSentence(room)}</Text>
                  </View>
                ))}
              </View>
            )}

            {scope.additionalItems.length > 0 && (
              <View>
                <Text style={styles.columnHeading}>Additional work</Text>
                {scope.additionalItems.map((item, i) => (
                  <View style={styles.bulletRow} key={i}>
                    <Text style={styles.bullet}>•</Text>
                    <Text style={styles.bulletText}>{item}</Text>
                  </View>
                ))}
              </View>
            )}

            {scope.existingConditions && (
              <View>
                <Text style={styles.columnHeading}>Existing conditions</Text>
                <Text style={styles.overviewText}>{scope.existingConditions}</Text>
              </View>
            )}

            {scope.accessIssues && (
              <View>
                <Text style={styles.columnHeading}>Access &amp; working constraints</Text>
                <Text style={styles.overviewText}>{scope.accessIssues}</Text>
              </View>
            )}

            {(scope.inclusions.length > 0 || scope.exclusions.length > 0) && (
              <View>
                <Text style={styles.columnHeading}>Included &amp; not included</Text>
                <View style={styles.columns}>
                  <View style={styles.column}>
                    <Text style={[styles.columnHeading, { marginBottom: 2 }]}>Included</Text>
                    {scope.inclusions.map((item, i) => (
                      <View style={styles.bulletRow} key={i}>
                        <Text style={styles.bullet}>•</Text>
                        <Text style={styles.bulletText}>{item}</Text>
                      </View>
                    ))}
                  </View>
                  <View style={[styles.column, styles.columnLast]}>
                    <Text style={[styles.columnHeading, { marginBottom: 2 }]}>Not included</Text>
                    {scope.exclusions.map((item, i) => (
                      <View style={styles.bulletRow} key={i}>
                        <Text style={styles.bullet}>•</Text>
                        <Text style={styles.bulletText}>{item}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            )}

            {scope.materialsMentioned.length > 0 && (
              <View>
                <Text style={styles.columnHeading}>Materials</Text>
                <View style={styles.materialsPanel}>
                  <Text style={styles.materialsText}>{formatMaterialsSentence(scope.materialsMentioned)}</Text>
                  {materialsSupplySentence(scope.materialsSupply) && (
                    <Text style={[styles.materialsText, { marginTop: 4 }]}>
                      {materialsSupplySentence(scope.materialsSupply)}
                    </Text>
                  )}
                </View>
              </View>
            )}

            {scope.assumptions.length > 0 && (
              <View wrap={false}>
                <Text style={styles.columnHeading}>Assumptions</Text>
                <View style={styles.assumptionsPanel}>
                  <Text style={styles.assumptionsIntro}>
                    The following assumptions apply to this quote:
                  </Text>
                  {scope.assumptions.map((assumption, i) => (
                    <View style={styles.assumptionRow} key={i}>
                      <Text style={styles.bullet}>•</Text>
                      <Text style={styles.assumptionText}>{assumption.description}</Text>
                      <Text style={styles.treatmentTag}>{TREATMENT_LABEL[assumption.treatment]}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>
        )}

        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderText, styles.descCol]}>Description</Text>
          <Text style={[styles.tableHeaderText, styles.qtyCol]}>Qty</Text>
          <Text style={[styles.tableHeaderText, styles.priceCol]}>Unit price</Text>
          <Text style={[styles.tableHeaderText, styles.totalCol]}>Total</Text>
        </View>

        {grouped.map((group) => (
          <View key={group.category}>
            <Text style={styles.categoryLabel}>{CATEGORY_LABELS[group.category]}</Text>
            {group.items.map((item, i) => (
              <View style={styles.row} key={i} wrap={false}>
                <View style={styles.descCol}>
                  <Text>{item.description}</Text>
                  {item.people && item.people.length > 1 && (
                    item.people.map((person, pi) => (
                      <Text style={styles.subBullet} key={pi}>
                        {`• ${person.label} — ${person.days} ${person.days === 1 ? "day" : "days"}`}
                      </Text>
                    ))
                  )}
                  {item.includes_tasks?.map((task, ti) => (
                    <Text style={styles.subBullet} key={ti}>
                      {`• ${task}`}
                    </Text>
                  ))}
                  {item.unpriced ? (
                    // No rate was available, so there is no figure at all. Say
                    // that outright: a £0.00 here reads as "included at no
                    // charge", which is a fabricated commitment. "Estimated" is
                    // deliberately suppressed for this case — it is the marker
                    // for a real number that may move, and attaching it to an
                    // absent one only lends the absence credibility.
                    <Text style={styles.unpricedNote}>
                      {/* No em dash: the PDF's Helvetica has no glyph for one,
                          so it drops out and leaves a gap mid-sentence. */}
                      Not priced: a rate for this work is still to be confirmed.
                    </Text>
                  ) : (
                    item.assumed && (
                      // Customer document shows only that a line is estimated.
                      // assumption_note is contractor-facing guidance (e.g.
                      // "confirm against supplier price") and must never reach the
                      // customer — it stays in the quote editor, not here.
                      <Text style={styles.assumptionNote}>Estimated</Text>
                    )
                  )}
                  {item.customer_note && (
                    <Text style={styles.assumptionNote}>{item.customer_note}</Text>
                  )}
                </View>
                <Text style={styles.qtyCol}>
                  {item.quantity} {item.unit}
                </Text>
                <Text style={[styles.priceCol, item.unpriced ? styles.unpricedCell : {}]}>
                  {item.unpriced ? "To be confirmed" : formatGBP(item.unit_price)}
                </Text>
                <Text style={[styles.totalCol, item.unpriced ? styles.unpricedCell : {}]}>
                  {item.unpriced ? "To be confirmed" : formatGBP(lineItemTotal(item))}
                </Text>
              </View>
            ))}
          </View>
        ))}

        <View style={styles.totals}>
          {subtotal !== total && (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Subtotal</Text>
              <Text style={styles.totalsValue}>{formatGBP(subtotal)}</Text>
            </View>
          )}
          {vatRegistered && (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>VAT (20%)</Text>
              <Text style={styles.totalsValue}>{formatGBP(vat)}</Text>
            </View>
          )}
          <View style={styles.grandRow}>
            {/* A total computed over a quote with an unpriced line covers only
                the lines that HAVE a price. Labelling that "Total" claims a
                completeness the document doesn't have, so the label says what
                the figure actually is and the note below says what it omits. */}
            <Text style={styles.grandLabel}>{hasUnpriced ? "Priced so far" : "Total"}</Text>
            <Text style={styles.grandValue}>{formatGBP(total)}</Text>
          </View>
          {hasUnpriced && (
            <Text style={styles.incompleteNote}>
              {`This quote is not complete: ${unpricedCount} ${
                unpricedCount === 1 ? "item is" : "items are"
              } still to be priced and ${
                unpricedCount === 1 ? "is" : "are"
              } not included in the figure above.`}
            </Text>
          )}
        </View>

        <MadeWithMotko />

        <PdfFooter note={footerTerms} />
        <Text
          style={sharedStyles.pageNumber}
          fixed
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
        />
      </Page>
    </Document>
  );
};
