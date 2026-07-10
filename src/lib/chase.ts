import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

type ChaseCopyInput = {
  companyName: string;
  customerName: string;
  amount: number;
  daysOverdue: number;
};

export const draftChaseMessage = async (input: ChaseCopyInput): Promise<string> => {
  const tone =
    input.daysOverdue >= 14 ? "firm" : input.daysOverdue >= 7 ? "direct but polite" : "friendly reminder";

  const fallback = `Your payment of £${input.amount.toFixed(2)} to ${input.companyName} is now ${input.daysOverdue} days overdue. Please settle at your earliest convenience.`;

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 300,
      messages: [
        {
          role: "user",
          content: `Write a short payment chase email body (2-3 sentences, plain text, no subject line, no greeting, no sign-off) from ${input.companyName} to their customer ${input.customerName}. The invoice for £${input.amount.toFixed(2)} is ${input.daysOverdue} days overdue. Tone: ${tone}.`,
        },
      ],
    });

    const block = message.content[0];
    return block?.type === "text" ? block.text.trim() : fallback;
  } catch {
    return fallback;
  }
};
