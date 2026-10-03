# Każdy Krok / Every Step

„Czy dam radę przejść tę trasę dzisiaj?” Planer podróży i przewodnik po miejscach Krakowa dla osób o ograniczonej mobilności: w trakcie rehabilitacji, na wózku, z wózkiem dziecięcym. Zamiast diagnozy: dzisiejsze preferencje dotyczące barier. Interfejs po polsku, angielsku i niemiecku, projektowany najpierw pod iPhone’a.

## Uruchomienie

Node.js 24 (sprawdzono 24.16.0) i npm.

```sh
npm ci                      # kopiuje też worker MapLibre do public/maplibre
npm run data:transit        # jednorazowo: rozkład ZTP → .runtime/transit.sqlite (~320 MB)
# pozostałe migawki (OSM, miejsca, drogi, parkingi, budynki UMK) są w data/ i odświeża się je skryptami data:*
npm run dev -- --port 3030
```

Otwórz [localhost:3030](http://localhost:3030). Produkcyjnie: `npm run build && npm run start -- --port 3030`.

AI: serwer bierze `OPENAI_API_KEY` z procesu albo czyta tylko tę zmienną z istniejącego `../.env` (inna ścieżka: `OPENAI_ENV_FILE`). Klucz nie trafia do klienta, logów ani dokumentacji. Domyślny model: `gpt-5.6-luna` (zmiana: `OPENAI_MODEL`). Bez klucza trasy, wyszukiwanie i zgłoszenia działają; zdjęcie zapisuje się bez automatycznego opisu.

### Panel dla miasta (`/city`)

Panel zgłoszeń dla Urzędu Miasta Krakowa / ZDMK jest wyłączony, dopóki nie ustawisz hasła:

```sh
CITY_DASHBOARD_PASSWORD='długie-hasło-służbowe' npm run dev -- --port 3030
# albo wpis w .env.local (plik jest w .gitignore)
# opcjonalnie: CITY_DASHBOARD_SECRET — osobny klucz podpisu ciasteczka sesji
```

Otwórz [localhost:3030/city](http://localhost:3030/city) i zaloguj się tym hasłem (sesja 12 h). W produkcji ciasteczko ma flagę `Secure`, więc panel wymaga HTTPS.

## Co działa

**Trasa**
1. **Wyszukiwanie jak w Jakdojade/Google Maps.** Adresy z numerami, ulice, miejsca i przystanki ZTP z lokalnego indeksu (także bez polskich znaków), „Moja lokalizacja”, godzina wyjazdu.
2. **Czym jedziesz:** komunikacja (tramwaje i autobusy ZTP z przesiadkami), taksówka (od drzwi do drzwi, cena szacunkowa wg maksymalnej taryfy miejskiej, przyciski Uber/Bolt/FreeNow) albo samochód (dojazd na parking, potem dojście). Na wózku samochód kieruje tylko na parkingi z miejscami dla osób z niepełnosprawnościami.
3. **Jak się poruszasz:** pieszo, o kulach, na wózku, z wózkiem dziecięcym. Odpoczynek co 5–20 minut (ławki przy każdym odcinku), dostępne toalety na trasie. Na wózku znikają schody, wysokie krawężniki, wąskie przejścia; bruk i strome odcinki są karane i opisane.
4. **Lista wariantów** z paskiem przebiegu, na którym bariery stoją tam, gdzie wystąpią; krótkie powody, gdy wariant nie pasuje.
5. **Mapa (standardowa lub satelitarna GUGiK) i lista kroków**: oś czasu, wskazówki, przystanki, parking, schody i krawężniki wpięte w kroki. Udostępnianie trasy linkiem (np. opiekunowi).

**Odkrywaj**
6. **Muzea, zabytki, kultura, urzędy, toalety, noclegi, zdrowie, parki** (3 080 miejsc z OSM, 886 z danymi o dostępności, 20 budynków z zestawienia UMK). Konkretne fakty: wejście bez stopni, stopnie, podjazd, winda, schodołaz, szerokość drzwi, toaleta, obsługa w języku migowym; każdy ze źródłem, datą pobrania, datą edycji i statusem. Braki są pokazane jako „brak danych”, sprzeczne źródła jako ostrzeżenie.
7. **Okolica z lotu ptaka:** AI opisuje wycinek ortofotomapy GUGiK (co widać, czego nie da się ocenić z góry, co sprawdzić na miejscu). Bez pomiarów i bez oceny dostępności.
8. **Partnerzy:** właściciel obiektu, hotel lub organizator dodaje dane o dostępności (deklaracja właściciela z datą), wybiera wpis bezpłatny albo pakiet partnera z oznaczeniem „Promowane” i dostaje kod widżetu „Jak do nas dotrzeć bez barier” (`/embed?to=lat,lon&name=…`). Promocja nie zmienia danych o dostępności. Przykładowy partner jest jawnie oznaczony jako dane demonstracyjne.

**Wspólne**
9. **Zgłoszenie jednym zdjęciem**: AI opisuje, zapis jako niezweryfikowane, autor może poprawić lub usunąć. Zgłoszenie sprzeczne z mapą (np. poręcz) daje ostrzeżenie o sprzecznych danych przy barierze.
10. **„Nie dotarłem/am”**: zgłoszenie, że coś uniemożliwiło dotarcie do celu — także bez zdjęcia (komentarz i cel podróży), z możliwością dołożenia do 4 zdjęć, każde opisane przez AI.
11. **Panel miasta** (`/city`): przegląd zgłoszeń, filtry, mapa, statusy z historią zmian, publiczna odpowiedź, eksport CSV.
12. **Potrzeby własnymi słowami** zamieniane przez AI na ustawienia.
13. **Języki:** polski, angielski, niemiecki — interfejs, wskazówki z serwera i odpowiedzi AI.

Routing jest deterministyczny (graf pieszy i drogowy OSM, rozkład GTFS). AI (`gpt-5.6-luna`) nie wyznacza tras.

## Wdrożenie

Produkcja: [kazdy-krok.antek.page](https://kazdy-krok.antek.page) — Dokploy (Compose), obraz z `Dockerfile` budowany przy każdym pushu na `main`. Rozkład ZTP jest pobierany podczas budowania obrazu; zgłoszenia, zdjęcia i cache kafelków satelitarnych leżą na wolumenie `krok-data` (`/data`). Zmienne środowiskowe ustawione w Dokploy: `OPENAI_API_KEY`, `OPENAI_MODEL`, `CITY_DASHBOARD_PASSWORD`, `CITY_DASHBOARD_SECRET`. Panel miasta: `/city`.

## Sprawdzenie

```sh
npm run typecheck
npm test                         # routing, przesiadki, wyszukiwanie, magazyn zgłoszeń
npm run build
npm run test:ai                  # niewielkie rzeczywiste zapytania do modelu
node scripts/ui-check.mjs        # Playwright + axe (WCAG 2.2 AA), telefon i desktop; wymaga działającego serwera
npx tsx scripts/inspect-routes.ts  # czasy przykładowych zapytań planera
```

Wyniki: [docs/VALIDATION.md](docs/VALIDATION.md).

## Struktura

- `scripts/acquire-city.py`, `acquire-places.py`, `acquire-transit.py`: pozyskanie i normalizacja (Geofabrik PBF, ZTP GTFS). Wyniki w `data/` i `.runtime/`.
- `src/lib/routing.ts`, `walking.ts`, `city-graph.ts`: graf pieszy, A* z kosztami preferencji i profilu (wózek), kierunek schodów, wskazówki, dobór faktów.
- `src/lib/roads.ts`, `drive.ts`, `parking.ts`: graf drogowy, taksówka/samochód, parkingi z miejscami dla osób z niepełnosprawnościami.
- `src/lib/objects.ts`, `city-venues.ts`: miejsca do odkrywania (OSM + UMK + partnerzy + zgłoszenia), `GET /api/objects`, `POST /api/partners/objects`.
- `src/lib/imagery.ts`: wycinek ortofotomapy GUGiK, `POST /api/aerial`.
- `src/lib/i18n/*`: języki interfejsu i komunikaty serwera.
- `src/lib/transit.ts`, `transit-scan.ts`, `journey.ts`: connection scan, przesiadki, lista wariantów; `POST /api/journey`.
- `src/lib/places.ts`: indeks wyszukiwania; `GET /api/places`.
- `src/lib/ai.ts`, `reports-server.ts`, `server.ts`: AI (Responses API, Structured Outputs), zgłoszenia w SQLite, walidacja i czyszczenie zdjęć.
- `src/app/city`, `src/components/city/*`, `src/lib/city-auth.ts`, `city-reports.ts`, `src/app/api/city/*`: panel miasta (logowanie, filtry, statusy, CSV).
- `src/components/planner/*`: interfejs (shadcn/ui na Radix + Tailwind 4, własny motyw), `src/components/ui/*`: komponenty shadcn.

Więcej: [architektura](docs/ARCHITECTURE.md), [źródła i licencje](docs/DATA-SOURCES.md), [materiały konkursowe](docs/competition/README.md).

## Ograniczenia

- Dane OSM nie są sprawdzone w terenie; brak schodów na mapie nie gwarantuje ich braku. Progi, nachylenia i ciągłość chodników są w danych niepełne.
- Rozkład jest planowy (bez opóźnień na żywo). Obecny GTFS ZTP nie podaje przystosowania kursów ani przystanków (wszędzie „brak informacji”), więc dla wózka każdy przejazd ma tę uwagę. Nie podajemy stanu wind.
- Czas jazdy samochodem/taksówką to szacunek z mapy dróg (bez korków, zakazów skrętu i opłat). Tylko 5,6% parkingów w OSM ma oznaczone miejsca dla osób z niepełnosprawnościami.
- Pakiet partnera nie ma jeszcze płatności ani weryfikacji tożsamości; w prototypie każdy może go wybrać.
- Zgłoszenia nie mają kont ani moderacji; panel miasta ma jedno wspólne hasło (bez kont i ról). To lokalny prototyp. Zdjęcia i wycinki ortofotomapy trafiają do OpenAI do opisu.
- Kamera i GPS na iPhonie wymagają HTTPS (lub localhost). Sprawdzono Safari na symulatorze iPhone; nie testowano na fizycznym telefonie ani z VoiceOver.
- Serwer trzyma graf w pamięci (~1,2 GB RSS po starcie); usługa docelowa potrzebuje PostGIS/zoptymalizowanego grafu.
- Nic nie zostało opublikowane, wdrożone ani zgłoszone do konkursu.

## Konkurs

Oryginalne dokumenty w [docs](docs/README.md). Kryteria proponują wagi 25/20/15/20/20%, a regulamin 30/30/20/10/10% — do potwierdzenia z mentorami. Zgłoszenie: po polsku, PDF do 10 slajdów, wideo do 3 minut. Regulamin zawiera warunki przeniesienia praw; nie zaakceptowano żadnej umowy w imieniu użytkownika. Materiały w `docs/competition` (PDF, wideo) pokazują wcześniejszą wersję interfejsu i wymagają odświeżenia. Zgodność z wymaganiami: [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md).
