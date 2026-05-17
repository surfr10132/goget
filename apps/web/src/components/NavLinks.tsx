"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/orders", label: "Orders" },
  { href: "/account", label: "Account" },
];

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="text-sm flex gap-4">
      {LINKS.map(({ href, label }) => {
        const active = path.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={active ? "text-brand-600 font-semibold" : "text-gray-600 hover:text-gray-900"}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
