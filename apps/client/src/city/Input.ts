/**
 * Klaviatura va sichqoncha holati.
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
  };

  private onMouseDown = (event: MouseEvent): void => {
    if (!this.enabled) return;
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
      if (document.pointerLockElement === this.element) document.exitPointerLock();
    }
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
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
    if (document.pointerLockElement === this.element) document.exitPointerLock();
  }
}
