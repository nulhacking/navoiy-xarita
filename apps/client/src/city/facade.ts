import {
  CanvasTexture,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';

/** Bitta deraza katagining o'lchami, metr. UV shu bo'yicha hisoblanadi. */
export const WINDOW_WIDTH = 3.4;
export const WINDOW_HEIGHT = 3.2;

/** Tekstura tomonidagi kataklar soni. */
const CELLS = 4;
/** Bitta katakning piksel o'lchami. */
const CELL_PX = 64;

let cached: Texture | null = null;

/**
 * Bino fasadi uchun proseduraviy tekstura: deraza qatorlari.
 *
 * NIMA UCHUN: OSM'da bino faqat kontur va balandlik — devor materiali haqida
 * hech qanday ma'lumot yo'q. Tekis rangli devor esa binoni "quti" qilib
 * qo'yadi va masshtab hissini yo'qotadi: 5 qavatli uy 2 qavatlidan farq
 * qilmaydi. Deraza qatorlari aynan shu masshtabni tiklaydi — ko'z ularni
 * sanab, binoning haqiqiy balandligini "o'qiydi".
 *
 * Tekstura oq-qora: rang verteks ranglaridan keladi, shuning uchun bitta
 * tekstura barcha binolarga yaraydi va ularning ranglari har xil qoladi.
 */
export function facadeTexture(): Texture {
  if (cached) return cached;

  const size = CELLS * CELL_PX;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size * 4;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Fasad teksturasi uchun 2D kontekst mavjud emas');

  // Devor asosi — oq: verteks rangi uni o'z rangiga bo'yaydi.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size * 4);

  // Har katakda bitta deraza. Chetlarida devor qoladi, shunda qo'shni
  // kataklar orasida ustun va to'sin ko'rinadi.
  const margin = CELL_PX * 0.22;
  const w = CELL_PX - margin * 2;
  const h = CELL_PX * 0.52;
  const top = CELL_PX * 0.2;

  for (let variant = 0; variant < 4; variant++) {
  ctx.save(); ctx.translate(0,variant*size);
  for (let row = 0; row < CELLS; row++) {
    for (let col = 0; col < CELLS; col++) {
      const x = col * CELL_PX + margin;
      const y = row * CELL_PX + top;

      // Derazalar bir xil bo'lmasin: ba'zilari yorug'roq (parda, aks-sado),
      // ba'zilari qorong'i. Naqsh takrorlanadigan bo'lgani uchun tasodifiy
      // emas, barqaror qiymat ishlatiladi.
      const seed = (row * CELLS + col) * 2654435761;
      const shade = 0.28 + (((seed >>> 16) & 0xff) / 255) * 0.34;
      const value = Math.round(shade * 255);
      ctx.fillStyle = `rgb(${value}, ${value + 6}, ${value + 14})`;
      const width = variant === 3 ? CELL_PX*.84 : variant === 1 ? w*.72 : w;
      ctx.fillRect(x, y, width, h);
      ctx.strokeStyle = '#d8d9d2'; ctx.lineWidth = 2;
      ctx.strokeRect(x-1,y-1,width+2,h+2);
      ctx.fillStyle = '#b5b9b3'; ctx.fillRect(x+width/2-1,y,2,h);
      if (variant === 1) {
        ctx.fillStyle = '#c9bbaa'; ctx.fillRect(x-4,y-5,width+8,3);
        ctx.fillRect(x-4,y+h+2,width+8,4);
      }
      if (variant === 2 && col % 2 === 0) {
        ctx.fillStyle = '#777e7e'; ctx.fillRect(x-5,y+h-5,width+10,8);
        ctx.fillStyle = '#e0e2d9'; ctx.fillRect(x-6,y+h+3,width+12,3);
      }

      // Yuqori qirradagi ingichka yorug' chiziq — oyna ramkasi.
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.fillRect(x, y + h - 2, w, 2);
    }

    // Qavatlar orasidagi to'sin: gorizontal chiziq binoni qavatlarga bo'ladi.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.fillRect(0, row * CELL_PX + CELL_PX - 3, size, 3);
  }
  ctx.restore();
  }

  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  cached = texture;
  return texture;
}
