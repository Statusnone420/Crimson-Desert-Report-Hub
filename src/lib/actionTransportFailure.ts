export const ACTION_TRANSPORT_FAILURE_MESSAGE = "Save not confirmed; connection failed; request may have completed, reload current records before retrying.";

/** Only browser dispatch failures belong in a recoverable client form state. */
export function isActionTransportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "NetworkError") return true;
  return error instanceof TypeError && /^(Failed to fetch|Load failed)$/i.test(error.message.trim());
}
