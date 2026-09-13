/**
 * Klaviatura, sichqoncha va sensorli ekran holati.
 *
 * O'yin sikli har kadr holatni O'QIYDI (hodisalarga reaksiya qilmaydi) —
 * shuning uchun bu yerda faqat holat to'planadi. Sichqoncha burilishi esa
 * hodisa oralig'ida jamlanadi va o'qilgach nolga tushadi, aks holda kadr
 * tezligi burilish tezligiga ta'sir qilardi.
 */
export class Input {
  private readonly keys = new Set<string>();
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private wheelDelta = 0;
  private readonly element: HTMLElement;
  private pointerLocked = false;
  private enabled = true;
  private dragging = false;

  /** Bir marta bosilishi kerak bo'lgan tugmalar (masalan "mashinaga o'tirish"). */
  private readonly pressed = new Set<string>();

  /**
   * Ekrandagi boshqaruv (`TouchControls`): klaviatura bilan BIR XIL kodlar
   * orqali ishlaydi, shuning uchun `Player` qaysi qurilma ekanini bilmaydi.
   * Joystik esa analog — yarim og'dirilganda sekin yuriladi.
   */
  private readonly virtualKeys = new Set<string>();
  private virtualAxis = { x: 0, y: 0 };
  /** Kamerani sudrayotgan barmoqlar: pointerId → oxirgi nuqta. */
  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  /** Sensorli bosishdan keyin brauzer soxta `mousedown` yuboradi — pointer lock so'ralmasin. */
  private lastTouch = -Infinity;

  constructor(element: HTMLElement) {
    this.element = element;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    element.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mouseup', this.onMouseUp);
    element.addEventListener('contextmenu', this.onContextMenu);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    element.addEventListener('wheel', this.onWheel, { passive: false });
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerup', this.onPointerUp);
    element.addEventListener('pointercancel', this.onPointerUp);
  }

  // --- Sensorli ekran: bir barmoq — kamera, ikki barmoq — masofa -------------

  private onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return;
    this.lastTouch = performance.now();
    if (!this.enabled) return;
    this.element.setPointerCapture?.(event.pointerId);
    this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.pinchDistance = this.touchSpread();
  };

  private onPointerMove = (event: PointerEvent): void => {
    const last = this.touches.get(event.pointerId);
    if (event.pointerType !== 'touch' || !last || !this.enabled) return;
    if (this.touches.size === 1) {
      // Barmoq sichqonchadan sezgirroq bo'lishi kerak: ekran kichik, harakat qisqa.
      this.mouseDeltaX += (event.clientX - last.x) * 1.6;
      this.mouseDeltaY += (event.clientY - last.y) * 1.6;
    }
    last.x = event.clientX;
    last.y = event.clientY;
    if (this.touches.size === 2) {
      const spread = this.touchSpread();
      // Barmoqlar yaqinlashsa kamera uzoqlashadi — xaritadagidek.
      if (this.pinchDistance > 0) this.wheelDelta += (this.pinchDistance - spread) * 4;
      this.pinchDistance = spread;
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.touches.delete(event.pointerId)) return;
    this.pinchDistance = this.touchSpread();
  };

  private touchSpread(): number {
    if (this.touches.size < 2) return 0;
    const [a, b] = [...this.touches.values()];
    return Math.hypot(a!.x - b!.x, a!.y - b!.y);
  }

  /** Joystik: x — o'ngga, y — oldinga, har biri [-1, 1]. */
  setVirtualAxis(x: number, y: number): void {
    this.virtualAxis = this.enabled ? { x, y } : { x: 0, y: 0 };
  }

  /** Ekrandagi tugma bosildi/qo'yib yuborildi — klaviatura kodi bilan. */
  setVirtualKey(code: string, down: boolean): void {
    if (down && this.enabled) {
      if (!this.virtualKeys.has(code)) this.pressed.add(code);
      this.virtualKeys.add(code);
    } else this.virtualKeys.delete(code);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || !this.enabled) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
    this.keys.add(event.code);
    this.pressed.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  /** Oyna fokusdan chiqsa tugmalar "bosilgan" holicha qolib ketmasin. */
  private onBlur = (): void => {
    this.dragging = false;
    this.keys.clear();
    this.pressed.clear();
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    this.wheelDelta = 0;
    this.releaseVirtual();
  };

  private releaseVirtual(): void {
    this.virtualKeys.clear();
    this.virtualAxis = { x: 0, y: 0 };
    this.touches.clear();
    this.pinchDistance = 0;
  }

  private onMouseDown = (event: MouseEvent): void => {
    if (!this.enabled || performance.now() - this.lastTouch < 800) return;
    if (event.button === 2) { this.dragging = true; event.preventDefault(); return; }
    if (event.button !== 0) return;
    if (!this.pointerLocked) this.element.requestPointerLock()?.catch(() => { /* Esc or browser refusal: click again to retry. */ });
  };

  private onMouseMove = (event: MouseEvent): void => {
    if (!this.enabled || (!this.pointerLocked && !this.dragging)) return;
    this.mouseDeltaX += event.movementX;
    this.mouseDeltaY += event.movementY;
  };

  private onMouseUp = (): void => { this.dragging = false; };
  private onContextMenu = (event: MouseEvent): void => { if (this.enabled) event.preventDefault(); };

  private onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.element;
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.wheelDelta += event.deltaY;
  };

  /**
   * Boshqaruvni yoqadi/o'chiradi (masalan katta xarita ochilganda).
   * O'chirilganda barcha tugmalar bo'shatilgan deb hisoblanadi — aks holda
   * xarita ochilgan paytda bosilgan tugma "yopishib" qolardi.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.dragging = false;
      this.wheelDelta = 0;
      this.keys.clear();
      this.pressed.clear();
      this.mouseDeltaX = 0;
      this.mouseDeltaY = 0;
      this.releaseVirtual();
      if (document.pointerLockElement === this.element) document.exitPointerLock();
    }
  }

  isDown(code: string): boolean {
    return this.keys.has(code) || this.virtualKeys.has(code);
  }

  /** Shu kadrda bosilganmi. O'qilgach holat tozalanadi. */
  wasPressed(code: string): boolean {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  }

  get locked(): boolean {
    return this.pointerLocked;
  }

  /** Sichqoncha siljishini o'qib, hisoblagichni nolga tushiradi. */
  takeMouseDelta(): { x: number; y: number } {
    const delta = { x: this.mouseDeltaX, y: this.mouseDeltaY };
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    return delta;
  }

  takeWheelDelta(): number {
    const delta = this.wheelDelta;
    this.wheelDelta = 0;
    return delta;
  }

  /** Yurish yo'nalishi: X = o'ng, Y = oldinga, har biri [-1, 1]. */
  moveAxis(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) y += 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) y -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1;
    x += this.virtualAxis.x;
    y += this.virtualAxis.y;
    const length = Math.hypot(x, y);
    return length > 1 ? { x: x / length, y: y / length } : { x, y };
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.element.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
    this.element.removeEventListener('contextmenu', this.onContextMenu);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.element.removeEventListener('wheel', this.onWheel);
    this.element.removeEventListener('pointerdown', this.onPointerDown);
    this.element.removeEventListener('pointermove', this.onPointerMove);
    this.element.removeEventListener('pointerup', this.onPointerUp);
    this.element.removeEventListener('pointercancel', this.onPointerUp);
    if (document.pointerLockElement === this.element) document.exitPointerLock();
  }
}
