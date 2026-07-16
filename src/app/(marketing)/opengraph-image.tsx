import { ImageResponse } from "next/og";

// Static WhatsApp/OG card for the landing route. Flat canvas, one green accent
// bar, a framed mock quote — no gradients, no photography. Keeps well under 300KB.
export const alt = "Motko — Say the job. Send the quote.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
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

          {/* framed mock quote */}
          <div
            style={{
              width: 300,
              height: 380,
              display: "flex",
              flexDirection: "column",
              borderRadius: 16,
              border: "1px solid #dddddd",
              background: "#f6f3ee",
              padding: 24,
              boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 700, color: "#222222" }}>
              Quote
            </div>
            {[220, 180, 200, 150].map((w, i) => (
              <div
                key={i}
                style={{
                  marginTop: i === 0 ? 20 : 16,
                  width: w,
                  height: 14,
                  borderRadius: 7,
                  background: "#e7e4df",
                }}
              />
            ))}
            <div style={{ flex: 1 }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ width: 90, height: 16, borderRadius: 8, background: "#e7e4df" }} />
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: "#004225",
                }}
              >
                £992.50
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
