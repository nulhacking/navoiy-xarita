# Navoiy 3D — amaldagi holat

## 2026-09-13: Xalqlar Do‘stligi shoh ko‘chasi — to‘liq tekshiruv va qayta qurish

Ko‘cha Amir Temur chorrahasidan shimoliy davomi (v −1300) bilan janubiy
chorrahagacha (1.6 km) va undan janubi-sharqqa ketgan tarmoq (0.45 km) bo‘ylab
tekshirildi. Manbalar: Google sun’iy yo‘ldosh z19 tayllari (ko‘chaga burilgan
freymda 0.1–0.3 m/px o‘lchov to‘rli qirqimlar) va Google Street View — Lemala 360
avtomobil kamerasi (2024-iyul), har ~100 m da to‘rt yo‘nalish. OSM qatnov qismi
o‘qlari tasvir bilan 1 m ichida mos keldi. O‘lchovlar va freym:
`apps/client/src/city/XalqlarDostligiReference.ts`.

Topilgan xatolar (endi tuzatilgan):

- **"G‘alaba shoh ko‘chasi" moduli aslida shu ko‘chada edi** (haqiqiy G‘alaba
  ko‘chasi 800 m sharqda). U o‘ylab topilgan arka va 22 m projektorlar qo‘ygan,
  savdo markazini ~15 m siljitgan va sharqdagi ikkinchi qatordagi 6 ta haqiqiy
  OSM binosini (207682880–885) yashirib qo‘ygan edi. Modul olib tashlandi.
- **Farxod modulidagi "Karimov shoh ko‘chasi" qismlari**: suzish havzasi 22 m
  va 70 m, Sport Saroyi 30–40 m, tennis kortlari ~50 m siljigan; "Turon" binosi
  trotuar ustiga, stadion va Farhod sharqidagi "park + dumaloq favvora" esa
  umuman yo‘q joyga qo‘yilgan (u yerda 5 qavatli uylar). Farxod endi faqat
  Farhod binosi va maydonini quradi.
- O‘rta ajratgich maysa qilingan edi — Street View’da u **1 m oq bo‘yalgan beton**,
  ikki yonida sariq chiziq. Chiroqlar tashqi chetlarda, shimolda "palma" shaklli.
- Ko‘chaning janubiy uchi to‘g‘ri chizilgan edi: aslida v ≈ 280 dan sharqqa
  egilib, Janubiy ko‘chasi va janubi-sharqiy tarmoq bilan chorrahaga chiqadi.
- Shahar taylidagi avtomatik chiroq/skameykalar qatnov qismi va ajratgich ustiga
  tushardi (OSM o‘qlaridan hisoblangan) — ko‘cha zonasida endi qo‘yilmaydi.
- G‘alaba bog‘i (Park of Victory) yodgorlik maydoni, "Navoiy" mehmonxonasi,
  Ishonch/SO/Bonum savdo markazi va rotundasi OSM’da yo‘q edi — qo‘shildi.

Qurilgan narsalar: 3+3 bo‘lakli qatnov qismlari, oq ajratgich va bordyurlar
(kolliderli), chiziqlar, 11 ta zebra va strelkalar, Amir Temur chorrahasidagi
mast svetoforlar (50 s sikl), 118 chiroq (tunda yer dog‘lari bilan), 11 ta
bayramona girlyanda, 6 bekat, reklama shchitlari, kiosklar, Hokimiyat maydoni
chetidagi beton to‘siqlar, qiya avtoturargohlar, ~670 daraxt o‘lchangan
qatorlarda, g‘arbiy xiyobon (parterlar, 4 favvora, oval maydon, panjara),
Sport Saroyi (fasad, yozuv, olimpiya halqalari, bayroqlar, "I ♥ NAVOIY"),
"Delfin" 50 m hovuzi, G‘alaba bog‘i yodgorligi, Farhod oldidagi oq panjara.

Aniqlik chegaralari: binolar balandligi fotosuratdan baholangan; fasad detallari,
daraxt turlari va aniq soni, girlyandalar shakli — vizual taxmin. Ikkinchi
qatordagi binolar OSM’dan. Street View heading kalibrlashi ~10° xato bo‘lishi
mumkin, shuning uchun joylashuv faqat sun’iy yo‘ldoshdan olindi. Daraxt tanalari
modelda jigarrang (haqiqatda ko‘pi oqlangan).

Tekshirish: `npm run typecheck`, `npm run build`, `npm run test:world`,
`npm run test:xalqlar`, `npm run test:farxod`. Kadrlar:
`artifacts/xalqlar-north-square.png`, `-mall`, `-farhod-avenue`, `-sport-saroyi`,
`-junction`, `-night`.

## Hokimiyat: fotosurat va satellite rekonstruksiyasi

`Viloyat hokimiyatiga borish` tugmasi maydon yonidagi xavfsiz yo‘lga olib boradi.
Hokimiyat uchun alohida `Hokimiyat.ts` va `HokimiyatReference.ts` yaratildi:

- 146696850, 146696818, 367714606 OSM obyektlarining konturlari saqlandi.
  Ularning eski umumiy fasad va kollayderlari chizilmaydi; yangi model faqat
  shu uchta identifikatorni almashtiradi. G‘arbiy korpusning OSM nomi pochta.
- Oltin vertikal panjaralar va yuqori geometrik bezaklar haqiqiy 3D detal,
  ikki keng fasadda. Oq yon panel, qavat derazalari, kirish portali, zinapoya,
  tom antennalari va yon korpusning solar panellari bor.
- Maydon satellite’dagi to‘rtburchak konturga bog‘langan, ichma-ich tosh naqshi,
  uchta favvora nuqtasi, gulzorlar, 66 daraxt, chiroq va skameykalar qo‘shilgan.
- Favvora suv zarralari animatsiyali. Daraxtlar import qilingan CC0 modellardan;
  ignabargli nusxalar rasmdagi ixcham tojga yaqinlashtirildi. Keng bargli
  ko‘cha daraxtlarining past tanasi oq rangda. Daraxt tanalari kollayderli.
- Maydon relyefga yopishadi; bino va zinapoyalar kollayderli. Oddiy tayldagi
  tasodifiy daraxtlar shu hovlida chiqarilmaydi. Gulzor va tosh qoplamaning
  chuqurlik qatlamlari alohida, ustma-ust miltillash bo‘lmasligi uchun.

Manba rasmlari va aniqlik chegaralari: `artifacts/hokimiyat-reference/README.md`.
14 qavat uchun 45.8 m balandlik avvalgi OSM ekstrudatsiyasidan; fasad naqshining
mayda o‘lchamlari, daraxt turlari va jihozlar o‘lchangan 1:1 skan emas.
Yon korpusdagi panellar uning haqiqiy OSM konturi ichida joylashtiriladi.

Tekshirish: `npm run test:hokimiyat`, `npm run build`, `npm run test:world`.
Test tugma orqali borish, yerga tushish, tom kollayderi, maydon/yer balandligi,
takroriy oddiy bino yo‘qligi, render xatolari va kunduz/tun ko‘rinishini tekshiradi.
Natija tasvirlari: `artifacts/hokimiyat-front.png`, `hokimiyat-satellite.png`,
`hokimiyat-street.png`, `hokimiyat-night.png`.

## 2026-09-11: Satellites.pro bilan Ozero parkini boyitish

Satellites.pro Apple qatlamida z17, z18 va maksimal z19 ko‘rinishlari tekshirildi.
Ozero sharqiy qirg‘og‘i, shimoliy/janubiy park hamda Navoiy umumiy ko‘rinishi:
`artifacts/satellite-reference` ichida 6 ta referens screenshot va manba izohi bor.
Bu o‘yinga yuklanadigan satellite yer teksturasi emas. Butun Navoiy bo‘yicha
yuqori aniqlikdagi to‘liq mozaika yoki har bir bino fasadi olinmagan.

- 11 ta alohida ekin/daraxtzor bloki: park yo‘nalishiga burilgan yosh daraxt
  qatorlari, katta daraxtli erkin guruhlar, xilma-xil balandlik va toj kengligi.
- 1 008 ta park daraxti (mazkur smoke fixture), 32 ta yo‘lak konturi. Daraxtlar
  suv, bino, sport maydonchasi, yo‘lak va attraksion o‘rniga ekilmaydi.
- Janubiy bog‘ning diagonal yo‘llari, sayr maydonlari, charxpalak, karusel,
  ikki pergola, sharqiy sport jihozlari va besh yaproqli maydon bezaklari.
  Attraksionlar statik, ularga chiqish/aylanish mexanikasi yo‘q. Ularning
  balandliklari va konstruksiyasi vizual taxmin, real obyektning 3D skani emas.
- Tuproq va maysa bloklari relyef bo‘ylab mayda uchburchaklar bilan yotadi.
  Yo‘llarga 50 sm chokli protseduraviy tosh material qo‘shildi. Yashillik
  yo‘llardan pastroq depth qatlamida, suv uchun alohida yagona sirt saqlanadi.
- Ustunlar, karusel asosi va charxpalak tayanchlari fizik kollayderga ega;
  statik geometriya material bo‘yicha birlashtiriladi, daraxtlar LOD/instance.
- Parkda barg teksturali daraxtlar 550 m gacha saqlanadi. Uzoq daraxtlarning
  toji bir nechta bo‘lakdan iborat, ranglari ozroq farqlanadi. Dumaloq
  maydonlar relyef bo‘ylab maydalanadi; tekis yo‘laklar takroriy yer soyasi
  tashlamaydi, shuning uchun chiziqli self-shadow artefakti kamayadi.

Tekshiruv: typecheck, build, 13 world testi va lake smoke testi.
Qo‘shimcha ko‘rinishlar: `artifacts/ozero-park-north.png`, `ozero-park-south.png`.
Bu bosqich Ozero va parkni boyitadi; shaharning qolgan qismi avvalgi OSM
rekonstruksiyasi bo‘lib, satellite asosida har bir binoni 1:1 tekshirish tugamagan.

## 2026-09-11: transport va ko‘cha detallari

- Sport avtomobilga qo‘shimcha sedan, SUV, Suzuki SV650 va velosiped GLB modellari.
- F eng yaqin harakatdagi yoki to‘xtab turgan transportning aynan o‘z modelini egallaydi.
  Oldingi transport joyida qoladi; tushib, qayta o‘tirish mumkin. O‘lcham va tezlanish turiga mos.
- Mustaqil skeletli haydovchi avtomobil ichida, mototsikl/velosiped ustida ko‘rinadi.
  O‘tirish va qo‘l-oyoq pozalari hisoblanadi; velosipedda oyoqlar masofaga qarab pedal harakatini bajaradi.
- Quaternius barg teksturali daraxtlari, tayyor skameyka, chiroq va konditsioner modellari.
- Odamlar jami beshta model: Casual, Man, Woman, Woman Casual, Worker. Har nusxaning skeleti mustaqil.
- Daraxtlar 200 metrli guruhlarga bo‘lingan. 300 metrdan uzoqda yengil variant, yaqinda import qilingan model ishlaydi.
- OSM konturlari ustiga hajmli balkonlar va yo‘l chetlariga och rangli yo‘laklar.
- Litsenziyalar va mualliflar: `apps/client/public/models/credits.html` hamda har asset yonidagi LICENSE fayli.
- Yuklash: `node tools/models/fetch-fleet.mjs`. Tekshirish: `npm run test:fleet`.

Navoiy uchun [Uzbekistan Travel](https://uzbekistan.travel/en/r/navoi-region/) va
[UzReport](https://uzreport.news/society/navoiyda-toza-hudud-duk-ish-boshladi) fotosuratlari qidirildi.
Keng ko‘chalar, och fasadlar, yashil sayrgoh va daraxt qatorlari ko‘rinish uchun yo‘nalish berdi.
Koordinatali yuqori aniqlikdagi sun’iy yo‘ldosh tasviri bilan har bir bino/daraxt bo‘yicha tekshiruv
bajarilmadi. Qo‘shilgan balkon, daraxt, chiroq va skameyka joylari — taxminiy. Bu hali fotogrammetrik
1:1 Navoiy nusxasi emas; modellar bepul low-poly assetlar.

Bu OSM koordinatalaridan mustaqil quriladigan brauzer prototipi. Tayyor GTA
xaritasi yoki sun’iy yo‘ldosh rasmi ustida yurish emas. Fotorealistik raqamli
nusxa ham emas: xaritada bo‘lmagan fasad va interyerlarni qayta tiklamaydi.

## Boshqaruv

- WASD: piyoda yurish yoki mashina boshqarish; Shift: yugurish.
- Space: piyoda sakrash, mashinada qo‘l tormozi. F: radius ichidagi **eng yaqin** mashinaga o‘tirish/tushish.
- Sichqoncha: kamera; g‘ildirak: kamera masofasi.
- M yoki dumaloq xaritaga bosish: katta xarita. M/Escape: yopish.
- Xaritada +/− yoki g‘ildirak: 1–32× zoom; sudrash: surish.
- Mening joyim: o‘yinchi atrofiga yaqinlashtirish. Butun shahar: boshlang‘ich ko‘rinish.
- Bir marta bosish: metka. Teleport: eng yaqin xavfsiz ko‘chaga o‘tish;
  yangi joy colliderlari oldindan yuklanadi. Suv yonidagi xavfli joy rad etiladi.
- F3: texnik statistika. Xarita ochilganda o‘yin pauzada.

## Shahar va modellar

OSM ekstraktidan 35 213 bino va 6 540 yo‘l bo‘yicha geometriya yaratilgan.
Binoning konturi, qavat soni, turi va mavjud balandligi saqlanadi. Turga
qarab neytral ko‘rinish beriladi: uylar, ko‘p qavatli uylar, maktablar,
issiqxonalar, omborlar bir xil deraza tartibidan foydalanmaydi. Asl rang yoki
material tegi mavjud bo‘lsa, u ustun; aks holda ranglar dekorativ taxmin.

Xom ma’lumot auditi: bbox bilan kesishgan 34 790 binoning 29 693 tasida
qavat soni, 30 tasida aniq height tegi bor. building:colour, building:material,
roof:shape teglari topilmadi. Padded bake chegarasi tufayli sonlar yuqoridagidan farq qiladi.

Suv havzalari, kanal va ariqlar qo‘shilgan. Kanal markaz chiziqlari width
tegi bo‘lmasa turga qarab taxminiy en bilan kengaytiriladi. 2 469 suv
poligoni — alohida ko‘llar soni emas, kanal segmentlari ham shu hisobda.
Piyoda va mashina suvni kesib o‘tmaydi; suzish va suvga cho‘kish mexanikasi yo‘q.

6 tagacha NPC mashina, 10 tagacha piyoda o‘yinchi atrofida harakatlanadi. Daraxtlar
ko‘cha va yashil-zona konturidan hosil qilinadi: yumaloq, terak-simon va keng tojli
turlari aralashtiriladi.
OSM tutash nuqtalari va bir tomonlama yo‘llardan foydalaniladi. Mashinalar
rulni asta buradi, burilish oldidan sekinlashadi, oldidagi jismlargacha
masofa saqlaydi. Harakat bicycle steering formulasi va lateral acceleration
chegarasi bilan boshqariladi. Rapier kinematik collision: to‘liq shina,
amortizator va avariya simulyatsiyasi emas. OSMdagi svetoforlarda qizil/sariq/yashil sikl ishlaydi.

Personajlar: Quaternius Casual, Woman va Man, CC0 — Idle/Walk/Run.
Ular stilize qilingan low-poly modellar, insonning fotorealistik skani emas.
Avtomobil: CarConcept, Darmstadt Graphics Group, CC BY 4.0.
Manbalar va litsenziyalar apps/client/public/models ichida.

## Aniqlik chegaralari

Murakkab multipolygon relation teshiklari va ko‘prik/tunnel balandliklari
hali to‘liq qo‘llanmaydi. NPC bunday yo‘llarga chiqarilmaydi. Aniq peshlavha,
fasad, daraxt koordinatalari va interyerlar uchun qo‘shimcha geoma’lumot
kerak. Protseduraviy daraxt va yo‘l bo‘yoqlari o‘lchangan obyektlar emas.
Metkaga chiziq to‘g‘ri yo‘nalish: ko‘cha bo‘ylab hisoblangan marshrut emas.

Render hududi tuman ko‘rish masofasiga mos 3×3 tayl. Chegarani kesgan OSM obyektlari
navigatsiya uchun qo‘shni tayllarda saqlanadi, lekin ko‘rinadigan geometriya faqat bitta
egasi bo‘lgan taylda chiziladi — bu tom, yo‘l, suv va daraxtlardagi ustma-ust chizilish
(`z-fighting`)ni bartaraf qiladi. FPS uzoq pasaysa render
aniqligi 1.35× dan bosqichma-bosqich 0.8× gacha tushadi va tezlik tiklanganda
yana ko‘tariladi. Fizika bir kadrda ko‘pi bilan 6 ta 60 Hz qadamni quvadi;
bu uzoq kadrdan keyingi “catch-up” qotishini cheklaydi. Tuproq, asfalt, tom,
fasad, suv va o‘simliklar alohida materialga ega. Teksturalar protseduraviy,
sun’iy yo‘ldosh rasmining nusxasi emas.

## Ishga tushirish va tekshiruv

```sh
npm install
node tools/osm-pipeline/bake.mjs navoiy
node tools/models/fetch.mjs
node tools/models/fetch-casual.mjs
node tools/models/fetch-people.mjs
node tools/osm-pipeline/signals.mjs
node tools/osm-pipeline/fetch-terrain.mjs
npm run dev
```

Public ichidagi modellar, OSM va 16 ta DEM fayli bo‘lsa, qayta yuklash
shart emas. DEM mahalliydan o‘qiladi; fayl yo‘q bo‘lsa AWS Terrain Tiles
manbasiga murojaat qilinadi. OSM va model atributlari ekranda saqlangan.

```sh
npm run typecheck
npm test
npm run test:world
npm run build
# Mahalliy server ishlab turganda, Chrome/Edge yoki CHROME_PATH bilan:
npm run test:city
npm run test:details
```

Brauzer testi: 30/60/120 Hz yurish, sakrash va yerga qaytish, haydash,
chiqish/tushish, identifikatori bir xil NPC harakati, collider/mesh balandligi,
pauza, xarita zoom/sudrash/metka va teleport. Skrinshotlar artifacts ichiga
yoziladi. SwiftShader testidan haqiqiy GPU’dagi FPS haqida xulosa chiqarilmaydi.

## Kamera, modellar va svetoforlar

O‘ng mouse tugmasini ushlab 360° qarash mumkin; chap bosish pointer-lock
rejimini yoqadi, Esc undan chiqadi. Mashinada C ushlab kamerani orqaga
qaytarish mumkin. Kamera mustaqil aylantirilganda avtomatik qaytmaydi.
G‘ildiraklarda alohida rul va aylanish o‘qlari bor; burilish fizik rulga,
aylanish esa kolliziyadan keyingi haqiqiy masofaga bog‘langan. Orqaga
yurishda aylanish ham teskari. Modeldagi old g‘ildiraklarning dastlabki
30° burilishi tekislangan; old tomon nomlangan old/orqa o‘qlardan aniqlanadi.

Besh xil Quaternius personaji (Casual, Woman, Man, Woman Casual, Worker) bor.
Bular CC0 low-poly assetlar, fotorealistik skanlar emas. Manbalar va
litsenziyalar public/models ichida saqlangan.

signals.json mahalliy OSM ekstraktidan 40 ta traffic_signals nuqtasini
saqlaydi. Yuklangan yo‘llarga mos nuqtalarda 3D chiroqlar va zebra ko‘rinadi.
Qizil/sariqda NPC mashinalar to‘xtaydi, yashilda davom etadi. 50 soniyalik
ikki yo‘nalishli sikl, chiroq ustuni chekinishi va zebra chizig‘i taxminiy
o‘yin dizayni — real shaharning chiroq jadvali yoki o‘lchangan zebra emas.

Uy, ko‘p qavatli turar joy, savdo va umumiy binolarning fasadlari ajratilgan.
OSM konturlari va mavjud qavat ma’lumotlari saqlanadi. Deraza, balkon naqshi,
rang va tomning noma’lum detallari o‘lchangan emas. Ko‘cha darajasidagi asl
fasadlar uchun qo‘shimcha foto/3D ma’lumot zarur.

## Ozero: foydalanuvchi rasmlariga moslashtirish (2026-09-11)

`Ozero qirg‘og‘iga borish` tugmasi xavfsiz yo‘lga ko‘chiradi. Soat slayderi
bilan tong/kunduz/shom/tunni ko‘rish, `hozir` bilan haqiqiy vaqtga qaytish mumkin.

- Ko‘l: OSM suv halqasining 46 nuqtasi, shu jumladan sharqiy ichkariga kirgan
  qirg‘oq saqlanadi. Tayllardan takroriy suv chizilmaydi: bitta uzluksiz 3D sirt.
- Foydalanuvchi bergan birinchi satellite screenshot uchta OSM qirg‘oq
  nuqtasiga bog‘langan. Shimoliy aylana yo‘laklar, bayroq maydoni, sharqiy
  sayrgoh, amfiteatr, janubiy yo‘laklar va uchta pristan vizual taxmin bilan
  modellashtirilgan. Qolgan yettita rasm shu qismlarning ko‘rinishi uchun
  ishlatilgan; Google rasmlari tekstura yoki yer qoplami sifatida qo‘shilmagan.
- Qirg‘oq: pale stone bank, aylanma sayr yo‘li, 580 ta qo‘shimcha qatorlab
  ekilgan imported tree instance, tayyor chiroq/skameyka assetlari.
  Bular individual daraxtlarning o‘lchangan koordinatalari emas.
- Suv: to‘q yashil-ko‘k chuqur qism, sayoz qirg‘oq rangi, shamol ripplari,
  Fresnel osmon aksi va quyosh/oydan PBR yorug‘lik. Bu ray-traced shahar aksi emas.
- Ozero yonida yer to‘ri 16× zichroq (~4 m). Render, `heightAt` va Rapier
  trimesh bir xil geometriya ishlatadi; ko‘l ichidan eski yirik kataklar
  chiqib qolmaydi. 4 m tub chuqurligi — o‘yin uchun taxmin, batimetrik o‘lchov emas.
- Quyosh/oy disklarining burchak o‘lchami tabiiy kattalikka yaqinlashtirildi;
  atmosfera shu’lasi, oy fazasi va protseduraviy sirt tuslari bor. Muhit aksi
  balandlik bilan birga azimut va oy yo‘nalishiga ham qarab yangilanadi.
  Osmon va materiallar bir xil tone mapping/rang fazosidan o‘tadi.
- Tunda qirg‘oq chiroqlarining linzalari va yer shu’lasi yonadi. Eng yaqin
  to‘rtta chiroq haqiqiy nuqtaviy yorug‘lik ham beradi; barcha ustunlar uchun
  alohida soya hisoblanmaydi. Oy ufq ostida/yangi oy bo‘lsa sun’iy to‘lin oy
  ko‘rsatilmaydi. Sinov uchun alohida to‘lin oy lahzasi ham tekshiriladi.

Bu ish GTA darajasidagi fotorealistik yoki har bir bino fasadining 1:1 nusxasi
emas. Amfiteatr balandligi, bayroq ustuni, yo‘lak kengliklari va jihoz joylari
taxminiy rekonstruksiya. Bino/yo‘l asosiy konturlari OSMdan keladi.

Tekshirish: `npm run test:world`, `npm run test:lake`, `npm run test:sky`,
`npm run test:city`, `npm run build`. `test:lake` tugma, suv sathi, tub,
qirg‘oq ichida yer chiqmasligi, kolliziya/render mosligi va to‘lin oy nurini
tekshiradi. Tasvirlar: `artifacts/ozero-overhead.png`, `ozero-evening.png`,
`ozero-night.png`, `ozero-moon.png`.
