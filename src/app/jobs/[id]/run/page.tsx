import { getJob } from "@/app/jobs/actions";
import { getQuote } from "@/app/quotes/actions";
import { getCurrentContractor } from "@/lib/auth";
import type { TranscriptTurn } from "@/lib/voice-transcript";
import type { SowState } from "@/lib/schemas/sow";
import type { JobExtraction, LineItem } from "@/lib/schemas/job";
import { formatGBP } from "@/lib/format";

type RunPageProps = {
  params: Promise<{ id: string }>;
};

export default async function RunPage({ params }: RunPageProps) {
  const { id } = await params;

  const job = await getJob(id);
  const quote = await getQuote(id);
  const currentContractor = await getCurrentContractor();

  if (!job) {
    return <div>Job not found</div>;
  }

  // Check contractor ownership
  if (!currentContractor || job.contractor_id !== currentContractor.id) {
    return <div>Access denied. You are not authorized to view this job.</div>;
  }

  const conversationTurns = job.conversation_json as TranscriptTurn[] | null;
  const transcript = job.transcript;
  const sowState = job.sow_json as SowState | null;
  const extraction = job.extracted_json as JobExtraction | null;
  const draftedLineItems = quote?.drafted_line_items_json ?? null;
  const finalLineItems = quote?.line_items_json ?? [];
  const contractorFlags = quote?.contractor_flags_json ?? [];

  // Check if this is a manual quote (no voice run)
  const hasVoiceRun = Boolean(conversationTurns || transcript);

  if (!hasVoiceRun) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="mb-4 text-2xl font-bold">Run Viewer</h1>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center">
          <p className="text-lg font-medium text-gray-700">
            No voice run for this job. This quote was created manually.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <h1 className="mb-6 text-2xl font-bold">Run Viewer</h1>

      <div className="space-y-6">
        {/* Pane 1: Conversation Turns */}
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-semibold">Conversation Turns</h2>
          {conversationTurns && conversationTurns.length > 0 ? (
            <div className="max-h-96 overflow-y-auto space-y-2">
              {conversationTurns.map((turn, idx) => (
                <div key={idx} className="rounded bg-gray-50 p-3">
                  <div className="mb-1 text-sm font-medium text-gray-600">
                    {turn.speaker}
                    {turn.at && (
                      <span className="ml-2 text-xs text-gray-400">
                        {new Date(turn.at).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <div className="text-gray-800">{turn.text}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-gray-500">Pipeline did not reach this stage</div>
          )}
        </div>

        {/* Pane 2: Flat Transcript */}
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-semibold">Flat Transcript</h2>
          {transcript ? (
            <div className="max-h-96 overflow-y-auto">
              <pre className="whitespace-pre-wrap text-sm text-gray-800">{transcript}</pre>
            </div>
          ) : (
            <div className="text-gray-500">Pipeline did not reach this stage</div>
          )}
        </div>

        {/* Pane 3: SoW State */}
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-semibold">SoW State</h2>
          {sowState ? (
            <div className="max-h-96 overflow-y-auto space-y-4">
              <div>
                <div className="font-medium text-gray-700">Job Type:</div>
                <div className="text-gray-800">{sowState.job_type}</div>
              </div>

              {sowState.rooms && sowState.rooms.length > 0 && (
                <div>
                  <div className="font-medium text-gray-700">Rooms:</div>
                  {sowState.rooms.map((room, idx) => (
                    <div key={idx} className="ml-4 mt-2">
                      <div className="font-medium text-gray-800">
                        {room.name}
                        {room.dimensions && (
                          <span className="ml-2 text-sm text-gray-600">
                            ({room.dimensions})
                          </span>
                        )}
                      </div>
                      {room.work_items && room.work_items.length > 0 && (
                        <ul className="ml-4 mt-1 list-disc text-gray-700">
                          {room.work_items.map((item, itemIdx) => (
                            <li key={itemIdx}>{item}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {sowState.stated_prices && sowState.stated_prices.length > 0 && (
                <div>
                  <div className="font-medium text-gray-700">Stated Prices:</div>
                  {sowState.stated_prices.map((price, idx) => (
                    <div key={idx} className="ml-4 mt-2 rounded bg-gray-50 p-3">
                      <div className="font-medium text-gray-800">
                        {formatGBP(price.amount)}
                        {price.item ? (
                          <span className="ml-2 text-sm">({price.item})</span>
                        ) : (
                          <span className="ml-2 text-sm text-gray-500">(no item)</span>
                        )}
                      </div>
                      {price.transcript_span && (
                        <div className="mt-1 text-sm text-gray-600">
                          Span: &quot;{price.transcript_span}&quot;
                        </div>
                      )}
                      {price.qualifiers && (
                        <div className="mt-1 text-xs text-gray-500">
                          {price.qualifiers.already_paid && (
                            <span className="mr-2">Already paid</span>
                          )}
                          {price.qualifiers.each && <span className="mr-2">Each</span>}
                          {price.qualifiers.fitted && <span className="mr-2">Fitted</span>}
                          {price.qualifiers.excluded && <span>Excluded</span>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-gray-500">Pipeline did not reach this stage</div>
          )}
        </div>

        {/* Pane 4: Extraction */}
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-semibold">Extraction</h2>
          {extraction ? (
            <div className="max-h-96 overflow-y-auto space-y-4">
              <div>
                <div className="font-medium text-gray-700">Job Type:</div>
                <div className="text-gray-800">{extraction.job_type}</div>
              </div>

              {extraction.scope_items && extraction.scope_items.length > 0 && (
                <div>
                  <div className="font-medium text-gray-700">Scope Items:</div>
                  <ul className="ml-4 mt-1 list-disc text-gray-700">
                    {extraction.scope_items.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {extraction.materials_mentioned && extraction.materials_mentioned.length > 0 && (
                <div>
                  <div className="font-medium text-gray-700">Materials Mentioned:</div>
                  <div className="text-gray-800">
                    {extraction.materials_mentioned.join(", ")}
                  </div>
                </div>
              )}

              {extraction.notes && (
                <div>
                  <div className="font-medium text-gray-700">Notes:</div>
                  <div className="text-gray-800">{extraction.notes}</div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-gray-500">Pipeline did not reach this stage</div>
          )}
        </div>

        {/* Pane 5: Drafted Line Items */}
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-semibold">Drafted Line Items</h2>
          {draftedLineItems && draftedLineItems.length > 0 ? (
            <div className="max-h-96 overflow-y-auto space-y-3">
              {draftedLineItems.map((item, idx) => (
                <LineItemDisplay key={idx} item={item} />
              ))}
            </div>
          ) : (
            <div className="text-gray-500">Pipeline did not reach this stage</div>
          )}
        </div>

        {/* Pane 6: Final Line Items */}
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-semibold">Final Line Items</h2>
          {finalLineItems.length > 0 ? (
            <div className="max-h-96 overflow-y-auto space-y-3">
              {finalLineItems.map((item, idx) => (
                <LineItemDisplay key={idx} item={item} />
              ))}
            </div>
          ) : (
            <div className="text-gray-500">No line items</div>
          )}

          {contractorFlags.length > 0 && (
            <div className="mt-4">
              <div className="font-medium text-gray-700">Contractor Flags:</div>
              <ul className="ml-4 mt-2 list-disc text-gray-700">
                {contractorFlags.map((flag, idx) => (
                  <li key={idx}>{flag}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Draft vs Final Comparison */}
        {draftedLineItems && draftedLineItems.length > 0 && (
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="mb-4 text-xl font-semibold">Draft vs Final Comparison</h2>
            <DraftVsFinalComparison
              draftedItems={draftedLineItems}
              finalItems={finalLineItems}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function LineItemDisplay({ item }: { item: LineItem }) {
  const provenance = item.provenance as
    | { source: "transcript" | "contractor"; transcript_span?: string }
    | undefined;

  return (
    <div className="rounded border border-gray-200 bg-gray-50 p-3">
      <div className="font-medium text-gray-800">{item.description}</div>
      <div className="mt-1 text-sm text-gray-600">
        {item.category} | {item.quantity} {item.unit} @ {formatGBP(item.unit_price)}
      </div>
      {provenance && (
        <div className="mt-2 text-sm">
          <span className="font-medium text-gray-700">Source:</span>{" "}
          <span className="text-gray-800">{provenance.source}</span>
          {provenance.source === "transcript" && provenance.transcript_span && (
            <div className="mt-1 text-xs text-gray-600">
              Span: &quot;{provenance.transcript_span}&quot;
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DraftVsFinalComparison({
  draftedItems,
  finalItems,
}: {
  draftedItems: LineItem[];
  finalItems: LineItem[];
}) {
  // Detect fixed-mode pricing collapse: multiple drafted items become a single final item
  const isFixedModeCollapse =
    draftedItems.length > 1 &&
    finalItems.length === 1 &&
    finalItems[0].category === "labour" &&
    (finalItems[0].unit === "job" || finalItems[0].description.toLowerCase().includes("works"));

  if (isFixedModeCollapse) {
    return (
      <div className="space-y-4">
        <div className="rounded bg-blue-50 p-4 text-blue-800">
          <div className="font-medium">
            Collapsed to single works line (fixed pricing mode)
          </div>
          <div className="mt-1 text-sm">
            The drafted breakdown was collapsed into a single fixed-price line for the
            customer quote.
          </div>
        </div>

        <div>
          <div className="mb-2 font-medium text-gray-700">Drafted Items:</div>
          <div className="space-y-2">
            {draftedItems.map((item, idx) => (
              <div key={idx} className="text-sm text-gray-600">
                • {item.description} ({item.category})
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 font-medium text-gray-700">Final Item:</div>
          <div className="text-sm text-gray-600">
            • {finalItems[0].description} ({finalItems[0].category})
          </div>
        </div>
      </div>
    );
  }

  // General comparison
  const added: LineItem[] = [];
  const removed: LineItem[] = [];

  const draftDescriptions = new Set(draftedItems.map((item) => item.description));
  const finalDescriptions = new Set(finalItems.map((item) => item.description));

  for (const item of finalItems) {
    if (!draftDescriptions.has(item.description)) {
      added.push(item);
    }
  }

  for (const item of draftedItems) {
    if (!finalDescriptions.has(item.description)) {
      removed.push(item);
    }
  }

  return (
    <div className="space-y-4">
      {added.length > 0 && (
        <div>
          <div className="mb-2 font-medium text-green-700">Added:</div>
          <div className="space-y-2">
            {added.map((item, idx) => (
              <div key={idx} className="text-sm text-gray-600">
                + {item.description} ({item.category})
              </div>
            ))}
          </div>
        </div>
      )}

      {removed.length > 0 && (
        <div>
          <div className="mb-2 font-medium text-red-700">Removed:</div>
          <div className="space-y-2">
            {removed.map((item, idx) => (
              <div key={idx} className="text-sm text-gray-600">
                - {item.description} ({item.category})
              </div>
            ))}
          </div>
        </div>
      )}

      {added.length === 0 && removed.length === 0 && (
        <div className="text-sm text-gray-600">No changes between draft and final</div>
      )}
    </div>
  );
}
