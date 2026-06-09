import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { logoutAction } from "./actions";

export const metadata: Metadata = {
  title: "HouseScore",
  description: "A personal real estate decision engine",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen">
          <header className="border-b border-slate-200 bg-white">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
              <Link href="/" className="text-lg font-semibold text-brand">
                🏡 HouseScore
              </Link>
              <nav className="flex items-center gap-4 text-sm">
                <Link href="/" className="hover:text-brand">
                  Houses
                </Link>
                <Link href="/compare" className="hover:text-brand">
                  Compare
                </Link>
                <Link href="/map" className="hover:text-brand">
                  Map
                </Link>
                <Link href="/places" className="hover:text-brand">
                  Places
                </Link>
                <Link href="/archived" className="hover:text-brand">
                  Archived
                </Link>
                <Link href="/properties/new" className="btn">
                  + Add house
                </Link>
                <form action={logoutAction}>
                  <button className="text-slate-400 hover:text-slate-700">
                    Sign out
                  </button>
                </form>
              </nav>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
