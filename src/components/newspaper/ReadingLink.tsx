import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";

type Direction = "forward" | "back" | "up" | "down" | "external";

export function DirectionIcon({ direction = "forward" }: { direction?: Direction }) {
  return (
    <span className={`reading-link__icon reading-link__icon--${direction}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14m-6-6 6 6-6 6" />
      </svg>
    </span>
  );
}

type ReadingLinkProps = ComponentPropsWithoutRef<"a"> & {
  href: string;
  variant?: "action" | "quiet" | "source";
  direction?: Direction;
  /** Visible provenance for a standalone source, never added to inline prose. */
  source?: string;
  /** Feeds and downloads use the browser rather than the page router. */
  native?: boolean;
};

/** Native anchors with a shared visual vocabulary; only internal pages use Next Link. */
export function ReadingLink({ href, children, className = "", variant = "action", direction, source, native = false, target, rel, ...props }: ReadingLinkProps) {
  const external = /^(https?:)?\/\//.test(href);
  const content = <><span className="reading-link__copy"><span className="reading-link__label">{children}</span>{source ? <span className="reading-link__source">{source}</span> : null}</span><DirectionIcon direction={direction ?? (external ? "external" : "forward")} /></>;
  const shared = {
    ...props,
    href,
    className: `reading-link reading-link--${variant} ${className}`.trim(),
    target: target ?? (external ? "_blank" : undefined),
    rel: rel ?? (external ? "noreferrer noopener" : undefined),
  };
  return href.startsWith("/") && !href.startsWith("//") && !native && props.download === undefined
    ? <Link {...shared}>{content}</Link>
    : <a {...shared}>{content}</a>;
}
