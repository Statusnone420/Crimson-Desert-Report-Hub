import Link from "next/link";
import { PublicShell } from "@/components/dispatch/Chrome";

export default function NotFound() {
  return (
    <PublicShell>
      <div className="dispatch-container" style={{ paddingBlock: 64, minHeight: "50vh" }}>
        <p className="dispatch-kicker">404 · Not on the board</p>
        <h1 className="dispatch-pagehead__title" style={{ marginTop: 14 }}>
          This page isn&apos;t tracked.
        </h1>
        <p className="dispatch-pagehead__dek" style={{ marginTop: 14 }}>
          The address doesn&apos;t match anything the board publishes.{" "}
          <Link href="/" className="dispatch-link">
            Return to the Brief →
          </Link>
        </p>
      </div>
    </PublicShell>
  );
}
