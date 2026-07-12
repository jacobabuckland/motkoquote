import { questionPackSchema, type QuestionPack } from "@/lib/schemas/question-pack";

// Versioned, in-repo question packs — plain data, reviewed and edited like
// code (per the design doc's own preference), not stored in a DB table.
// Each entry is validated at module-load time so a malformed pack fails
// fast at build/test time rather than mid-call.
const RAW_PACKS = [
  {
    job_type: "full rewire",
    slots: [
      { key: "property_type", label: "Property type", type: "choice", priority: "required", choices: ["house", "flat", "bungalow"] },
      { key: "num_bedrooms", label: "Number of bedrooms", type: "number", priority: "required" },
      { key: "consumer_unit_replacement", label: "Consumer unit (fuse box) replacement needed?", type: "boolean", priority: "required" },
      { key: "floor_type", label: "Floor type (for cable routing)", type: "choice", priority: "assumable", choices: ["suspended timber", "solid concrete"], default_value: "suspended timber" },
      {
        key: "access_difficulty",
        label: "Any difficult access (listed building, no floor access, etc.)?",
        type: "boolean",
        priority: "assumable",
        pricing_effect: "1.5x labour lines when true",
        default_value: false,
      },
      { key: "chase_walls", label: "Chasing into walls required for cable routing?", type: "boolean", priority: "assumable", default_value: true },
    ],
  },
  {
    job_type: "boiler replacement",
    slots: [
      { key: "current_fuel_type", label: "Current boiler fuel type", type: "choice", priority: "required", choices: ["gas", "oil", "electric"] },
      { key: "boiler_type", label: "Replacement boiler type", type: "choice", priority: "required", choices: ["combi", "system", "regular"] },
      { key: "relocating_boiler", label: "Is the boiler moving location?", type: "boolean", priority: "assumable", default_value: false },
      {
        key: "access_difficulty",
        label: "Any difficult access (loft, tight airing cupboard, etc.)?",
        type: "boolean",
        priority: "assumable",
        pricing_effect: "1.25x labour lines when true",
        default_value: false,
      },
    ],
  },
] satisfies QuestionPack[];

export const QUESTION_PACKS: QuestionPack[] = RAW_PACKS.map((pack) => questionPackSchema.parse(pack));
