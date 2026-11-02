"use client";
/* ══════════════════════════════════════════════════════════════════════
   DESIGN SYSTEM DOCSPILOT (style DPRO)
   Briques d'interface réutilisées par toutes les pages :
   cartes blanches à bord fin, boutons bleu marine, accent cyan.
   ══════════════════════════════════════════════════════════════════════ */
import {
  createContext, useContext, useState, useCallback, useRef, useEffect,
  ReactNode, ButtonHTMLAttributes,
} from "react";
import { Loader2, CheckCircle2, AlertTriangle, Info, X, Check, ChevronDown } from "lucide-react";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

/* ─── Bouton ─────────────────────────────────────────────────────────── */
type Variant = "cta" | "primary" | "secondary" | "ghost";
const VARIANTS: Record<Variant, string> = {
  cta:       "bg-navy text-white shadow-sm hover:brightness-125 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none",
  primary:   "bg-navy text-white hover:brightness-125 disabled:bg-slate-200 disabled:text-slate-400",
  secondary: "bg-white text-slate-700 border border-[var(--border)] hover:border-cyan hover:text-navy disabled:text-slate-300",
  ghost:     "text-slate-500 hover:text-navy hover:bg-slate-100 disabled:text-slate-300 disabled:bg-transparent",
};
const SIZES = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-11 px-5 text-sm gap-2",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: keyof typeof SIZES;
  icon?: ReactNode;
  loading?: boolean;
};

export function Button({ variant = "primary", size = "md", icon, loading, className, children, disabled, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center rounded-lg font-semibold whitespace-nowrap disabled:cursor-not-allowed",
        VARIANTS[variant], SIZES[size], className,
      )}>
      {loading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

/* ─── Carte ──────────────────────────────────────────────────────────── */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("bg-white border border-[var(--border)] rounded-xl shadow-sm", className)}>{children}</div>;
}

/* ─── En-tête de page ───────────────────────────────────────────────── */
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div className="min-w-0">
        <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
        {description && <p className="mt-1 text-sm text-slate-500 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
    </header>
  );
}

/* ─── Titre de section ──────────────────────────────────────────────── */
export function SectionTitle({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        {description && <p className="mt-1 text-sm text-slate-500 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ─── Badge ──────────────────────────────────────────────────────────── */
type Tone = "neutral" | "navy" | "cyan" | "success" | "warning" | "danger";
const TONES: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-600",
  navy:    "bg-navy text-white",
  cyan:    "bg-cyan/15 text-cyan-dark",
  success: "bg-emerald-500/10 text-emerald-700",
  warning: "bg-amber-500/10 text-amber-700",
  danger:  "bg-danger/10 text-danger",
};
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", TONES[tone], className)}>
      {children}
    </span>
  );
}

/* ─── Barre de progression ───────────────────────────────────────────── */
export function ProgressBar({ value, label, detail }: { value: number; label?: string; detail?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="w-full">
      {(label || detail) && (
        <div className="flex justify-between gap-4 text-sm mb-2">
          <span className="font-medium text-slate-900">{label}</span>
          <span className="text-slate-500 tabular-nums">{detail ?? `${pct} %`}</span>
        </div>
      )}
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-cyan rounded-full transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ─── État vide ──────────────────────────────────────────────────────── */
export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-16">
      {icon && <div className="w-16 h-16 rounded-2xl bg-cyan/10 text-cyan flex items-center justify-center mb-4">{icon}</div>}
      <p className="text-lg font-semibold text-slate-900">{title}</p>
      {text && <p className="mt-1 text-sm text-slate-500 max-w-sm">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ─── Onglets (contrôle segmenté) ────────────────────────────────────── */
export function Tabs<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[]; label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex flex-wrap max-w-full gap-1 p-1 rounded-lg bg-slate-100">
      {options.map(o => {
        const active = o.value === value;
        return (
          <button key={o.value} role="tab" aria-selected={active} onClick={() => onChange(o.value)}
            className={cx(
              "shrink-0 h-8 px-3 rounded-md text-sm font-medium",
              active ? "bg-white text-navy shadow-sm" : "text-slate-500 hover:text-navy",
            )}>
            {o.label}
            {o.count !== undefined && (
              <span className={cx("ml-1.5 text-xs tabular-nums", active ? "text-cyan-dark" : "text-slate-400")}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Menu déroulant ─────────────────────────────────────────────────── */
export function Menu({ label, icon, items }: {
  label: string; icon?: ReactNode; items: { label: string; icon?: ReactNode; onClick: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button variant="secondary" icon={icon} onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open}>
        {label} <ChevronDown size={14} aria-hidden />
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 min-w-48 bg-white border border-[var(--border)] rounded-xl shadow-xl py-1.5 z-30">
          {items.map(it => (
            <button key={it.label} role="menuitem" onClick={() => { setOpen(false); it.onClick(); }}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-navy text-left">
              {it.icon}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Indicateur d'étapes (horizontal) ───────────────────────────────── */
export type StepStatus = "done" | "current" | "todo";
export function Stepper({ steps, onSelect }: {
  steps: { id: number; title: string; hint: string; status: StepStatus; disabled?: boolean }[];
  onSelect: (id: number) => void;
}) {
  return (
    <nav aria-label="Étapes" className="bg-white border border-[var(--border)] rounded-xl shadow-sm px-3 py-2.5 overflow-x-auto">
      <ol className="flex items-center gap-2 min-w-max lg:min-w-0">
        {steps.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2 lg:flex-1 last:flex-none">
            <button onClick={() => onSelect(s.id)} disabled={s.disabled}
              aria-current={s.status === "current" ? "step" : undefined}
              className={cx("flex items-center gap-3 text-left rounded-lg px-2.5 py-2 disabled:cursor-not-allowed",
                s.status === "current" ? "bg-slate-50" : "hover:bg-slate-50")}>
              <span className={cx(
                "shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold",
                s.status === "done" && "bg-cyan text-white",
                s.status === "current" && "bg-navy text-white ring-4 ring-cyan/25",
                s.status === "todo" && "bg-white border border-[var(--border)] text-slate-400",
              )}>
                {s.status === "done" ? <Check size={14} strokeWidth={3} aria-hidden /> : s.id}
              </span>
              <span className="min-w-0">
                <span className={cx("block text-sm font-semibold whitespace-nowrap", s.status === "todo" ? "text-slate-500" : "text-slate-900")}>{s.title}</span>
                <span className="hidden xl:block text-xs text-slate-500 whitespace-nowrap">{s.hint}</span>
              </span>
            </button>
            {i < steps.length - 1 && (
              <span className={cx("h-px w-6 lg:w-auto lg:flex-1 lg:min-w-6", s.status === "done" ? "bg-cyan" : "bg-[var(--border)]")} aria-hidden />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/* ─── Notifications (remplacent les alert() du navigateur) ───────────── */
type ToastTone = "success" | "error" | "info";
type ToastItem = { id: number; message: string; tone: ToastTone };
const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const show = useCallback((message: string, tone: ToastTone = "info") => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, message, tone }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4500);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 w-[calc(100%-2.5rem)] max-w-sm" role="status" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className="flex items-start gap-3 bg-white border border-[var(--border)] rounded-xl shadow-xl px-4 py-3">
            {t.tone === "success" && <CheckCircle2 size={18} className="text-emerald-600 shrink-0 mt-0.5" aria-hidden />}
            {t.tone === "error" && <AlertTriangle size={18} className="text-danger shrink-0 mt-0.5" aria-hidden />}
            {t.tone === "info" && <Info size={18} className="text-cyan shrink-0 mt-0.5" aria-hidden />}
            <p className="text-sm text-slate-700 flex-1">{t.message}</p>
            <button onClick={() => setToasts(x => x.filter(y => y.id !== t.id))} className="text-slate-400 hover:text-navy" aria-label="Fermer">
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);