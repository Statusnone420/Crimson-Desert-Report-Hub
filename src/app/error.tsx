"use client";

// Route-level error surface. Client component, so it composes the dispatch
// language directly instead of importing the server chrome.
export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <>
      <div className="dispatch-topline" aria-hidden="true" />
      <main id="main-content" className="dispatch-container" style={{ paddingBlock: 64, minHeight: "60vh" }}>
        <p className="dispatch-kicker">Server error</p>
        <h1 className="dispatch-pagehead__title" style={{ marginTop: 14 }}>
          Something broke on our side.
        </h1>
        <p className="dispatch-pagehead__dek" style={{ marginTop: 14 }}>
          The board never fills in blanks — nothing was published or counted from this failure.
        </p>
        <button type="button" className="dispatch-btn" style={{ marginTop: 24 }} onClick={() => reset()}>
          Try again
        </button>
      </main>
    </>
  );
}
