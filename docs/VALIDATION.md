# Walidacja (3 października 2026)

| Kontrola | Wynik |
| --- | --- |
| `npm run typecheck` | bez błędów |
| `npm test` | 68/68 (routing i kierunek schodów, profil wózka/wózka dziecięcego, taksówka i samochód z parkingami, przesiadki, kolejność wariantów, komunikaty pl/en/uk, wyszukiwanie, miejsca: parsowanie UMK, łączenie źródeł, konflikty, braki danych, walidacja partnera, magazyn zgłoszeń, błędy sieci/AI) |
| `npm run build` | produkcyjny build Next.js 16 przechodzi |
| `npm run test:ai` | `gpt-5.6-luna` dostępny; potrzeby → ustawienia z zachowanym kierunkiem schodów; opis syntetycznego zdjęcia zgodny ze schematem, kierunek „nieznany” |
| `node scripts/ui-check.mjs` | Chromium, iPhone 13 (emulacja) i desktop 1440×900: wyszukiwanie → wyniki → szczegóły → preferencje → zdjęcie (zapis automatyczny, poprawa, usunięcie) → wózek + samochód → mapa satelitarna → Odkrywaj → miejsce → formularz partnera → język angielski → widżet `/embed`. axe-core, tagi WCAG 2.0/2.1/2.2 A+AA: **0 naruszeń**, brak błędów strony. Zrzuty: `artifacts/ui/` (poza Gitem) |
| iOS Simulator (iPhone 18 Pro, iOS 27, Safari) | wpisanie adresu i celu, wybór podpowiedzi przy otwartej klawiaturze, mapa MapLibre z trasą i schodami, lista wariantów, oś czasu przejazdu |
| `POST /api/aerial` | ortofotomapa GUGiK + opis AI po angielsku dla Wawelu, ok. 7 s |
| `npx tsx scripts/inspect-routes.ts` | po wczytaniu grafu: zapytania miejskie 12–200 ms, pierwsze zapytanie po zimnym starcie ~2,5 s |

Znalezione i poprawione podczas testów (runda 2): nakładające się znaczniki miejsc (teraz warstwa mapy, lista jest odpowiednikiem), panele zakładek bez powiązania z kartami, kontrast nieaktywnej zakładki, odwrócone kolory cech oznaczających barierę („stopnie przy wejściu: tak”). Runda 1: popover podpowiedzi przeskakiwał nad pole przy klawiaturze iOS (teraz lista pod polem, mapa chowa się w trakcie wpisywania); worker MapLibre 6 nie ładował się po bundlowaniu (serwowany z `public/maplibre`); nakładające się znaczniki ławek (ukryte do przybliżenia); `aria-expanded`/`aria-controls` przy zamkniętej liście; etykiety suwaka na uchwycie; karty tras czytane jako przełączniki (teraz `aria-current`).

Nie sprawdzono: fizyczny iPhone, VoiceOver, aparat na prawdziwym urządzeniu (w testach plik zdjęcia), WebKit Playwright (pobranie przeglądarki przekroczyło limit czasu — zamiast niego Safari w symulatorze), działanie przy słabej sieci w terenie.
