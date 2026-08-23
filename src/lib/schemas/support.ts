import { z } from "zod";

// A support message from a signed-in contractor. Deliberately thin: who they
// are comes from the session, not from the form, so there is nothing here to
// spoof and nothing for them to retype.
//
// The caps are not cosmetic. Both fields reach an email — the subject reaches a
// header — so an unbounded field is an unbounded header and an unbounded body.
export const SUPPORT_SUBJECT_MAX = 120;
export const SUPPORT_MESSAGE_MAX = 4000;

export const supportMessageSchema = z.object({
  subject: z
    .string()
    .trim()
    .min(1, "Give your message a subject.")
    .max(SUPPORT_SUBJECT_MAX, `Keep the subject under ${SUPPORT_SUBJECT_MAX} characters.`),
  message: z
    .string()
    .trim()
    .min(10, "Tell us a little more so we can help.")
    .max(SUPPORT_MESSAGE_MAX, `Keep the message under ${SUPPORT_MESSAGE_MAX} characters.`),
});

export type SupportMessage = z.infer<typeof supportMessageSchema>;
