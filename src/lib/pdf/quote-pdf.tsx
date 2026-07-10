import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { LineItem } from "@/lib/schemas/job";

type Props = {
  companyName: string;
  brandColor?: string;
  footerTerms?: string;
  customerName: string;
  lineItems: LineItem[];
  subtotal: number;
  vat: number;
  total: number;
  vatRegistered: boolean;
};

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 11, fontFamily: "Helvetica" },
  header: { marginBottom: 24 },
  title: { fontSize: 20, marginBottom: 4 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#eeeeee",
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  totalLabel: { fontWeight: 700 },
  footer: { marginTop: 32, fontSize: 9, color: "#666666" },
});

export const QuotePdf = ({
  companyName,
  brandColor = "#111111",
  footerTerms,
  customerName,
  lineItems,
  subtotal,
  vat,
  total,
  vatRegistered,
}: Props) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: brandColor }]}>{companyName}</Text>
        <Text>Quote for {customerName}</Text>
      </View>

      {lineItems.map((item, index) => (
        <View style={styles.row} key={index}>
          <Text>{item.description}</Text>
          <Text>£{(item.quantity * item.unit_price).toFixed(2)}</Text>
        </View>
      ))}

      <View style={{ marginTop: 12 }}>
        <View style={styles.totalsRow}>
          <Text>Subtotal</Text>
          <Text>£{subtotal.toFixed(2)}</Text>
        </View>
        {vatRegistered && (
          <View style={styles.totalsRow}>
            <Text>VAT (20%)</Text>
            <Text>£{vat.toFixed(2)}</Text>
          </View>
        )}
        <View style={styles.totalsRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalLabel}>£{total.toFixed(2)}</Text>
        </View>
      </View>

      {footerTerms && <Text style={styles.footer}>{footerTerms}</Text>}
    </Page>
  </Document>
);
