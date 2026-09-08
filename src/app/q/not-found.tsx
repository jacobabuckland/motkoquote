// Customer-facing 404 for /q. Reached by `notFound()` in the page below —
// an unknown id, a truncated link, or a document that is no longer publicly
// available. Must not distinguish those; see the component.
import { CustomerLinkNotFound } from "@/components/customer/link-not-found";

export default function QuoteLinkNotFound() {
  return <CustomerLinkNotFound document="quote" />;
}
