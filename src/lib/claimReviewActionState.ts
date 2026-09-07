export type ClaimReviewActionState = {
  status: "idle" | "success" | "unavailable" | "stale" | "validation_error" | "error" | "transport_error";
  message: string | null;
  itemId: string | null;
  revision: number | null;
};

export const initialClaimReviewActionState: ClaimReviewActionState = {
  status: "idle",
  message: null,
  itemId: null,
  revision: null,
};
