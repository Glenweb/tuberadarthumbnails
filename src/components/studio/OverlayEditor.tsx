"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TextOverlay } from "@/lib/db/types";
import { FONTS } from "@/lib/imaging/fonts";
import { OVERLAY_STYLES, type OverlayStyle } from "@/lib/imaging/presets";
import {
  CANVAS_H,
  CANVAS_W,
  drawGuides,
  drawOverlay,
  drawScrim,
  layoutOverlay,
  type Ctx2D,
  type ScrimSpec,
} from "@/lib/imaging/draw";
import { api, type VariantDTO } from "@/lib/client";
import { Banner, Field, Spinner, Toggle } from "@/components/ui";

const SWATCHES = [
  "#ffffff", "#000000", "#facc15", "#22d3ee", "#ff3d57",
  "#22c55e", "#f97316", "#a855f7", "#0ea5e9", "#fde047",
];

/** Load the overlay faces before the canvas measures with them. */
async function ensureBrowserFonts() {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  await Promise.all(
    FONTS.map((f) =>
      document.fonts.load(`${f.weight} 100px ${f.id}`).catch(() => undefined),
    ),
  );
  await document.fonts.ready;
}

export function OverlayEditor({
  variant, onSaved, onPreviewChange,
}: {
  variant: VariantDTO;
  onSaved?: (v: VariantDTO) => void;
  /** Fires on every edit so the parent can re-score live. */
  onPreviewChange?: (overlays: TextOverlay[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shelfRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [overlays, setOverlays] = useState<TextOverlay[]>(variant.overlays);
  const [scrim, setScrim] = useState<ScrimSpec>({ type: "none", strength: 0.5 });
  const [selectedId, setSelectedId] = useState<string | null>(variant.overlays[0]?.id ?? null);
  const [guides, setGuides] = useState(false);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const selected = overlays.find((o) => o.id === selectedId) ?? null;

  // Reset when a different variant is opened.
  useEffect(() => {
    setOverlays(variant.overlays);
    setSelectedId(variant.overlays[0]?.id ?? null);
    setDirty(false);
    setError(null);
  }, [variant.id, variant.overlays]);

  // Load the base image and the overlay fonts before first paint.
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    const url = variant.baseAssetUrl;
    if (!url) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = async () => {
      await ensureBrowserFonts();
      if (cancelled) return;
      imgRef.current = img;
      setReady(true);
    };
    img.onerror = () => !cancelled && setError("The base image for this variant could not be loaded.");
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [variant.baseAssetUrl]);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    const scale = Math.max(CANVAS_W / img.width, CANVAS_H / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, (CANVAS_W - dw) / 2, (CANVAS_H - dh) / 2, dw, dh);

    const shared = ctx as unknown as Ctx2D;
    drawScrim(shared, scrim);
    for (const o of overlays) drawOverlay(shared, o);
    if (guides) drawGuides(shared);

    // Selection outline, drawn last and never exported.
    if (selected) {
      const { box } = layoutOverlay(shared, selected);
      ctx.save();
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 3;
      ctx.setLineDash([9, 6]);
      ctx.strokeRect(box.x - 6, box.y - 6, box.w + 12, box.h + 12);
      ctx.restore();
    }

    // Mirror into the shelf-size preview: the size that decides the click.
    const shelf = shelfRef.current;
    if (shelf) {
      const sctx = shelf.getContext("2d");
      if (sctx) {
        sctx.clearRect(0, 0, 168, 94);
        sctx.drawImage(canvas, 0, 0, 168, 94);
      }
    }
  }, [overlays, scrim, guides, selected]);

  useEffect(() => {
    if (ready) paint();
  }, [ready, paint]);

  const update = useCallback(
    (patch: Partial<TextOverlay>) => {
      if (!selectedId) return;
      setOverlays((prev) => {
        const next = prev.map((o) => (o.id === selectedId ? { ...o, ...patch } : o));
        onPreviewChange?.(next);
        return next;
      });
      setDirty(true);
    },
    [selectedId, onPreviewChange],
  );

  /* ───────────────────────── Drag to reposition ───────────────────────── */

  const dragState = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const toCanvasCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_H,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    const { x, y } = toCanvasCoords(e);

    // Topmost overlay whose box contains the point wins.
    for (let i = overlays.length - 1; i >= 0; i--) {
      const o = overlays[i];
      const { box } = layoutOverlay(ctx as unknown as Ctx2D, o);
      if (x >= box.x - 8 && x <= box.x + box.w + 8 && y >= box.y - 8 && y <= box.y + box.h + 8) {
        setSelectedId(o.id);
        dragState.current = { id: o.id, dx: x - o.x * CANVAS_W, dy: y - o.y * CANVAS_H };
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
    }
    setSelectedId(null);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragState.current;
    if (!drag) return;
    const { x, y } = toCanvasCoords(e);
    setOverlays((prev) => {
      const next = prev.map((o) =>
        o.id === drag.id
          ? {
              ...o,
              x: Math.max(-0.1, Math.min(0.98, (x - drag.dx) / CANVAS_W)),
              y: Math.max(-0.05, Math.min(0.98, (y - drag.dy) / CANVAS_H)),
            }
          : o,
      );
      onPreviewChange?.(next);
      return next;
    });
    setDirty(true);
  };

  const endDrag = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragState.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
    }
    dragState.current = null;
  };

  /* ───────────────────────────── Actions ──────────────────────────────── */

  const addLayer = () => {
    const id = `layer_${Date.now().toString(36)}`;
    const layer: TextOverlay = {
      id,
      text: "NEW LINE",
      x: 0.06, y: 0.12, w: 0.44,
      size: 64, font: "TRGrotesk", weight: 700,
      color: "#ffffff", align: "left", uppercase: true,
      letterSpacing: 0, lineHeight: 1.05,
      stroke: { width: 7, color: "#000000" },
      shadow: null, plate: null, rotation: 0,
    };
    setOverlays((prev) => {
      const next = [...prev, layer];
      onPreviewChange?.(next);
      return next;
    });
    setSelectedId(id);
    setDirty(true);
  };

  const removeLayer = () => {
    if (!selectedId) return;
    setOverlays((prev) => {
      const next = prev.filter((o) => o.id !== selectedId);
      onPreviewChange?.(next);
      return next;
    });
    setSelectedId(null);
    setDirty(true);
  };

  const applyStyle = (style: OverlayStyle) => {
    if (!selected) return;
    const accent = variant.concept?.palette?.at(-1) ?? "#facc15";
    const presets: Record<OverlayStyle, Partial<TextOverlay>> = {
      impact: {
        color: "#ffffff", font: "TRDisplayBlack", weight: 900, letterSpacing: -1.5,
        stroke: { width: Math.round(selected.size * 0.1), color: "#000000" },
        shadow: { blur: 26, color: "rgba(0,0,0,0.72)", dx: 0, dy: 8 }, plate: null,
      },
      plate: {
        color: "#0b0f19", font: "TRDisplayXBold", weight: 800, letterSpacing: -0.5,
        stroke: null, shadow: { blur: 30, color: "rgba(0,0,0,0.5)", dx: 0, dy: 10 },
        plate: { color: accent, padding: Math.round(selected.size * 0.16), radius: 10 },
      },
      kicker: {
        color: "#ffffff", font: "TRGrotesk", weight: 700, letterSpacing: 2,
        stroke: null, shadow: null,
        plate: { color: accent, padding: 12, radius: 6 },
      },
      outline: {
        color: accent, font: "TRDisplayBlack", weight: 900, letterSpacing: -1,
        stroke: { width: Math.round(selected.size * 0.14), color: "#07080d" },
        shadow: { blur: 18, color: "rgba(0,0,0,0.6)", dx: 0, dy: 6 }, plate: null,
      },
      editorial: {
        color: "#ffffff", font: "TRGrotesk", weight: 700, letterSpacing: 0.5,
        lineHeight: 1.12, stroke: null,
        shadow: { blur: 34, color: "rgba(0,0,0,0.8)", dx: 0, dy: 4 }, plate: null,
      },
    };
    update(presets[style]);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await api.patch<{ variant: VariantDTO; creditsRemaining: number }>(
        `/api/variants/${variant.id}`,
        { overlays, scrim },
      );
      setDirty(false);
      onSaved?.(res.variant);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this edit.");
    } finally {
      setSaving(false);
    }
  };

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Repaint without the selection outline and guides so the export is clean.
    const prevSelected = selectedId;
    const prevGuides = guides;
    setSelectedId(null);
    setGuides(false);
    requestAnimationFrame(() => {
      paint();
      requestAnimationFrame(() => {
        const link = document.createElement("a");
        link.download = `${variant.label.replace(/[^\w-]+/g, "-").toLowerCase()}-1280x720.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
        setSelectedId(prevSelected);
        setGuides(prevGuides);
      });
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_288px]">
      <div className="min-w-0 space-y-3">
        <div className="relative overflow-hidden rounded-[13px] border border-ink-700 bg-ink-800">
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            className="block w-full touch-none select-none"
            style={{ aspectRatio: "16 / 9", cursor: dragState.current ? "grabbing" : "grab" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
          {!ready && (
            <div className="absolute inset-0 grid place-items-center bg-ink-900/85">
              <span className="flex items-center gap-2 text-[12.5px] text-ink-300">
                <Spinner /> Loading canvas…
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Toggle checked={guides} onChange={setGuides} label="Guides" />
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-ink-400">Shelf size</span>
            <canvas
              ref={shelfRef}
              width={168}
              height={94}
              className="rounded-[6px] border border-ink-600"
              title="How it reads at 168×94 — the size that decides the click"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button className="btn btn-ghost btn-sm" onClick={download} disabled={!ready}>
              Download PNG
            </button>
            <button
              className={`btn btn-sm ${dirty || saving ? "btn-primary" : "btn-ghost"}`}
              onClick={save}
              disabled={!dirty || saving}
            >
              {saving ? <><Spinner /> Saving</> : dirty ? "Save edit" : "Saved"}
            </button>
          </div>
        </div>

        {error && <Banner tone="error" onDismiss={() => setError(null)}>{error}</Banner>}
      </div>

      {/* ───────────────────────── Controls ───────────────────────── */}
      <aside className="space-y-3">
        <div className="panel-tight p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-ink-400">Layers</span>
            <div className="flex gap-1">
              <button className="btn btn-quiet btn-sm" onClick={addLayer}>+ Add</button>
              <button className="btn btn-quiet btn-sm" onClick={removeLayer} disabled={!selectedId}>Remove</button>
            </div>
          </div>
          <ul className="space-y-1">
            {overlays.length === 0 && <li className="text-[12px] text-ink-400">No text layers. Add one.</li>}
            {overlays.map((o) => (
              <li key={o.id}>
                <button
                  onClick={() => setSelectedId(o.id)}
                  className={`w-full truncate rounded-[7px] px-2.5 py-1.5 text-left text-[12px] font-semibold transition-colors ${
                    o.id === selectedId ? "bg-accent-500/15 text-accent-400" : "text-ink-300 hover:bg-ink-800"
                  }`}
                >
                  {o.text || "(empty)"}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {selected ? (
          <div className="panel-tight p-3 space-y-3">
            <Field label="Text">
              <textarea
                className="field min-h-[62px] resize-y"
                value={selected.text}
                onChange={(e) => update({ text: e.target.value })}
              />
            </Field>

            <div>
              <span className="label">Style preset</span>
              <div className="flex flex-wrap gap-1">
                {OVERLAY_STYLES.map((s) => (
                  <button key={s.id} className="btn btn-ghost btn-sm" onClick={() => applyStyle(s.id)} title={s.note}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <Field label="Font">
              <select className="field" value={selected.font} onChange={(e) => update({ font: e.target.value })}>
                {FONTS.map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Slider label="Size" min={24} max={220} value={selected.size} onChange={(v) => update({ size: v })} />
              <Slider label="Width" min={15} max={95} value={Math.round(selected.w * 100)} onChange={(v) => update({ w: v / 100 })} suffix="%" />
              <Slider label="Tracking" min={-8} max={16} value={selected.letterSpacing} onChange={(v) => update({ letterSpacing: v })} />
              <Slider label="Line height" min={80} max={180} value={Math.round(selected.lineHeight * 100)} onChange={(v) => update({ lineHeight: v / 100 })} suffix="%" />
              <Slider label="Rotation" min={-15} max={15} value={selected.rotation} onChange={(v) => update({ rotation: v })} suffix="°" />
              <Slider
                label="Stroke"
                min={0}
                max={34}
                value={selected.stroke?.width ?? 0}
                onChange={(v) => update({ stroke: v === 0 ? null : { width: v, color: selected.stroke?.color ?? "#000000" } })}
              />
            </div>

            <div>
              <span className="label">Colour</span>
              <div className="flex flex-wrap gap-1.5">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    onClick={() => update({ color: c })}
                    className={`h-6 w-6 rounded-[5px] border transition-transform hover:scale-110 ${
                      selected.color.toLowerCase() === c ? "border-accent-500 ring-2 ring-accent-500/40" : "border-ink-600"
                    }`}
                    style={{ background: c }}
                    aria-label={`Set colour ${c}`}
                  />
                ))}
                <input
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(selected.color) ? selected.color : "#ffffff"}
                  onChange={(e) => update({ color: e.target.value })}
                  className="h-6 w-6 cursor-pointer rounded-[5px] border border-ink-600 bg-transparent p-0"
                  aria-label="Custom colour"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Toggle checked={selected.uppercase} onChange={(v) => update({ uppercase: v })} label="Caps" />
              <Toggle
                checked={Boolean(selected.shadow)}
                onChange={(v) => update({ shadow: v ? { blur: 26, color: "rgba(0,0,0,0.72)", dx: 0, dy: 8 } : null })}
                label="Shadow"
              />
              <Toggle
                checked={Boolean(selected.plate)}
                onChange={(v) =>
                  update({
                    plate: v
                      ? { color: variant.concept?.palette?.at(-1) ?? "#facc15", padding: Math.round(selected.size * 0.16), radius: 10 }
                      : null,
                  })
                }
                label="Plate"
              />
            </div>

            <div className="flex gap-1">
              {(["left", "center", "right"] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => update({ align: a })}
                  className={`btn btn-sm flex-1 ${selected.align === a ? "btn-accent" : "btn-ghost"}`}
                >
                  {a[0].toUpperCase() + a.slice(1)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="panel-tight p-3 text-[12px] text-ink-400">
            Click a text layer on the canvas to edit it, or drag it to reposition.
          </div>
        )}

        <div className="panel-tight p-3 space-y-2">
          <span className="label">Background scrim</span>
          <select
            className="field"
            value={scrim.type}
            onChange={(e) => { setScrim((s) => ({ ...s, type: e.target.value as ScrimSpec["type"] })); setDirty(true); }}
          >
            <option value="none">None</option>
            <option value="bottom">Bottom fade</option>
            <option value="left">Left fade</option>
            <option value="radial">Radial</option>
            <option value="vignette">Vignette</option>
          </select>
          {scrim.type !== "none" && (
            <Slider
              label="Strength"
              min={10}
              max={95}
              value={Math.round(scrim.strength * 100)}
              onChange={(v) => { setScrim((s) => ({ ...s, strength: v / 100 })); setDirty(true); }}
              suffix="%"
            />
          )}
          <p className="text-[11px] leading-snug text-ink-400">
            A scrim is the cheapest legibility fix there is: it lifts text contrast without touching the image.
          </p>
        </div>
      </aside>
    </div>
  );
}

function Slider({
  label, min, max, value, onChange, suffix = "",
}: { label: string; min: number; max: number; value: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-ink-400">{label}</span>
        <span className="tabular text-[11px] font-semibold text-ink-200">{Math.round(value)}{suffix}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-[var(--color-accent-500)]"
      />
    </label>
  );
}
