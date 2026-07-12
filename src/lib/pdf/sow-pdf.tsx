import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { SowState } from "@/lib/schemas/sow";
import { PdfHeader, PdfFooter, sharedStyles, colors } from "./shared";

const styles = StyleSheet.create({
  jobTitle: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 4, textTransform: "capitalize" },
  customerLine: { fontSize: 9, color: colors.subtle, marginBottom: 16 },
  overviewText: { fontSize: 9, lineHeight: 1.5, marginBottom: 4 },
  infoBar: { flexDirection: "row", marginBottom: 8 },
  infoBox: { flex: 1, backgroundColor: colors.panel, padding: 10, marginRight: 12 },
  infoBoxLast: { marginRight: 0 },
  infoLabel: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: colors.subtle,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  infoValue: { fontSize: 9 },
  room: { marginBottom: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  roomName: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  roomDimensions: { fontSize: 9, color: colors.subtle, marginBottom: 4 },
  bulletRow: { flexDirection: "row", marginBottom: 2, paddingLeft: 4 },
  bullet: { width: 10, fontSize: 9 },
  bulletText: { flex: 1, fontSize: 9 },
  materialsWrap: { flexDirection: "row", flexWrap: "wrap" },
  materialChip: {
    fontSize: 8,
    backgroundColor: colors.panel,
    paddingVertical: 3,
    paddingHorizontal: 8,
    marginRight: 6,
    marginBottom: 6,
  },
  assumptionsPanel: { backgroundColor: colors.panel, padding: 12 },
  assumptionsIntro: { fontSize: 8, color: colors.subtle, marginBottom: 6 },
});

type Props = {
  companyName: string;
  trade?: string | null;
  companyNumber?: string | null;
  vatNumber?: string | null;
  brandColor?: string;
  logoUrl?: string;
  reference: string;
  date: string;
  customerName?: string | null;
  sow: SowState;
};

export const SowPdf = ({
  companyName,
  trade,
  companyNumber,
  vatNumber,
  brandColor,
  logoUrl,
  reference,
  date,
  customerName,
  sow,
}: Props) => (
  <Document>
    <Page size="A4" style={sharedStyles.page}>
      <PdfHeader
        kind="STATEMENT OF WORK"
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

      <Text style={styles.jobTitle}>{sow.job_type}</Text>
      {customerName && <Text style={styles.customerLine}>Prepared for {customerName}</Text>}

      {sow.overview_narrative && (
        <View>
          <Text style={sharedStyles.sectionTitle}>Overview</Text>
          <Text style={styles.overviewText}>{sow.overview_narrative}</Text>
        </View>
      )}

      {(sow.timeline || sow.access_issues) && (
        <View style={styles.infoBar}>
          {sow.timeline && (
            <View style={sow.access_issues ? styles.infoBox : [styles.infoBox, styles.infoBoxLast]}>
              <Text style={styles.infoLabel}>Timeline</Text>
              <Text style={styles.infoValue}>{sow.timeline}</Text>
            </View>
          )}
          {sow.access_issues && (
            <View style={[styles.infoBox, styles.infoBoxLast]}>
              <Text style={styles.infoLabel}>Access notes</Text>
              <Text style={styles.infoValue}>{sow.access_issues}</Text>
            </View>
          )}
        </View>
      )}

      {sow.rooms.length > 0 && (
        <View>
          <Text style={sharedStyles.sectionTitle}>Scope of work</Text>
          {sow.rooms.map((room, i) => (
            <View style={styles.room} key={i} wrap={false}>
              <Text style={styles.roomName}>{room.name}</Text>
              {room.dimensions && <Text style={styles.roomDimensions}>{room.dimensions}</Text>}
              {room.work_items.map((item, j) => (
                <View style={styles.bulletRow} key={j}>
                  <Text style={styles.bullet}>•</Text>
                  <Text style={styles.bulletText}>{item}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}

      {sow.materials_mentioned.length > 0 && (
        <View>
          <Text style={sharedStyles.sectionTitle}>Materials</Text>
          <View style={styles.materialsWrap}>
            {sow.materials_mentioned.map((material, i) => (
              <Text style={styles.materialChip} key={i}>
                {material}
              </Text>
            ))}
          </View>
        </View>
      )}

      {sow.assumptions.length > 0 && (
        <View>
          <Text style={sharedStyles.sectionTitle}>Assumptions</Text>
          <View style={styles.assumptionsPanel}>
            <Text style={styles.assumptionsIntro}>
              Confirm the following with the customer before work begins:
            </Text>
            {sow.assumptions.map((assumption, i) => (
              <View style={styles.bulletRow} key={i}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.bulletText}>{assumption}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <PdfFooter note="Based on a recorded conversation with the customer. Verify scope on site before starting work." />
      <Text
        style={sharedStyles.pageNumber}
        fixed
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
      />
    </Page>
  </Document>
);
