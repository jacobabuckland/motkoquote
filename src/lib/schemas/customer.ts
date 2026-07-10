import { z } from "zod";

export const customerInputSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
});

export type CustomerInput = z.infer<typeof customerInputSchema>;
