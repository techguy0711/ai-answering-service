// Seeds a demo tenant with a barbershop catalog and an OWNER user.
// Usage: npm run db:seed
//
// Login after seeding:
//   email:    owner@miamicuts.test
//   password: barbershop123

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: "miami-cuts" },
    update: {},
    create: {
      name: "Miami Cuts",
      slug: "miami-cuts",
      billingStatus: "TRIALING",
    },
  });

  const passwordHash = await bcrypt.hash("barbershop123", 10);

  await prisma.user.upsert({
    where: { email: "owner@miamicuts.test" },
    update: {},
    create: {
      email: "owner@miamicuts.test",
      passwordHash,
      role: "OWNER",
      tenantId: tenant.id,
    },
  });

  // Barbershop starter catalog.
  const services = [
    { name: "Haircut", durationMinutes: 30, priceCents: 3500 },
    { name: "Beard trim", durationMinutes: 15, priceCents: 1500 },
    { name: "Cut + beard", durationMinutes: 45, priceCents: 4500 },
    { name: "Kids cut", durationMinutes: 25, priceCents: 2500 },
    { name: "Shape-up / line-up", durationMinutes: 15, priceCents: 1500 },
  ];

  for (const svc of services) {
    const existing = await prisma.service.findFirst({
      where: { tenantId: tenant.id, name: svc.name },
    });
    if (!existing) {
      await prisma.service.create({
        data: { ...svc, tenantId: tenant.id },
      });
    }
  }

  console.log(`Seeded tenant: ${tenant.name} (${tenant.id})`);
  console.log("Login: owner@miamicuts.test / barbershop123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
