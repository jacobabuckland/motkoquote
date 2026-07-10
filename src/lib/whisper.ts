export const transcribeAudio = async (
  audio: Blob,
  filename: string,
): Promise<string> => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", "whisper-1");

  const response = await fetch(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Whisper transcription failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as { text: string };
  return data.text;
};
