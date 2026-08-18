import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export async function GET() {
  // Read the committed AASA JSON file from the public directory
  const aasaPath = join(process.cwd(), "public/.well-known/apple-app-site-association.json");
  const aasaContent = readFileSync(aasaPath, "utf-8");
  const aasaJson = JSON.parse(aasaContent);

  // Return as JSON with the correct content type
  return NextResponse.json(aasaJson, {
    headers: {
      "Content-Type": "application/json",
    },
  });
}
