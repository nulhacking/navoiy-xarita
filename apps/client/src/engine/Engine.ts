import {
  ACESFilmicToneMapping,
  Clock,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';

export interface FrameContext {
  /** O'tgan kadrdan beri vaqt, sekund. Yuqoridan cheklangan (tab fokusdan chiqqanda sakrash bo'lmasligi uchun). */
  dt: number;
  /** Boshlanishdan beri o'tgan umumiy vaqt, sekund. */
  elapsed: number;
  /** Kadr raqami. */
  frame: number;
}

export type System = (ctx: FrameContext) => void;

export interface EngineStats {
  fps: number;
  drawCalls: number;
  triangles: number;
  programs: number;
  geometries: number;
  textures: number;
}

/**
 * Renderer + sahna + kadr sikli. Faqat "idish" — dunyo, fizika va o'yin
 * mantig'i tizim (System) sifatida ro'yxatdan o'tadi.
 *
 * Sikl tartibi ataylab shunday: avval barcha tizimlar `dt` bilan yangilanadi,
 * keyin bitta render. Keyinchalik fizika qo'shilganda shu yerga fixed-step
 * akkumulyator kiradi (render o'zgaruvchan, fizika qat'iy 60 Hz).
 */
export class Engine {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;

  private readonly clock = new Clock();
  private readonly systems: System[] = [];
  private readonly resizeObserver: ResizeObserver;
  private animationId: number | null = null;
  private frame = 0;
  private elapsed = 0;
  private disposed = false;

  // FPS — silliqlangan o'rtacha, aks holda raqam sakrab turadi va o'qib bo'lmaydi.
  private fpsAccumulator = 0;
  private fpsFrames = 0;
  private smoothedFps = 0;
  /**
   * Render aniqligining yuqori chegarasi. Telefonda ekran piksel zichligi 3 ga
   * yetadi, GPU esa kompyuternikidan ancha zaif — 1 dan oshirish kadrni ikki
   * barobar sekinlashtiradi, ko'zga esa deyarli sezilmaydi.
   */
  private readonly maxPixelRatio = Math.min(window.devicePixelRatio, window.matchMedia('(pointer: coarse)').matches ? 1 : 1.35);
  /** Sekin qurilmada shu chegaragacha tushadi; telefonda pastroq. */
  private readonly minPixelRatio = this.maxPixelRatio <= 1 ? .6 : .8;
  private pixelRatio = this.maxPixelRatio;
  private slowSamples = 0;
  private fastSamples = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      // City-scale near/far works with standard depth and early depth testing.
      logarithmicDepthBuffer: false,
      powerPreference: 'high-performance',
      // Skrinshot olish uchun (Playwright perf testlari) kerak.
      preserveDrawingBuffer: false,
    });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.camera = new PerspectiveCamera(60, 1, 1, 1e8);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
  }

  /** Tizim qo'shish. Qaytgan funksiya uni ro'yxatdan chiqaradi. */
  addSystem(system: System): () => void {
    this.systems.push(system);
    return () => {
      const index = this.systems.indexOf(system);
      if (index !== -1) this.systems.splice(index, 1);
    };
  }

  start(): void {
    if (this.animationId !== null || this.disposed) return;
    this.clock.start();
    const tick = () => {
      this.animationId = requestAnimationFrame(tick);
      this.update();
    };
    this.animationId = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.clock.stop();
  }

  private update(): void {
    // Tab fon rejimiga o'tib qaytganda dt bir necha sekund bo'lishi mumkin —
    // bu fizikani portlatadi, shuning uchun 250 ms ga cheklaymiz.
    const wallDt = this.clock.getDelta();
    const dt = Math.min(wallDt, 0.25);
    this.elapsed += dt;
    this.frame++;

    const ctx: FrameContext = { dt, elapsed: this.elapsed, frame: this.frame };
    for (const system of this.systems) system(ctx);

    this.renderer.render(this.scene, this.camera);

    this.fpsAccumulator += wallDt;
    this.fpsFrames++;
    if (this.fpsAccumulator >= 0.5) {
      this.smoothedFps = this.fpsFrames / this.fpsAccumulator;
      if(this.smoothedFps<42){this.slowSamples++;this.fastSamples=0;}
      else if(this.smoothedFps>57){this.fastSamples++;this.slowSamples=0;}
      else {this.slowSamples=0;this.fastSamples=0;}
      if(this.slowSamples>=3&&this.pixelRatio>this.minPixelRatio){this.pixelRatio=Math.max(this.minPixelRatio,this.pixelRatio-.12);this.renderer.setPixelRatio(this.pixelRatio);this.resize();this.slowSamples=0;}
      if(this.fastSamples>=8&&this.pixelRatio<this.maxPixelRatio){this.pixelRatio=Math.min(this.maxPixelRatio,this.pixelRatio+.08);this.renderer.setPixelRatio(this.pixelRatio);this.resize();this.fastSamples=0;}
      this.fpsAccumulator = 0;
      this.fpsFrames = 0;
    }
  }

  getStats(): EngineStats {
    const { render, memory, programs } = this.renderer.info;
    return {
      fps: this.smoothedFps,
      drawCalls: render.calls,
      triangles: render.triangles,
      programs: programs?.length ?? 0,
      geometries: memory.geometries,
      textures: memory.textures,
    };
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    const width = parent?.clientWidth || window.innerWidth;
    const height = parent?.clientHeight || window.innerHeight;
    if (width === 0 || height === 0) return;

    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.resizeObserver.disconnect();
    this.systems.length = 0;
    this.renderer.dispose();
    // GPU xotirasini darhol bo'shatadi. Canvas bundan keyin qayta ishlatilmaydi —
    // Viewport har mount uchun yangisini yaratadi.
    this.renderer.forceContextLoss();
  }
}
