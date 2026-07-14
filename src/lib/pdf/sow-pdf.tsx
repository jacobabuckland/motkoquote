import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { synthesizeTimeline, type SowRoom, type SowState } from "@/lib/schemas/sow";
import { formatMaterialsSentence } from "@/lib/format";
import {
  PdfHeader,
  PdfAccentBar,
  PdfFooter,
  PartyBlock,
  MetaRow,
  sharedStyles,
  colors,
} from "./shared";

const styles = StyleSheet.create({
  jobTitle: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 2, textTransform: "capitalize" },
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
  acceptanceStrip: {
    marginTop: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  acceptanceText: { fontSize: 8.5, color: colors.subtle, lineHeight: 1.5, marginBottom: 16 },
  signatureRow: { flexDirection: "row" },
  signatureBlock: { flex: 1, marginRight: 20 },
  signatureLine: { borderTopWidth: 1, borderTopColor: colors.ink, marginTop: 24, paddingTop: 4 },
  signatureLabel: { fontSize: 7.5, color: colors.subtle, textTransform: "uppercase", letterSpacing: 0.5 },
});

const TREATMENT_LABEL: Record<SowState["assumptions_and_unknowns"][number]["treatment"], string> = {
  excluded: "Excluded",
  provisional_sum: "Provisional sum",
  assumed_ok: "Assumed OK",
};

// A room's work items rendered as one flowing sentence rather than a bare
// bullet fragment list — the room heading carries the "where", the sentence
// carries the "what".
const roomSentence = (room: SowRoom): string => {
  const items = room.work_items.join("; ");
  return items.endsWith(".") ? items : `${items}.`;
};

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
  sow: SowState;
};

export const SowPdf = ({
  companyName,
  trade,
  companyNumber,
  vatNumber,
  brandColor = "#111827",
  logoUrl,
  footerTerms,
  reference,
  date,
  sow,
}: Props) => {
  const sectionTitleAccent = [sharedStyles.sectionTitle, { borderBottomColor: brandColor }];
  // Cells with no value are omitted entirely rather than rendered with a
  // dash placeholder — Timeline is the sole exception, since
  // synthesizeTimeline always resolves to a meaningful fallback.
  const metaItems: { label: string; value: string }[] = [];
  if (sow.job_type) metaItems.push({ label: "Job type", value: sow.job_type });
  metaItems.push({ label: "Reference", value: reference });
  metaItems.push({ label: "Date", value: date });
  metaItems.push({ label: "Timeline", value: synthesizeTimeline(sow) });
  if (sow.deadline?.job_by) metaItems.push({ label: "Job needed by", value: sow.deadline.job_by });

  return (
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
        <PdfAccentBar brandColor={brandColor} />

        <Text style={styles.jobTitle}>{sow.job_type || "Job"}</Text>

        <View style={sharedStyles.partiesRow}>
          <PartyBlock
            label="Customer"
            name={sow.customer_name}
            lines={[sow.customer_phone, sow.customer_email]}
          />
          <PartyBlock label="Site address" lines={[sow.site_address ?? "Same as customer address"]} />
        </View>

        <MetaRow items={metaItems} />

        {sow.overview_narrative && (
          <View>
            <Text style={sectionTitleAccent}>Overview</Text>
            <Text style={styles.overviewText}>{sow.overview_narrative}</Text>
          </View>
        )}

        {sow.rooms.length > 0 && (
          <View>
            <Text style={sectionTitleAccent}>Scope of work</Text>
            {sow.rooms.map((room, i) => (
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

        {sow.existing_conditions && (
          <View>
            <Text style={sectionTitleAccent}>Existing conditions</Text>
            <Text style={styles.overviewText}>{sow.existing_conditions}</Text>
          </View>
        )}

        {sow.access_issues && (
          <View>
            <Text style={sectionTitleAccent}>Access &amp; working constraints</Text>
            <Text style={styles.overviewText}>{sow.access_issues}</Text>
          </View>
        )}

        {(sow.inclusions.length > 0 || sow.exclusions.length > 0) && (
          <View>
            <Text style={sectionTitleAccent}>Included &amp; not included</Text>
            <View style={styles.columns}>
              <View style={styles.column}>
                <Text style={styles.columnHeading}>Included</Text>
                {sow.inclusions.length === 0 && (
                  <Text style={styles.bulletText}>Everything described above.</Text>
                )}
                {sow.inclusions.map((item, i) => (
                  <View style={styles.bulletRow} key={i}>
                    <Text style={styles.bullet}>•</Text>
                    <Text style={styles.bulletText}>{item}</Text>
                  </View>
                ))}
              </View>
              <View style={[styles.column, styles.columnLast]}>
                <Text style={styles.columnHeading}>Not included</Text>
                {sow.exclusions.length === 0 && (
                  <Text style={styles.bulletText}>Nothing excluded.</Text>
                )}
                {sow.exclusions.map((item, i) => (
                  <View style={styles.bulletRow} key={i}>
                    <Text style={styles.bullet}>•</Text>
                    <Text style={styles.bulletText}>{item}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}

        {sow.materials_mentioned.length > 0 && (
          <View>
            <Text style={sectionTitleAccent}>Materials</Text>
            <View style={styles.materialsPanel}>
              <Text style={styles.materialsText}>{formatMaterialsSentence(sow.materials_mentioned)}</Text>
            </View>
          </View>
        )}

        {sow.assumptions_and_unknowns.length > 0 && (
          <View wrap={false}>
            <Text style={sectionTitleAccent}>Assumptions</Text>
            <View style={styles.assumptionsPanel}>
              <Text style={styles.assumptionsIntro}>
                Confirm the following with the customer before work begins:
              </Text>
              {sow.assumptions_and_unknowns.map((assumption, i) => (
                <View style={styles.assumptionRow} key={i}>
                  <Text style={styles.bullet}>•</Text>
                  <Text style={styles.assumptionText}>{assumption.description}</Text>
                  <Text style={styles.treatmentTag}>{TREATMENT_LABEL[assumption.treatment]}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View style={styles.acceptanceStrip} wrap={false}>
          <Text style={styles.acceptanceText}>
            By signing below, the customer accepts the scope, assumptions and exclusions set out in this
            Statement of Work. Any work outside this scope will be quoted separately before proceeding.
          </Text>
          <View style={styles.signatureRow}>
            <View style={styles.signatureBlock}>
              <View style={styles.signatureLine}>
                <Text style={styles.signatureLabel}>Customer signature</Text>
              </View>
            </View>
            <View style={[styles.signatureBlock, { marginRight: 0 }]}>
              <View style={styles.signatureLine}>
                <Text style={styles.signatureLabel}>Date</Text>
              </View>
            </View>
          </View>
        </View>

        <PdfFooter
          note={
            footerTerms ??
            "Based on a recorded conversation with the customer. Verify scope on site before starting work."
          }
        />
        <Text
          style={sharedStyles.pageNumber}
          fixed
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
        />
      </Page>
    </Document>
  );
};
