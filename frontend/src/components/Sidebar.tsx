import Link from "next/link";
import { LayoutGrid, Package, Wallet, History, type LucideIcon } from "lucide-react";
import { cn } from "cn";

function NavRow({
  href,
  icon: Icon,
  label,
  active,
  badge,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  active?: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg border-l-2 px-3 py-2 text-sm transition-colors",
        active
          ? "border-primary bg-background font-medium text-foreground shadow-sm"
          : "border-transparent text-muted-foreground hover:bg-background/60 hover:text-foreground"
      )}
    >
      <span className="flex items-center gap-2">
        <Icon className={cn("size-4", active && "text-primary")} />
        {label}
      </span>
      {badge !== undefined && badge > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-[11px] font-medium text-primary">
          {badge}
        </span>
      )}
    </Link>
  );
}

export function Sidebar({ splitCount }: { splitCount: number }) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col gap-1 self-start rounded-2xl bg-muted/60 p-3 lg:sticky lg:top-6 lg:flex">
      <Link href="/" className="mb-3 flex items-center gap-2 px-1 pt-1">
        <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-base">🧩</span>
        <span className="font-semibold tracking-tight">FinTessa</span>
      </Link>

      <p className="px-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Menu</p>
      <NavRow href="#overview" icon={LayoutGrid} label="Overview" active />

      <div className="mt-2">
        <div className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-foreground">
          <Package className="size-4 text-muted-foreground" />
          Basket
        </div>
        <div className="ml-[15px] flex flex-col gap-0.5 border-l border-border pl-4">
          <NavRow href="#balances" icon={Wallet} label="Balances" />
          <NavRow href="#activity" icon={History} label="Recent splits" badge={splitCount} />
        </div>
      </div>
    </aside>
  );
}
