"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { FileText, X, ChevronRight, ZoomIn, ZoomOut, Maximize2, Loader2 } from "lucide-react";

import { API } from "../lib/api";

interface CitationSource {
  fileName: string;
  page: string | number;
}

interface CitationBadgeProps {
  index: number;
  source: CitationSource;
  value: string;
  allPages: {
    fileName: string;
    page: string | number;
    markdown: string;
    image?: string;
  }[];
}

interface BBox {
  x: number; y: number;
  width: number; height: number;
  img_w: number; img_h: number;
}

function findInMarkdown(markdown: string, value: string) {
  if (!markdown || !value || value.length < 2) return null;
  const lower    = markdown.toLowerCase();
  const valLower = value.toLowerCase().trim();
  const idx      = lower.indexOf(valLower);
  if (idx === -1) return null;
  const start = Math.max(0, idx - 110);
  const end   = Math.min(markdown.length, idx + valLower.length + 110);
  const clean = (s: string) => s.replace(/[#*_`|>\-]{2,}/g, " ").replace(/\s+/g, " ").trim();
  return {
    before: (start > 0 ? "…" : "") + clean(markdown.slice(start, idx)),
    match:  markdown.slice(idx, idx + valLower.length),
    after:  clean(markdown.slice(idx + valLower.length, end)) + (end < markdown.length ? "…" : ""),
  };
}

// ─── Image + canvas highlight — coordonnées calculées sur l'image réelle ─────
function ImageWithHighlight({
  imageb64,
  bbox,
  zoom,
}: {
  imageb64: string;
  bbox: BBox | null;
  zoom: number;
}) {
  const imgRef    = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = useCallback(() => {
    const img    = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas || !bbox) return;

    // Taille naturelle de l'image (pixels originaux du JPEG)
    const natW = img.naturalWidth;
    const natH = img.naturalHeight;
    if (!natW || !natH) return;

    // Taille affichée à l'écran APRES zoom (img est dans le div zoomé)
    const dispW = img.offsetWidth;
    const dispH = img.offsetHeight;

    // Canvas de la même taille que l'image affichée
    canvas.width  = dispW;
    canvas.height = dispH;

    // Ratio entre coordonnées OCR (basées sur natW/natH) et affichage réel
    const rx = dispW / natW;
    const ry = dispH / natH;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, dispW, dispH);

    const x   = bbox.x      * rx;
    const y   = bbox.y      * ry;
    const w   = bbox.width  * rx;
    const h   = bbox.height * ry;
    const pad = 5;

    // Fond jaune semi-transparent
    ctx.fillStyle = "rgba(250, 204, 21, 0.38)";
    ctx.fillRect(x - pad, y - pad, w + pad * 2, h + pad * 2);

    // Bordure orange
    ctx.strokeStyle = "rgba(234, 88, 12, 0.9)";
    ctx.lineWidth   = 2.5;
    ctx.strokeRect(x - pad, y - pad, w + pad * 2, h + pad * 2);
  }, [bbox]);

  // Redessine quand bbox change ou quand zoom change (car offsetWidth change)
  useEffect(() => {
    const timer = setTimeout(draw, 50);
    return () => clearTimeout(timer);
  }, [bbox, zoom, draw]);

  return (
    <div className="relative w-full">
      <img
        ref={imgRef}
        src={`data:image/jpeg;base64,${imageb64}`}
        alt="page"
        className="w-full h-auto block"
        draggable={false}
        onLoad={draw}
      />
      {bbox && (
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0 pointer-events-none"
          style={{ width: "100%", height: "100%" }}
        />
      )}
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────
export function CitationBadge({ index, source, value, allPages }: CitationBadgeProps) {
  const [open, setOpen]           = useState(false);
  const [zoom, setZoom]           = useState(1.8);
  const [expanded, setExpanded]   = useState(false);
  const [mode, setMode]           = useState<"image" | "text">("image");
  const [bbox, setBbox]           = useState<BBox | null>(null);
  const [locating, setLocating]   = useState(false);
  const popupRef                  = useRef<HTMLDivElement>(null);
  const badgeRef                  = useRef<HTMLButtonElement>(null);
  const [placement, setPlacement] = useState<"bottom" | "top">("bottom");

  const matchedPage = allPages.find(
    (p) => p.fileName === source.fileName && String(p.page) === String(source.page)
  );
  const hasImage  = !!matchedPage?.image && matchedPage.image !== "";
  const mdContext = matchedPage ? findInMarkdown(matchedPage.markdown, value) : null;

  const locateValue = useCallback(async () => {
    if (!hasImage || !matchedPage?.image) return;
    setLocating(true);
    setBbox(null);
    try {
      const res  = await fetch(`${API}/locate-value`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: matchedPage.image, value }),
      });
      const data = await res.json();
      setBbox(data.bbox ?? null);
    } catch {
      setBbox(null);
    } finally {
      setLocating(false);
    }
  }, [hasImage, matchedPage, value]);

  useEffect(() => {
    if (open && hasImage) {
      setMode("image");
      setZoom(1.8);
      locateValue();
    }
    if (!open) { setExpanded(false); setBbox(null); }
  }, [open]);

  useEffect(() => {
    if (!open || !badgeRef.current) return;
    const rect = badgeRef.current.getBoundingClientRect();
    setPlacement(window.innerHeight - rect.bottom < 300 ? "top" : "bottom");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popupRef.current && !popupRef.current.contains(e.target as Node) &&
        badgeRef.current && !badgeRef.current.contains(e.target as Node)
      ) { setOpen(false); setExpanded(false); }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const popupW = expanded ? "w-[680px]" : "w-[400px]";

  return (
    <span className="relative inline-block ml-1.5 align-middle">

      {/* ── Badge ── */}
      <button
        ref={badgeRef}
        onClick={() => setOpen((o) => !o)}
        className={`
          inline-flex items-center justify-center w-[18px] h-[18px] rounded-full
          text-[9px] font-black leading-none transition-all duration-150 select-none border
          ${open
            ? "bg-blue-600 text-white border-blue-600 shadow-sm"
            : "bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100"
          }
        `}
      >
        {index}
      </button>

      {/* ── Popup ── */}
      {open && (
        <div
          ref={popupRef}
          className={`
            absolute z-50 left-1/2 -translate-x-1/2
            ${placement === "bottom" ? "top-7" : "bottom-7"}
            ${popupW}
            animate-in fade-in duration-100 transition-all
          `}
        >
          <div className="bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">

            {/* ── En-tête ── */}
            <div className="flex items-center justify-between px-3.5 py-2 bg-slate-50 border-b border-slate-100">
              <div className="flex items-center gap-1.5 min-w-0">
                <FileText size={10} className="text-slate-400 shrink-0" />
                <span className="text-[10px] font-bold text-slate-500 truncate max-w-[160px]">
                  {source.fileName}
                </span>
                <ChevronRight size={9} className="text-slate-300 shrink-0" />
                <span className="text-[10px] font-black text-blue-500 shrink-0">
                  p.{source.page}
                </span>
                {locating && (
                  <span className="flex items-center gap-1 text-[9px] text-amber-500 font-bold ml-1.5">
                    <Loader2 size={9} className="animate-spin" /> localisation…
                  </span>
                )}
                {!locating && bbox && (
                  <span className="text-[9px] text-amber-500 font-black ml-1.5">✦ surligné</span>
                )}
                {!locating && !bbox && mode === "image" && (
                  <span className="text-[9px] text-slate-300 ml-1.5">non trouvé</span>
                )}
              </div>

              <div className="flex items-center gap-1 ml-2 shrink-0">
                {hasImage && (
                  <div className="flex items-center bg-slate-100 rounded-lg p-0.5 mr-1.5">
                    <button onClick={() => setMode("image")}
                      className={`px-2 py-0.5 rounded-md text-[9px] font-black transition-all ${mode === "image" ? "bg-white text-slate-700 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}>
                      PDF
                    </button>
                    <button onClick={() => setMode("text")}
                      className={`px-2 py-0.5 rounded-md text-[9px] font-black transition-all ${mode === "text" ? "bg-white text-slate-700 shadow-sm" : "text-slate-400 hover:text-slate-600"}`}>
                      Texte
                    </button>
                  </div>
                )}
                {mode === "image" && hasImage && (
                  <>
                    <button onClick={() => setZoom(z => Math.max(0.8, +(z - 0.3).toFixed(1)))}
                      className="p-0.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors">
                      <ZoomOut size={11} />
                    </button>
                    <span className="text-[9px] text-slate-400 font-bold w-7 text-center">
                      {Math.round(zoom * 100)}%
                    </span>
                    <button onClick={() => setZoom(z => Math.min(4, +(z + 0.3).toFixed(1)))}
                      className="p-0.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors">
                      <ZoomIn size={11} />
                    </button>
                    <div className="w-px h-3.5 bg-slate-200 mx-1" />
                  </>
                )}
                <button onClick={() => setExpanded(e => !e)}
                  className="p-0.5 rounded text-slate-300 hover:text-slate-500 hover:bg-slate-200 transition-colors">
                  <Maximize2 size={11} />
                </button>
                <button onClick={() => { setOpen(false); setExpanded(false); }}
                  className="p-0.5 rounded text-slate-300 hover:text-slate-500 hover:bg-slate-200 transition-colors ml-0.5">
                  <X size={11} />
                </button>
              </div>
            </div>

            {/* ── Corps ── */}
            {mode === "image" && hasImage ? (
              <div className="overflow-auto bg-slate-100" style={{ maxHeight: expanded ? "520px" : "300px" }}>
                <div style={{ transform: `scale(${zoom})`, transformOrigin: "top center", transition: "transform 0.15s ease" }}>
                  <ImageWithHighlight
                    imageb64={matchedPage!.image!}
                    bbox={bbox}
                    zoom={zoom}
                  />
                </div>
              </div>
            ) : (
              <div className="px-4 py-3" style={{ minHeight: "60px" }}>
                {mdContext ? (
                  <p className="text-[12px] leading-relaxed text-slate-600">
                    {mdContext.before && <span className="text-slate-400">{mdContext.before} </span>}
                    <mark className="bg-amber-200 text-amber-900 font-bold rounded-sm px-0.5 not-italic">
                      {mdContext.match}
                    </mark>
                    {mdContext.after && <span className="text-slate-400"> {mdContext.after}</span>}
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    <p className="text-[11px] text-slate-400 italic">
                      La valeur a été interprétée par l'IA depuis cette page — elle peut être formulée différemment dans le document original.
                    </p>
                    {matchedPage?.markdown && (
                      <p className="text-[10px] text-slate-300 font-mono leading-relaxed line-clamp-4">
                        {matchedPage.markdown.slice(0, 300).replace(/[#*_`|>\-]{2,}/g, " ").replace(/\s+/g, " ")}…
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── Footer ── */}
            <div className="px-3.5 py-2 bg-slate-50 border-t border-slate-100 flex items-center gap-2">
              <span className="text-[8px] font-black text-slate-400 uppercase tracking-wider shrink-0">
                Valeur extraite
              </span>
              <span className="text-[10px] font-black text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md truncate">
                {value}
              </span>
            </div>

          </div>
        </div>
      )}
    </span>
  );
}