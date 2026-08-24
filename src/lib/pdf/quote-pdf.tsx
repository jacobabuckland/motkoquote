import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { LineItem } from "@/lib/schemas/job";
import type { QuoteScope } from "@/lib/pdf/quote-payload";
import { lineItemTotal } from "@/lib/quote-math";
import { formatGBP } from "@/lib/format";
import { PdfHeader, PdfAccentBar, PdfFooter, MadeWithMotko, PartyBlock, MetaRow, sharedStyles, colors } from "./shared";

// Exported so the flex-in-a-column guard can bind against the real style
// objects rather than matching source text. A room work-item line rendered with
// flex:1 inside the column-direction scopeRoom is what made the Scope of work
// section overlap itself; asserting on the values is the only way to stop that
// coming back that does not break on a rename.
export const styles = StyleSheet.create({
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
  scopeBlock: { marginBottom: 12 },
  scopeText: { fontSize: 9, lineHeight: 1.5, marginBottom: 4 },
  scopeRoom: { marginBottom: 6 },
  scopeRoomName: { fontSize: 9.5, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  scopeSubheading: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: colors.subtle,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 6,
    marginBottom: 3,
  },
  scopeBullet: { flexDirection: "row", marginBottom: 2 },
  scopeBulletMark: { width: 9, fontSize: 9 },
  // flex:1 belongs to the BULLET ROW below and nowhere else: scopeBullet is
  // flexDirection "row", so it means "fill the remaining width beside the
  // mark". Do not reuse this style in a column container — see scopeRoomText.
  scopeBulletText: { flex: 1, fontSize: 9, lineHeight: 1.4 },
  // The room work-item line. Same type treatment as scopeBulletText, minus the
  // flex, because its parent (scopeRoom) declares no flexDirection and so
  // defaults to COLUMN. There, flex:1 applies along the vertical main axis --
  // flex-basis:0 -- so the wrapped text's own height stops being the starting
  // measurement and the block is laid out shorter than it draws. The next
  // room's heading then lands on top of it, and the error accumulates down the
  // section. That is why the overview paragraph above rendered cleanly while
  // every room below it collided.
  scopeRoomText: { fontSize: 9, lineHeight: 1.4 },
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
});

// One bulleted sub-list. Renders nothing at all when empty, so an absent
// inclusions/exclusions list leaves no orphan heading behind.
const ScopeList = ({ title, items }: { title: string; items: string[] }) => {
  if (items.length === 0) return null;
  return (
    <View>
      <Text style={styles.scopeSubheading}>{title}</Text>
      {items.map((item, i) => (
        <View style={styles.scopeBullet} key={i}>
          <Text style={styles.scopeBulletMark}>•</Text>
          <Text style={styles.scopeBulletText}>{item}</Text>
        </View>
      ))}
    </View>
  );
};

const CATEGORY_LABELS: Record<LineItem["category"], string> = {
  labour: "Labour",
  materials: "Materials",
  travel: "Travel",
  callout: "Callout",
  other: "Other",
};

const CATEGORY_ORDER: LineItem["category"][] = ["labour", "materials", "travel", "callout", "other"];

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
  // Absent when the call was too thin to derive scope, or on a legacy quote.
  // The section is then omitted entirely rather than rendered empty.
  scope?: QuoteScope;
  subtotal: number;
  vat: number;
  total: number;
  vatRegistered: boolean;
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
  scope,
  subtotal,
  vat,
  total,
  vatRegistered,
}: Props) => {
  const sectionTitle = [sharedStyles.sectionTitle, { borderBottomColor: brandColor }];

  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    items: lineItems.filter((item) => item.category === category),
  })).filter((group) => group.items.length > 0);

  const metaItems = [
    { label: "Reference", value: reference },
    { label: "Date", value: date },
  ];
  if (jobType) metaItems.unshift({ label: "Job type", value: jobType });
  // synthesizeTimeline always resolves to something meaningful (it falls back
  // to "To be confirmed before work begins."), so this cell never renders a
  // placeholder — the same rule the statement-of-work document uses.
  if (scope) metaItems.push({ label: "Timeline", value: scope.timeline });

  // A guest quote may have captured no customer at all. PartyBlock renders its
  // label unconditionally, so passing an empty block through would print a bare
  // "CUSTOMER" heading with nothing under it — an empty label is exactly what
  // an unbranded draft must not show. Omit the block instead.
  const hasCustomer = Boolean(customerName || customerPhone || customerEmail);

  // Lines whose amount is absent rather than zero. Their presence changes what
  // the totals block is allowed to claim.
  const unpricedCount = lineItems.filter((item) => item.unpriced).length;
  const hasUnpriced = unpricedCount > 0;

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

        {/* What the work IS, before what it costs. Without this the customer
            received a priced table and nothing else — and in fixed-price mode a
            single line reading "<trade> works as described", where "described"
            pointed at a statement of work only the contractor could open. */}
        {scope && (
          <View style={styles.scopeBlock}>
            <Text style={sectionTitle}>Scope of work</Text>

            {scope.overviewNarrative && (
              <Text style={styles.scopeText}>{scope.overviewNarrative}</Text>
            )}

            {scope.rooms.map((room, i) => (
              <View style={styles.scopeRoom} key={i} wrap={false}>
                <Text style={styles.scopeRoomName}>
                  {room.name}
                  {room.dimensions ? ` (${room.dimensions})` : ""}
                </Text>
                {room.workItems.length > 0 && (
                  <Text style={styles.scopeRoomText}>
                    {room.workItems.join("; ")}
                    {room.workItems.join("; ").endsWith(".") ? "" : "."}
                  </Text>
                )}
              </View>
            ))}

            <ScopeList title="Additional work" items={scope.additionalItems} />

            {scope.existingConditions && (
              <>
                <Text style={styles.scopeSubheading}>Existing conditions</Text>
                <Text style={styles.scopeText}>{scope.existingConditions}</Text>
              </>
            )}

            {scope.accessIssues && (
              <>
                <Text style={styles.scopeSubheading}>Access &amp; working constraints</Text>
                <Text style={styles.scopeText}>{scope.accessIssues}</Text>
              </>
            )}

            <ScopeList title="Included" items={scope.inclusions} />
            <ScopeList title="Not included" items={scope.exclusions} />
            <ScopeList title="Materials" items={scope.materialsMentioned} />

            {scope.materialsSupply && (
              <>
                {scope.materialsSupply.contractorSupplied.length > 0 && (
                  <Text style={styles.scopeText}>
                    {`Supplied by us: ${scope.materialsSupply.contractorSupplied.join(", ")}.`}
                  </Text>
                )}
                {scope.materialsSupply.customerSupplied.length > 0 && (
                  <Text style={styles.scopeText}>
                    {`Supplied by you: ${scope.materialsSupply.customerSupplied.join(", ")}.`}
                  </Text>
                )}
              </>
            )}

            {/* Customer-facing by design — the statement of work already prints
                these under "Confirm the following with the customer". The
                contractor-only channels (contractor_flags, assumption_note)
                never reach this document. */}
            <ScopeList title="Assumptions" items={scope.assumptions} />
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
