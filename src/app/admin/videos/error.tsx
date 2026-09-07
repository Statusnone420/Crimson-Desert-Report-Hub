"use client";

export default function VideoReviewError({ error }: { error: Error & { digest?: string } }) {
  return (
    <div className="dispatch-container" style={{ paddingBlock: 40 }}>
      <p className="dispatch-kicker dispatch-kicker--amber">Operator · Watch inbox</p>
      <h1 className="dispatch-pagehead__title" style={{ fontSize: 36 }}>
        Video review could not finish
      </h1>
      <p className="op-unavailable" role="alert">
        {error.message || "The private inbox write failed. Reload and try again."}
      </p>
    </div>
  );
}
