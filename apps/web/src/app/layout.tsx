import "./globals.css";
import type { Metadata } from "next";
import { NavLinks } from "@/components/NavLinks";

export const metadata: Metadata = {
  title: "GoGet — find anything in Indonesia",
  description: "Hard-to-find items, picked up from any store, delivered by GoSend or Grab.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="min-h-screen bg-white text-gray-900 font-sans">
        <header className="border-b border-gray-100">
          <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
            <a href="/" className="flex items-center gap-2 font-semibold">
              <span className="inline-block w-7 h-7 rounded-lg bg-brand-500 text-white grid place-items-center">G</span>
              GoGet
            </a>
            <NavLinks />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
        <footer className="mt-16 border-t border-gray-100 py-6 text-center text-xs text-gray-500">
          GoGet · Made in Indonesia · GoSend &amp; Grab partner
        </footer>
      </body>
    </html>
  );
}
