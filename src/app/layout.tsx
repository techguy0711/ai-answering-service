import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Answering Service",
  description: "AI phone receptionist for boutique service businesses.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background antialiased">{children}</body>
    </html>
  );
}
