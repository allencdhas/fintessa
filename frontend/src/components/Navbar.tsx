"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";

const NAV_LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#tech", label: "Tech" },
];

export function Navbar() {
  const pathname = usePathname();

  // The dashboard owns its own navigation (a sidebar) and its own wallet-connect control —
  // the floating marketing navbar would just be duplicate chrome there.
  if (pathname?.startsWith("/app")) return null;

  return (
    <header className="sticky top-3 z-50 px-3 sm:top-4 sm:px-4">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 rounded-full border border-border/60 bg-background/75 px-3 py-2 shadow-sm shadow-black/[0.03] backdrop-blur-md supports-[backdrop-filter]:bg-background/60">
        <Link href="/" className="flex shrink-0 items-center gap-2 pl-1 font-semibold tracking-tight">
          <span aria-hidden className="text-lg leading-none">
            🧩
          </span>
          <span className="hidden sm:inline">FinTessa</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <Button key={link.href} asChild variant="ghost" size="sm" className="rounded-full text-muted-foreground">
              <Link href={link.href}>{link.label}</Link>
            </Button>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <Button asChild size="sm" className="rounded-full">
            <Link href="/app">Launch App</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
