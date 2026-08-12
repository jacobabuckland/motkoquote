import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Static WhatsApp/OG card for the landing route. Flat canvas, one green accent
// bar, and the real captured scope-of-work screenshot (public/marketing/sow.png)
// framed on the right — no gradients, no photography. Stays under 300KB.
export const alt = "Motko — Say the job. Send the quote.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  // Inline the real SoW capture as a data URL so the OG renderer needs no
  // network fetch (absolute-URL fetches aren't available at render time).
  const sow = await readFile(join(process.cwd(), "public/marketing/sow.png"));
  const sowSrc = `data:image/png;base64,${sow.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        {/* green accent bar */}
        <div style={{ width: 16, height: "100%", background: "#004225" }} />

        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "72px",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 560 }}>
            <div
              style={{
                fontSize: 34,
                fontWeight: 700,
                color: "#004225",
                letterSpacing: "-0.02em",
              }}
            >
              Motko
            </div>
            <div
              style={{
                marginTop: 28,
                fontSize: 64,
                fontWeight: 700,
                color: "#222222",
                lineHeight: 1.05,
                letterSpacing: "-0.02em",
              }}
            >
              Say the job. Send the quote.
            </div>
            <div style={{ marginTop: 28, fontSize: 26, color: "#717171" }}>
              Talk it through. Motko prices it from your rates and gets you paid.
            </div>
          </div>

          {/* real captured scope-of-work screenshot, top-anchored 4:5 crop */}
          <div
            style={{
              display: "flex",
              width: 300,
              height: 380,
              overflow: "hidden",
              borderRadius: 16,
              border: "1px solid #dddddd",
              background: "#ffffff",
              boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={sowSrc}
              alt=""
              width={300}
              height={650}
              style={{ width: 300, objectFit: "cover", objectPosition: "top" }}
            />
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
