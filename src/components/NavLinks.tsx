"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/issues", label: "Issues" },
  { href: "/report", label: "Report" },
  { href: "/about", label: "About" },
  { href: "/scanner", label: "Scanner" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    // One line at every width: on phones this is a full-bleed strip that scrolls
    // sideways if it must, instead of wrapping into orphan rows.
    <nav
      className="nav-scroll -mx-4 flex items-center gap-1 overflow-x-auto whitespace-nowrap px-4 text-sm sm:mx-0 sm:px-0"
      aria-label="Primary"
    >
      {NAV.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className="nav-link"
            data-active={active}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
