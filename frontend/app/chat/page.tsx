"use client";
import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Send, Loader2, Database, Search, BookOpen, Trash2, AlertTriangle, Bot, ListTree,
} from "lucide-react";
import { useLang } from "../context/LanguageContext";
import { API } from "../lib/api";
import { Badge, Button, Card, PageHeader, cx } from "../components/ui";

// ─── Types : ce que renvoie la route /chat du backend ───────────────────────
type Step = { outil: string; arguments: string; resultat: any };
type AgentAnswer = {
  reponse: string;
  etapes: Step[];
  sql: string[];
  sources: string[];
  contexte: "ON" | "OFF";
  erreur?: boolean;
};
type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; details: AgentAnswer };

const STORAGE_KEY = "docspilot_chat";

const EXAMPLES: [string, string][] = [
  ["Combien de pompes sont enregistrées ?", "How many pumps are saved?"],
  ["Quelles pompes ont un corps en inox ?", "Which pumps have a stainless steel casing?"],
  ["Quel est le débit moyen par client ?", "What is the average flow per customer?"],
  ["Quelle pompe a la plus grande hauteur manométrique ?", "Which pump has the highest head?"],
  ["Que disent les documents sur la garniture mécanique ?", "What do the documents say about the mechanical seal?"],
];

const TOOLS: Record<string, { fr: string; en: string; icon: any }> = {
  query_table:      { fr: "Requête SQL",         en: "SQL query",       icon: Database },
  search_documents: { fr: "Recherche documents", en: "Document search", icon: Search },
  lookup_glossary:  { fr: "Glossaire",           en: "Glossary",        icon: BookOpen },
};

// ─── Résultat d'un outil (panneau Traçabilité) ──────────────────────────────
function StepResult({ step }: { step: Step }) {
  const { t } = useLang();
  const r = step.resultat || {};
  if (r.erreur) {
    return (
      <p className="text-xs text-danger bg-danger/5 border border-danger/20 rounded-lg p-2.5 flex items-start gap-1.5">
        <AlertTriangle size={13} className="shrink-0 mt-0.5" aria-hidden /> {r.erreur}
      </p>
    );
  }
  if (step.outil === "query_table") {
    const cols: string[] = r.colonnes || [];
    const rows: any[][] = (r.lignes || []).slice(0, 20);
    return (
      <div className="space-y-2">
        <pre className="text-[11px] leading-relaxed bg-sidebar text-slate-200 rounded-lg p-3 whitespace-pre-wrap break-words">{r.sql}</pre>
        {cols.length > 0 && (
          <div className="overflow-x-auto border border-[var(--border)] rounded-lg">
            <table className="text-[11px] w-full">
              <thead className="bg-slate-50">
                <tr>{cols.map(c => <th key={c} scope="col" className="px-2 py-1.5 text-left font-semibold text-slate-500 whitespace-nowrap">{c}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((v, j) => <td key={j} className="px-2 py-1.5 text-slate-700 whitespace-nowrap">{v === null ? "—" : String(v)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {r.nb_lignes > rows.length && (
              <p className="text-[10px] text-slate-400 px-2 py-1 border-t border-[var(--border)]">{rows.length} / {r.nb_lignes} {t("lignes affichées", "rows shown")}</p>
            )}
          </div>
        )}
      </div>
    );
  }
  if (step.outil === "search_documents") {
    return (
      <ul className="space-y-2">
        {(r.passages || []).map((p: any, i: number) => (
          <li key={i} className="text-[11px] bg-slate-50 border border-[var(--border)] rounded-lg p-2.5">
            <span className="font-semibold text-cyan-dark">{p.fichier} - p.{p.page}</span>
            <p className="text-slate-600 mt-1 line-clamp-3">{p.texte}</p>
          </li>
        ))}
      </ul>
    );
  }
  if (step.outil === "lookup_glossary") {
    return (
      <ul className="space-y-1.5">
        {(r.resultats || []).map((g: any, i: number) => (
          <li key={i} className="text-[11px] text-slate-600 bg-slate-50 border border-[var(--border)] rounded-lg p-2.5">
            <span className="font-semibold text-slate-900">{g.terme || g.champ_lexique}</span>
            {g.definition ? ` : ${g.definition}` : g.synonymes ? ` : ${g.synonymes.join(", ")}` : ""}
          </li>
        ))}
      </ul>
    );
  }
  return <pre className="text-[11px] whitespace-pre-wrap">{JSON.stringify(r, null, 2)}</pre>;
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function ChatPage() {
  const { t } = useLang();
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [contextOn, setContextOn] = useState(true);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);   // réponse affichée dans Traçabilité
  const scrollRef = useRef<HTMLDivElement>(null);

  // Conversation conservée si on change de page (sessionStorage)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved: Message[] = JSON.parse(raw);
        setMessages(saved);
        const last = saved.map(m => m.role).lastIndexOf("assistant");
        if (last >= 0) setSelected(last);
      }
    } catch {}
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages)); } catch {}
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || loading) return;
    setQuestion("");
    const history = messages.map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => [...prev, { role: "user", content: q }]);
    setLoading(true);
    let answer: Message;
    try {
      const res = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, context_on: contextOn, history }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: AgentAnswer = await res.json();
      answer = { role: "assistant", content: data.reponse, details: data };
    } catch {
      answer = {
        role: "assistant",
        content: t("Impossible de joindre l'agent. Vérifiez que le backend est lancé.", "Cannot reach the agent. Check that the backend is running."),
        details: { reponse: "", etapes: [], sql: [], sources: [], contexte: contextOn ? "ON" : "OFF", erreur: true },
      };
    }
    setMessages(prev => [...prev, answer]);
    setSelected(messages.length + 1);   // position de la réponse (après la question)
    setLoading(false);
  };

  const clear = () => { setMessages([]); setSelected(null); };
  const trace = selected !== null && messages[selected]?.role === "assistant"
    ? (messages[selected] as Extract<Message, { role: "assistant" }>).details : null;

  return (
    <>
      <PageHeader
        title={t("Chat agent", "Agent chat")}
        description={t("Posez une question sur les pompes extraites. L'agent choisit ses outils, exécute et cite ses sources.",
                       "Ask about the extracted pumps. The agent picks its tools, runs them and cites its sources.")}
        actions={
          <>
            {/* Contexte métier ON / OFF */}
            <div role="radiogroup" aria-label={t("Contexte métier", "Business context")}
              className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100">
              {[true, false].map(on => (
                <button key={String(on)} role="radio" aria-checked={contextOn === on} onClick={() => setContextOn(on)}
                  className={cx("h-8 px-3 rounded-md text-sm font-medium flex items-center gap-2",
                    contextOn === on ? "bg-white text-navy shadow-sm" : "text-slate-500 hover:text-navy")}>
                  <span className={cx("w-2 h-2 rounded-full", on ? "bg-cyan" : "bg-slate-400")} aria-hidden />
                  {on ? t("Avec contexte", "With context") : t("Sans contexte", "Without context")}
                </button>
              ))}
            </div>
            {messages.length > 0 && (
              <Button variant="ghost" size="sm" icon={<Trash2 size={14} aria-hidden />} onClick={clear}>{t("Effacer", "Clear")}</Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_440px] gap-6 items-start">
        {/* ══ Conversation ══════════════════════════════════════════════ */}
        <Card className="flex flex-col h-[calc(100vh-15rem)] min-h-[520px] overflow-hidden">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 md:p-6 flex flex-col gap-5">
            {messages.length === 0 && !loading && (
              <div className="m-auto w-full max-w-lg text-center">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-cyan/10 text-cyan flex items-center justify-center">
                  <Bot className="w-8 h-8" aria-hidden />
                </div>
                <p className="mt-4 text-lg font-semibold text-slate-900">{t("Interrogez vos fiches pompes", "Query your pump sheets")}</p>
                <p className="mt-1 text-sm text-slate-500">{t("Choisissez un exemple ou écrivez votre question.", "Pick an example or type your question.")}</p>
                <ul className="mt-6 flex flex-col gap-2 text-left">
                  {EXAMPLES.map(([fr, en]) => (
                    <li key={fr}>
                      <button onClick={() => ask(t(fr, en))}
                        className="w-full text-sm text-slate-700 bg-white border border-[var(--border)] rounded-lg px-4 py-2.5 hover:border-cyan hover:text-navy text-left">
                        {t(fr, en)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <p className="max-w-[80%] bg-navy text-white text-sm rounded-xl rounded-br-sm px-4 py-2.5">{m.content}</p>
                </div>
              ) : (
                <div key={i} className="flex gap-3 items-start">
                  <span className="w-8 h-8 shrink-0 rounded-lg bg-navy flex items-center justify-center">
                    <Bot className="w-4 h-4 text-cyan" aria-hidden />
                  </span>
                  <div className={cx("min-w-0 max-w-[85%] rounded-xl border p-4 bg-white",
                    selected === i ? "border-cyan ring-2 ring-cyan/20" : "border-[var(--border)]")}>
                    <div className="flex flex-wrap items-center gap-1.5 mb-2">
                      <Badge tone={m.details.contexte === "ON" ? "cyan" : "neutral"}>
                        {m.details.contexte === "ON" ? t("Avec contexte", "With context") : t("Sans contexte", "Without context")}
                      </Badge>
                      {m.details.erreur && <Badge tone="danger">{t("Erreur", "Error")}</Badge>}
                    </div>
                    <div className="prose prose-sm max-w-none prose-p:my-1.5 prose-headings:text-slate-900 prose-table:text-xs prose-th:px-2 prose-td:px-2">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                    </div>
                    {m.details.sources.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {m.details.sources.map((s, k) => (
                          <span key={k} className="text-[11px] font-medium bg-cyan/15 text-cyan-dark rounded-full px-2.5 py-0.5">{s}</span>
                        ))}
                      </div>
                    )}
                    {m.details.etapes.length > 0 && (
                      <button onClick={() => setSelected(i)}
                        className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-navy">
                        <ListTree size={14} aria-hidden />
                        {selected === i
                          ? t("Affiché dans Traçabilité", "Shown in Traceability")
                          : t(`Voir les ${m.details.etapes.length} étape(s)`, `See the ${m.details.etapes.length} step(s)`)}
                      </button>
                    )}
                  </div>
                </div>
              )
            )}

            {loading && (
              <div className="flex gap-3 items-center">
                <span className="w-8 h-8 shrink-0 rounded-lg bg-navy flex items-center justify-center">
                  <Loader2 className="w-4 h-4 text-cyan animate-spin" aria-hidden />
                </span>
                <p className="text-sm text-slate-500">{t("L'agent analyse les données…", "The agent is analysing the data…")}</p>
              </div>
            )}
          </div>

          {/* Saisie */}
          <form onSubmit={e => { e.preventDefault(); ask(question); }}
            className="border-t border-[var(--border)] p-3 md:p-4 flex gap-2 bg-[var(--surface)]">
            <input
              type="text" value={question} onChange={e => setQuestion(e.target.value)}
              placeholder={t("Posez votre question…", "Ask your question…")} aria-label={t("Votre question", "Your question")}
              className="flex-1 min-w-0 h-11 bg-white border border-[var(--border)] rounded-lg px-4 text-sm outline-none focus:border-cyan" />
            <Button type="submit" variant="cta" size="lg" disabled={loading || !question.trim()} loading={loading}
              icon={<Send size={16} aria-hidden />}>
              <span className="hidden sm:inline">{t("Envoyer", "Send")}</span>
            </Button>
          </form>
        </Card>

        {/* ══ Traçabilité ═══════════════════════════════════════════════ */}
        <Card className="flex flex-col overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border)]">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-slate-900">{t("Traçabilité", "Traceability")}</h3>
              {trace && <Badge tone={trace.contexte === "ON" ? "cyan" : "neutral"}>{trace.contexte === "ON" ? t("Avec contexte", "With context") : t("Sans contexte", "Without context")}</Badge>}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {contextOn
                ? t("Avec contexte : l'agent reçoit la description des colonnes, les règles métier et le glossaire.",
                    "With context: the agent gets column descriptions, business rules and the glossary.")
                : t("Sans contexte : l'agent ne voit que les noms des colonnes.",
                    "Without context: the agent only sees the column names.")}
            </p>
          </div>

          <div className="p-5">
            {!trace || trace.etapes.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-16">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center">
                  <ListTree className="w-6 h-6" aria-hidden />
                </div>
                <p className="mt-3 text-sm font-medium text-slate-900">{t("Aucune étape à afficher", "No step to show")}</p>
                <p className="mt-1 text-xs text-slate-500 max-w-60">{t("Les outils appelés par l'agent, la requête SQL et les pages lues apparaîtront ici.",
                  "The tools the agent called, the SQL query and the pages it read will show here.")}</p>
              </div>
            ) : (
              <ol className="relative flex flex-col gap-5">
                {trace.etapes.map((step, i) => {
                  const tool = TOOLS[step.outil];
                  const Icon = tool?.icon ?? Database;
                  const failed = !!step.resultat?.erreur;
                  return (
                    <li key={i} className="relative pl-10">
                      {i < trace.etapes.length - 1 && <span className="absolute left-[13px] top-8 -bottom-5 w-px bg-[var(--border)]" aria-hidden />}
                      <span className={cx("absolute left-0 top-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold",
                        failed ? "bg-danger/10 text-danger" : "bg-navy text-white")}>{i + 1}</span>
                      <p className="flex items-center gap-2 text-sm font-semibold text-slate-900 h-7">
                        <Icon size={15} className="text-cyan" aria-hidden />
                        {tool ? t(tool.fr, tool.en) : step.outil}
                        {failed && <Badge tone="danger">{t("corrigée ensuite", "retried")}</Badge>}
                      </p>
                      <div className="mt-2"><StepResult step={step} /></div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          {trace && trace.sources.length > 0 && (
            <div className="px-5 py-4 border-t border-[var(--border)] bg-[var(--surface)]">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("Pages citées", "Cited pages")}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {trace.sources.map((s, k) => (
                  <span key={k} className="text-[11px] font-medium bg-white border border-[var(--border)] text-slate-600 rounded-full px-2.5 py-0.5">{s}</span>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}