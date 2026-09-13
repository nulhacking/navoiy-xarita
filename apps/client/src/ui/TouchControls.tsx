import { useEffect, useRef, useState } from 'react';

import type { Input } from '../city/Input.ts';
import { useAppStore } from '../state/store.ts';

/** Joystik radiusi, px — tutqich shundan uzoqqa chiqmaydi. */
const RADIUS = 52;
/** Markaz atrofidagi o'lik zona: barmoq qimirlashi yurishga aylanmasin. */
const DEAD_ZONE = 0.12;

/**
 * Telefon va planshet uchun ekrandagi boshqaruv.
 *
 * Hammasi `Input` ga klaviatura bilan bir xil kodlar (`KeyF`, `Space`, …)
 * orqali boradi — `Player` boshqaruvning qayerdan kelayotganini bilmaydi.
 * Kamera joystik va tugmalardan tashqaridagi har qanday joyni sudrab
 * aylantiriladi (bu `Input` ning o'zida, canvas ustida).
 */
export function TouchControls({ input }: { input: Input }) {
  const ready = useAppStore((s) => s.ready);
  const mapOpen = useAppStore((s) => s.mapOpen);
  const player = useAppStore((s) => s.player);
  const setMapOpen = useAppStore((s) => s.setMapOpen);
  const [running, setRunning] = useState(false);
  const driving = player.mode === 'drive';

  // Yugurish yopishqoq tugma: barmoqni ushlab turish noqulay.
  useEffect(() => {
    input.setVirtualKey('ShiftLeft', running && !driving);
  }, [input, running, driving]);

  if (!ready || mapOpen) return null;

  return (
    <div className="touch-controls">
      <Joystick input={input} />
      <div className="touch-buttons">
        <HoldButton input={input} code="Space" label={driving ? 'Tormoz' : 'Sakrash'} icon={driving ? '■' : '⤒'} />
        {driving
          ? <HoldButton input={input} code="KeyC" label="Orqaga" icon="↺" />
          : (
            <button type="button" className={`touch-btn ${running ? 'on' : ''}`} onClick={() => setRunning(!running)}>
              <span>»</span><small>Yugurish</small>
            </button>
          )}
        <HoldButton
          input={input}
          code="KeyF"
          label={driving ? 'Tushish' : 'O‘tirish'}
          icon={driving ? '⇲' : '🚗'}
          hot={!driving && player.nearCar}
          disabled={!driving && !player.nearCar}
        />
        <button type="button" className="touch-btn" onClick={() => setMapOpen(true)}>
          <span>⌖</span><small>Xarita</small>
        </button>
      </div>
    </div>
  );
}

function HoldButton({ input, code, label, icon, hot = false, disabled = false }: {
  input: Input; code: string; label: string; icon: string; hot?: boolean; disabled?: boolean;
}) {
  const release = () => input.setVirtualKey(code, false);
  // Tugma yo'qolsa (masalan mashinadan tushganda) bosilgan holat qolib ketmasin.
  useEffect(() => release, [input, code]);
  return (
    <button
      type="button"
      className={`touch-btn ${hot ? 'hot' : ''}`}
      disabled={disabled}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        input.setVirtualKey(code, true);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span>{icon}</span><small>{label}</small>
    </button>
  );
}

function Joystick({ input }: { input: Input }) {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef<number | null>(null);

  const move = (clientX: number, clientY: number) => {
    const rect = base.current?.getBoundingClientRect();
    if (!rect) return;
    let dx = clientX - (rect.left + rect.width / 2);
    let dy = clientY - (rect.top + rect.height / 2);
    const length = Math.hypot(dx, dy);
    if (length > RADIUS) { dx *= RADIUS / length; dy *= RADIUS / length; }
    setKnob({ x: dx, y: dy });
    const magnitude = Math.min(1, length / RADIUS);
    const scale = magnitude < DEAD_ZONE ? 0 : (magnitude - DEAD_ZONE) / (1 - DEAD_ZONE) / (magnitude || 1);
    input.setVirtualAxis(dx / RADIUS * scale, -dy / RADIUS * scale);
  };
  const end = () => {
    active.current = null;
    setKnob({ x: 0, y: 0 });
    input.setVirtualAxis(0, 0);
  };
  useEffect(() => () => input.setVirtualAxis(0, 0), [input]);

  return (
    <div
      ref={base}
      className="joystick"
      onPointerDown={(event) => {
        active.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        move(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => { if (active.current === event.pointerId) move(event.clientX, event.clientY); }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div className="joystick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}
