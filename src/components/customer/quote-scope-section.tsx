// What the work IS, on the page the customer accepts.
//
// /q/[id] selected line_items_json and never sow_json, so it rendered a
// heading, a priced table, a total and an Accept button — and nothing that said
// what the work was. In fixed-price mode that is one line reading "<trade>
// works as described" above a single figure, described nowhere the customer can
// reach. A customer who accepted had accepted a number, not an agreement.
//
// The quote PDF has carried the scope for a while. That is not the same thing:
// a PDF the customer may never open is not the artefact the acceptance binds
// to. The button is here.
//
// The source is buildQuoteScope, deliberately. Its own header calls it "the
// list of things a customer is allowed to read" — a narrowed projection that
// keeps the SOW's contractor-only channels (next_question, unasked_required,
// wrap_incomplete, reclassification bookkeeping) off customer surfaces by
// construction rather than by anyone remembering. Rendering that projection and
// nothing else also means this page and the PDF cannot state different scope:
// two presentations, one derivation.

import type { QuoteScope } from "@/lib/pdf/quote-payload";
import { Card } from "@/components/ui/card";

const ScopeList = ({ title, items }: { title: string; items: string[] }) => {
  // An empty section with a heading is worse than no section: it advertises
  // that something was captured and then shows none of it. Same rule the PDF's
  // own ScopeList follows.
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
        {title}
      </h3>
      <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
};

export const QuoteScopeSection = ({ scope }: { scope: QuoteScope }) => (
  <section className="flex flex-col gap-4">
    <h2 className="text-sm font-semibold">What&apos;s included</h2>

    {scope.overviewNarrative && (
      <p className="text-sm text-text-secondary">{scope.overviewNarrative}</p>
    )}

    {/* Work every room shares, said once and BEFORE the rooms it qualifies —
        the reader needs it ahead of the list it applies to. P1-5 lifts it out
        of the rooms; without that this section would repeat one sentence under
        every room on a document being accepted. */}
    <ScopeList title="Throughout" items={scope.wholeJobItems} />

    {scope.rooms.length > 0 && (
      <Card className="flex flex-col divide-y divide-border p-0 text-sm">
        {scope.rooms.map((room, i) => (
          <div key={i} className="flex flex-col gap-1 px-4 py-3">
            <span className="font-medium">
              {room.name}
              {room.dimensions ? ` (${room.dimensions})` : ""}
            </span>
            {room.workItems.length > 0 && (
              <ul className="flex flex-col gap-0.5 text-text-secondary">
                {room.workItems.map((item, wi) => (
                  <li key={wi}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </Card>
    )}

    <ScopeList title="Additional work" items={scope.additionalItems} />

    {scope.existingConditions && (
      <div className="flex flex-col gap-1">
        <h3 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
          Existing conditions
        </h3>
        <p className="text-sm">{scope.existingConditions}</p>
      </div>
    )}

    {scope.accessIssues && (
      <div className="flex flex-col gap-1">
        <h3 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
          Access
        </h3>
        <p className="text-sm">{scope.accessIssues}</p>
      </div>
    )}

    <ScopeList title="Included" items={scope.inclusions} />
    {/* The section a dispute actually turns on. It is not buried below the
        price for that reason. */}
    <ScopeList title="Not included" items={scope.exclusions} />
    <ScopeList title="Materials" items={scope.materialsMentioned} />

    {scope.materialsSupply && (
      <>
        <ScopeList
          title="Supplied by your tradesperson"
          items={scope.materialsSupply.contractorSupplied}
        />
        <ScopeList title="Supplied by you" items={scope.materialsSupply.customerSupplied} />
      </>
    )}

    {/* Named as assumptions, not stated as fact: these are what the price was
        built on, and a customer who can see them can correct one before
        accepting rather than arguing about it afterwards. */}
    <ScopeList title="What this price assumes" items={scope.assumptions} />

    {scope.timeline && (
      <div className="flex flex-col gap-1">
        <h3 className="text-xs font-medium uppercase tracking-wide text-text-secondary">
          Timing
        </h3>
        <p className="text-sm">{scope.timeline}</p>
      </div>
    )}
  </section>
);
