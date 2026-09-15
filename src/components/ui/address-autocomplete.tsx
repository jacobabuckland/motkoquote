"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
} from "react";
import type { StructuredAddress } from "@/lib/schemas/address";
import { rawAddress } from "@/lib/schemas/address";
import {
  loadGetAddressLibrary,
  addressToStructuredAddress,
} from "@/lib/getaddress";

type Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type"
> & {
  label: string;
  // The formatted, one-line address shown in the field.
  value: string;
  // Fires on every change: on free-text keystrokes with just { formatted },
  // and on dropdown selection with the full structured address.
  onChange: (address: StructuredAddress) => void;
  error?: string;
  hint?: string;
};

const DEBOUNCE_MS = 250;

type GetAddressSuggestion = {
  id: string;
  address: string;
};

// A single visible text field with a getAddress.io autocomplete dropdown,
// for UK addresses. Styled to match <Input>. Fully degradable: with no API
// key or a failed fetch it behaves as a plain text input, and free text the
// contractor types (ignoring the dropdown) always flows through onChange as
// a valid address — selection is never required.
export const AddressAutocomplete = ({
  label,
  value,
  onChange,
  error,
  hint,
  id,
  className = "",
  onBlur,
  onKeyDown,
  ...props
}: Props) => {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listboxId = `${inputId}-listbox`;

  const [suggestions, setSuggestions] = useState<GetAddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // getAddress.io client, resolved lazily on first use.
  const clientRef = useRef<Awaited<ReturnType<typeof loadGetAddressLibrary>>>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Guards against a slow fetch resolving after the input was cleared/changed.
  const latestQueryRef = useRef("");
  // Guards against a slow fetch resolving after the list was DISMISSED, which
  // the query string alone cannot see: clicking away does not change what was
  // typed, so a response issued before the click passed the check below and
  // reopened a list the user had just closed. Every deliberate close bumps
  // this, so any request already in flight is stale by definition.
  const dropdownGenerationRef = useRef(0);

  // Close the list, and disown anything still in flight. Always use this
  // rather than a bare setOpen(false) — a close that does not invalidate the
  // outstanding request is the bug this exists to prevent.
  const closeDropdown = () => {
    dropdownGenerationRef.current += 1;
    // A lookup that has been debounced but not yet issued is abandoned too.
    // Without this, clicking away inside the debounce window leaves a request
    // that has not started — so there is no generation for the guard above to
    // invalidate, and the list opens under the cursor of someone who has
    // already moved on.
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setOpen(false);
  };

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Close the dropdown when clicking away.
  //
  // Attached for the component's whole life rather than only while the list is
  // open, and both halves of that matter:
  //
  //   * While it was keyed on `open`, there was a window where the list had
  //     rendered but the effect had not run yet — the state change came from a
  //     resolved promise rather than an event, so React schedules the effect
  //     asynchronously. A click landing in that window hit no listener at all
  //     and the list stayed open. That is the CI failure in
  //     tests/acceptance/676.test.tsx, which passes locally every time because
  //     the mocked fetch resolves long before the click.
  //   * A click while the list is CLOSED but a lookup is in flight has to
  //     count too. Otherwise the response arrives afterwards and opens a list
  //     under the cursor of someone who has already moved on.
  //
  // Closing an already-closed list is a no-op beyond bumping the generation,
  // which is precisely what the second case needs.
  useEffect(() => {
    const onDocPointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) closeDropdown();
    };
    document.addEventListener("pointerdown", onDocPointer);
    return () => document.removeEventListener("pointerdown", onDocPointer);
  }, []);

  const fetchSuggestions = async (input: string) => {
    // Read BEFORE the first await, so a dismissal during either await is seen.
    const generation = dropdownGenerationRef.current;

    if (!clientRef.current) clientRef.current = await loadGetAddressLibrary();
    const client = clientRef.current;
    if (!client) return; // Client unavailable — stay a plain text field.

    try {
      const next = await client.autocomplete(input);
      // Drop stale responses if the input moved on while we were awaiting.
      if (latestQueryRef.current !== input) return;
      // Or if the list was dismissed while we were awaiting. The query is
      // unchanged in that case, so the check above cannot see it.
      if (dropdownGenerationRef.current !== generation) return;
      setSuggestions(next);
      setActiveIndex(-1);
      setOpen(next.length > 0);
    } catch {
      setSuggestions([]);
      closeDropdown();
    }
  };

  const handleInput = (text: string) => {
    // Raw text is always a valid address, structured components cleared until
    // (and unless) the contractor picks a suggestion.
    onChange(rawAddress(text));
    latestQueryRef.current = text;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 3) {
      setSuggestions([]);
      closeDropdown();
      return;
    }
    debounceRef.current = setTimeout(() => void fetchSuggestions(text), DEBOUNCE_MS);
  };

  const selectSuggestion = async (suggestion: GetAddressSuggestion) => {
    if (!clientRef.current) return;

    closeDropdown();
    setSuggestions([]);

    // Show the suggestion's text immediately — full address fetch happens in background.
    onChange(rawAddress(suggestion.address));

    try {
      const fullAddress = await clientRef.current.get(suggestion.id);
      if (fullAddress) {
        onChange(addressToStructuredAddress(fullAddress));
      }
      // If detail fetch fails, the immediate text is already showing — no further update needed.
    } catch {
      // Detail fetch failed — immediate text is already showing, nothing more to do.
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (!open || suggestions.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      const chosen = suggestions[activeIndex];
      if (chosen) void selectSuggestion(chosen);
    } else if (event.key === "Escape") {
      closeDropdown();
    }
  };

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1.5">
      <label htmlFor={inputId} className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-text-secondary">{label}</span>
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-invalid={Boolean(error)}
          autoComplete="off"
          value={value}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={onBlur}
          className={`h-11 w-full rounded-control border bg-surface px-3 text-sm text-foreground ${
            error ? "border-error" : "border-border"
          } ${className}`}
          {...props}
        />
      </label>

      {open && suggestions.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute top-full z-10 mt-1 w-full divide-y divide-border overflow-hidden rounded-card border border-border bg-surface text-sm shadow-elevated"
        >
          {suggestions.map((suggestion, index) => {
            return (
              <li key={suggestion.id} role="option" aria-selected={index === activeIndex}>
                <button
                  type="button"
                  // onMouseDown (not onClick) so the selection fires before the
                  // input's blur closes the dropdown.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void selectSuggestion(suggestion);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex min-h-11 w-full items-center px-3 py-2 text-left ${
                    index === activeIndex ? "bg-surface-hover" : "hover:bg-surface-hover"
                  }`}
                >
                  {suggestion.address}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {error && <span className="text-xs text-error">{error}</span>}
      {!error && hint && <span className="text-xs text-text-muted">{hint}</span>}
    </div>
  );
};
