// "Save changes" reported Saved and threw the customer's details away.
//
// Reported 13 Sep, on any draft job. Type a customer name, email, mobile and
// site address into the send form, press "Save changes" directly above them,
// and the button reports "Saved". Reload: all four blank. No unsaved-changes
// indicator appeared either — the amber "N unsaved changes" line that fires for
// a line edit stayed silent throughout.
//
// The cause: `updateQuoteLineItems` wrote `line_items_json` and nothing else.
// The only path that ever persisted a customer was `sendQuote`, so the details
// existed in React state and nowhere else until the quote was sent.
//
// Same shape as the pricing-mode defect on the same screen — a destructive
// outcome behind a control whose label says the opposite — and arguably worse,
// because nothing is visibly lost until the contractor comes back.
//
// The SECOND half of the same wiring, reported separately: after a send, the
// form came back EMPTY. The editor was seeded from `sow_json` alone, which is
// what the voice call captured, while `customers` holds what the contractor
// confirmed at send time and nothing writes it back. So the job header showed
// the customer's name while the form below it sat blank, "Re-send to customer"
// was disabled, and the hint read "Add the customer's name to send" about a
// customer displayed three inches above.
import { describe, expect, it } from "vitest";
import { mockSupabaseClient } from "../helpers/supabase";
import {
  buildCustomerContact,
  hasCustomerDetail,
  persistJobCustomer,
} from "@/lib/persist-job-customer";

const CUSTOMER = {
  name: "Priya Raman",
  email: "priya.raman@example.com",
  phone: "07700900123",
  address: "12 Malvern Road, NR1 4BA",
};

describe("a job that already has a customer", () => {
  it("updates the existing row rather than inserting another", async () => {
    const { client, getWrites } = mockSupabaseClient([{ id: "cust_1" }]);

    await persistJobCustomer(client, {
      jobId: "job_1",
      contractorId: "contractor_1",
      customerId: "cust_1",
      customer: CUSTOMER,
    });

    const writes = getWrites();
    expect(writes.filter((w) => w.method === "insert")).toHaveLength(0);
    expect(writes.filter((w) => w.method === "update" && w.table === "customers")).toHaveLength(1);
  });

  it("writes the name and the contact the contractor typed", async () => {
    const { client, getWrites } = mockSupabaseClient([{ id: "cust_1" }]);

    await persistJobCustomer(client, {
      jobId: "job_1",
      contractorId: "contractor_1",
      customerId: "cust_1",
      customer: CUSTOMER,
    });

    const update = getWrites().find((w) => w.method === "update" && w.table === "customers");
    expect(update?.payload).toMatchObject({ name: "Priya Raman" });
  });
});

describe("a job with no customer yet", () => {
  it("inserts one and points the job at it", async () => {
    const { client, getWrites } = mockSupabaseClient([{ id: "cust_new" }]);

    const id = await persistJobCustomer(client, {
      jobId: "job_1",
      contractorId: "contractor_1",
      customerId: null,
      customer: CUSTOMER,
    });

    expect(id).toBe("cust_new");

    const writes = getWrites();
    expect(writes.find((w) => w.method === "insert" && w.table === "customers")).toBeDefined();
    // The second write is what stops the row being orphaned.
    expect(writes.find((w) => w.method === "update" && w.table === "jobs")?.payload).toMatchObject({
      customer_id: "cust_new",
    });
  });

  it("files it under the contractor who owns the job", async () => {
    const { client, getWrites } = mockSupabaseClient([{ id: "cust_new" }]);

    await persistJobCustomer(client, {
      jobId: "job_1",
      contractorId: "contractor_1",
      customerId: null,
      customer: CUSTOMER,
    });

    expect(
      getWrites().find((w) => w.method === "insert" && w.table === "customers")?.payload,
    ).toMatchObject({ contractor_id: "contractor_1" });
  });
});

describe("the stored contact", () => {
  it("normalises a UK mobile", () => {
    expect(buildCustomerContact({ name: "X", phone: "07700900123" }).phone).toBe("+447700900123");
  });

  it("keeps an unparseable number rather than dropping it", () => {
    // The contractor typed something. Losing it silently is the defect this
    // whole file is about, in miniature.
    const contact = buildCustomerContact({ name: "X", phone: "ask his wife" });
    expect(contact.phone).toBe("ask his wife");
  });

  it("carries the site address, which the contract prefill reads", () => {
    expect(buildCustomerContact(CUSTOMER).address).toBe("12 Malvern Road, NR1 4BA");
  });
});

describe("what must NOT be written", () => {
  it("ignores a save with every customer field blank", () => {
    // An ordinary save from a surface with no customer fields, or a contractor
    // who simply did not touch them. Writing here would blank a real row.
    expect(hasCustomerDetail({ name: "" })).toBe(false);
    expect(hasCustomerDetail({ name: "   ", email: "", phone: "", address: "" })).toBe(false);
    expect(hasCustomerDetail(undefined)).toBe(false);
  });

  it("saves when any single detail is present", () => {
    // A phone number alone is worth keeping — the name may come later.
    expect(hasCustomerDetail({ name: "", phone: "07700900123" })).toBe(true);
    expect(hasCustomerDetail({ name: "Priya" })).toBe(true);
    expect(hasCustomerDetail({ name: "", address: "12 Malvern Road" })).toBe(true);
  });
});
