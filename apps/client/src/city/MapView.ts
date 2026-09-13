/** Normalized map viewport. Pixel/world conversions share this transform. */
export class MapView {
  zoom = 1;
  centerX = 0.5;
  centerY = 0.5;

  toMap(x: number, y: number): { x: number; y: number } {
    return { x: this.centerX + (x - 0.5) / this.zoom, y: this.centerY + (y - 0.5) / this.zoom };
  }

  toScreen(x: number, y: number): { x: number; y: number } {
    return { x: (x - this.centerX) * this.zoom + 0.5, y: (y - this.centerY) * this.zoom + 0.5 };
  }

  zoomAt(factor: number, x = 0.5, y = 0.5): void {
    const anchor = this.toMap(x, y);
    this.zoom = Math.min(32, Math.max(1, this.zoom * factor));
    this.centerX = anchor.x - (x - 0.5) / this.zoom;
    this.centerY = anchor.y - (y - 0.5) / this.zoom;
    this.clamp();
  }

  pan(dx: number, dy: number): void {
    this.centerX -= dx / this.zoom;
    this.centerY -= dy / this.zoom;
    this.clamp();
  }

  center(x: number, y: number): void {
    this.centerX = x;
    this.centerY = y;
    this.clamp();
  }

  reset(): void { this.zoom = 1; this.centerX = 0.5; this.centerY = 0.5; }

  private clamp(): void {
    const half = 0.5 / this.zoom;
    this.centerX = Math.max(half, Math.min(1 - half, this.centerX));
    this.centerY = Math.max(half, Math.min(1 - half, this.centerY));
  }
}
