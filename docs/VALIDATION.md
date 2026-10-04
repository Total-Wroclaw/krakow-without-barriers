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

## Położenie obserwacji z lotu ptaka (4 października 2026)

Pomiar: 12 miejsc w Krakowie (centrum, dworzec, galerie, szpital, arena, Nowa Huta, Kopiec Kościuszki), obserwacje modelu porównane z OSM (Geofabrik): odległość od najbliższego obiektu tego samego rodzaju (przejście, schody, parking, torowisko, chodnik/plac) i trafienia w obrys budynku. Kilka przebiegów, bo model nie jest deterministyczny.

| Wariant | mediana błędu (przejścia, schody, parkingi, tory) | > 20 m od obiektu | uwagi |
| --- | --- | --- | --- |
| dotychczas (`detail: auto`) | ok. 10 m | 10 z 52 | punkty na dachach i trawnikach |
| pełna rozdzielczość (`detail: high`) | 3–13 m | 7–15 z ~50 | |
| siatka współrzędnych na zdjęciu | 2–6 m | 1–7 z ~35 | mniej obserwacji, mała poprawa |
| **pełna rozdzielczość + drugie spojrzenie na zbliżeniu 50 m** | **1–3 m** | **3–4 z ~40** | ok. 20% obserwacji odrzuconych jako niepotwierdzone |

Wybrany ostatni wariant: każda obserwacja jest sprawdzana na ostrzejszym wycinku 50 × 50 m wokół wskazanego miejsca; model wskazuje ją dokładnie albo odrzuca (dach, drzewo, trawnik). Bez tego sprawdzenia obserwacje nie są pokazywane. Część „błędów” to braki w OSM (np. nieoznaczony parking na podwórku), a parking na dachu Galerii Kazimierz jest prawdziwy. Pełny odczyt trwa ok. 15–20 s i jest zapisywany w pamięci podręcznej.

### Szybszy odczyt (4 października 2026, ANALYSIS_VERSION 10)

Odczyt jest teraz podzielony: wskazówki dojścia (bez rozumowania modelu, `effort: none`) i wstępne obserwacje (`effort: low`, pełna rozdzielczość) idą równolegle, a każda obserwacja jest sprawdzana na własnym zbliżeniu 50 × 50 m, wszystkie naraz (`effort: none`). Odpowiedź `POST /api/aerial` to NDJSON: najpierw wskazówki, potem pełny odczyt z obserwacjami; odczyt z pamięci podręcznej to jedna linia.

Czas (5 miejsc: Teatr Słowackiego, Camelot Cafe, Bar Kawowy Rio, Galeria Kazimierz, Muzeum Narodowe; bez pamięci podręcznej, po jednym naraz):

| | wskazówki | obserwacje |
| --- | --- | --- |
| przedtem (jedno wywołanie + zbiorcze zbliżenia, `effort: medium`) | ok. 16 s (razem z obserwacjami; pierwsze 4–8 s, zbliżenia 6–10 s) | ok. 16 s |
| teraz, `POST /api/aerial` | 2,7–3,5 s (średnio 3,0 s) | 5,7–7,4 s (średnio 6,5 s) |
| teraz, w przeglądarce od kliknięcia miejsca | 3,4–4,5 s | 6,2–8,7 s |
| z pamięci podręcznej, w przeglądarce | ok. 0,4 s | ok. 0,4 s |

Dokładność (te same 12 miejsc co wyżej, 4 przebiegi z ustawieniami produkcyjnymi): mediana błędu 1,7–2,3 m, > 20 m od obiektu 4–9 z ~45 (łącznie 25/180 = 14%; przedtem 24/209 = 11,5%), na dachu 0–3 (przedtem 3–8), przejścia/schody/parkingi/tory w 8 m: 77% (przedtem 69%). Wstępne obserwacje bez rozumowania (`effort: none`) wypadły wyraźnie gorzej (mediana dla przejść i schodów ~20 m przed sprawdzeniem), więc zostają na `low`.
