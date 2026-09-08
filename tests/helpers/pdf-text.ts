// Reads the words out of a PDF document component, so a test can assert on
// what the document SAYS.
//
// The obvious approaches don't work. `renderToBuffer` produces compressed
// streams, so the rendered text is not findable in the bytes — a search for
// "Customer signature" in a document that plainly contains it returns false,
// which is worse than no check at all. And Testing Library cannot mount these:
// @react-pdf/renderer's Document/Page/View/Text are its own host elements, not
// DOM ones.
//
// So this walks the element tree the component returns, invoking composite
// components (PdfFooter, PartyBlock, MadeWithMotko …) as it meets them, and
// concatenates every string it finds. That is the document's text content —
// what a reader sees — rather than the source that produced it.
//
// It cannot see text supplied by a `render` callback (the fixed page-number
// footer), which takes render-time arguments this walker has no business
// inventing. Nothing asserted through it should depend on those.

import { isValidElement, type ReactElement, type ReactNode } from "react";

type ElementProps = { children?: ReactNode };

export const pdfText = (node: ReactNode): string => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(pdfText).join(" ");

  if (isValidElement(node)) {
    const element = node as ReactElement<ElementProps>;
    if (typeof element.type === "function") {
      const render = element.type as (props: unknown) => ReactNode;
      return pdfText(render(element.props));
    }
    return pdfText(element.props?.children);
  }

  return "";
};

/** Collapses runs of whitespace so an assertion can quote a sentence normally. */
export const pdfProse = (node: ReactNode): string => pdfText(node).replace(/\s+/g, " ").trim();
