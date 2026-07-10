const EMBEDDING_MODEL = "text-embedding-3-small";

export const embedText = async (text: string): Promise<number[]> => {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI embeddings failed: ${response.status}`);
  }

  const data = (await response.json()) as { data: { embedding: number[] }[] };
  const embedding = data.data[0]?.embedding;
  if (!embedding) throw new Error("No embedding returned");
  return embedding;
};
