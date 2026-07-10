import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { PdfHeader, PdfFooter, sharedStyles, colors } from "@/lib/pdf/shared";

const styles = StyleSheet.create({
  body: { fontSize: 10, lineHeight: 1.5, color: colors.ink },
  panel: {
    backgroundColor: colors.panel,
    borderRadius: 4,
    padding: 12,
    marginBottom: 4,
  },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  label: { color: colors.subtle },
  signatureBlock: { marginTop: 24, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
  signatureLine: { marginTop: 24, borderBottomWidth: 1, borderBottomColor: colors.border, width: 220 },
});

type ContractPdfProps = {
  companyName: string;
  trade?: string | null;
  companyNumber?: string | null;
  vatNumber?: string | null;
  brandColor?: string;
  logoUrl?: string;
  reference: string;
  date: string;
  customerName: string;
  quoteTotal: number;
  depositPct: number | null;
  termsText: string;
  status: string;
  signerName?: string | null;
  signedAt?: string | null;
};

export const ContractPdf = ({
  companyName,
  trade,
  companyNumber,
  vatNumber,
  brandColor,
  logoUrl,
  reference,
  date,
  customerName,
  quoteTotal,
  depositPct,
  termsText,
  status,
  signerName,
  signedAt,
}: ContractPdfProps) => {
  const depositAmount = depositPct ? Math.round(quoteTotal * (depositPct / 100) * 100) / 100 : null;

  return (
    <Document>
      <Page size="A4" style={sharedStyles.page}>
        <PdfHeader
          kind="Contract"
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

        <Text style={sharedStyles.sectionTitle}>Parties</Text>
        <View style={styles.panel}>
          <View style={styles.row}>
            <Text style={styles.label}>Contractor</Text>
            <Text>{companyName}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Customer</Text>
            <Text>{customerName}</Text>
          </View>
        </View>

        <Text style={sharedStyles.sectionTitle}>Payment terms</Text>
        <View style={styles.panel}>
          <View style={styles.row}>
            <Text style={styles.label}>Total quote value</Text>
            <Text>£{quoteTotal.toFixed(2)}</Text>
          </View>
          {depositAmount !== null && (
            <View style={styles.row}>
              <Text style={styles.label}>Deposit ({depositPct}%)</Text>
              <Text>£{depositAmount.toFixed(2)}</Text>
            </View>
          )}
          <View style={styles.row}>
            <Text style={styles.label}>Balance on completion</Text>
            <Text>£{(quoteTotal - (depositAmount ?? 0)).toFixed(2)}</Text>
          </View>
        </View>

        <Text style={sharedStyles.sectionTitle}>Terms</Text>
        <Text style={styles.body}>{termsText}</Text>

        <View style={styles.signatureBlock}>
          {status === "signed" && signerName ? (
            <>
              <Text style={styles.body}>
                Signed by {signerName}
                {signedAt ? ` on ${signedAt}` : ""}.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.body}>Customer signature</Text>
              <View style={styles.signatureLine} />
            </>
          )}
        </View>

        <PdfFooter />
      </Page>
    </Document>
  );
};
