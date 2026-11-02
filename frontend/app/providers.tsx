"use client";
import { ReactNode } from "react";
import { LanguageProvider } from "./context/LanguageContext";
import { ExtractionProvider } from "./context/ExtractionContext";
import { ToastProvider } from "./components/ui";

// Regroupe les "contextes" partagés par toutes les pages
export function Providers({ children }: { children: ReactNode }) {
  return (
    <LanguageProvider>
      <ExtractionProvider>
        <ToastProvider>{children}</ToastProvider>
      </ExtractionProvider>
    </LanguageProvider>
  );
}