/**
 * @vitest-environment happy-dom
 */

// Regression: a trade could not set their logo and could not be told why.
//
// `logo-upload.tsx` set a fixed "Upload failed — try again." and threw away
// `uploadError.message` on the very line that reported the failure — bucket
// missing, RLS denial, MIME rejection, 5xx, all six words. So the trade retried
// the same file, got the same answer, and nobody downstream could tell which of
// those it was.
//
// Reported as happening on EVERY valid upload. That matters: the handler
// branches on wrong-type, over-size and no-session ABOVE this point, each with
// its own message and an early return, so none of them can produce the generic
// string. A 100% failure rate therefore means the storage call itself is
// failing systematically for every user and every file — which is what makes
// the `x-upsert` candidate the leading one, since it would fail identically
// every time rather than for particular files.
//
// What this file cannot do: prove an upload succeeds against real Supabase
// Storage. The host is unreachable from CI. It pins what the component does
// with the answer it gets.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

afterEach(cleanup);

type UploadOptions = { upsert?: boolean; contentType?: string };

const upload = vi.fn<(path: string, file: File, opts: UploadOptions) => Promise<unknown>>();
const getUser = vi.fn(async () => ({ data: { user: { id: "user-1" } } }));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser },
    storage: {
      from: () => ({
        upload,
        remove: async () => ({ error: null }),
        getPublicUrl: () => ({
          data: { publicUrl: "https://cdn.example/logos/user-1/logo-1.png" },
        }),
      }),
    },
  }),
}));

const pngFile = (over: { type?: string; size?: number } = {}) => {
  const file = new File(["x"], "logo.png", { type: over.type ?? "image/png" });
  if (over.size != null) Object.defineProperty(file, "size", { value: over.size });
  return file;
};

const mount = async (onChange = vi.fn()) => {
  const { LogoUpload } = await import("@/components/ui/logo-upload");
  const { container } = render(<LogoUpload onChange={onChange} />);
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  return { input, onChange };
};

const drop = (input: HTMLInputElement, file: File) => {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
};

describe("a failed upload says what the storage layer said", () => {
  it("renders the storage error's own message, not a fixed string", async () => {
    upload.mockResolvedValue({
      error: { message: "new row violates row-level security policy" },
    });
    const { input } = await mount();

    drop(input, pngFile());

    await waitFor(() =>
      expect(
        screen.getByText("new row violates row-level security policy"),
        "the storage layer's message was discarded — the defect this file exists for",
      ).toBeTruthy(),
    );
    // The human sentence stays: a trade cannot act on an RLS message, but they
    // can read it down the phone.
    expect(screen.getByText("Couldn't upload that logo.")).toBeTruthy();
  });

  it("carries a different message through unchanged", async () => {
    // If this passed while the test above failed, the component would be
    // matching on a known string rather than reporting what it was told.
    upload.mockResolvedValue({ error: { message: "Bucket not found" } });
    const { input } = await mount();

    drop(input, pngFile());

    await waitFor(() => expect(screen.getByText("Bucket not found")).toBeTruthy());
  });

  it("says the human sentence alone when the error carries no message", async () => {
    upload.mockResolvedValue({ error: { message: "" } });
    const { input } = await mount();

    drop(input, pngFile());

    await waitFor(() => expect(screen.getByText("Couldn't upload that logo.")).toBeTruthy());
  });
});

describe("the upload call itself", () => {
  it("does not send upsert", async () => {
    // The path carries a millisecond timestamp so it cannot collide, and upsert
    // bought nothing — but it sends x-upsert, which makes the storage layer
    // resolve whether the object exists first, and that check needs SELECT on
    // storage.objects. The `logos` bucket has insert, update and delete
    // policies and no select: the only bucket in the repo missing one.
    upload.mockResolvedValue({ error: null });
    const { input } = await mount();

    drop(input, pngFile());

    await waitFor(() => expect(upload).toHaveBeenCalled());
    const [, , options] = upload.mock.calls[0]!;
    expect(options.upsert, "x-upsert needs a SELECT policy the logos bucket lacks").toBeUndefined();
    expect(options.contentType).toBe("image/png");
  });

  it("hands back the public URL and clears the pending state on success", async () => {
    upload.mockResolvedValue({ error: null });
    const { input, onChange } = await mount();

    drop(input, pngFile());

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("https://cdn.example/logos/user-1/logo-1.png"),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Upload logo" })).toBeTruthy(),
    );
  });
});

describe("the three branches above it keep their own words", () => {
  // Each returns early with its own message, which is why none of them can
  // produce the generic string — and why "it fails on every case" points at the
  // storage call rather than at these.
  it("names the accepted formats for a rejected type", async () => {
    upload.mockClear();
    const { input } = await mount();

    drop(input, pngFile({ type: "image/heic" }));

    await waitFor(() =>
      expect(screen.getByText("Use a PNG, JPG or WebP image.")).toBeTruthy(),
    );
    expect(upload, "a rejected type must never reach storage").not.toHaveBeenCalled();
  });

  it("names the size limit for an oversize file", async () => {
    upload.mockClear();
    const { input } = await mount();

    drop(input, pngFile({ size: 3 * 1024 * 1024 }));

    await waitFor(() => expect(screen.getByText("Keep the file under 2MB.")).toBeTruthy());
    expect(upload).not.toHaveBeenCalled();
  });

  it("asks for a sign-in when the session is gone", async () => {
    upload.mockClear();
    getUser.mockResolvedValueOnce({ data: { user: null } } as never);
    const { input } = await mount();

    drop(input, pngFile());

    await waitFor(() => expect(screen.getByText("Sign in again to upload.")).toBeTruthy());
    expect(upload).not.toHaveBeenCalled();
  });
});
