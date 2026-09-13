import { create } from 'zustand';

import type { CityStats } from '../city/CityWorld.ts';
import type { PlayerMode } from '../city/Player.ts';
import type { EngineStats } from '../engine/Engine.ts';

export interface PlayerHud {
  vehicleLabel: string;
  mode: PlayerMode;
  /** km/soat. */
  speed: number;
  nearCar: boolean;
  grounded: boolean;
  /** Suvda: 0 — quruqlikda, 1 — kechyapti, 2 — suzyapti. */
  water: 0 | 1 | 2;
}

/** Osmon va soat — HUD uchun. */
export interface SkyHud {
  /** Shahar vaqti, `HH:MM`. */
  time: string;
  /** Sutkaning soati, 0..24 — slayder shu qiymatda turadi. */
  hour: number;
  /** Soat haqiqiy vaqt bilan yuryaptimi? */
  live: boolean;
  /** 0 — tun, 1 — kunduz. */
  daylight: number;
  /** Quyosh va oyning ufqdan balandligi, gradus. */
  sunAltitude: number;
  moonAltitude: number;
  /** Oy diskining yoritilgan ulushi, 0..1. */
  moonIllumination: number;
}

export interface Waypoint {
  /** Mahalliy metrda. */
  x: number;
  z: number;
  /** O'yinchidan masofa, metr — HUD ko'rsatadi. */
  distance: number;
}

interface AppState {
  ready: boolean;
  mapOpen: boolean;
  waypoint: Waypoint | null;
  stats: EngineStats | null;
  city: CityStats;
  player: PlayerHud;
  sky: SkyHud;
  errors: string[];
  showStats: boolean;

  setReady: (ready: boolean) => void;
  setMapOpen: (open: boolean) => void;
  setWaypoint: (waypoint: Waypoint | null) => void;
  setStats: (stats: EngineStats) => void;
  setCity: (city: CityStats) => void;
  setPlayer: (player: PlayerHud) => void;
  setSky: (sky: SkyHud) => void;
  pushError: (message: string) => void;
  toggleStats: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  ready: false,
  mapOpen: false,
  waypoint: null,
  stats: null,
  city: { tiles: 0, buildings: 0, triangles: 0, physicsTiles: 0, loading: 0, cars: 0, people: 0 },
  player: { mode: 'walk', speed: 0, nearCar: false, grounded: false, vehicleLabel: 'Transport', water: 0 },
  sky: { time: '--:--', hour: 12, live: true, daylight: 1, sunAltitude: 45, moonAltitude: -30, moonIllumination: 0 },
  errors: [],
  showStats: false,

  setReady: (ready) => set({ ready }),
  setMapOpen: (mapOpen) => set({ mapOpen }),
  setWaypoint: (waypoint) => set({ waypoint }),
  setStats: (stats) => set({ stats }),
  setCity: (city) => set({ city }),
  setPlayer: (player) => set({ player }),
  setSky: (sky) => set({ sky }),
  // Bir xil xato ketma-ket takrorlanishi mumkin — faqat oxirgi 5 tasi saqlanadi.
  pushError: (message) =>
    set((state) =>
      state.errors[0] === message ? state : { errors: [message, ...state.errors].slice(0, 5) },
    ),
  toggleStats: () => set((state) => ({ showStats: !state.showStats })),
}));
