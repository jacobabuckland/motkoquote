// Customer-facing 404 for /c. Reached by `notFound()` in the page below —
// an unknown id, a truncated link, or a document that is no longer publicly
// available. Must not distinguish those; see the component.
import { CustomerLinkNotFound } from "@/components/customer/link-not-found";

export default function ContractLinkNotFound() {
  return <CustomerLinkNotFound document="contract" />;
}
