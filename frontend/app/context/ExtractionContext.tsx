"use client";
import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";

// Sauvegarde dans sessionStorage : les données survivent à un rafraîchissement de page
function writeStorage(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function usePersisted<T>(key: string, fallback: T) {
  const [state, setState] = useState<T>(fallback);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) setState(JSON.parse(raw) as T);
    } catch {}
    setHydrated(true);
  }, [key]);

  useEffect(() => {
    if (!hydrated) return;
    writeStorage(key, state);
  }, [key, state, hydrated]);

  return [state, setState] as const;
}

interface ExtractionContextType {
  data: any[];
  setData: React.Dispatch<React.SetStateAction<any[]>>;
  deleteSuggestions: any[];
  setDeleteSuggestions: React.Dispatch<React.SetStateAction<any[]>>;
  excludedPages: any[];
  setExcludedPages: React.Dispatch<React.SetStateAction<any[]>>;
  extractedResults: any[] | null;
  setExtractedResults: React.Dispatch<React.SetStateAction<any[] | null>>;
  openBlocks: Record<number, boolean>;
  setOpenBlocks: React.Dispatch<React.SetStateAction<Record<number, boolean>>>;
  filterDone: boolean;
  setFilterDone: React.Dispatch<React.SetStateAction<boolean>>;
}

const ExtractionContext = createContext<ExtractionContextType | null>(null);

export function ExtractionProvider({ children }: { children: ReactNode }) {
  const [data,              setData]              = usePersisted<any[]>("docspilot_data", []);
  const [deleteSuggestions, setDeleteSuggestions] = usePersisted<any[]>("docspilot_deleteSuggestions", []);
  const [excludedPages,     setExcludedPages]     = usePersisted<any[]>("docspilot_excludedPages", []);
  const [extractedResults,  setExtractedResults]  = usePersisted<any[] | null>("docspilot_extractedResults", null);
  const [openBlocks,        setOpenBlocks]        = usePersisted<Record<number, boolean>>("docspilot_openBlocks", { 1: true, 2: true, 3: true, 4: false });
  const [filterDone,        setFilterDone]        = usePersisted<boolean>("docspilot_filterDone", false);

  return (
    <ExtractionContext.Provider value={{
      data, setData,
      deleteSuggestions, setDeleteSuggestions,
      excludedPages, setExcludedPages,
      extractedResults, setExtractedResults,
      openBlocks, setOpenBlocks,
      filterDone, setFilterDone,
    }}>
      {children}
    </ExtractionContext.Provider>
  );
}

export const useExtraction = () => {
  const context = useContext(ExtractionContext);
  if (!context) throw new Error("useExtraction doit être utilisé dans un ExtractionProvider");
  return context;
};