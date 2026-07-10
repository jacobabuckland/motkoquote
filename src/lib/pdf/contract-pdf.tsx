import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { PdfHeader, PdfFooter, sharedStyles, colors } from "@/lib/pdf/shared";
import { parseContractMarkdown, type ContractBlock, type ContractInline } from "@/lib/contracts/markdown";

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

  heading1: { fontSize: 14, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 8 },
  heading2: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 14, marginBottom: 6 },
  heading3: { fontSize: 10.5, fontFamily: "Helvetica-Bold", marginTop: 10, marginBottom: 4 },
  paragraph: { fontSize: 9.5, lineHeight: 1.5, color: colors.ink, marginBottom: 8 },
  blockquote: {
    fontSize: 9.5,
    lineHeight: 1.5,
    color: colors.subtle,
    fontStyle: "italic",
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    paddingLeft: 8,
    marginBottom: 8,
  },
  list: { marginBottom: 8 },
  listItem: { flexDirection: "row", marginBottom: 2 },
  bullet: { width: 12, fontSize: 9.5, color: colors.ink },
  listItemText: { flex: 1, fontSize: 9.5, lineHeight: 1.5, color: colors.ink },
  hr: { borderBottomWidth: 1, borderBottomColor: colors.border, marginVertical: 12 },
  table: { marginBottom: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 2 },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border },
  tableRowLast: { flexDirection: "row" },
  tableCell: { flex: 1, fontSize: 9, padding: 4, color: colors.ink },
  tableHeaderCell: { flex: 1, fontSize: 9, padding: 4, fontFamily: "Helvetica-Bold", backgroundColor: colors.panel },
  bold: { fontFamily: "Helvetica-Bold" },
  italic: { fontStyle: "italic" },
});

const Inlines = ({ inlines }: { inlines: ContractInline[] }) => (
  <Text>
    {inlines.map((inline, i) => (
      <Text
        key={i}
        style={inline.bold ? styles.bold : inline.italic ? styles.italic : undefined}
      >
        {inline.text}
      </Text>
    ))}
  </Text>
);

const ContractBlocks = ({ blocks }: { blocks: ContractBlock[] }) => (
  <>
    {blocks.map((block, i) => {
      if (block.type === "heading") {
        const style =
          block.level === 1 ? styles.heading1 : block.level === 2 ? styles.heading2 : styles.heading3;
        return (
          <Text key={i} style={style}>
            <Inlines inlines={block.inlines} />
          </Text>
        );
      }
      if (block.type === "paragraph") {
        return (
          <Text key={i} style={styles.paragraph}>
            <Inlines inlines={block.inlines} />
          </Text>
        );
      }
      if (block.type === "blockquote") {
        return (
          <Text key={i} style={styles.blockquote}>
            <Inlines inlines={block.inlines} />
          </Text>
        );
      }
      if (block.type === "list") {
        return (
          <View key={i} style={styles.list}>
            {block.items.map((item, j) => (
              <View key={j} style={styles.listItem}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.listItemText}>
                  <Inlines inlines={item} />
                </Text>
              </View>
            ))}
          </View>
        );
      }
      if (block.type === "table") {
        return (
          <View key={i} style={styles.table}>
            <View style={styles.tableRow}>
              {block.header.map((cell, j) => (
                <Text key={j} style={styles.tableHeaderCell}>
                  <Inlines inlines={cell} />
                </Text>
              ))}
            </View>
            {block.rows.map((row, r) => (
              <View key={r} style={r === block.rows.length - 1 ? styles.tableRowLast : styles.tableRow}>
                {row.map((cell, c) => (
                  <Text key={c} style={styles.tableCell}>
                    <Inlines inlines={cell} />
                  </Text>
                ))}
              </View>
            ))}
          </View>
        );
      }
      return <View key={i} style={styles.hr} />;
    })}
  </>
);

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
  renderedBody: string;
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
  renderedBody,
  status,
  signerName,
  signedAt,
}: ContractPdfProps) => {
  const depositAmount = depositPct ? Math.round(quoteTotal * (depositPct / 100) * 100) / 100 : null;
  const blocks = parseContractMarkdown(renderedBody);

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

        <ContractBlocks blocks={blocks} />

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
