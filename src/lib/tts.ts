// Turns a short question into spoken audio so the SoW flow can talk back to
// the contractor, not just listen. Returns a data URI the client can play
// directly, or an empty string if TTS isn't configured/available — callers
// should treat that as "no audio, text still works".
export const synthesizeSpeech = async (text: string): Promise<string> => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return "";

  try {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        voice: "alloy",
        input: text,
        response_format: "mp3",
      }),
    });

    if (!response.ok) {
      console.error("Text-to-speech failed:", response.status, await response.text());
      return "";
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:audio/mpeg;base64,${buffer.toString("base64")}`;
  } catch (err) {
    console.error("Text-to-speech request failed:", err);
    return "";
  }
};
