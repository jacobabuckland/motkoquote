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
  createSessionToken,
  loadPlacesLibrary,
  placeToStructuredAddress,
  type AutocompleteSuggestion,
} from "@/lib/google-maps";

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

// A single visible text field with a Google Places (New) autocomplete
// dropdown, restricted to GB. Styled to match <Input>. Fully degradable:
// with no API key or a failed script load it behaves as a plain text input,
// and free text the contractor types (ignoring the dropdown) always flows
// through onChange as a valid address — selection is never required.
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

  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Places library + per-search session token, resolved lazily on first use.
  const placesRef = useRef<Awaited<ReturnType<typeof loadPlacesLibrary>>>(null);
  const sessionTokenRef = useRef<object | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Guards against a slow fetch resolving after the input was cleared/changed.
  const latestQueryRef = useRef("");

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Close the dropdown when clicking away.
  useEffect(() => {
    if (!open) return;
    const onDocPointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDocPointer);
    return () => document.removeEventListener("pointerdown", onDocPointer);
  }, [open]);

  const fetchSuggestions = async (input: string) => {
    if (!placesRef.current) placesRef.current = await loadPlacesLibrary();
    const places = placesRef.current;
    if (!places) return; // Places unavailable — stay a plain text field.

    if (!sessionTokenRef.current) {
      sessionTokenRef.current = createSessionToken(places);
    }

    try {
      const { suggestions: next } =
        await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input,
          includedRegionCodes: ["gb"],
          sessionToken: sessionTokenRef.current,
        });
      // Drop stale responses if the input moved on while we were awaiting.
      if (latestQueryRef.current !== input) return;
      const withPredictions = next.filter((s) => s.placePrediction);
      setSuggestions(withPredictions);
      setActiveIndex(-1);
      setOpen(withPredictions.length > 0);
    } catch {
      setSuggestions([]);
      setOpen(false);
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
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(() => void fetchSuggestions(text), DEBOUNCE_MS);
  };

  const selectSuggestion = async (suggestion: AutocompleteSuggestion) => {
    const prediction = suggestion.placePrediction;
    if (!prediction) return;

    setOpen(false);
    setSuggestions([]);

    const place = prediction.toPlace();
    try {
      await place.fetchFields({
        fields: ["id", "formattedAddress", "addressComponents", "location"],
      });
      onChange(placeToStructuredAddress(place));
    } catch {
      // Detail fetch failed — keep the prediction's own text so the field
      // still holds a usable formatted address.
      onChange(rawAddress(prediction.text.toString()));
    }
    // A session ends when a place is picked — start a fresh one next search.
    sessionTokenRef.current = null;
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
      setOpen(false);
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
            const prediction = suggestion.placePrediction;
            if (!prediction) return null;
            return (
              <li key={prediction.placeId} role="option" aria-selected={index === activeIndex}>
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
                  {prediction.text.toString()}
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
