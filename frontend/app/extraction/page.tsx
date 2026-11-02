"use client";
import { useState, useEffect, useMemo, useRef, DragEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Upload, FileText, X, Pencil, Check, ArrowRight, Download,
  RotateCcw, ScanSearch, Cpu, BookOpen, Plus, Undo2, ChevronLeft, ChevronRight,
} from "lucide-react";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useExtraction } from "../context/ExtractionContext";
import { useLang } from "../context/LanguageContext";
import { CitationBadge } from "../components/CitationBadge";
import {
  Button, Card, PageHeader, SectionTitle, Badge, ProgressBar, EmptyState,
  Tabs, Menu, Stepper, StepStatus, useToast, cx,
} from "../components/ui";
import { API } from "../lib/api";

type ManualEntry = { value: string; source: string };
type ManualMap = Record<string, ManualEntry>;

const MISSING_VALUES_LIST = ["", "n/a", "none", "null", "undefined", "non spécifié", "non specifié", "non spécifiée", "non défini", "non définie", "inconnu", "inconnue", "not specified", "not available", "na", "-", "--", "---"];
const isMissingValue = (v: any) => !v || MISSING_VALUES_LIST.includes(String(v).trim().toLowerCase());

const CATEGORY_LABELS: Record<string, { fr: string; en: string }> = {
  Identification:                { fr: "Identification", en: "Identification" },
  Caracteristiques_du_produit:   { fr: "Produit",         en: "Product" },
  Caracteristiques_hydrauliques: { fr: "Hydraulique",     en: "Hydraulics" },
  Caracteristiques_mecaniques:   { fr: "Mécanique",       en: "Mechanics" },
  Materiau:                      { fr: "Matériaux",       en: "Materials" },
  Conditions_de_fonctionnement:  { fr: "Fonctionnement",  en: "Operation" },
  Peinture:                      { fr: "Peinture",        en: "Paint" },
  Autres:                        { fr: "Autres",          en: "Other" },
};
const prettify = (s: string) => s.replace(/_/g, " ").trim();

/* Lit "Fichier 1/2 : x - Conversion Page 3/12" → pourcentage global */
function progressFrom(text: string) {
  const f = text.match(/Fichier\s+(\d+)\/(\d+)/i);
  const p = text.match(/Page\s+(\d+)\/(\d+)/i);
  if (!f) return 3;
  const [fi, fn] = [Number(f[1]), Number(f[2])];
  const inFile = p ? Number(p[1]) / Number(p[2]) : 0.05;
  return Math.max(3, ((fi - 1 + inFile) / fn) * 100);
}

/* ─── Cellule de valeur : affichage, correction, saisie si absente ───── */
function ValueCell({ value, isManual, isMissing, citation, onSave }: {
  value: string; isManual: boolean; isMissing: boolean; citation: React.ReactNode;
  onSave: (value: string, source?: string) => void;
}) {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftSource, setDraftSource] = useState("");

  const open = () => { setDraft(isMissing ? "" : value); setDraftSource(""); setEditing(true); };
  const save = () => {
    const v = draft.trim();
    if (v) onSave(v, isMissing ? (draftSource.trim() || undefined) : undefined);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
          placeholder={t("Valeur", "Value")} aria-label={t("Valeur", "Value")}
          className="h-9 min-w-0 flex-1 px-3 text-sm border border-[var(--border)] rounded-lg focus:border-navy outline-none" />
        {isMissing && (
          <input value={draftSource} onChange={e => setDraftSource(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
            placeholder={t("Source (ex. fiche.pdf - Page 3)", "Source (e.g. sheet.pdf - Page 3)")} aria-label="Source"
            className="h-9 w-56 px-3 text-sm border border-[var(--border)] rounded-lg focus:border-navy outline-none" />
        )}
        <Button size="sm" variant="primary" onClick={save} icon={<Check size={14} aria-hidden />}>{t("Enregistrer", "Save")}</Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>{t("Annuler", "Cancel")}</Button>
      </div>
    );
  }

  if (isMissing) {
    return (
      <div className="flex items-center gap-2">
        <Badge tone="warning">{t("Non trouvé dans les documents", "Not found in documents")}</Badge>
        <Button size="sm" variant="ghost" onClick={open} icon={<Plus size={14} aria-hidden />}>{t("Saisir", "Enter")}</Button>
      </div>
    );
  }

  return (
    <div className="group flex flex-wrap items-center gap-1.5">
      <span className="font-semibold text-navy">{value}</span>
      {isManual && <Badge tone="cyan">{t("Corrigé", "Edited")}</Badge>}
      {citation}
      <button onClick={open} aria-label={t("Corriger la valeur", "Edit value")}
        className="p-1 rounded-md text-slate-300 hover:text-navy hover:bg-slate-100 opacity-60 group-hover:opacity-100 focus:opacity-100">
        <Pencil size={13} />
      </button>
    </div>
  );
}

export default function ExtractionPage() {
  const { t, lang } = useLang();
  const toast = useToast();
  const {
    data, setData, deleteSuggestions, setDeleteSuggestions,
    excludedPages, setExcludedPages, extractedResults, setExtractedResults,
    filterDone, setFilterDone,
  } = useExtraction();

  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [progressText, setProgressText] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [activePage, setActivePage] = useState(0);
  const [viewMode, setViewMode] = useState<"preview" | "markdown" | "edit">("preview");
  const [manualMap, setManualMap] = useState<ManualMap>({});
  const [activePump, setActivePump] = useState(0);
  const [activeCategory, setActiveCategory] = useState("all");
  const [missingOnly, setMissingOnly] = useState(false);
  const [lexiconSaved, setLexiconSaved] = useState(false);
  const [newFeature, setNewFeature] = useState({ category: "Identification", name: "", fr: "", en: "", others: "" });
  const fileInput = useRef<HTMLInputElement>(null);

  // Étape affichée au chargement : là où l'utilisateur en était
  useEffect(() => {
    setMounted(true);
    try {
      if (sessionStorage.getItem("docspilot_extractedResults") && sessionStorage.getItem("docspilot_extractedResults") !== "null") setStep(3);
      else if (sessionStorage.getItem("docspilot_filterDone") === "true") setStep(2);
    } catch {}
  }, []);
  useEffect(() => { setManualMap({}); setActivePump(0); }, [extractedResults]);

  const pageId = (p: any) => p.fileName + p.page;
  const keptPages = data.filter((p: any) => !excludedPages.includes(pageId(p)));

  /* ─── Fichiers ─────────────────────────────────────────────────────── */
  const addFiles = (files: File[]) => {
    const ok = files.filter(f => /\.(pdf|docx|xlsx|xls)$/i.test(f.name));
    if (ok.length < files.length) toast(t("Formats acceptés : PDF, Word (.docx), Excel.", "Accepted formats: PDF, Word (.docx), Excel."), "error");
    setSelectedFiles(prev => [...prev, ...ok.filter(f => !prev.some(p => p.name === f.name))]);
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragOver(false); addFiles(Array.from(e.dataTransfer.files)); };

  /* ─── 1. Conversion (flux NDJSON) ──────────────────────────────────── */
  const startConversion = async () => {
    if (selectedFiles.length === 0) return;
    setLoading(true); setFilterDone(false); setProgressText("");
    setData([]); setDeleteSuggestions([]); setExcludedPages([]); setExtractedResults(null);
    const formData = new FormData();
    selectedFiles.forEach(f => formData.append("files", f));
    try {
      const response = await fetch(`${API}/process-pdf`, { method: "POST", body: formData });
      const reader = response.body?.getReader();
      const decoder = new TextDecoder(); let buffer = "";
      if (reader) {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n"); buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              if (parsed.progress) setProgressText(parsed.progress);
              if (parsed.final_data) {
                setData(parsed.final_data.map((item: any) => ({ ...item, isEditing: false })));
                setSelectedFiles([]); setActivePage(0);
                toast(t(`${parsed.final_data.length} pages converties.`, `${parsed.final_data.length} pages converted.`), "success");
              }
            } catch { console.error("JSON parse:", line); }
          }
        }
      }
    } catch { toast(t("Le serveur DocsPilot ne répond pas. Vérifiez que le backend est lancé.", "The DocsPilot server is not responding. Check that the backend is running."), "error"); }
    finally { setLoading(false); setProgressText(""); }
  };

  /* ─── 2. Filtrage ──────────────────────────────────────────────────── */
  const runFiltering = async () => {
    if (data.length === 0) return;
    setFiltering(true); setFilterDone(false);
    try {
      const res = await fetch(`${API}/filter-pages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data.map((item: any) => ({ page: item.page, markdown: item.markdown, fileName: item.fileName }))),
      });
      const suggestions = await res.json();
      setDeleteSuggestions(suggestions); setFilterDone(true);
      toast(suggestions.length
        ? t(`${suggestions.length} page(s) à vérifier.`, `${suggestions.length} page(s) to review.`)
        : t("Toutes les pages semblent techniques.", "All pages look technical."), "success");
    } catch { toast(t("Le filtrage a échoué. Réessayez.", "Filtering failed. Try again."), "error"); }
    finally { setFiltering(false); }
  };
  const decide = (s: any, exclude: boolean) => {
    const id = s.fileName + s.page;
    if (exclude) setExcludedPages((prev: any[]) => [...prev, id]);
    setDeleteSuggestions((prev: any[]) => prev.filter((x: any) => (x.fileName + x.page) !== id));
  };
  const restorePage = (id: string) => setExcludedPages((prev: any[]) => prev.filter((x: string) => x !== id));

  /* ─── 3. Extraction ────────────────────────────────────────────────── */
  const runExtraction = async () => {
    if (keptPages.length === 0) { toast(t("Gardez au moins une page technique.", "Keep at least one technical page."), "error"); return; }
    setExtracting(true);
    try {
      const res = await fetch(`${API}/extract-features`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages: keptPages }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const results = await res.json();
      setExtractedResults(Array.isArray(results) ? results : [results]);
      toast(t("Extraction terminée et enregistrée.", "Extraction complete and saved."), "success");
    } catch { toast(t("L'extraction a échoué. Consultez le terminal du backend.", "Extraction failed. Check the backend terminal."), "error"); }
    finally { setExtracting(false); }
  };

  /* Correction manuelle : même route que l'ancienne page */
  const makeKey = (pi: number, cat: string, f: string) => `${pi}|${cat}|${f}`;
  const saveManual = (key: string, value: string, source?: string) => {
    const src = source ?? manualMap[key]?.source ?? "";
    setManualMap(p => ({ ...p, [key]: { value, source: src } }));
    const [pIdxStr, category, field] = key.split("|");
    const tag = extractedResults?.[parseInt(pIdxStr)]?.tag;
    if (!tag) return;
    fetch(`${API}/update-extraction-field`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag, category, field, value, source: src || "Saisi manuellement" }),
    }).then(() => toast(t("Valeur enregistrée.", "Value saved."), "success"))
      .catch(() => toast(t("Enregistrement impossible.", "Could not save."), "error"));
  };

  /* ─── 4. Lexique ───────────────────────────────────────────────────── */
  const handleUpdateLexicon = async () => {
    if (!newFeature.name.trim()) { toast(t("Donnez un nom à la caractéristique.", "Give the characteristic a name."), "error"); return; }
    try {
      const res = await fetch(`${API}/update-lexicon`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newFeature, others: newFeature.others.split(",").map(s => s.trim()).filter(Boolean) }),
      });
      const result = await res.json();
      if (res.ok && result.status === "success") {
        toast(t(`« ${newFeature.name} » ajouté au lexique.`, `"${newFeature.name}" added to the lexicon.`), "success");
        setLexiconSaved(true);
        setNewFeature({ category: newFeature.category, name: "", fr: "", en: "", others: "" });
      } else toast(t("Le lexique n'a pas pu être mis à jour.", "The lexicon could not be updated."), "error");
    } catch { toast(t("Le lexique n'a pas pu être mis à jour.", "The lexicon could not be updated."), "error"); }
  };

  /* ─── Exports (logique d'origine) ──────────────────────────────────── */
  const buildExportResults = () => {
    if (!extractedResults) return [];
    return extractedResults.map((pump: any, pIdx: number) => {
      const enriched = JSON.parse(JSON.stringify(pump));
      Object.entries(enriched.categories || {}).forEach(([cat, fields]: any) => {
        Object.keys(fields).forEach(field => {
          const entry = manualMap[makeKey(pIdx, cat, field)];
          if (entry?.value) enriched.categories[cat][field] = { valeur: entry.value, page: entry.source || "-" };
        });
      });
      return enriched;
    });
  };
  const notFound = t("cette information ne se trouve pas dans vos documents", "this information was not found in your documents");
  const exportToExcel = () => {
    const results = buildExportResults(); if (!results.length) return;
    const wb = XLSX.utils.book_new();
    results.forEach((pump: any) => {
      const rows: any[] = [
        [t("DOCSPILOT - RAPPORT D'EXTRACTION", "DOCSPILOT - EXTRACTION REPORT")],
        [`${t("Repère pompe", "Pump tag")} : ${pump.tag || "N/A"}`],
        [`${t("Date", "Date")} : ${new Date().toLocaleDateString()}`], [],
        [t("CATÉGORIE", "CATEGORY"), t("CARACTÉRISTIQUE", "CHARACTERISTIC"), t("VALEUR EXTRAITE", "EXTRACTED VALUE"), "SOURCE"],
      ];
      Object.entries(pump.categories || {}).forEach(([cat, fields]: any) => {
        Object.entries(fields).forEach(([field, info]: any) => {
          if (field === "_source_path") return;
          const raw = typeof info === "object" ? info?.valeur : info;
          rows.push([prettify(cat), prettify(field), isMissingValue(raw) ? notFound : raw, typeof info === "object" ? info?.page : "-"]);
        });
      });
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws["!cols"] = [{ wch: 25 }, { wch: 35 }, { wch: 50 }, { wch: 25 }];
      XLSX.utils.book_append_sheet(wb, ws, (pump.tag || "Pompe").substring(0, 31));
    });
    XLSX.writeFile(wb, `DocsPilot_Extraction_${Date.now()}.xlsx`);
  };
  const exportToPDF = () => {
    const results = buildExportResults(); if (!results.length) return;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    results.forEach((pump: any, pIdx: number) => {
      if (pIdx > 0) doc.addPage();
      doc.setFillColor(26, 43, 74); doc.rect(0, 0, 595, 70, "F");
      doc.setFontSize(18); doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.text("DOCSPILOT", 40, 43);
      doc.setFontSize(9); doc.setFont("helvetica", "normal");
      doc.text(`${t("Généré le", "Generated on")} ${new Date().toLocaleDateString()}`, 555, 43, { align: "right" });
      doc.setFontSize(14); doc.setTextColor(26, 43, 74); doc.setFont("helvetica", "bold");
      doc.text(`${t("Fiche pompe", "Pump sheet")} : ${pump.tag || "N/A"}`, 40, 105);
      const body: any[] = [];
      Object.entries(pump.categories || {}).forEach(([cat, fields]: any) => {
        Object.entries(fields).forEach(([field, info]: any) => {
          if (field === "_source_path") return;
          const raw = typeof info === "object" ? info?.valeur : info;
          body.push([prettify(cat), prettify(field), String(isMissingValue(raw) ? notFound : raw), typeof info === "object" ? String(info?.page ?? "-") : "-"]);
        });
      });
      autoTable(doc, {
        startY: 125,
        head: [[t("Catégorie", "Category"), t("Caractéristique", "Characteristic"), t("Valeur", "Value"), "Source"]],
        body, styles: { fontSize: 7.5, cellPadding: 5, textColor: [26, 43, 74] },
        headStyles: { fillColor: [26, 43, 74], textColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: [245, 247, 251] },
        columnStyles: { 2: { cellWidth: 200 } },
        didParseCell(d) {
          if (d.section === "body" && d.column.index === 2 && String(d.cell.raw) === notFound) {
            d.cell.styles.textColor = [176, 0, 0]; d.cell.styles.fontStyle = "italic";
          }
        },
      });
    });
    doc.save(`DocsPilot_${t("Fiches", "Sheets")}_${Date.now()}.pdf`);
  };

  const resetAll = () => {
    setData([]); setDeleteSuggestions([]); setExcludedPages([]); setExtractedResults(null); setFilterDone(false);
    setSelectedFiles([]); setStep(1);
  };

  /* ─── Données dérivées pour l'affichage ────────────────────────────── */
  const pump = extractedResults?.[activePump];
  const pumpRows = useMemo(() => {
    if (!pump?.categories) return [] as any[];
    const rows: any[] = [];
    Object.entries(pump.categories).forEach(([cat, fields]: any) => {
      Object.entries(fields || {}).forEach(([field, info]: any) => {
        if (field === "_source_path") return;
        const key = makeKey(activePump, cat, field);
        const manual = manualMap[key];
        const raw = typeof info === "object" ? info?.valeur : info;
        const value = manual?.value || raw;
        const source = manual?.value ? (manual.source || t("Saisi manuellement", "Entered manually")) : (typeof info === "object" ? info?.page ?? "" : "");
        rows.push({ key, cat, field, value, source, isManual: !!manual?.value, isMissing: isMissingValue(value) });
      });
    });
    return rows;
  }, [pump, manualMap, activePump, lang]);
  const foundCount = pumpRows.filter(r => !r.isMissing).length;
  const categories = Array.from(new Set(pumpRows.map(r => r.cat)));
  const visibleRows = pumpRows.filter(r => (activeCategory === "all" || r.cat === activeCategory) && (!missingOnly || r.isMissing));

  const steps: { id: number; title: string; hint: string; status: StepStatus; disabled?: boolean }[] = [
    { id: 1, title: t("Documents", "Documents"), hint: t("Import et conversion", "Import and conversion"), status: step === 1 ? "current" : data.length ? "done" : "todo" },
    { id: 2, title: t("Filtrage", "Filtering"), hint: t("Écarter les pages inutiles", "Set aside useless pages"), status: step === 2 ? "current" : filterDone ? "done" : "todo", disabled: !data.length },
    { id: 3, title: t("Extraction", "Extraction"), hint: t("Fiche de chaque pompe", "Sheet for each pump"), status: step === 3 ? "current" : extractedResults ? "done" : "todo", disabled: !data.length },
    { id: 4, title: t("Lexique", "Lexicon"), hint: t("Synonymes FR / EN", "FR / EN synonyms"), status: step === 4 ? "current" : lexiconSaved ? "done" : "todo" },
  ];

  const page = data[activePage];
  const multiFiles = new Set(data.map((p: any) => p.fileName)).size > 1;

  if (!mounted) return null;

  return (
    <>
      <PageHeader
        title={t("Extraction", "Extraction")}
        description={t("Importez vos fiches techniques, écartez les pages inutiles, puis obtenez la fiche de chaque pompe avec la source de chaque valeur.",
                       "Import your datasheets, set aside useless pages, then get each pump's sheet with the source of every value.")}
        actions={data.length > 0 && (
          <>
            <Badge tone="cyan">{keptPages.length} {t("pages retenues", "pages kept")}</Badge>
            <Button variant="ghost" size="sm" icon={<RotateCcw size={14} aria-hidden />} onClick={resetAll}>{t("Recommencer", "Start over")}</Button>
          </>
        )}
      />

      <div className="flex flex-col gap-6">
        {/* Étapes en haut : toute la largeur reste pour le contenu */}
        <Stepper steps={steps} onSelect={setStep} />

        <div className="min-w-0 flex flex-col gap-6">

          {/* ══ ÉTAPE 1 : DOCUMENTS ══════════════════════════════════════ */}
          {step === 1 && (
            <>
              {(data.length === 0 || selectedFiles.length > 0) && !loading && (
                <Card className="p-6 md:p-8">
                  <SectionTitle title={t("Importer des documents", "Import documents")}
                    description={t("PDF numériques ou scannés, Word (.docx) et Excel. Plusieurs fichiers d'un même dossier peuvent être traités ensemble.",
                                   "Native or scanned PDF, Word (.docx) and Excel. Several files from the same tender can be processed together.")} />
                  <div
                    onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    className={cx("mt-6 rounded-2xl border-2 border-dashed px-6 py-10 flex flex-col items-center text-center transition-colors",
                      dragOver ? "border-cyan bg-[#ebfbfc]" : "border-[var(--border)] bg-[var(--surface)]")}>
                    <div className="w-12 h-12 rounded-full bg-white border border-[var(--border)] flex items-center justify-center text-navy">
                      <Upload size={20} aria-hidden />
                    </div>
                    <p className="mt-4 font-semibold text-navy">{t("Glissez vos fichiers ici", "Drop your files here")}</p>
                    <p className="text-sm text-slate-500">{t("ou", "or")}</p>
                    <Button variant="secondary" size="sm" className="mt-2" onClick={() => fileInput.current?.click()}>
                      {t("Parcourir", "Browse")}
                    </Button>
                    <input ref={fileInput} type="file" multiple hidden accept=".pdf,.xlsx,.xls,.docx"
                      onChange={e => { addFiles(Array.from(e.target.files || [])); e.target.value = ""; }} />
                  </div>

                  {selectedFiles.length > 0 && (
                    <>
                      <ul className="mt-6 divide-y divide-[var(--border)] border border-[var(--border)] rounded-xl">
                        {selectedFiles.map((f, i) => (
                          <li key={f.name} className="flex items-center gap-3 px-4 py-3">
                            <FileText size={18} className="text-slate-400 shrink-0" aria-hidden />
                            <span className="text-sm font-semibold text-navy truncate flex-1">{f.name}</span>
                            <span className="text-xs text-slate-500 tabular-nums">{(f.size / 1024 / 1024).toFixed(1)} Mo</span>
                            <button onClick={() => setSelectedFiles(p => p.filter((_, j) => j !== i))}
                              className="p-1 rounded-md text-slate-400 hover:text-navy hover:bg-slate-100" aria-label={t(`Retirer ${f.name}`, `Remove ${f.name}`)}>
                              <X size={16} />
                            </button>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-6 flex justify-end">
                        <Button variant="cta" size="lg" onClick={startConversion} icon={<Cpu size={16} aria-hidden />}>
                          {t(`Convertir ${selectedFiles.length} document(s)`, `Convert ${selectedFiles.length} document(s)`)}
                        </Button>
                      </div>
                    </>
                  )}
                </Card>
              )}

              {loading && (
                <Card className="p-6 md:p-8">
                  <SectionTitle title={t("Conversion en cours", "Converting")}
                    description={t("Chaque page est lue par Docling ou, pour les scans, par le modèle de vision. Le premier document prend plus de temps.",
                                   "Each page is read by Docling or, for scans, by the vision model. The first document takes longer.")} />
                  <div className="mt-6">
                    <ProgressBar value={progressFrom(progressText)} label={progressText.split(" - ").slice(-1)[0] || t("Préparation…", "Preparing…")} />
                    <p className="mt-2 text-xs text-slate-500 truncate">{progressText.split(" - ")[0]}</p>
                  </div>
                </Card>
              )}

              {data.length > 0 && !loading && page && (
                <Card className="overflow-hidden">
                  <div className="p-6 border-b border-[var(--border)]">
                    <SectionTitle
                      title={t(`${data.length} pages converties`, `${data.length} pages converted`)}
                      description={t("Vérifiez le texte reconnu. Vous pouvez le corriger avant le filtrage.", "Check the recognised text. You can correct it before filtering.")}
                      actions={<Button variant="cta" onClick={() => setStep(2)} icon={<ArrowRight size={16} aria-hidden />}>{t("Continuer : filtrer", "Next: filter")}</Button>}
                    />
                  </div>
                  {/* Choix de la page : barre horizontale, pour laisser toute la largeur à la page */}
                  <div className="flex items-center gap-2 px-4 md:px-6 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
                    <Button size="sm" variant="secondary" aria-label={t("Page précédente", "Previous page")}
                      disabled={activePage === 0} onClick={() => setActivePage(activePage - 1)} icon={<ChevronLeft size={16} aria-hidden />} />
                    <ul className="flex-1 min-w-0 flex gap-1.5 overflow-x-auto py-0.5">
                      {data.map((p: any, i: number) => {
                        const excluded = excludedPages.includes(pageId(p));
                        return (
                          <li key={pageId(p) + i} className="shrink-0">
                            <button onClick={() => setActivePage(i)} title={`${p.fileName} - page ${p.page}`}
                              aria-current={i === activePage ? "page" : undefined}
                              className={cx("h-8 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 border",
                                i === activePage ? "bg-navy text-white border-navy" : "bg-white text-slate-600 border-[var(--border)] hover:border-cyan")}>
                              {multiFiles && <span className="max-w-[120px] truncate opacity-70">{p.fileName}</span>}
                              <span className={cx("font-semibold", excluded && "line-through opacity-60")}>p.{p.page}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    <Button size="sm" variant="secondary" aria-label={t("Page suivante", "Next page")}
                      disabled={activePage === data.length - 1} onClick={() => setActivePage(activePage + 1)} icon={<ChevronRight size={16} aria-hidden />} />
                  </div>

                  {/* Page d'origine à gauche, texte reconnu à droite : deux grands panneaux */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 lg:divide-x divide-[var(--border)]">
                    <section className="min-w-0 flex flex-col" aria-label={t("Page d'origine", "Original page")}>
                      <div className="flex items-center justify-between gap-3 h-14 px-4 md:px-6 border-b border-[var(--border)]">
                        <p className="text-sm font-semibold text-slate-900 truncate">{page.fileName} <span className="text-slate-400 font-normal">- page {page.page}</span></p>
                        <Badge tone="neutral">{t("Original", "Original")}</Badge>
                      </div>
                      <div className="h-[70vh] min-h-[420px] overflow-auto bg-slate-100 p-4">
                        {page.image ? <img src={`data:image/jpeg;base64,${page.image}`} alt={`${page.fileName}, page ${page.page}`} className="w-full h-auto bg-white shadow-sm rounded" />
                          : page.images?.length ? <div className="flex flex-col gap-3">{page.images.map((img: string, i: number) => <img key={i} src={`data:image/jpeg;base64,${img}`} alt={`${page.fileName} ${i + 1}`} className="w-full h-auto bg-white shadow-sm rounded" />)}</div>
                          : page.html ? <div className="bg-white rounded p-4 text-xs overflow-auto [&_table]:w-full [&_td]:border [&_td]:border-[var(--border)] [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-[var(--border)] [&_th]:px-2 [&_th]:py-1 [&_th]:bg-slate-50" dangerouslySetInnerHTML={{ __html: page.html }} />
                          : <EmptyState icon={<FileText size={24} aria-hidden />} title={t("Pas d'aperçu", "No preview")} />}
                      </div>
                    </section>

                    <section className="min-w-0 flex flex-col border-t lg:border-t-0 border-[var(--border)]" aria-label={t("Texte reconnu", "Recognised text")}>
                      <div className="flex items-center justify-between gap-3 h-14 px-4 md:px-6 border-b border-[var(--border)]">
                        <p className="text-sm font-semibold text-slate-900">{t("Texte reconnu", "Recognised text")}</p>
                        <Tabs label={t("Mode d'affichage", "View mode")} value={viewMode}
                          onChange={(v) => setViewMode(v)}
                          options={[
                            { value: "preview", label: t("Aperçu", "Preview") },
                            { value: "markdown", label: "Markdown" },
                            { value: "edit", label: t("Corriger", "Edit") },
                          ]} />
                      </div>
                      <div className="h-[70vh] min-h-[420px] overflow-auto">
                        {viewMode === "edit" ? (
                          <textarea value={page.markdown}
                            onChange={e => { const d = [...data]; d[activePage] = { ...d[activePage], markdown: e.target.value }; setData(d); }}
                            aria-label={t("Texte de la page", "Page text")}
                            className="block w-full h-full p-5 text-[13px] leading-relaxed font-mono outline-none resize-none" />
                        ) : viewMode === "markdown" ? (
                          <pre className="p-5 text-[13px] leading-relaxed font-mono text-slate-600 whitespace-pre-wrap">{page.markdown}</pre>
                        ) : (
                          <div className="p-6 prose prose-sm max-w-none prose-headings:text-slate-900 prose-table:text-xs prose-th:bg-slate-50 prose-th:px-2 prose-th:py-1.5 prose-td:px-2 prose-td:py-1.5 prose-th:border prose-td:border prose-th:border-[var(--border)] prose-td:border-[var(--border)]">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{page.markdown}</ReactMarkdown>
                          </div>
                        )}
                      </div>
                    </section>
                  </div>
                </Card>
              )}
            </>
          )}

          {/* ══ ÉTAPE 2 : FILTRAGE ════════════════════════════════════════ */}
          {step === 2 && data.length > 0 && (
            <Card className="p-6 md:p-8">
              <SectionTitle
                title={t("Écarter les pages inutiles", "Set aside useless pages")}
                description={t("DocsPilot repère les pages de garde, les sommaires et les pages vides. Vous décidez pour chacune.",
                               "DocsPilot spots cover pages, tables of contents and blank pages. You decide for each one.")}
                actions={<Button variant={filterDone ? "secondary" : "cta"} loading={filtering} onClick={runFiltering} icon={<ScanSearch size={16} aria-hidden />}>
                  {filterDone ? t("Relancer l'analyse", "Run again") : t("Analyser les pages", "Analyse pages")}
                </Button>}
              />

              {!filterDone && !filtering && (
                <EmptyState icon={<ScanSearch size={20} aria-hidden />}
                  title={t(`${data.length} pages à analyser`, `${data.length} pages to analyse`)}
                  text={t("L'analyse prend quelques secondes par page.", "Analysis takes a few seconds per page.")} />
              )}

              {filtering && <div className="mt-8"><ProgressBar value={60} label={t("Analyse des pages…", "Analysing pages…")} detail="" /></div>}

              {filterDone && !filtering && (
                <div className="mt-8 flex flex-col gap-8">
                  {deleteSuggestions.length > 0 ? (
                    <div>
                      <p className="text-sm font-bold text-navy mb-3">{t("À vérifier", "To review")} · {deleteSuggestions.length}</p>
                      <ul className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-xl">
                        {deleteSuggestions.map((s: any) => (
                          <li key={s.fileName + s.page} className="flex flex-wrap items-center gap-3 px-4 py-3">
                            <span className="text-sm font-semibold text-navy flex-1 min-w-0 truncate">{s.fileName} · {t("page", "page")} {s.page}</span>
                            <Badge tone="warning">{s.reason}</Badge>
                            <div className="flex gap-2">
                              <Button size="sm" variant="secondary" onClick={() => decide(s, false)}>{t("Garder", "Keep")}</Button>
                              <Button size="sm" variant="primary" onClick={() => decide(s, true)}>{t("Écarter", "Set aside")}</Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-sm text-emerald-700 font-semibold">{t("Plus aucune page à vérifier.", "No pages left to review.")}</p>
                  )}

                  {excludedPages.length > 0 && (
                    <div>
                      <p className="text-sm font-bold text-navy mb-3">{t("Pages écartées", "Pages set aside")} · {excludedPages.length}</p>
                      <div className="flex flex-wrap gap-2">
                        {excludedPages.map((id: string) => (
                          <span key={id} className="inline-flex items-center gap-2 bg-[var(--surface)] border border-[var(--border)] rounded-full pl-3 pr-1 py-1 text-xs text-slate-600">
                            {id.replace(/(\d+)$/, " · p.$1")}
                            <button onClick={() => restorePage(id)} className="p-1 rounded-full hover:bg-white text-slate-500 hover:text-navy" aria-label={t("Restaurer la page", "Restore page")}>
                              <Undo2 size={13} />
                            </button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-4 pt-6 border-t border-[var(--border)]">
                    <p className="text-sm text-slate-600">{t(`${keptPages.length} pages seront utilisées pour l'extraction.`, `${keptPages.length} pages will be used for extraction.`)}</p>
                    <Button variant="cta" onClick={() => setStep(3)} icon={<ArrowRight size={16} aria-hidden />}>{t("Continuer : extraire", "Next: extract")}</Button>
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* ══ ÉTAPE 3 : EXTRACTION ══════════════════════════════════════ */}
          {step === 3 && data.length > 0 && (
            <>
              {(!extractedResults || extracting) && (
                <Card className="p-6 md:p-8">
                  <SectionTitle
                    title={t("Extraire les caractéristiques", "Extract the specifications")}
                    description={t("Détection des repères de pompes, extraction des champs du lexique avec leur source, passe dédiée aux matériaux, puis enregistrement en base.",
                                   "Pump tag detection, extraction of the lexicon fields with their source, a dedicated materials pass, then storage in the database.")} />
                  {extracting ? (
                    <div className="mt-8">
                      <ProgressBar value={70} label={t("Extraction en cours…", "Extracting…")} detail={t("1 à 3 minutes", "1 to 3 minutes")} />
                    </div>
                  ) : (
                    <div className="mt-8 flex flex-wrap items-center justify-between gap-4">
                      <p className="text-sm text-slate-600">{t(`${keptPages.length} pages retenues seront analysées.`, `${keptPages.length} kept pages will be analysed.`)}</p>
                      <Button variant="cta" size="lg" onClick={runExtraction} icon={<Cpu size={16} aria-hidden />} disabled={!keptPages.length}>
                        {t("Lancer l'extraction", "Start extraction")}
                      </Button>
                    </div>
                  )}
                </Card>
              )}

              {extractedResults && !extracting && pump && (
                <>
                  {extractedResults.length > 1 && (
                    <Tabs label={t("Pompes", "Pumps")} value={String(activePump)} onChange={(v) => { setActivePump(Number(v)); setActiveCategory("all"); }}
                      options={extractedResults.map((p: any, i: number) => ({ value: String(i), label: p.tag || `Pompe ${i + 1}` }))} />
                  )}

                  {/* Synthèse de la fiche */}
                  <Card className="p-6 md:p-8">
                    <div className="flex flex-wrap items-start justify-between gap-6">
                      <div>
                        <p className="text-sm text-slate-500">{t("Fiche pompe", "Pump sheet")}</p>
                        <p className="text-3xl font-black text-navy mt-1">{pump.tag || "N/A"}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="ghost" icon={<RotateCcw size={15} aria-hidden />} onClick={runExtraction}>{t("Relancer", "Run again")}</Button>
                        <Menu label={t("Exporter", "Export")} icon={<Download size={15} aria-hidden />} items={[
                          { label: t("Excel (.xlsx)", "Excel (.xlsx)"), onClick: exportToExcel },
                          { label: "PDF", onClick: exportToPDF },
                        ]} />
                      </div>
                    </div>
                    <div className="mt-6 max-w-xl">
                      <ProgressBar value={pumpRows.length ? (foundCount / pumpRows.length) * 100 : 0}
                        label={t("Champs trouvés dans les documents", "Fields found in the documents")}
                        detail={`${foundCount} / ${pumpRows.length}`} />
                    </div>
                  </Card>

                  {/* Tableau des caractéristiques */}
                  <Card className="overflow-hidden">
                    <div className="p-4 md:px-6 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-3">
                      <Tabs label={t("Catégories", "Categories")} value={activeCategory} onChange={setActiveCategory}
                        options={[
                          { value: "all", label: t("Tout", "All"), count: pumpRows.length },
                          ...categories.map(c => ({ value: c, label: CATEGORY_LABELS[c] ? t(CATEGORY_LABELS[c].fr, CATEGORY_LABELS[c].en) : prettify(c), count: pumpRows.filter(r => r.cat === c).length })),
                        ]} />
                      <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                        <input type="checkbox" checked={missingOnly} onChange={e => setMissingOnly(e.target.checked)} className="w-4 h-4 accent-[#1a2b4a]" />
                        {t(`Seulement les manquants (${pumpRows.length - foundCount})`, `Missing only (${pumpRows.length - foundCount})`)}
                      </label>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-slate-500 bg-[var(--surface)]">
                            {activeCategory === "all" && <th scope="col" className="font-semibold px-6 py-3 w-40">{t("Catégorie", "Category")}</th>}
                            <th scope="col" className="font-semibold px-6 py-3 w-56">{t("Caractéristique", "Characteristic")}</th>
                            <th scope="col" className="font-semibold px-6 py-3">{t("Valeur", "Value")}</th>
                            <th scope="col" className="font-semibold px-6 py-3 w-56">Source</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {visibleRows.map((r, i) => {
                            const parts = String(r.source).split(" - Page ");
                            const citation = !r.isMissing && parts[0] && parts[1]
                              ? <CitationBadge index={i + 1} source={{ fileName: parts[0].trim(), page: parts[1].trim() }} value={String(r.value)} allPages={data} />
                              : null;
                            return (
                              <tr key={r.key} className="align-top hover:bg-[var(--surface)]/60">
                                {activeCategory === "all" && (
                                  <td className="px-6 py-3.5 text-xs text-slate-500">{CATEGORY_LABELS[r.cat] ? t(CATEGORY_LABELS[r.cat].fr, CATEGORY_LABELS[r.cat].en) : prettify(r.cat)}</td>
                                )}
                                <td className="px-6 py-3.5 text-slate-600">{prettify(r.field)}</td>
                                <td className="px-6 py-3.5">
                                  <ValueCell value={String(r.value ?? "")} isManual={r.isManual} isMissing={r.isMissing} citation={citation}
                                    onSave={(v, src) => saveManual(r.key, v, src)} />
                                </td>
                                <td className="px-6 py-3.5 text-xs text-slate-500">{r.isMissing ? "—" : r.source}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {visibleRows.length === 0 && (
                        <EmptyState title={t("Aucun champ manquant dans cette catégorie", "No missing field in this category")} />
                      )}
                    </div>
                  </Card>
                </>
              )}
            </>
          )}

          {/* ══ ÉTAPE 4 : LEXIQUE ═════════════════════════════════════════ */}
          {step === 4 && (
            <Card className="p-6 md:p-8">
              <SectionTitle
                title={t("Enrichir le lexique", "Enrich the lexicon")}
                description={t("Le lexique liste chaque caractéristique recherchée et ses libellés possibles en français et en anglais. Une nouvelle entrée sera utilisée dès la prochaine extraction.",
                               "The lexicon lists every characteristic searched for and its possible labels in French and English. A new entry is used from the next extraction.")} />
              <div className="mt-8 grid sm:grid-cols-2 gap-5 max-w-3xl">
                {[
                  { k: "name", label: t("Nom du champ", "Field name"), ph: t("ex. Couleur", "e.g. Colour") },
                  { k: "fr", label: t("Libellé français", "French label"), ph: t("ex. Couleur", "e.g. Couleur") },
                  { k: "en", label: t("Libellé anglais", "English label"), ph: t("ex. Color", "e.g. Color") },
                ].map(f => (
                  <label key={f.k} className="flex flex-col gap-1.5 text-sm font-semibold text-navy">
                    {f.label}
                    <input value={(newFeature as any)[f.k]} placeholder={f.ph}
                      onChange={e => setNewFeature({ ...newFeature, [f.k]: e.target.value })}
                      className="h-10 px-3 font-normal border border-[var(--border)] rounded-lg focus:border-navy outline-none" />
                  </label>
                ))}
                <label className="flex flex-col gap-1.5 text-sm font-semibold text-navy">
                  {t("Catégorie", "Category")}
                  <select value={newFeature.category} onChange={e => setNewFeature({ ...newFeature, category: e.target.value })}
                    className="h-10 px-3 font-normal border border-[var(--border)] rounded-lg bg-white focus:border-navy outline-none">
                    {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{t(v.fr, v.en)}</option>)}
                  </select>
                </label>
                <label className="sm:col-span-2 flex flex-col gap-1.5 text-sm font-semibold text-navy">
                  {t("Autres libellés possibles", "Other possible labels")}
                  <input value={newFeature.others} placeholder={t("Séparés par des virgules, ex. RAL, Teinte", "Comma-separated, e.g. RAL, Shade")}
                    onChange={e => setNewFeature({ ...newFeature, others: e.target.value })}
                    className="h-10 px-3 font-normal border border-[var(--border)] rounded-lg focus:border-navy outline-none" />
                </label>
              </div>
              <div className="mt-8">
                <Button variant="primary" onClick={handleUpdateLexicon} icon={<BookOpen size={16} aria-hidden />}>{t("Ajouter au lexique", "Add to lexicon")}</Button>
              </div>
            </Card>
          )}

          {/* Étapes 2 et 3 sans documents */}
          {(step === 2 || step === 3) && data.length === 0 && (
            <Card><EmptyState icon={<FileText size={20} aria-hidden />} title={t("Aucun document converti", "No converted document")}
              text={t("Commencez par importer et convertir vos fiches techniques.", "Start by importing and converting your datasheets.")}
              action={<Button variant="cta" onClick={() => setStep(1)}>{t("Importer des documents", "Import documents")}</Button>} /></Card>
          )}
        </div>
      </div>
    </>
  );
}