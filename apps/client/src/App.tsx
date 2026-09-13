import { useState } from 'react';

import { Viewport } from './ui/Viewport.tsx';

/** Faqat sensorli ekran: sichqoncha ham, klaviatura ham yo'q deb taxmin qilinadi. */
const touchOnly = typeof window !== 'undefined' &&
  window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches;

/**
 * Ilova hech qanday sozlash talab qilmaydi: barcha ma'lumot manbalari
 * bepul va kalitsiz. `npm run dev` — va u ishlaydi.
 *
 * Boshqaruv hozircha WASD va sichqonchada. Telefonda og'ir 3D sahnani
 * yuklab, keyin boshqarib bo'lmasligini bilish yomon — shuning uchun
 * avval ogohlantiriladi, lekin baribir kirish mumkin.
 */
export function App() {
  const [accepted, setAccepted] = useState(!touchOnly);
  if (!accepted) {
    return (
      <div className="setup">
        <div className="card panel">
          <h2>Kompyuterda oching</h2>
          <p>Navoiy 3D klaviatura (WASD) va sichqoncha bilan boshqariladi. Telefon va planshet uchun sensorli boshqaruv hali yo'q.</p>
          <p className="note">Sahna ~17 MB yuklanadi va kuchli grafika talab qiladi.</p>
          <button className="lake-visit" type="button" onClick={() => setAccepted(true)}>Baribir ochish</button>
        </div>
      </div>
    );
  }
  return <Viewport />;
}
