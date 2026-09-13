# Xarita — Navoiy 3D (GTA uslubida)

Haqiqiy Navoiy shahri, OSM xaritasidan olingan koordinatalar bo'yicha 3D'da:
ichida piyoda yurish va mashina haydash mumkin.

**Hech qanday API kaliti, billing yoki akkaunt kerak emas** — barcha ma'lumot
manbalari bepul va ochiq.

```bash
npm install
node tools/osm-pipeline/bake.mjs navoiy   # bir marta: OSM ma'lumotini tayyorlaydi
node tools/models/fetch.mjs               # bir marta: personaj va mashina modellari
node tools/models/fetch-fleet.mjs         # sedan/SUV, moto, velosiped, daraxt va ko‘cha jihozlari
node tools/models/compress.mjs            # modellarni siqish (meshopt + WebP), ~25 MB → ~7 MB
npm run dev                                # http://localhost:5173
```

Birinchi `bake` Geofabrik'dan O'zbekiston ekstraktini (118 MB) yuklab oladi va
undan Navoiy uchun **35 213 bino**, **6 540 yo'l**, **2 017 yer qoplamasi**
va suv havzalarini ajratib, 191 ta taylga yozadi (~4 MB).

## Boshqaruv

| Tugma | Piyoda | Mashinada |
|---|---|---|
| `W A S D` | yurish | gaz / tormoz / burilish |
| `Shift` | yugurish | — |
| `Space` | sakrash | — |
| `F` | mashinaga o'tirish (yaqin bo'lsa) | tushish |
| `M` | katta xaritani ochish | katta xaritani ochish |
| sichqoncha | kamerani aylantirish | |
| g'ildirak | kamera masofasi | |

Chap pastda **dumaloq mini-xarita**: o'yinchi doim markazda, xarita u qaragan
tomonga qarab aylanadi. Sariq uchburchak — siz, qizil nuqta — mashina.
Yorqin oq chiziqlar katta ko'chalar, kulrang — kichik ko'chalar.

Chap yuqorida **soat**: Navoiy vaqti, yonida sutka slayderi va "hozir"
tugmasi. Quyosh, oy, soyalar, osmon rangi va ko'cha chiroqlari — hammasi shu
vaqtdan kelib chiqadi. Sukut bo'yicha soat haqiqiy vaqt bilan yuradi;
slayderni surib istalgan soatga o'tish mumkin, "hozir" esa qaytaradi.
Vaqt tanlangandan keyin ham oqishda davom etadi — 19:30 ni qo'yib, quyoshning
botishini kuzatib o'tirsa bo'ladi.

Suvga bemalol kirish mumkin: sayozda yurish sekinlashadi, ko'krakdan oshganda
**suzish** boshlanadi — gavda o'zi suv yuzasiga ko'tariladi va HUD'da
`🏊 suzmoqda` chiqadi. Transport esa qirg'oqda to'xtaydi.

Mini-xaritani bosing (yoki `M`) — **butun shahar xaritasi** ochiladi. Xaritaga
bosib **metka** qo'yish mumkin: u mini-xaritada va 3D dunyoda sariq ustun
sifatida ko'rinadi, masofasi HUD'da yoziladi. "O'sha yerda paydo bo'lish"
tugmasi sizni (va mashinani) darhol o'sha joyga ko'chiradi.

## Holat

| Qism | Holat |
|---|---|
| Shahar geometriyasi: binolar, yo'llar, suv, yer qoplamasi | ✅ |
| Relyef (SRTM) + fizika heightfield'i | ✅ |
| Piyoda yurish, sakrash, binolarga to'qnashuv | ✅ |
| Suvga kirish: kechish va suzish, o'yilgan havza tubi | ✅ |
| Kun/tun sikli: haqiqiy quyosh va oy, fazasi bilan | ✅ |
| Tunda ko'cha chiroqlari, oy soyasi, yulduzlar | ✅ |
| Mashina: haydash, to'qnashuv, kirish/chiqish | ✅ |
| Dumaloq mini-xarita (GTA uslubida, o'yinchi bilan aylanadi) | ✅ |
| Katta xarita: metka qo'yish va o'sha joyda paydo bo'lish | ✅ |
| Quyosh soyalari, osmon gradienti, bino fasadlari (deraza qatorlari) | ✅ |
| Daraxtlar: ko'chalar bo'ylab va yashil zonalarda | ✅ |
| Haqiqiy glTF modellar: personaj (animatsiyali) va avtomobil | ✅ |
| Kelasi: post-processing (SSAO, bloom) | ⬜ |
| Kelasi: AI trafik, NPC, missiyalar | ⬜ |
| Kelasi: ko'p o'yinchi | ⬜ |

Modellar `tools/models/fetch.mjs` orqali Khronos glTF-Sample-Assets dan
olinadi. Ular kelmasa o'yin baribir ishlaydi — oddiy shakllar bilan.

> Avtomobil modeli (CarConcept) sifatli, lekin og'ir: 11 MB, ~400 draw call.
> Yengilroq variant kerak bo'lsa `tools/models/fetch.mjs` da `CarConcept` ni
> `CesiumMilkTruck` (370 KB) ga almashtirish kifoya.

## Ma'lumot manbalari

| Qatlam | Manba | Litsenziya |
|---|---|---|
| Binolar, yo'llar, yer qoplamasi | OSM — Geofabrik ekstrakti | ODbL |
| Relyef | AWS Terrain Tiles (Terrarium PNG) | ochiq (SRTM, NED, GMTED) |
| Personaj (CesiumMan), avtomobil (CarConcept) | Khronos glTF-Sample-Assets | CC BY 4.0 |

Atribut ekranda doim ko'rinib turadi — bu litsenziya sharti.

Boshqa shaharni qo'shish: `tools/osm-pipeline/bake.mjs` ichidagi `REGIONS`
ro'yxatiga bbox qo'shing yoki `--bbox janub,g'arb,shimol,sharq` bilan ishga
tushiring.

## Tuzilish

```
packages/geo/          WGS84 geodeziya, Web Mercator + quyosh/oy astronomiyasi
apps/client/src/
  city/                shahar dunyosi — o'yinning o'zagi
    CityFrame.ts       qo'zg'almas mahalliy freym (X=sharq, Y=yuqori, Z=janub)
    Sky.ts             osmon, quyosh/oy, soyalar va kun-tun yorug'ligi
    WorldClock.ts      dunyo vaqti: jonli soat yoki undan siljish
    Ground.ts          relyef meshi + balandlik so'rovi
    CityTile.ts        bino/yo'l/yuza geometriyasi
    CityWorld.ts       tayl oqimi, yoritish, soyalar, osmon, tug'ilish nuqtasi
    Minimap.ts         dumaloq mini-xarita (2D canvas)
    CityOverview.ts    butun shahar xaritasi (bir marta quriladi)
    facade.ts          proseduraviy bino fasadi teksturasi
    trees.ts           daraxtlar (ko'cha bo'ylab + yashil zonalarda)
    XalqlarDostligi.ts Xalqlar Do'stligi shoh ko'chasi: kesim, chiroqlar, xiyobon, landmarklar
    models.ts          glTF modellarni yuklash va o'lchamga moslash
    Physics.ts         Rapier: heightfield + bino collider'lari
    Player.ts          piyoda va mashina boshqaruvi, kamera
    Input.ts           klaviatura va sichqoncha
  engine/Engine.ts     renderer va kadr sikli
tools/osm-pipeline/    OSM PBF o'quvchi va bake konveyeri
tools/smoke/           brauzer testlari
```

### Nima uchun floating origin YO'Q

Sayyora masshtabida (radius 6.4 mln m) `float32` ~0.5 m aniqlik beradi va
kamera qimirlaganda hamma narsa titraydi — shuning uchun globus versiyasida
koordinata freymi o'yinchi ortidan ko'chib yurardi. Bitta shahar esa atigi
~20 km: shu kattalikda `float32` qadami ~2 mm. Demak butun Navoiy bitta
qo'zg'almas freymda saqlanadi va rebase, obyektlarni qayta joylashtirish,
boshqaruv holatini tiklash — bularning hech biri kerak emas.

### Relyef: bitta manba, uch iste'molchi

`Ground.heights` da **mahalliy freymdagi Y** saqlanadi (geodezik balandlik
emas) va uni uch joy ishlatadi: ko'rinadigan mesh, fizika heightfield'i va
binolar/yo'llarning balandligi. Bitta manba bo'lgani uchun ular hech qachon
bir-biridan ajralmaydi.

Bu tuzatish edi: avval geodezik balandlik saqlanardi, mahalliy Y esa Yer
egriligi tufayli shahar chetida ~6 m past. Natijada fizika sirti ko'rinadigan
sirtdan yuqorida turib, personaj havoda yurgandek ko'rinardi. Ikkinchi xato —
Rapier heightfield'ining indekslash tartibi (tez indeks Z, X emas) — relyef
fizikasini transponirlab qo'ygan edi. Ikkalasi ham `tools/smoke` testlari
bilan tekshiriladi: oyoq–yer farqi barcha yo'nalishda ~9 sm bo'lib qolishi kerak.

### Kun va tun: bitta lahzadan hamma narsa

Sahnaning yorug'ligi bitta qiymatdan — LAHZADAN chiqadi. Quyosh va oyning
o'rni undan astronomik hisoblanadi (`packages/geo/src/celestial.ts`,
Meeus'ning past aniqlikdagi formulalari: quyosh uchun ~0.01°, oy uchun ~0.3°),
qolgan hamma narsa esa quyosh balandligining hosilasi: osmon gradienti,
shafaq rangi, tuman, muhit yorug'ligi, soya yo'nalishi va ko'cha
chiroqlarining kuchi. Shuning uchun vaqtni istalgan lahzaga surish yetarli —
sahna o'zi to'liq mos holatga keladi, alohida "kechki rejim" yo'q.

Bir necha qaror izohga arziydi:

- **Soya tashlovchi chiroq bitta.** Kunduzi u quyosh, tunda oy: yo'nalishi va
  rangi almashadi. Ikki alohida soyali chiroq ikki marta soya xaritasi degani,
  foydasi esa yo'q — ufqning ikkala tomonida ham bittasi doim boshqasidan
  o'n barobar yorqin.
- **Quyosh va oy disklari alohida mesh emas**, osmon gumbazining fragment
  shaderida chiziladi. Oy fazasi ham shu yerda: diskdagi har nuqtaning sirt
  normali hisoblanib, quyosh yo'nalishiga solishtiriladi — yoritilgan yarim
  o'zi chiqadi, tekstura kerak emas. Disklar haqiqiysidan uch barobar katta
  (0.27° emas, ~1°): aks holda ular ekranda bir-ikki piksel bo'lib,
  yulduzdan farq qilmaydi.
- **Ko'cha chiroqlari PointLight EMAS.** 110 ta haqiqiy chiroq kadrni
  o'ldiradi. O'rniga ikki narsa: `street-lamp.glb` ning o'z linzasi (u
  alohida material bilan kelgan — topib emissiv qilish kifoya) va yerdagi
  additiv yorug'lik dog'i. Aynan dog' tunni "yoritilgan" qilib ko'rsatadi.
- **Tun ataylab haqiqiydan yorug'roq.** Oysiz tunda ko'cha deyarli qop-qora
  bo'ladi — fizik jihatdan to'g'ri, lekin o'ynab bo'lmaydi.
- **Muhit xaritasi (PMREM) qayta pishiriladi**, lekin quyosh 3° dan ko'p
  siljiganda va sekundiga to'rt martadan oshmay: bitta pishirish ~9 ms, ya'ni
  butun kadr. Jonli vaqtda bu 11 daqiqada bir marta sodir bo'ladi.

Astronomiya `packages/geo` da, birlik testlar bilan. Testlar formulalardan
MUSTAQIL: quyoshturishda tush balandligi `90° - kenglik ± 23.44°` ga,
tengkunlikda kunduz uzunligi 12 soatga, haqiqiy tush esa uzunlikdan kelib
chiqqan vaqtga solishtiriladi. Oy uchun — sinodik oy (29.53 kun) davomida
fazaning bir marta aylanishi va to'lin oyning quyoshga qarama-qarshi turishi.

### Relyef: nima uchun DEM to'g'ridan-to'g'ri o'qilmaydi

DEM 29 m/px, bizning to'r esa 67 m qadamda — manbadan 2.3 marta siyrak.
Nuqtaviy o'qish bunday holda klassik aliasing beradi: SRTM'ning shovqini har
67 metrda tasodifiy do'nglikka aylanadi. Tekis Navoiy tekisligida (6 km da
atigi ~48 m balandlik farqi) natija butun shaharni g'adir-budur qilib
ko'rsatardi — aslida u yerda unaqa do'ngliklar yo'q.

Ikki qadam, ikkalasi ham `Ground.ts` da:

1. **Tent filtri** — har bir tugun katak ENI bo'yicha o'rtachalanadi. Bu
   siyraklashtirishdan OLDIN chiqish to'ri ko'tara olmaydigan chastotalarni
   olib tashlaydi.
2. **Gauss silliqlash**, sigma 0.8 katak (~53 m) — manbaning o'z shovqinini
   kesadi. Haqiqiy relyef bu yerda kilometr masshtabida, shovqin esa to'r
   qadamida: ularni chastota bo'yicha ajratsa bo'ladi.

O'lchangan natija: shahar markazidagi 6x6 km da egrilik **1.82 m dan 0.37 m
ga** tushdi (5 barobar silliq), janubdagi haqiqiy tog'lar esa cho'qqisidan
atigi 3.6 m yo'qotdi — 480 m relyefning 0.8% i. Soxta do'ngliklar ketdi,
haqiqiylari qoldi.

Bir chok ham tuzatildi: namuna avval bitta DEM tayli ichida qirqilardi va
tayl chetida qo'shnisining o'rniga o'zining chekka pikseli takrorlanardi.
Endi piksel koordinatasi global.

### Suv: tub o'yiladi, yuza yassi qoladi

DEM ko'l YUZASINI o'lchaydi, tubini emas — ya'ni suv chuqurligi ma'lumotda
umuman yo'q. Shuning uchun relyef qurilayotganda havza tubi sun'iy ravishda
sathdan 4 m past o'yiladi, ko'rinadigan suv yuzasi esa qirg'oq darajasida
yassi qoladi. Ikkalasi bitta manbadan: `Ground.heights` — tub (fizika ham,
mesh ham), `Ground.surface` — o'yilmagan qirg'oq, sath esa
`waterSurfaceLevel` bilan qirg'oqning pastki choragidan olinadi.

Ikki chegara bor, ikkalasi ham to'r qadamidan kelib chiqadi:

- **60 metrdan tor havza o'yilmaydi.** To'r qadami 67 m: 8 metrli ariqni
  o'yish uni chuqurlashtirmaydi, balki tasodifan ustiga tushgan bitta tugunni
  4 m ga tushirib, yo'l va yer qoplamasini ham o'sha chuqurga tortadi. Ariq
  kechib o'tiladigan bo'lib qolgani — shu masshtabdagi to'g'ri javob.
- **Mahalliy yerdan 6 m dan chuqur kesilmaydi.** Sath butun halqa uchun
  bitta, yer esa qiya bo'lishi mumkin; bu chegarasiz qiya daryoning yuqori
  uchi 18 metrlik quduqqa aylanardi (o'lchangan).

Qirg'oq qiyaligi alohida hisoblanmaydi: to'r suv ichidagi tugun bilan
tashqaridagisini chiziqli bog'laydi va bu 67 m da 4 m — yumshoq, asta-sekin
kirib boriladigan sohil.

Suv konturlari relyefdan oldin kerak (tayllar hali kelmagan bo'ladi), shuning
uchun bake ularni alohida `osm/water.json` ga ham yozadi.

### Yassi qatlamlar: nima uchun har biri alohida mesh

Yer qoplamasi, suv, yo'lka, piyoda yo'li, ko'cha va yo'l chiziqlari bir-birining
ustida, atigi bir necha santimetr farq bilan yotadi. OSM'da ular ustma-ust ham
tushadi: `landuse=residential` mahallasi ustida maysa, uning ustida sport
maydonchasi va avtoturargoh — bitta taylda shunday juftliklar mingdan ortiq.

Balandlik farqi yaqinda yetarli, uzoqda emas. Kamera 1..1400 m, chuqurlik buferi
24-bit: uning qadami 400 m da ~1 sm, 1000 m da ~6 sm. Ya'ni uzoqdagi qatlamlar
bitta chuqurlik qiymatiga tushib "laparlaydi" (z-fighting) — kamera qimirlaganda
butun kvartal pirpirab turadi.

Yechim — `polygonOffset`: u chuqurlikni metrda emas, BUFER BIRLIGIDA suradi,
shuning uchun tartib har qanday masofada saqlanadi. U butun chizish chaqiruvi
uchun o'rnatiladi, demak har bir qatlam alohida mesh bo'lishi shart —
`CityTile.ts` dagi `LAYER` jadvali shu 11 qatlamni belgilaydi. Bahosi: tayl
uchun 3 ta o'rniga eng ko'pi 11 ta chizish chaqiruvi (9 tayl → +72).

Balandliklar 6 sm dan oshmaydi: fizika sirti relyefning O'ZI, oyoq–yer tirqishi
esa ~9 sm. Undan yuqori ko'tarilsa personaj asfalt ichida yurgandek ko'rinadi.

### Nima uchun ma'lumot oldindan tayyorlanadi

- **Overpass API** `out geom` so'rovlarida ishonchsiz: uchta mustaqil
  mirrorda ham kichik bbox uchun 60–90 s timeout berdi.
- **Rasmiy OSM API** bulk yuklashni taqiqlaydi.
- **Tayyor vektor tayl servislari** bino qatlamini kesadi: OpenFreeMap'ning
  Navoiy markazidagi z14 taylida 11 ta bino bor, OSM'ning o'zida esa shu
  hududda 24 686 ta (Overpass `out count` bilan tasdiqlangan).

Xom ekstraktdan o'zimiz tayyorlash — yagona to'liq va ishonchli yo'l.
PBF o'quvchi ham o'zimizniki: npm'dagi parserlar 2022 dan beri yangilanmagan,
format esa 2010 dan beri o'zgarmagan va `pbf` + Node `zlib` bilan yetarli.

## Buyruqlar

```bash
npm run dev                                  # dev server
npm run build                                # typecheck + prod build
npm test                                     # geo matematikasi (56 test)
npm run typecheck                            # butun monorepo
node tools/osm-pipeline/bake.mjs <hudud>     # OSM tayllari + water.json
node tools/models/fetch.mjs                  # modellarni yuklab olish
npm run test:sky                             # kun/tun sikli, soyalar, chiroqlar
npm run test:lake                            # Ozero konturi, suv/fizika, qirg‘oq va oy nuri
npm run test:xalqlar                         # Xalqlar Do'stligi shoh ko'chasi: kolliderlar, Street View kadrlari
node tools/models/fetch-fleet.mjs             # qo‘shimcha tekin transport, odam, daraxt/jihoz assetlari
node tools/smoke/check.mjs http://localhost:5173/ shot.png
```

## Litsenziya eslatmasi

OSM ma'lumoti qayta ishlanadi (bake). ODbL hosila ma'lumotlar bazasini ham
ODbL ostida ulashishni talab qiladi — `tools/osm-pipeline` va uning natijasi
shu sababli ochiq.
