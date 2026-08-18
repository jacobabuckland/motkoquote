import { getMoneyPosition } from "./money-position-actions";
import { MoneyPositionClient } from "./money-position-client";

/**
 * Server component wrapper for MoneyPosition.
 * Fetches data server-side and passes to client component for rendering.
 * All amounts server-computed in pence, converted to pounds in the client.
 */
export async function MoneyPosition() {
  const position = await getMoneyPosition();
  return <MoneyPositionClient position={position} />;
}
