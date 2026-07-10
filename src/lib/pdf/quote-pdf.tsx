import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { LineItem } from "@/lib/schemas/job";
import { PdfHeader, PdfFooter, sharedStyles, colors } from "./shared";

const styles = StyleSheet.create({
  billTo: { marginBottom: 20 },
  billToLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: colors.subtle,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 2,
  },
  billToName: { fontSize: 11, fontFamily: "Helvetica-Bold" },
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

const CATEGORY_LABELS: Record<LineItem["category"], string> = {
  labour: "Labour",
  materials: "Materials",
  travel: "Travel",
  callout: "Callout",
  other: "Other",
};

const CATEGORY_ORDER: LineItem["category"][] = ["labour", "materials", "travel", "callout", "other"];

type Props = {
  companyName: string;
  trade?: string | null;
  companyNumber?: string | null;
  vatNumber?: string | null;
  brandColor?: string;
  logoUrl?: string;
  footerTerms?: string;
  reference: string;
  date: string;
  customerName: string;
  lineItems: LineItem[];
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
  brandColor,
  logoUrl,
  footerTerms,
  reference,
  date,
  customerName,
  lineItems,
  subtotal,
  vat,
  total,
  vatRegistered,
}: Props) => {
  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    items: lineItems.filter((item) => item.category === category),
  })).filter((group) => group.items.length > 0);

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
        <View style={sharedStyles.divider} />

        <View style={styles.billTo}>
          <Text style={styles.billToLabel}>Prepared for</Text>
          <Text style={styles.billToName}>{customerName}</Text>
        </View>

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
                  {item.assumed && (
                    <Text style={styles.assumptionNote}>
                      Estimated{item.assumption_note ? ` — ${item.assumption_note}` : ""}
                    </Text>
                  )}
                </View>
                <Text style={styles.qtyCol}>
                  {item.quantity} {item.unit}
                </Text>
                <Text style={styles.priceCol}>£{item.unit_price.toFixed(2)}</Text>
                <Text style={styles.totalCol}>£{(item.quantity * item.unit_price).toFixed(2)}</Text>
              </View>
            ))}
          </View>
        ))}

        <View style={styles.totals}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text style={styles.totalsValue}>£{subtotal.toFixed(2)}</Text>
          </View>
          {vatRegistered && (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>VAT (20%)</Text>
              <Text style={styles.totalsValue}>£{vat.toFixed(2)}</Text>
            </View>
          )}
          <View style={styles.grandRow}>
            <Text style={styles.grandLabel}>Total</Text>
            <Text style={styles.grandValue}>£{total.toFixed(2)}</Text>
          </View>
        </View>

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
