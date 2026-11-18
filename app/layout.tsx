import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "BizOS — AI Business Operating System", template: "%s · BizOS" },
  description: "Leads, calls, sales, invoices and payments — one AI-powered platform.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen font-sans antialiased" suppressHydrationWarning>{children}</body>
    </html>
  );
}
