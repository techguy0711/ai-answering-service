"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Calendar,
  Scissors,
  Phone,
  ClipboardList,
  Settings,
  CreditCard,
} from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/services", label: "Services", icon: Scissors },
  { href: "/calls", label: "Calls", icon: Phone },
  { href: "/appointments", label: "Appointments", icon: ClipboardList },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/billing", label: "Billing", icon: CreditCard },
] as const;

export function Sidebar({ tenantName }: { tenantName: string }) {
  const pathname = usePathname();

  return (
    <aside className="flex w-64 flex-col border-r bg-muted/40 p-4">
      <div className="mb-6 px-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Tenant
        </p>
        <p className="truncate text-sm font-semibold">{tenantName}</p>
      </div>
      <nav className="flex flex-1 flex-col gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
