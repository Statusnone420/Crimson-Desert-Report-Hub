export type VideoActionState = {
  status: "idle" | "success" | "error" | "transport_error";
  code: "none" | "validation" | "stale" | "duplicate" | "invalid_state" | "unavailable" | "transport";
  message: string;
};

export const initialVideoActionState: VideoActionState = {
  status: "idle",
  code: "none",
  message: "",
};

