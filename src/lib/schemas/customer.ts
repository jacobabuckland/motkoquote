import { z } from "zod";

export const customerInputSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

export type CustomerInput = z.infer<typeof customerInputSchema>;
