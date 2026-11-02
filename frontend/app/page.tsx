"use client";
import Link from "next/link";
import {
  FileSearch, MessagesSquare, FileText, Filter, Cpu, Bot, Database, Search, BookOpen,
} from "lucide-react";
import { useLang } from "./context/LanguageContext";
import { Card, PageHeader } from "./components/ui";

/* Le parcours d'un document (c'est une vraie séquence, d'où la numérotation) */
const PIPELINE = [
  { icon: FileText, fr: ["Conversion", "Docling ou vision Groq selon la page"], en: ["Conversion", "Docling or Groq vision per page"] },
  { icon: Filter,   fr: ["Filtrage", "Pages de garde et sommaires écartés"],    en: ["Filtering", "Cover and contents pages set aside"] },
  { icon: Cpu,      fr: ["Extraction", "Champs du lexique avec leur source"],   en: ["Extraction", "Lexicon fields with their source"] },
  { icon: Bot,      fr: ["Agent", "Questions sur les fiches enregistrées"],     en: ["Agent", "Questions on the saved sheets"] },
];

/* Les 3 outils de l'agent */
const TOOLS = [
  { icon: Database, name: "query_table",      fr: "Requête SQL en lecture seule sur la vue pompes_vue.",          en: "Read-only SQL query on the pompes_vue view." },
  { icon: Search,   name: "search_documents", fr: "Recherche dans le texte des pages indexées (RAG).",           en: "Search in the text of the indexed pages (RAG)." },
  { icon: BookOpen, name: "lookup_glossary",  fr: "Définitions métier : inox, HMT, NPSH… (contexte ON).",         en: "Business definitions: stainless, head, NPSH… (context ON)." },
];

export default function Home() {
  const { lang, t } = useLang();

  return (
    <>
      <PageHeader
        title={t("Bienvenue sur DocsPilot", "Welcome to DocsPilot")}
        description={t("Extrayez les caractéristiques de vos fiches techniques de pompes, puis interrogez-les avec un agent qui cite ses sources.",
                       "Extract the specifications from your pump datasheets, then query them with an agent that cites its sources.")}
      />

      {/* Les deux actions principales */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { href: "/extraction", icon: FileSearch, color: "#4FC3F7",
            title: t("Extraction", "Extraction"),
            text: t("Importez des PDF, Word ou Excel et obtenez la fiche de chaque pompe.", "Import PDF, Word or Excel files and get each pump's sheet."),
            cta: t("Nouvelle extraction", "New extraction") },
          { href: "/chat", icon: MessagesSquare, color: "#10B981",
            title: t("Chat agent", "Agent chat"),
            text: t("Posez une question : l'agent choisit l'outil, exécute et montre ses sources.", "Ask a question: the agent picks a tool, runs it and shows its sources."),
            cta: t("Poser une question", "Ask a question") },
        ].map(a => (
          <Link key={a.href} href={a.href}
            className="group bg-white border border-[var(--border)] rounded-xl p-5 shadow-sm transition-all hover:shadow-md hover:border-cyan/50">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-lg font-semibold text-slate-900">{a.title}</p>
                <p className="mt-1 text-sm text-slate-500">{a.text}</p>
              </div>
              <span className="w-10 h-10 shrink-0 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${a.color}20`, color: a.color }}>
                <a.icon className="w-5 h-5" aria-hidden />
              </span>
            </div>
            <span className="mt-5 inline-flex items-center h-9 px-4 rounded-lg bg-navy text-white text-sm font-semibold group-hover:brightness-125">
              {a.cta}
            </span>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
        <div className="flex flex-col gap-6 min-w-0">
          {/* Parcours d'un document */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold text-slate-900">{t("Parcours d'un document", "How a document flows")}</h3>
            <p className="mt-1 text-sm text-slate-500">{t("Un pipeline d'extraction technique rigoureux, suivi d'un agent d'analyse.", "A rigorous technical extraction pipeline, followed by an analysis agent.")}</p>
            <ol className="mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {PIPELINE.map((s, i) => {
                const [title, text] = lang === "fr" ? s.fr : s.en;
                return (
                  <li key={i} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="flex items-center justify-between">
                      <span className="w-9 h-9 rounded-lg bg-navy flex items-center justify-center">
                        <s.icon className="w-4.5 h-4.5 text-cyan" aria-hidden />
                      </span>
                      <span className="text-xs font-semibold text-slate-400 tabular-nums">{i + 1} / {PIPELINE.length}</span>
                    </div>
                    <p className="mt-3 text-sm font-semibold text-slate-900">{title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{text}</p>
                  </li>
                );
              })}
            </ol>
          </Card>

          {/* Outils de l'agent */}
          <Card className="overflow-hidden">
            <div className="px-6 pt-6 pb-4">
              <h3 className="text-lg font-semibold text-slate-900">{t("Les outils de l'agent", "The agent's tools")}</h3>
              <p className="mt-1 text-sm text-slate-500">{t("Un seul agent  décide à chaque question quel outil appeler.", "A single  agent decides which tool to call for each question.")}</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-[var(--border)] bg-[var(--surface)]">
                  <th scope="col" className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">{t("Outil", "Tool")}</th>
                  <th scope="col" className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">{t("Rôle", "Role")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {TOOLS.map(tool => (
                  <tr key={tool.name} className="hover:bg-slate-50">
                    <td className="px-6 py-3.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-2 font-mono text-xs font-semibold text-navy">
                        <tool.icon className="w-4 h-4 text-cyan" aria-hidden />{tool.name}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-slate-600">{t(tool.fr, tool.en)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>

        {/* Exemple de réponse */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold text-slate-900">{t("Exemple de réponse", "Sample answer")}</h3>
          <p className="mt-1 text-sm text-slate-500">{t("La requête et les pages citées sont toujours affichées.", "The query and the cited pages are always shown.")}</p>
          <div className="mt-5 flex flex-col gap-3">
            <p className="self-end max-w-[85%] bg-navy text-white text-sm rounded-xl rounded-br-sm px-4 py-2.5">
              {t("Quelles pompes ont un corps en inox ?", "Which pumps have a stainless steel casing?")}
            </p>
            <div className="text-sm text-slate-700">
              <p><strong className="text-slate-900">{t("3 pompes", "3 pumps")}</strong> {t("ont un corps en acier inoxydable : P-101, P-204 et P6301G.", "have a stainless steel casing: P-101, P-204 and P6301G.")}</p>
              <pre className="mt-3 text-[11px] leading-relaxed bg-sidebar text-slate-200 rounded-lg px-3 py-2.5 whitespace-pre-wrap break-words">{`SELECT repere, materiau_corps, source
FROM pompes_vue
WHERE materiau_corps ILIKE '%inox%'`}</pre>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {["fiche_P101.pdf - p.2", "dossier_B.pdf - p.7", "P6301G.pdf - p.1"].map(s => (
                  <span key={s} className="text-[11px] font-medium bg-cyan/15 text-cyan-dark rounded-full px-2.5 py-0.5">{s}</span>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}