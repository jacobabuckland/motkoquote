// Deterministic job_type classifier. The Realtime model reports job_type as
// free-form text (or, historically, not at all); this collapses whatever it
// says into a small closed vocabulary so pack matching is stable and
// synonym-tolerant without embeddings or a network call. It is the
// deterministic safety net behind the model — even if the model reports
// "spotlights" or "hob circuit", classification is what decides which pack (if
// any) fires.

export type JobCategory =
  | "downlights"
  | "door_hanging"
  | "cooker_circuit"
  | "rewire"
  | "boiler"
  | "bathroom"
  | "kitchen"
  | "general";

export const JOB_CATEGORIES: readonly JobCategory[] = [
  "downlights",
  "door_hanging",
  "cooker_circuit",
  "rewire",
  "boiler",
  "bathroom",
  "kitchen",
  "general",
];

// Synonym substrings per category. Ordered most-specific-task first, rooms
// last, so a job named for both a task and a room ("kitchen downlights")
// classifies by the task, not the room. Every entry is a lowercase substring
// matched against the normalized job_type; the first category with any hit
// wins. "general" carries no synonyms — it is the default when nothing matches.
const CATEGORY_SYNONYMS: Record<Exclude<JobCategory, "general">, readonly string[]> = {
  // Circuit work for a cooker/hob wins over a bare "rewire" mention, because
  // "rewire of a hob" (audit session A) is a cooker circuit, not a house rewire.
  cooker_circuit: [
    "cooker circuit",
    "hob circuit",
    "oven circuit",
    "cooker point",
    "cooker",
    "hob",
  ],
  downlights: [
    "downlight",
    "down light",
    "spotlight",
    "spot light",
    "spotlights",
    "spots",
    "recessed light",
    "lighting",
    "light fitting",
    "ceiling light",
  ],
  door_hanging: [
    "door hanging",
    "door hang",
    "hang door",
    "hanging door",
    "hang a door",
    "fit door",
    "fitting door",
    "fitting doors",
    "internal door",
    "door",
    "doors",
  ],
  rewire: ["full rewire", "house rewire", "rewire", "rewiring", "re-wire", "re wire"],
  boiler: [
    "boiler replacement",
    "boiler swap",
    "boiler install",
    "combi boiler",
    "boiler",
  ],
  bathroom: ["bathroom", "en-suite", "ensuite", "en suite", "wet room", "wetroom"],
  kitchen: ["kitchen"],
} as const;

// Iterated in this fixed order — tasks before rooms — so classification is
// deterministic regardless of object key ordering.
const CATEGORY_ORDER: readonly Exclude<JobCategory, "general">[] = [
  "cooker_circuit",
  "downlights",
  "door_hanging",
  "rewire",
  "boiler",
  "bathroom",
  "kitchen",
];

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

// Collapses a free-form job_type into a JobCategory. Returns "general" when
// nothing in the closed vocabulary matches — that's the generic, pack-less
// flow, not an error.
export const classifyJobType = (raw: string): JobCategory => {
  const text = normalize(raw);
  if (text === "") return "general";
  for (const category of CATEGORY_ORDER) {
    if (CATEGORY_SYNONYMS[category].some((synonym) => text.includes(synonym))) {
      return category;
    }
  }
  return "general";
};
