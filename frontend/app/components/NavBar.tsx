"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Home, FileSearch, MessagesSquare, FileText, Languages } from "lucide-react";
import { useLang } from "../context/LanguageContext";
import { API } from "../lib/api";

/* Menu, regroupé en sections comme dans DPRO */
const SECTIONS = [
  {
    fr: "Principal", en: "Main",
    items: [
      { href: "/",           fr: "Accueil",    en: "Home",       icon: Home },
      { href: "/extraction", fr: "Extraction", en: "Extraction", icon: FileSearch },
    ],
  },
  {
    fr: "Analyse", en: "Analysis",
    items: [
      { href: "/chat", fr: "Chat agent", en: "Agent chat", icon: MessagesSquare },
    ],
  },
];

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

/* ─── Barre latérale sombre : réduite aux icônes, s'ouvre au survol ──── */
export function NavBar() {
  const pathname = usePathname();
  const { t } = useLang();
  const [backendOk, setBackendOk] = useState<boolean | null>(null);
  // Comme DPRO : barre réduite aux icônes, elle s'ouvre quand la souris la survole
  const [open, setOpen] = useState(false);

  // Petit indicateur : le backend FastAPI répond-il ?
  useEffect(() => {
    fetch(`${API}/health`).then(r => setBackendOk(r.ok)).catch(() => setBackendOk(false));
  }, []);

  return (
    // La place réservée reste de 72 px : la barre ouverte passe par-dessus la page (rien ne bouge)
    <div className="w-[72px] shrink-0 h-screen sticky top-0 z-40">
    <aside
      onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}
      className={`absolute inset-y-0 left-0 flex flex-col overflow-hidden bg-sidebar border-r border-navy transition-[width,box-shadow] duration-200 ${
        open ? "w-[260px] shadow-2xl" : "w-[72px]"}`}>
      {/* Logo */}
      <Link href="/" className="flex items-center gap-3 px-4 h-16 border-b border-navy">
        <span className="w-9 h-9 shrink-0 rounded-lg bg-navy flex items-center justify-center">
          <FileText className="w-5 h-5 text-cyan" aria-hidden />
        </span>
        <span className={open ? "flex flex-col whitespace-nowrap" : "hidden"}>
          <span className="text-sm font-bold tracking-tight text-slate-50">DocsPilot</span>
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">{t("Fiches techniques", "Datasheets")}</span>
        </span>
      </Link>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 overflow-y-auto" aria-label={t("Navigation principale", "Main navigation")}>
        {SECTIONS.map(section => (
          <div key={section.fr}>
            <div className="pt-4 pb-2 px-3 first:pt-0">
              <span className={`${open ? "inline" : "hidden"} whitespace-nowrap text-[10px] font-semibold uppercase tracking-widest text-slate-400/60`}>
                {t(section.fr, section.en)}
              </span>
              {!open && <div className="w-full h-px bg-navy my-1" />}
            </div>
            <div className="space-y-0.5">
              {section.items.map(({ href, fr, en, icon: Icon }) => {
                const active = isActive(pathname, href);
                return (
                  <Link key={href} href={href} aria-current={active ? "page" : undefined} title={t(fr, en)}
                    className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium border-l-2 transition-all duration-150 ${
                      active
                        ? "bg-navy text-slate-50 border-cyan"
                        : "text-slate-400 hover:bg-navy/60 hover:text-slate-50 border-transparent"}`}>
                    <Icon className={`w-5 h-5 shrink-0 ${active ? "text-cyan" : "text-slate-400 group-hover:text-slate-50"}`} aria-hidden />
                    {open && <span className="whitespace-nowrap">{t(fr, en)}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bas de la barre : état du backend */}
      <div className="border-t border-navy p-4">
        <div className="flex items-center gap-3 px-1" title={backendOk ? "Backend OK" : "Backend"}>
          <span className="w-8 h-8 shrink-0 rounded-full bg-navy flex items-center justify-center">
            <span className={`w-2.5 h-2.5 rounded-full ${backendOk === null ? "bg-slate-500" : backendOk ? "bg-emerald-400" : "bg-danger"}`} />
          </span>
          <span className={open ? "block min-w-0 whitespace-nowrap" : "hidden"}>
            <span className="block text-sm font-medium text-slate-50 leading-tight">Backend</span>
            <span className="block text-xs text-slate-400 truncate">
              {backendOk === null ? t("Vérification…", "Checking…") : backendOk ? t("Connecté", "Connected") : t("Hors ligne", "Offline")}
            </span>
          </span>
        </div>
      </div>
    </aside>
    </div>
  );
}

/* ─── Barre du haut : titre de la page + langue ──────────────────────── */
const TITLES: Record<string, [string, string]> = {
  "/": ["Accueil", "Home"],
  "/extraction": ["Extraction", "Extraction"],
  "/chat": ["Chat agent", "Agent chat"],
};

export function TopBar() {
  const pathname = usePathname();
  const { lang, setLang, t } = useLang();
  const title = TITLES[pathname] ?? ["", ""];

  return (
    <header className="flex items-center justify-between h-14 px-6 bg-white/95 backdrop-blur-sm border-b border-[var(--border)] sticky top-0 z-20">
      <h1 className="text-base font-semibold text-slate-900">{t(title[0], title[1])}</h1>
      <button onClick={() => setLang(lang === "fr" ? "en" : "fr")}
        className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-500 hover:text-navy hover:bg-slate-100 rounded-lg"
        aria-label={t("Passer en anglais", "Switch to French")}>
        <Languages className="w-4 h-4" aria-hidden />
        {lang === "fr" ? "English" : "Français"}
      </button>
    </header>
  );
}