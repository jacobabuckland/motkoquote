"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import {
  SUPPORT_MESSAGE_MAX,
  supportMessageSchema,
} from "@/lib/schemas/support";
import { sendSupportMessage } from "./support-actions";

type Props = {
  /** From the session. Shown so the contractor knows where a reply will go. */
  replyToEmail: string;
};

export const SupportForm = ({ replyToEmail }: Props) => {
  const toast = useToast();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sending, startSending] = useTransition();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const parsed = supportMessageSchema.safeParse({ subject, message });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check your message.");
      return;
    }

    startSending(async () => {
      const res = await sendSupportMessage(parsed.data);
      if ("error" in res) {
        setError(res.error);
        return;
      }

      // Settled end state before anything else, per the UI conventions in
      // CLAUDE.md: the button lands on "Sent ✓" rather than resting on a
      // spinner. This is a non-job save, so it stays in place — there is
      // nowhere better to send someone who has just asked a question.
      setSent(true);
      setSubject("");
      setMessage("");
      toast("Message sent. We'll reply by email.");
    });
  };

  return (
    <Card>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          label="Subject"
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
            setSent(false);
          }}
          placeholder="What's this about?"
          autoComplete="off"
        />

        <Textarea
          label="Message"
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            setSent(false);
          }}
          rows={8}
          maxLength={SUPPORT_MESSAGE_MAX}
          placeholder="Tell us what's happening and we'll take a look."
          hint={`Replies go to ${replyToEmail}`}
          error={error ?? undefined}
        />

        <div className="flex items-center gap-3">
          <Button type="submit" loading={sending} success={sent} disabled={sending}>
            {sent ? "Sent ✓" : "Send message"}
          </Button>
        </div>
      </form>
    </Card>
  );
};
