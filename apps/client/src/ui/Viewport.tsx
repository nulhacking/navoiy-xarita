import { useEffect, useRef, useState } from 'react';

import { CityWorld } from '../city/CityWorld.ts';
import { Input } from '../city/Input.ts';
import { Minimap } from '../city/Minimap.ts';
import { cityHour, formatCityTime } from '../city/WorldClock.ts';
import { Engine } from '../engine/Engine.ts';
import { useAppStore } from '../state/store.ts';
import { BigMap } from './BigMap.tsx';
import { Hud } from './Hud.tsx';
import { TouchControls } from './TouchControls.tsx';
import { isTouchDevice } from './device.ts';
import { QUALITY } from '../city/Quality.ts';

/** UI ni har kadr yangilash isrofgarchilik — sekundiga 5 marta yetarli. */
const HUD_INTERVAL = 0.2;

export function Viewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const cityRef = useRef<CityWorld | null>(null);
  // Ekrandagi boshqaruv `Input` ga to'g'ridan-to'g'ri yozadi; u effekt ichida yaratiladi.
  const [input, setInput] = useState<Input | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Canvas'ni React emas, effektning o'zi yaratadi: StrictMode dev'da
    // effektni ikki marta ishga tushiradi, WebGL konteksti esa bir canvas'ga
    // bir marta olinadi va `dispose()` dan keyin ham qaytarib bo'lmaydi.
    const canvas = document.createElement('canvas');
    canvas.tabIndex = 0;
    container.appendChild(canvas);

    let engine: Engine;
    let input: Input;
    let city: CityWorld;

    try {
      engine = new Engine(canvas);
      // Shahar masshtabida logarifmik depth kerak emas va u ba'zi GPU'larda
      // sekinroq — oddiy near/far yetarli.
      engine.camera.near = 0.2;
      engine.camera.far = QUALITY.cameraFar;
      engine.camera.updateProjectionMatrix();

      input = new Input(canvas);
      city = new CityWorld({
        engine,
        input,
        onError: (message) => useAppStore.getState().pushError(message),
      });
    } catch (error) {
      canvas.remove();
      setFatal(error instanceof Error ? error.message : String(error));
      return;
    }

    cityRef.current = city;
    setInput(input);
    document.body.classList.toggle('touch', isTouchDevice);
    let disposed = false;
    let hudTimer = 0;
    let removeMinimap: (() => void) | null = null;

    const removeSystem = engine.addSystem((ctx) => {
      city.update(ctx);

      hudTimer += ctx.dt;
      if (hudTimer >= HUD_INTERVAL) {
        hudTimer = 0;
        const store = useAppStore.getState();
        store.setStats(engine.getStats());
        store.setCity(city.stats);
        const player = city.playerState;
        if (player) {
          if (store.waypoint) store.setWaypoint({ ...store.waypoint,
            distance: Math.hypot(player.position.x - store.waypoint.x, player.position.z - store.waypoint.z) });
          store.setPlayer({
            mode: player.mode,
            vehicleLabel: player.vehicleLabel,
            speed: player.speed,
            nearCar: player.nearCar,
            grounded: player.grounded,
            water: player.water,
          });
        }
        const sky = city.skyState;
        if (sky) {
          store.setSky({
            time: formatCityTime(sky.date),
            hour: cityHour(sky.date),
            live: city.clock.live,
            daylight: sky.daylight,
            sunAltitude: (sky.sun.altitude * 180) / Math.PI,
            moonAltitude: (sky.moon.altitude * 180) / Math.PI,
            moonIllumination: sky.moon.illumination,
          });
        }
      }
    });

    city
      .load()
      .then(() => {
        if (disposed) return;

        // Mini-xarita shahar yuklangandan keyin ulanadi: unga o'yinchi va
        // tayl ma'lumoti kerak, ular esa `load()` da yaratiladi.
        const canvasEl = minimapRef.current;
        if (canvasEl) {
          const minimap = new Minimap(canvasEl, {
            mapTiles: () => city.mapTiles(),
            playerXZ: () => {
              const p = city.playerState;
              return p ? { x: p.position.x, z: p.position.z } : { x: 0, z: 0 };
            },
            playerHeading: () => city.playerState?.heading ?? 0,
            carXZ: () => {
              const p = city.playerState;
              return p && p.mode === 'walk' ? { x: p.carPosition.x, z: p.carPosition.z } : null;
            },
            waypoint: () => useAppStore.getState().waypoint,
          });
          removeMinimap = engine.addSystem((ctx) => minimap.update(ctx.dt));
        }

        useAppStore.getState().setReady(true);
        engine.start();
      })
      .catch((error: unknown) => {
        if (!disposed) setFatal(error instanceof Error ? error.message : String(error));
      });

    // Katta xarita ochilganda boshqaruv to'xtaydi; metka esa 3D dunyoda
    // ustun sifatida ko'rsatiladi.
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (state.mapOpen !== previous.mapOpen) {
        input.setEnabled(!state.mapOpen);
        city.paused = state.mapOpen;
      }
      if (state.waypoint !== previous.waypoint) city.setWaypoint(state.waypoint);
    });

    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'F3' && !event.repeat) {
        event.preventDefault();
        useAppStore.getState().toggleStats();
      }
      if (event.code === 'KeyM' && !event.repeat) {
        const store = useAppStore.getState();
        if (!store.mapOpen) store.setMapOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);

    if (import.meta.env.DEV) {
      (window as unknown as { __xarita?: unknown }).__xarita = { engine, city };
    }

    return () => {
      disposed = true;
      removeSystem();
      removeMinimap?.();
      unsubscribe();
      window.removeEventListener('keydown', onKey);
      city.dispose();
      cityRef.current = null;
      setInput(null);
      input.dispose();
      engine.dispose();
      canvas.remove();
      useAppStore.getState().setReady(false);
    };
  }, []);

  return (
    <div className="viewport" ref={containerRef}>
      {fatal ? (
        <div className="setup">
          <div className="card panel">
            <h2>Ishga tushmadi</h2>
            <p>{fatal}</p>
            <p className="note">
              Brauzerda apparat tezlashtirish (hardware acceleration) yoqilganini tekshiring.
            </p>
          </div>
        </div>
      ) : (
        <Hud
          minimapRef={minimapRef}
          touch={isTouchDevice && input ? <TouchControls input={input} /> : null}
          setCityHour={(hour) => cityRef.current?.clock.setCityHour(hour)}
          resetClock={() => cityRef.current?.clock.reset()}
          visitLake={async()=>{
            const city=cityRef.current;if(!city?.frame)return;
            const p=city.frame.toLocal({lat:40.10915,lon:65.36285,alt:0});
            await city.teleport(p.x,p.z);
          }}
          visitHokimiyat={async()=>{
            const city=cityRef.current;if(!city?.hokimiyat)return;
            const p=city.hokimiyat.basis.point(10,60);await city.teleport(p.x,p.z);
          }}
          visitFarxod={async()=>{
            const city=cityRef.current;if(!city?.farxod)return;
            // Maydonning o'rtasi: bino, favvora va haykal bir kadrga tushadi.
            const p=city.farxod.basis.point(-20,-14);await city.teleport(p.x,p.z);
          }}
          visitSoftex={async()=>{
            const city=cityRef.current;if(!city?.softex)return;
            // Maydonchaning janubi-g'arbi: yumaloq burchak, yozuv va ayvon
            // bir kadrga tushadi. Mashina ariq tomonda paydo bo'ladi.
            const p=city.softex.basis.point(-17,6);
            await city.teleport(p.x,p.z);
          }}
          visitXalqlar={async()=>{
            const city=cityRef.current;if(!city?.xalqlar)return;
            // Xiyobon ro'parasi: savdo markazi rotundasi, favvoralar va shoh ko'cha bir kadrda.
            const p=city.xalqlar.basis.point(0,-760);
            await city.teleport(p.x,p.z);
          }}
          bigMap={
            <BigMap
              loadOverview={() => cityRef.current?.overview() ?? Promise.resolve(null)}
              playerXZ={() => {
                const p = cityRef.current?.playerState;
                return p ? { x: p.position.x, z: p.position.z } : { x: 0, z: 0 };
              }}
              teleport={(x, z) => cityRef.current?.teleport(x, z)}
            />
          }
        />
      )}
    </div>
  );
}
