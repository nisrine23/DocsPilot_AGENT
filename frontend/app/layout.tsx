import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { NavBar, TopBar } from "./components/NavBar";

// Inter : la police du projet DPRO
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "DocsPilot",
  description: "Extraction de fiches techniques de pompes et agent d'analyse",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={inter.variable}>
      <body className="antialiased">
        <Providers>
          {/* Même structure que DPRO : barre latérale + (barre du haut, contenu) */}
          <div className="flex min-h-screen">
            <NavBar />
            <div className="flex-1 min-w-0 flex flex-col">
              <TopBar />
              <main className="flex-1 p-4 md:p-6">
                <div className="max-w-7xl mx-auto">{children}</div>
              </main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}