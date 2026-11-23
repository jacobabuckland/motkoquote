// What Motko says it is doing while a tool runs, in the foreman's voice. One line
// per tool; anything unlisted gets the generic line rather than a tool name.

const STATUS: Record<string, string> = {
  get_needs_attention: "Seeing what needs you…",
  list_jobs: "Looking through your jobs…",
  get_job: "Opening the job…",
  show_progress: "Checking where the job's up to…",
  get_money_position: "Checking who owes you…",
  create_quote_draft: "Drafting and pricing the quote…",
  update_quote: "Updating the quote…",
  set_assumption: "Noting that on the quote…",
  propose_send_quote: "Setting that up for you to confirm…",
  propose_create_invoice: "Setting that up for you to confirm…",
  propose_mark_paid: "Setting that up for you to confirm…",
  propose_delete_draft: "Setting that up for you to confirm…",
};

export const GENERIC_STATUS = "Working on it…";

export const statusForTool = (name: string): string => STATUS[name] ?? GENERIC_STATUS;
