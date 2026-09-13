import {
  BackSide,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';

import { horizontalToLocal, moonPosition, sunPosition, type MoonPosition } from '@xarita/geo';
import { QUALITY } from './Quality.ts';

/** Soya kamerasi qamrab oladigan yarim en, metr. */
const SHADOW_EXTENT = 180;

/**
 * Osmon gumbazining radiusi. Kamera bilan birga ko'chadi, shuning uchun
 * qiymatning o'zi ahamiyatsiz — faqat tuman va `far` tekisligidan ichkarida
 * turishi kerak.
 */
const DOME_RADIUS = 4000;

/**
 * Quyosh va oy disklarining burchak radiusi, radian.
 *
 * Haqiqiy burchak o'lchamiga yaqin (~0.27°); kengroq atmosfera shu'lasi
 * diskni sun'iy kattalashtirmasdan ko'rinadigan qiladi.
 */
const SUN_RADIUS = 0.00465;
const MOON_RADIUS = 0.00475;

/** Kunduzgi ranglar. */
const DAY_ZENITH = new Color(0x4f86c6);
const DAY_HORIZON = new Color(0xcfd9e2);
/** Shafaq — quyosh ufq atrofida turganda ufq shu rangga bo'yaladi. */
const DUSK_HORIZON = new Color(0xff8f47);
/** Tungi ranglar. Qop-qora emas: to'liq qorong'ida shahar o'qilmay qoladi. */
const NIGHT_ZENITH = new Color(0x060a16);
const NIGHT_HORIZON = new Color(0x131a2c);

const SUN_HIGH = new Color(0xfff6e2);
const SUN_LOW = new Color(0xff9a4d);
const MOON_COLOR = new Color(0xaec4e8);

/** Yer sathidagi tuman rangi ufq bilan bir xil — chegara sezilmasligi uchun. */
const FOG_NEAR = QUALITY.fogNear;
const FOG_FAR = QUALITY.fogFar;

/** Osmon yorug'ligi (hemisphere) kunduzi va tunda. */
const DAY_SKY = new Color(0xc6d9ed);
const DAY_GROUND = new Color(0x9a8d75);
/**
 * Tun ataylab HAQIQIYDAN yorug'roq.
 *
 * Oysiz tunda ko'cha deyarli qop-qora bo'ladi — fizik jihatdan to'g'ri,
 * lekin o'ynab bo'lmaydi: yo'l ham, piyoda ham ko'rinmaydi. Shuning uchun
 * tungi muhit yorug'ligi shahar chiroqlarining umumiy shu'lasi sifatida
 * qoldirilgan.
 */
const NIGHT_SKY = new Color(0x4f6798);
const NIGHT_GROUND = new Color(0x313948);

/**
 * Muhit xaritasi (PMREM) shu burchakdan ko'p o'zgarganda qayta pishiriladi.
 *
 * Quyosh soatiga 15° yuradi, ya'ni jonli vaqtda bu ~12 daqiqada bir marta.
 * Har kadr qayta pishirish kadrni to'xtatib qo'yardi, umuman yangilamaslik
 * esa tunda binolarni kunduzgi ko'k aks bilan qoldirardi.
 */
const ENVIRONMENT_STEP = 0.05;

/**
 * Ikki qayta pishirish orasidagi eng kichik tanaffus, millisekund.
 *
 * Bitta pishirish ~9 ms (o'lchangan) — jonli vaqtda bu 11 daqiqada bir
 * marta, ya'ni
 * sezilmaydi. Lekin slayderni sudraganda quyosh soniyada o'n gradus yurib,
 * har kadrda yangi pishirish so'raladi. Chegara kadr tezligini saqlaydi,
 * muhit esa bir necha kadr ortda qolib, keyin yetib oladi.
 */
const ENVIRONMENT_INTERVAL = 250;

export interface SkyState {
  /** Dunyo vaqti. */
  date: Date;
  sun: { altitude: number; azimuth: number };
  moon: MoonPosition;
  /** 0 — tun, 1 — to'liq kunduz. Yorug'lik va ranglar shundan chiqadi. */
  daylight: number;
}

const VERTEX_SHADER = `
  varying vec3 vPosition;
  void main() {
    vPosition = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Osmon: gradient + yulduzlar + quyosh va oy disklari.
 *
 * Hammasi BITTA fragment shaderida: disklar alohida mesh bo'lsa ular uchun
 * chuqurlik, tartib va o'lcham bilan alohida ovora bo'lish kerak edi, bu
 * yerda esa ular shunchaki yo'nalish bo'yicha chiziladi.
 */
const FRAGMENT_SHADER = `
  uniform vec3 zenith;
  uniform vec3 horizon;
  uniform vec3 sunColor;
  uniform vec3 sunDir;
  uniform vec3 moonDir;
  uniform float daylight;
  uniform float moonVisible;
  varying vec3 vPosition;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  }

  float lunarNoise(vec3 p) {
    vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
      mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
  }

  void main() {
    vec3 dir = normalize(vPosition);
    // Balandlik bo'yicha aralashtirish. pow() gradientni ufqqa yaqin joyda
    // siqib, haqiqiy osmonga o'xshatadi.
    float h = clamp(dir.y, 0.0, 1.0);
    vec3 color = mix(horizon, zenith, pow(h, 0.45));

    float night = 1.0 - daylight;
    if (night > 0.01) {
      // Yulduzlar: yo'nalishni to'rga bo'lib, kataklarning kichik qismini
      // yoqamiz. Tekstura ham, geometriya ham kerak emas.
      vec2 starUv=vec2(atan(dir.z,dir.x)/6.2831853+0.5,acos(clamp(dir.y,-1.0,1.0))/3.14159265)*vec2(900.0,450.0);
      vec2 starOffset=fract(starUv)-0.5;
      float core=max(0.065,min(0.19,length(fwidth(starUv))*0.25));
      float star = smoothstep(0.994,0.9998,hash(vec3(floor(starUv),4.0))) * exp(-dot(starOffset,starOffset)/(core*core));
      color += vec3(star) * night * smoothstep(0.02, 0.30, dir.y) * 1.5;
    }

    // Quyosh: avval keng shu'la, keyin disk.
    float sunDot = dot(dir, sunDir);
    float sunAngle = acos(clamp(sunDot, -1.0, 1.0));
    float sunVisible = smoothstep(-0.025,0.005,sunDir.y);
    // Forward scattering / aerial haze, strongest toward the actual sun.
    color += sunColor * (exp(-sunAngle * 18.0)*0.32 + exp(-sunAngle*140.0)*1.4) * sunVisible;
    float solarEdge = max(fwidth(sunAngle),0.00025);
    color = mix(color, sunColor * 12.0, (1.0-smoothstep(${SUN_RADIUS.toFixed(5)}-solarEdge,${SUN_RADIUS.toFixed(5)}+solarEdge,sunAngle))*sunVisible);

    // Oy: disk fazasi bilan. Diskdagi har nuqtaning sirt normali
    // hisoblanadi va quyosh yo'nalishiga solishtiriladi — yoritilgan yarim
    // shu tarzda o'zi chiqadi, alohida tekstura kerak emas.
    if (moonVisible > 0.001 && dot(dir, moonDir) > 0.0) {
      float moonAngle=acos(clamp(dot(dir,moonDir),-1.0,1.0));
      float phase=clamp((1.0-dot(moonDir,sunDir))*0.5,0.0,1.0);
      color+=vec3(0.16,0.20,0.28)*exp(-moonAngle*100.0)*phase*moonVisible*0.22;
      vec3 rel = dir - moonDir * dot(dir, moonDir);
      float r = length(rel) / ${MOON_RADIUS.toFixed(4)};
      if (r < 1.0) {
        // Ko'rinadigan yarim sharning TASHQI normali kuzatuvchiga QARAB
        // turadi, ya'ni markazda u -moonDir. Ishorani chalkashtirsak to'lin
        // oy qop-qora, yangi oy esa yarqirab ko'rinadi.
        vec3 normal = normalize(-moonDir * sqrt(max(0.0, 1.0 - r * r)) + rel / ${MOON_RADIUS.toFixed(4)});
        float lit = smoothstep(-0.06, 0.10, dot(normal, sunDir));
        // Chekkaga qarab sal so'nadi — yassi doiraga o'xshab qolmasin.
        float limb = 0.55 + 0.45 * sqrt(max(0.0, 1.0 - r * r));
        // Procedural lunar maria / relief, not a claimed photographic moon texture.
        float albedo=0.63+0.20*lunarNoise(normal*9.0)+0.17*lunarNoise(normal*45.0);
        vec3 disc = vec3(0.94, 0.95, 0.90) * albedo * limb * (0.015 + 0.985 * lit);
        color = mix(color, disc, moonVisible * (1.0 - smoothstep(0.88, 1.0, r)));
      }
    }

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function buildDome(): Mesh<SphereGeometry, ShaderMaterial> {
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      zenith: { value: DAY_ZENITH.clone() },
      horizon: { value: DAY_HORIZON.clone() },
      sunColor: { value: SUN_HIGH.clone() },
      sunDir: { value: new Vector3(0, 1, 0) },
      moonDir: { value: new Vector3(0, -1, 0) },
      daylight: { value: 1 },
      moonVisible: { value: 0 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
  });

  const dome = new Mesh(new SphereGeometry(DOME_RADIUS, 32, 20), material);
  dome.matrixAutoUpdate = true;
  // Osmon hamma narsadan oldin va chuqurliksiz chiziladi.
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  return dome;
}

/** `t` ni `[a, b]` oralig'ida 0..1 ga silliq o'tkazadi. */
function smoothstep(a: number, b: number, t: number): number {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
}

/**
 * Vaqtga bog'langan osmon va yorug'lik.
 *
 * Bitta manba — LAHZA (`Date`). Quyosh va oyning o'rni undan astronomik
 * hisoblanadi (`@xarita/geo/celestial`), qolgan hamma narsa — ranglar,
 * soya yo'nalishi, ko'cha chiroqlari — quyosh balandligining hosilasi.
 * Shuning uchun vaqtni istalgan lahzaga ko'chirish yetarli: sahna o'zi
 * to'liq mos holatga keladi.
 */
export class Sky {
  readonly dome: Mesh<SphereGeometry, ShaderMaterial>;
  /**
   * Soya tashlaydigan yagona chiroq: kunduzi quyosh, tunda oy.
   *
   * Ikki alohida soyali chiroq ikki marta soya xaritasi degani, foydasi esa
   * yo'q — ufqning ikkala tomonida ham bittasi doim boshqasidan o'n barobar
   * yorqin. Shuning uchun yo'nalish va rang almashadi, chiroq esa bitta.
   */
  readonly key = new DirectionalLight(0xffeedd, 2.6);
  readonly ambient = new HemisphereLight(DAY_SKY.getHex(), DAY_GROUND.getHex(), 1.8);
  readonly fog = new Fog(DAY_HORIZON.getHex(), FOG_NEAR, FOG_FAR);

  private readonly scene: Scene;
  private readonly environmentScene = new Scene();
  private readonly environmentDome: Mesh<SphereGeometry, ShaderMaterial>;
  private readonly pmrem: PMREMGenerator;
  private environment: WebGLRenderTarget | null = null;
  private environmentAltitude = Number.NaN;
  private readonly environmentSun=new Vector3(0,0,0);
  private readonly environmentMoon=new Vector3(0,0,0);
  private environmentPhase=-1;
  private environmentAt = 0;

  private readonly zenith = new Color();
  private readonly horizon = new Color();
  private readonly keyColor = new Color();
  private readonly scratch = new Vector3();

  constructor(scene: Scene, renderer: WebGLRenderer) {
    this.scene = scene;

    this.dome = buildDome();
    scene.add(this.dome);

    // Bitta generator qayta ishlatiladi: har chaqiruvda yangisini yaratish
    // uning ichki shaderlarini qaytadan tayyorlaydi va pishirish uch
    // barobar qimmatga tushadi.
    this.pmrem = new PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();

    // Muhit xaritasi shu ikkinchi gumbazdan pishiriladi. U kichraytirilgan,
    // chunki PMREM kameralari sahna ichida turadi.
    this.environmentDome = buildDome();
    this.environmentDome.scale.setScalar(0.0025);
    this.environmentScene.add(this.environmentDome);

    // Tuman shaharning chetini yumshoq yopadi — aks holda yuklanmagan
    // tayllar joyida keskin chekka ko'rinadi. Rangi osmonning ufq rangi
    // bilan bir xil, shunda o'tish sezilmaydi.
    scene.fog = this.fog;
    scene.add(this.ambient);
    scene.add(this.key);
    scene.add(this.key.target);

    // Soyalar realistiklikning eng katta bitta hissasi: usiz binolar yerga
    // "yopishmay", suzib turgandek ko'rinadi.
    renderer.shadowMap.enabled = QUALITY.shadows;
    this.key.castShadow = QUALITY.shadows;
    this.key.shadow.mapSize.set(QUALITY.shadowMapSize, QUALITY.shadowMapSize);
    const camera = this.key.shadow.camera;
    camera.near = 1;
    camera.far = 1400;
    // Soya kamerasi o'yinchi atrofidagi ~180 m ni qamraydi. Kattaroq maydon
    // soyani bulanik qiladi, kichikrog'i esa chetlarda soyani yo'qotadi.
    camera.left = -SHADOW_EXTENT;
    camera.right = SHADOW_EXTENT;
    camera.top = SHADOW_EXTENT;
    camera.bottom = -SHADOW_EXTENT;
    // Akne (soyaning o'z sirtiga tushishi) ni yo'qotadi.
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.6;
    camera.updateProjectionMatrix();
  }

  /**
   * Sahnani berilgan lahzaga keltiradi.
   *
   * @param origin Kuzatuv nuqtasi — gumbaz va soya kamerasi shu yerga ko'chadi.
   */
  update(date: Date, lat: number, lon: number, origin: Vector3): SkyState {
    const sun = sunPosition(date, lat, lon);
    const moon = moonPosition(date, lat, lon);

    // Kunduz ulushi. Chegaralar fuqarolik shafag'iga yaqin: quyosh ufqdan
    // 6° past bo'lganda hali ko'rish mumkin, 8° yuqorida esa to'liq kunduz.
    const daylight = smoothstep(-0.105, 0.14, sun.altitude);

    const sunVector = horizontalToLocal(sun);
    const moonVector = horizontalToLocal(moon);

    // --- Ranglar
    this.zenith.copy(NIGHT_ZENITH).lerp(DAY_ZENITH, daylight);
    this.horizon.copy(NIGHT_HORIZON).lerp(DAY_HORIZON, daylight);
    // Shafaq: quyosh ufq atrofida bo'lganda ufq isiydi.
    const dusk = Math.exp(-((sun.altitude / 0.16) ** 2));
    this.horizon.lerp(DUSK_HORIZON, dusk * 0.75);

    const sunColor = SUN_LOW.clone().lerp(SUN_HIGH, smoothstep(0, 0.35, sun.altitude));

    const uniforms = this.dome.material.uniforms;
    uniforms.zenith!.value.copy(this.zenith);
    uniforms.horizon!.value.copy(this.horizon);
    uniforms.sunColor!.value.copy(sunColor);
    uniforms.sunDir!.value.set(sunVector.x, sunVector.y, sunVector.z);
    uniforms.moonDir!.value.set(moonVector.x, moonVector.y, moonVector.z);
    uniforms.daylight!.value = daylight;
    // Oy kunduzi ham ko'rinadi, lekin xiraroq.
    uniforms.moonVisible!.value = smoothstep(-0.02, 0.06, moon.altitude) * (1 - daylight * 0.55);
    for (const [name, uniform] of Object.entries(this.environmentDome.material.uniforms)) {
      const source = uniforms[name]!.value;
      uniform.value = typeof source === 'number' ? source : source.clone();
    }

    this.fog.color.copy(this.horizon);

    // --- Soya tashlovchi chiroq
    const sunLight = smoothstep(-0.10, 0.15, sun.altitude);
    if (sunLight > 0.01) {
      this.scratch.set(sunVector.x, sunVector.y, sunVector.z);
      this.keyColor.copy(sunColor);
      this.key.intensity = 2.9 * sunLight;
    } else {
      // Tun: oy soya tashlaydi. Kuchi fazaga bog'liq — yangi oyda deyarli
      // qorong'i, to'lin oyda binolarning soyasi aniq ko'rinadi.
      const moonLight = smoothstep(-0.02, 0.20, moon.altitude) * moon.illumination;
      this.scratch.set(moonVector.x, moonVector.y, moonVector.z);
      this.keyColor.copy(MOON_COLOR);
      this.key.intensity = 0.42 * moonLight;
    }
    this.key.color.copy(this.keyColor);
    this.key.target.position.copy(origin);
    this.key.target.updateMatrixWorld();
    // Yo'naltirilgan chiroqning o'zi cheksiz uzoqda, lekin uning SOYA
    // KAMERASI cheklangan maydonni qamraydi — shuning uchun u doim
    // kuzatuv nuqtasi ustida turishi kerak.
    this.key.position.copy(origin).addScaledVector(this.scratch, 600);

    // --- Muhit yorug'ligi
    this.ambient.color.copy(NIGHT_SKY).lerp(DAY_SKY, daylight);
    this.ambient.groundColor.copy(NIGHT_GROUND).lerp(DAY_GROUND, daylight);
    this.ambient.intensity = 1.45 + 0.37 * daylight;
    this.scene.environmentIntensity = 0.32 + 0.33 * daylight;

    this.dome.position.copy(origin);
    this.refreshEnvironment(sun.altitude);

    return { date, sun, moon, daylight };
  }

  /** Muhit xaritasini quyosh sezilarli siljiganda qayta pishiradi. */
  private refreshEnvironment(sunAltitude: number): void {
    const u=this.dome.material.uniforms,sun=u.sunDir!.value as Vector3,moon=u.moonDir!.value as Vector3;
    const phase=u.moonVisible!.value as number;
    if (Math.abs(sunAltitude-this.environmentAltitude)<ENVIRONMENT_STEP &&
      this.environmentSun.distanceTo(sun)<ENVIRONMENT_STEP &&
      this.environmentMoon.distanceTo(moon)<ENVIRONMENT_STEP && Math.abs(phase-this.environmentPhase)<.03) return;
    const now = performance.now();
    if (this.environment && now - this.environmentAt < ENVIRONMENT_INTERVAL) return;
    this.environmentAltitude = sunAltitude;
    this.environmentSun.copy(sun);this.environmentMoon.copy(moon);this.environmentPhase=phase;
    this.environmentAt = now;

    const target = this.pmrem.fromScene(this.environmentScene, 0.2, 0.1, 100);
    this.environment?.dispose();
    this.environment = target;
    this.scene.environment = target.texture;
  }

  dispose(): void {
    this.pmrem.dispose();
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.environmentDome.geometry.dispose();
    this.environmentDome.material.dispose();
    this.environment?.dispose();
    this.scene.environment = null;
    this.scene.fog = null;
  }
}
