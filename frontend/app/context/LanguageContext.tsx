"use client";
import { createContext, useContext, useState, ReactNode } from "react";

export type Lang = "fr" | "en";

interface LanguageContextType {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (fr: string, en: string) => string;
}

const LanguageContext = createContext<LanguageContextType>({
  lang: "fr",
  setLang: () => {},
  t: (fr) => fr,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>("fr");
  const t = (fr: string, en: string) => (lang === "fr" ? fr : en);
  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLang = () => useContext(LanguageContext);