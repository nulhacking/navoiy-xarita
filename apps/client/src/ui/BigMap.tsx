import { useEffect, useRef, useState } from 'react';

import type { CityOverview } from '../city/CityOverview.ts';
import { MapView } from '../city/MapView.ts';
import { useAppStore } from '../state/store.ts';
import { isTouchDevice } from './device.ts';

export interface BigMapProps {
  /** Umumiy xaritani bir marta quradi (keyingi chaqiruvlar keshdan). */
  loadOverview: () => Promise<CityOverview | null>;
  /** O'yinchining hozirgi joyi, mahalliy metrda. */
  playerXZ: () => { x: number; z: number };
  /** Belgilangan nuqtaga ko'chirish. */
  teleport: (x: number, z: number) => Promise<void> | void;
}

/**
 * Butun shahar xaritasi: bosib metka qo'yish va o'sha joyga o'tish.
 *
 * Mini-xaritani bosganda ochiladi. Xarita ustiga bosilsa, metka qo'yiladi —
 * u mini-xaritada ham, 3D dunyoda ham ko'rinadi. "O'sha yerga o'tish" tugmasi
 * o'yinchini darhol ko'chiradi.
 */
export function BigMap({ loadOverview, playerXZ, teleport }: BigMapProps) {
  const open = useAppStore((s) => s.mapOpen);
  const setOpen = useAppStore((s) => s.setMapOpen);
  const waypoint = useAppStore((s) => s.waypoint);
  const setWaypoint = useAppStore((s) => s.setWaypoint);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overviewRef = useRef<CityOverview | null>(null);
  const view = useRef(new MapView());
  const drag = useRef<{ x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  /** Ekrandagi barmoqlar — ikkitasi bo'lsa masshtab. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [travelling, setTravelling] = useState(false);

  // Xarita ochilganda bir marta quriladi.
  //
  // DIQQAT — `status` bog'liqliklar ro'yxatida BO'LMASLIGI kerak. U bor edi
  // va shu sababli deadlock yuzaga kelardi: `setStatus('loading')` effektni
  // qayta ishga tushirar, eski effekt tozalanib `cancelled = true` bo'lar,
  // yangi chaqiruv esa "allaqachon yuklanmoqda" deb darhol chiqib ketardi.
  // Natijada javob kelganda uni hech kim qabul qilmasdi va xarita abadiy
  // "tayyorlanmoqda" holatida qolardi.
  useEffect(() => {
    if (!open) return;
    if (overviewRef.current) {
      setStatus('ready');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    loadOverview()
      .then((overview) => {
        if (cancelled) return;
        overviewRef.current = overview;
        setStatus(overview ? 'ready' : 'failed');
      })
      .catch(() => {
        if (!cancelled) setStatus('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [open, loadOverview]);

  // Chizish: rasm + o'yinchi + metka.
  useEffect(() => {
    if (!open || status !== 'ready') return;
    const canvas = canvasRef.current;
    const overview = overviewRef.current;
    if (!canvas || !overview) return;

    let frame = 0;
    const render = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio, 2);
      const size = Math.round(Math.min(rect.width, rect.height));
      if (canvas.width !== size * dpr) {
        canvas.width = size * dpr;
        canvas.height = size * dpr;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const v = view.current;
      const origin = v.toScreen(0, 0);
      ctx.drawImage(overview.canvas, origin.x * size, origin.y * size, size * v.zoom, size * v.zoom);
      overview.drawDetail(ctx, size, v.zoom, v.centerX, v.centerY);

      const toScreen = (point: { px: number; py: number }) => {
        const p = v.toScreen(point.px / overview.canvas.width, point.py / overview.canvas.height);
        return { x: p.x * size, y: p.y * size };
      };
      const player = playerXZ();
      const p = toScreen(overview.toPixel(player.x, player.z));

      if (waypoint) {
        const w = toScreen(overview.toPixel(waypoint.x, waypoint.z));
        drawWaypoint(ctx, w.x, w.y);
        // O'yinchidan metkagacha chiziq.
        ctx.strokeStyle = 'rgba(255, 209, 102, 0.6)';
        ctx.setLineDash([6, 5]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(w.x, w.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // O'yinchi — yorqin doira.
      ctx.fillStyle = '#4da3ff';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(frame);
  }, [open, status, waypoint, playerXZ]);

  // Escape bilan yopish.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Escape' || event.code === 'KeyM') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    const overview = overviewRef.current;
    const canvas = canvasRef.current;
    if (!overview || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height);
    const point = view.current.toMap((event.clientX - rect.left) / size, (event.clientY - rect.top) / size);
    const world = overview.toWorld(point.x * overview.canvas.width, point.y * overview.canvas.height);
    const player = playerXZ();
    setWaypoint({
      x: world.x,
      z: world.z,
      distance: Math.hypot(world.x - player.x, world.z - player.z),
    });
  };

  return (
    <div className="bigmap" onClick={() => setOpen(false)}>
      <div className="bigmap-panel panel" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2>Navoiy</h2>
          <span className="hint">
            Xaritaga bosing — metka qo'yiladi. Yopish: <kbd>M</kbd> yoki <kbd>Esc</kbd>
          </span>
          <button type="button" className="close" onClick={() => setOpen(false)}>
            ✕
          </button>
        </header>

        <div className="map-tools" aria-label="Xarita masshtabi">
          <button type="button" aria-label="Yaqinlashtirish" disabled={zoom >= 32} onClick={() => { view.current.zoomAt(1.5); setZoom(view.current.zoom); }}>+</button>
          <span>{zoom.toFixed(1)}×</span>
          <button type="button" aria-label="Uzoqlashtirish" disabled={zoom <= 1} onClick={() => { view.current.zoomAt(1 / 1.5); setZoom(view.current.zoom); }}>−</button>
          <button type="button" onClick={() => { view.current.reset(); setZoom(1); }}>Butun shahar</button>
          <button type="button" onClick={() => {
            const overview = overviewRef.current;
            if (!overview) return;
            const player = playerXZ(), pixel = overview.toPixel(player.x, player.z);
            view.current.zoom = Math.max(view.current.zoom, 8);
            view.current.center(pixel.px / overview.canvas.width, pixel.py / overview.canvas.height);
            setZoom(view.current.zoom);
          }}>Mening joyim</button>
          <small>{isTouchDevice ? 'Ikki barmoq: masshtab · Sudrash: surish' : 'G‘ildirak: masshtab · Sudrash: xaritani surish'}</small>
        </div>
        <div className="bigmap-canvas">
          {status === 'loading' ? <div className="bigmap-status">Xarita tayyorlanmoqda…</div> : null}
          {status === 'failed' ? <div className="bigmap-status">Xaritani yuklab bo'lmadi.</div> : null}
          <canvas ref={canvasRef} onClick={handleClick} aria-label="Navoiy xaritasi" style={{ cursor: 'grab', touchAction: 'none' }}
            onWheel={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const size = Math.min(rect.width, rect.height);
              view.current.zoomAt(Math.exp(-event.deltaY * 0.0015), (event.clientX - rect.left) / size, (event.clientY - rect.top) / size);
              setZoom(view.current.zoom);
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
              // Ikkinchi barmoq tushdi: bu metka qo'yish emas, masshtab.
              if (pointers.current.size > 1) { suppressClick.current = true; drag.current = null; return; }
              suppressClick.current = false;
              drag.current = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false };
            }}
            onPointerMove={(event) => {
              const touch = pointers.current.get(event.pointerId);
              if (touch && pointers.current.size === 2) {
                const [a, b] = [...pointers.current.values()];
                const before = Math.hypot(a!.x - b!.x, a!.y - b!.y);
                touch.x = event.clientX; touch.y = event.clientY;
                const after = Math.hypot(a!.x - b!.x, a!.y - b!.y);
                const rect = event.currentTarget.getBoundingClientRect();
                const size = Math.min(rect.width, rect.height);
                if (before > 10) view.current.zoomAt(after / before, ((a!.x + b!.x) / 2 - rect.left) / size, ((a!.y + b!.y) / 2 - rect.top) / size);
                setZoom(view.current.zoom);
                return;
              }
              if (touch) { touch.x = event.clientX; touch.y = event.clientY; }
              const d = drag.current;
              if (!d) return;
              if (Math.hypot(event.clientX - d.startX, event.clientY - d.startY) > 4) d.moved = true;
              if (d.moved) {
                const rect = event.currentTarget.getBoundingClientRect();
                const size = Math.min(rect.width, rect.height);
                view.current.pan((event.clientX - d.x) / size, (event.clientY - d.y) / size);
              }
              d.x = event.clientX; d.y = event.clientY;
            }}
            onPointerUp={(event) => {
              const pinching = pointers.current.size > 1;
              pointers.current.delete(event.pointerId);
              suppressClick.current = suppressClick.current || pinching || !!drag.current?.moved;
              drag.current = null;
            }}
            onPointerCancel={(event) => { pointers.current.delete(event.pointerId); suppressClick.current = true; drag.current = null; }}
          />
        </div>

        <footer>
          {waypoint ? (
            <>
              <span>
                Metka: <b>{(waypoint.distance / 1000).toFixed(2)} km</b> narida
              </span>
              <button
                type="button"
                className="primary"
                disabled={travelling}
                onClick={async () => {
                  setTravelling(true);
                  try { await teleport(waypoint.x, waypoint.z); setOpen(false); }
                  finally { setTravelling(false); }
                }}
              >
                {travelling ? 'Hudud yuklanmoqda…' : "O'sha yerda paydo bo'lish"}
              </button>
              <button type="button" onClick={() => setWaypoint(null)}>
                Metkani o'chirish
              </button>
            </>
          ) : (
            <span className="hint">Metka qo‘yish uchun xaritaga bosing. Ko‘chirish eng yaqin xavfsiz yo‘lga amalga oshiriladi.</span>
          )}
        </footer>
      </div>
    </div>
  );
}

function drawWaypoint(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = '#ffd166';
  ctx.strokeStyle = '#3a2c00';
  ctx.lineWidth = 1.5;
  // Tomchi shaklidagi belgi: uchi aynan nuqtada turadi.
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - 6, y - 12);
  ctx.arc(x, y - 16, 7, Math.PI * 0.78, Math.PI * 0.22, false);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}
