import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { dbAdmin } from "@/lib/db";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  // Tenant lookup is admin-scope (we have the id, just need the name).
  const tenant = await dbAdmin.tenant.findUnique({
    where: { id: session.user.tenantId },
    select: { name: true },
  });

  return (
    <div className="flex min-h-screen">
      <Sidebar tenantName={tenant?.name ?? "Unknown"} />
      <div className="flex flex-1 flex-col">
        <Topbar email={session.user.email ?? ""} />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
