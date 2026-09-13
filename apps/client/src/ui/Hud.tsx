import { useState } from 'react';

import { useAppStore } from '../state/store.ts';
import { MODEL_ATTRIBUTION } from '../city/models.ts';
import { isTouchDevice } from './device.ts';

/** Navoiy o'yin rejimi uchun HUD. */
export function Hud({
  minimapRef,
  bigMap,
  touch,
  setCityHour,
  resetClock,
  visitLake,
  visitHokimiyat,
  visitFarxod,
  visitSoftex,
  visitXalqlar,
}: {
  minimapRef: React.Ref<HTMLCanvasElement>;
  bigMap: React.ReactNode;
  /** Telefon/planshet boshqaruvi; kompyuterda `null`. */
  touch: React.ReactNode;
  setCityHour: (hour: number) => void;
  resetClock: () => void;
  visitLake: () => Promise<void>;
  visitHokimiyat: () => Promise<void>;
  visitFarxod: () => Promise<void>;
  visitSoftex: () => Promise<void>;
  visitXalqlar: () => Promise<void>;
}) {
  return (
    <div className="overlay">
      <Minimap canvasRef={minimapRef} />
      {bigMap}
      <Clock setCityHour={setCityHour} resetClock={resetClock} visitLake={visitLake} visitHokimiyat={visitHokimiyat} visitFarxod={visitFarxod} visitSoftex={visitSoftex} visitXalqlar={visitXalqlar} />
      <Loading />
      <Stats />
      {touch ?? <Controls />}
      <Errors />
      <Attribution />
    </div>
  );
}

/**
 * GTA uslubidagi dumaloq mini-xarita.
 * Chizishning o'zi `city/Minimap.ts` da — bu yerda faqat joylashuv.
 */
function Minimap({ canvasRef }: { canvasRef: React.Ref<HTMLCanvasElement> }) {
  const ready = useAppStore((s) => s.ready);
  const player = useAppStore((s) => s.player);
  const setMapOpen = useAppStore((s) => s.setMapOpen);
  const waypoint = useAppStore((s) => s.waypoint);
  return (
    <div className="minimap" style={{ opacity: ready ? 1 : 0 }}>
      <canvas
        ref={canvasRef}
        title="Katta xaritani ochish (M)"
        onClick={() => setMapOpen(true)}
      />
      {waypoint ? (
        <div className="waypoint-badge">
          ⌖ {waypoint.distance < 1000
            ? `${waypoint.distance.toFixed(0)} m`
            : `${(waypoint.distance / 1000).toFixed(1)} km`}
        </div>
      ) : null}
      {player.mode === 'drive' ? (
        <>
          <div className="speedo">
            <span>{player.vehicleLabel} · </span>
            <b>{player.speed.toFixed(0)}</b> km/soat
          </div>
          {player.water ? (
            <div className="speedo">{player.water === 2 ? '🌊 motor suvga to‘ldi — F bilan chiqing' : '💧 suv kechyapti'}</div>
          ) : null}
        </>
      ) : player.water ? (
        <div className="speedo">{player.water === 2 ? '🏊 suzmoqda' : '💧 suvda'}</div>
      ) : null}
    </div>
  );
}

/**
 * Soat va vaqt boshqaruvi.
 *
 * Slayder sutkaning soatini beradi, "hozir" esa haqiqiy vaqtga qaytaradi.
 * Vaqt tanlangandan keyin ham OQISHDA davom etadi (`WorldClock` siljish
 * bilan ishlaydi) — ya'ni 19:30 ni tanlab, quyoshning botishini kuzatib
 * o'tirish mumkin.
 */
function Clock({ setCityHour, resetClock, visitLake, visitHokimiyat, visitFarxod, visitSoftex, visitXalqlar }: { setCityHour: (hour: number) => void; resetClock: () => void; visitLake:()=>Promise<void>; visitHokimiyat:()=>Promise<void>; visitFarxod:()=>Promise<void>; visitSoftex:()=>Promise<void>; visitXalqlar:()=>Promise<void> }) {
  const [visiting,setVisiting]=useState(false);
  const [visitingHokimiyat,setVisitingHokimiyat]=useState(false);
  const [visitingFarxod,setVisitingFarxod]=useState(false);
  const [visitingSoftex,setVisitingSoftex]=useState(false);
  const [visitingXalqlar,setVisitingXalqlar]=useState(false);
  // Telefonda menyu ekranning katta qismini yopib qo'yadi — yig'ilgan holda boshlanadi.
  const [collapsed, setCollapsed] = useState(isTouchDevice);
  const sky = useAppStore((s) => s.sky);
  const ready = useAppStore((s) => s.ready);
  const mapOpen = useAppStore((s) => s.mapOpen);
  // Sudrab turganda slayder o'z qiymatida qoladi: do'kon sekundiga besh marta
  // yangilanadi va usiz tutqich barmoq ostidan qochib ketardi.
  const [dragging, setDragging] = useState<number | null>(null);
  if (!ready || mapOpen) return null;

  const face = sky.sunAltitude > -0.8 ? '☀️' : sky.moonAltitude > 0 ? '🌙' : '🌑';
  const isAnyVisiting = visiting || visitingHokimiyat || visitingFarxod || visitingSoftex || visitingXalqlar;

  return (
    <div className={`clock panel ${collapsed ? 'collapsed' : ''}`}>
      <div className="clock-row">
        <span className="clock-face">{face}</span>
        <b>{sky.time}</b>
        <button
          type="button"
          className={sky.live ? 'live' : ''}
          onClick={() => { setDragging(null); resetClock(); }}
          title="Haqiqiy vaqtga qaytish"
        >
          hozir
        </button>
        <button
          type="button"
          className="clock-toggle"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? "Menyuni ochish" : "Menyuni yig'ish"}
          aria-label={collapsed ? "Menyuni ochish" : "Menyuni yig'ish"}
        >
          {collapsed ? '▾' : '▴'}
        </button>
      </div>
      {!collapsed && (
        <>
          <input
            type="range"
            min={0}
            max={24}
            step={0.25}
            value={dragging ?? sky.hour}
            aria-label="Sutka vaqti"
            onChange={(event) => {
              const hour = Number(event.target.value);
              setDragging(hour);
              setCityHour(hour);
            }}
            onPointerUp={() => setDragging(null)}
            onBlur={() => setDragging(null)}
          />
          <div className="clock-note">
            {sky.sunAltitude > 0
              ? `quyosh ${sky.sunAltitude.toFixed(0)}°`
              : sky.moonAltitude > 0
                ? `oy ${sky.moonAltitude.toFixed(0)}°`
                : 'tun'}
          </div>
          <div className="nav-list">
            <button className="lake-visit" type="button" disabled={isAnyVisiting} onClick={async()=>{setVisiting(true);try{await visitLake();}finally{setVisiting(false);}}}>
              {visiting ? 'Yuklanmoqda…' : '⌖ Ozero qirg‘og‘iga borish'}
            </button>
            <button className="lake-visit" type="button" disabled={isAnyVisiting} onClick={async()=>{setVisitingHokimiyat(true);try{await visitHokimiyat();}finally{setVisitingHokimiyat(false);}}}>
              {visitingHokimiyat ? 'Yuklanmoqda…' : '⌖ Viloyat hokimiyatiga borish'}
            </button>
            <button className="lake-visit" type="button" disabled={isAnyVisiting} onClick={async()=>{setVisitingFarxod(true);try{await visitFarxod();}finally{setVisitingFarxod(false);}}}>
              {visitingFarxod ? 'Yuklanmoqda…' : '⌖ Farhod madaniyat saroyiga borish'}
            </button>
            <button className="lake-visit" type="button" disabled={isAnyVisiting} onClick={async()=>{setVisitingSoftex(true);try{await visitSoftex();}finally{setVisitingSoftex(false);}}}>
              {visitingSoftex ? 'Yuklanmoqda…' : '⌖ SOFTEX markaziga borish'}
            </button>
            <button className="lake-visit" type="button" disabled={isAnyVisiting} onClick={async()=>{setVisitingXalqlar(true);try{await visitXalqlar();}finally{setVisitingXalqlar(false);}}}>
              {visitingXalqlar ? 'Yuklanmoqda…' : "⌖ Xalqlar Do'stligi shoh ko'chasi"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Loading() {
  const ready = useAppStore((s) => s.ready);
  if (ready) return null;
  return (
    <div className="boot">
      <div className="card panel">
        <h2>Navoiy yuklanmoqda…</h2>
        <p>Relyef, binolar va yo'llar tayyorlanmoqda.</p>
      </div>
    </div>
  );
}

function Stats() {
  const stats = useAppStore((s) => s.stats);
  const city = useAppStore((s) => s.city);
  const player = useAppStore((s) => s.player);
  const show = useAppStore((s) => s.showStats);
  if (!show || !stats) return null;

  return (
    <div className="stats panel">
      <div className={`row ${stats.fps < 30 ? 'warn' : ''}`}>
        <span>FPS</span>
        <b>{stats.fps.toFixed(0)}</b>
      </div>
      <div className="row">
        <span>draw calls</span>
        <b>{stats.drawCalls}</b>
      </div>
      <div className="row">
        <span>uchburchak</span>
        <b>{formatCount(stats.triangles)}</b>
      </div>
      <hr />
      <div className="row"><span>jonli shahar</span><b>{city.cars} mashina · {city.people} piyoda</b></div>
      <div className="row">
        <span>binolar</span>
        <b>{formatCount(city.buildings)}</b>
      </div>
      <div className="row">
        <span>tayllar</span>
        <b>
          {city.tiles} ({city.physicsTiles} fizika)
        </b>
      </div>
      <hr />
      <div className="row">
        <span>rejim</span>
        <b>{player.mode === 'drive' ? player.vehicleLabel : 'piyoda'}</b>
      </div>
      {player.mode === 'drive' ? (
        <div className="row">
          <span>tezlik</span>
          <b>{player.speed.toFixed(0)} km/soat</b>
        </div>
      ) : null}
    </div>
  );
}

function Controls() {
  const player = useAppStore((s) => s.player);
  const ready = useAppStore((s) => s.ready);
  const mapOpen = useAppStore((s) => s.mapOpen);
  // Katta xarita ochilganda yordam paneli uning tugmalarini to'sib qo'yardi.
  if (!ready || mapOpen) return null;

  return (
    <div className="help panel">
      {player.mode === 'drive' ? (
        <>
          <kbd>W</kbd>
          <kbd>S</kbd> gaz / tormoz
          <kbd>A</kbd>
          <kbd>D</kbd> burilish
          <kbd>F</kbd> tushish
          <kbd>Space</kbd> qo‘l tormozi
        </>
      ) : (
        <>
          <kbd>W A S D</kbd> yurish
          <kbd>Shift</kbd> yugurish
          <kbd>Space</kbd> sakrash
          <kbd className={player.nearCar ? 'hot' : ''}>F</kbd>
          {player.nearCar ? 'eng yaqin transportga o‘tirish' : 'transport yaqinida'}
        </>
      )}
      <kbd>o‘ng mouse</kbd> aylantirish
      {player.mode === 'drive' ? <><kbd>C</kbd> orqa kamera</> : null}
      <kbd>M</kbd> xarita
      <kbd>F3</kbd> statistika
    </div>
  );
}

function Errors() {
  const errors = useAppStore((s) => s.errors);
  const [dismissed, setDismissed] = useState(false);
  if (errors.length === 0 || dismissed) return null;
  return (
    <div className="errors panel" onClick={() => setDismissed(true)} title="Yashirish uchun bosing">
      {errors.map((error, index) => (
        <div key={`${error}-${index}`}>{error}</div>
      ))}
    </div>
  );
}

/** OSM (ODbL) va AWS Terrain Tiles atributi — litsenziya sharti. */
function Attribution() {
  return (
    <div className="attribution">
      <span className="credits">
        (c) OpenStreetMap contributors · Balandlik: AWS Terrain Tiles (SRTM, NED, GMTED) ·
        {MODEL_ATTRIBUTION}
        {' · '}<a href="/models/credits.html" target="_blank" rel="noreferrer" style={{color:'inherit',pointerEvents:'auto'}}>Model manbalari</a>
      </span>
    </div>
  );
}

function formatCount(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return String(value);
}
