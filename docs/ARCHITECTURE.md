# Architektura i przepływ danych

Pozyskanie → migawki źródeł → normalizacja → deterministyczne planowanie → prezentacja faktów. AI jest oddzielnym pomocnikiem (opis zdjęcia, zamiana opisu potrzeb na ustawienia), zgłoszenia — oddzielnym magazynem.

```
Geofabrik PBF ──acquire-city.py──▶ data/krakow-city.json.gz ──▶ city-graph.ts (graf CSR w pamięci)
              ├─acquire-places.py─▶ data/krakow-places.json.gz ─▶ places.ts ──▶ GET /api/places
              └─acquire-roads.py──▶ data/krakow-roads.json.gz ──▶ roads.ts ─┐ (taksówka/samochód)
                                    data/krakow-parking.json.gz ─▶ parking.ts ┴▶ drive.ts ─▶ journey.ts
ZTP GTFS A/M/T ─acquire-transit.py─▶ .runtime/transit.sqlite ──▶ transit.ts ─┐
                                                                    walking.ts ┴▶ journey.ts ▶ POST /api/journey { from, to, preferences, date, time, transport?, locale? }
Zdjęcie ─▶ server.ts (sharp: dekodowanie, zmniejszenie, bez EXIF) ─▶ ai.ts ─▶ reports-server.ts ─▶ .runtime/reports.sqlite
```

## Ruch pieszy

`buildGraph` tworzy zwarty graf (CSR, tablice typowane) z dróg pieszych i ulic OSM w obszarze 19.75–20.25 E, 49.94–50.20 N. Wykluczone: drogi prywatne, z zakazem ruchu pieszego, płatne, wewnętrzne, `area=yes`. Punkt startu/celu przypina się do najbliższego węzła głównej spójnej sieci (indeks siatki, maks. 100 m).

Kierunek schodów: `incline=up/down` odnosi się do kolejności węzłów drogi OSM; przejście w przeciwną stronę odwraca kierunek. Nieznany kierunek nigdy nie spełnia wykluczenia „unikam w dół/w górę”. `oneway:foot` i `oneway` na schodach ograniczają kierunek.

Wyszukiwanie: A* z jawnymi kosztami (`edgeCost`):
- wykluczone schody (`forbidden`) — twarde wykluczenie,
- schody bez oznaczonej poręczy przy „wolę poręcze”: +5 × długość,
- odcinek bez ławki w promieniu 25 m przy „odpoczynek”: +0,25 × długość,
- oś ulicy zamiast ścieżki pieszej: +0,3 × długość,
- wariant alternatywny: użyte drogi +3 × długość.

Warianty piesze: „Dopasowana do dzisiaj” (preferencje) oraz „Najkrótsza” (bez preferencji, jeśli wyraźnie inna) lub „Inny przebieg”. Tempo 1,0 m/s. Limit dystansu nie usuwa wariantu, tylko oznacza go jako niepasujący z krótkim powodem.

Odciążenie interfejsu (`walking.ts`): każda klatka schodowa na trasie jest faktem (kierunek względem drogi, stopnie, poręcz) i jest wpięta we wskazówkę; ławki tylko przy „odpoczynku”, co najmniej 150 m od siebie, maks. 25 m od trasy; wejścia tylko przy celu (≤ 30 m, maks. 2). Wskazówki grupują odcinki po nazwie, łączą fragmenty < 15 m i opisują skręty (zmiana kursu > 35°).

## Komunikacja miejska

`acquire-transit.py` normalizuje trzy feedy ZTP do SQLite (przystanki, kursy, kalendarze, wyjątki, kształty, połączenia). `transit.ts`:
1. Kandydaci: przystanki do ~900 m od startu i celu; dojścia liczone na grafie z preferencjami (`reach`, jedno przeszukanie do wielu celów).
2. Connection scan (`transit-scan.ts`) w oknie czasu, do 3 wejść do pojazdu, przesiadka na tym samym słupku z buforem 120 s, przejście między słupkami ≤ 400 m z szacunkiem (odległość × 1,3 przy 1 m/s + 60 s).
3. Każde użyte przejście jest sprawdzane rzeczywistym dojściem na grafie; jeśli jest dłuższe niż szacunek, scan się powtarza z poprawką.
4. Kolejne warianty: ponowny scan po odjeździe poprzedniego; duplikaty i warianty zdominowane są usuwane. Do 4 wariantów.

Kursy z GTFS po północy i doba poprzednia/następna są obsługiwane przesunięciem doby. Przystosowanie kursu pochodzi z `wheelchair_accessible`.

## Profil poruszania się (`preferences.mobility`)

To sposób poruszania się w danym dniu (`walk`, `wheelchair`, `stroller` — wózek dziecięcy), nie diagnoza. Dla `walk` routing działa dokładnie jak wcześniej. Dla kół (`routing.ts`, bity `edgeMobility` na krawędziach i `nodeBarrier` na węzłach):

| Cecha OSM | Wózek inwalidzki | Wózek dziecięcy |
| --- | --- | --- |
| `highway=steps` | zawsze wykluczone (niezależnie od „unikam schodów”), chyba że `ramp:wheelchair=yes` | wykluczone, chyba że `ramp=yes` lub `ramp:wheelchair=yes` |
| węzeł `kerb=raised` (też `normal`) | wykluczony | +40 m kosztu |
| `barrier=kerb` bez `kerb=*`, `kerb=yes` | +60 m | +20 m |
| `kerb=rolled` | +30 m | +10 m |
| `barrier=step/stile/turnstile/kissing_gate` | wykluczony | +80 m |
| `wheelchair=no` (droga / węzeł) | wykluczone | droga +1 × długość |
| `width` < 0,9 m (tylko footway/path/steps) | wykluczone | +0,5 × długość |
| `smoothness=impassable` | wykluczone | wykluczone |
| bruk/żwir (`sett`, `cobblestone`, `gravel`, `pebblestone`, `unpaved`, `rock`), `smoothness=bad` | +2 × długość | +1 × długość |
| `unhewn_cobblestone`, `ground`, `dirt`, `grass`, `sand`, `mud`, `grass_paver`…, `smoothness=very_bad/horrible/very_horrible` | +5 × długość | +2,5 × długość |
| liczbowe `incline` > 6 % (%, ° lub `steep`, poza schodami) | +3 × długość | +1 × długość |

Pokrycie tagów w grafie pieszym (735 530 węzłów): `kerb` na 5 853 węzłach (4 271 `lowered`, 1 147 `flush`, 367 `raised`, 10 `yes`), `barrier=kerb` 5 369, `barrier=step` 59; na drogach `surface` 107 048, `smoothness` 19 577, `width` 4 708 (w tym 140 ścieżek < 0,9 m), `wheelchair` 1 039, liczbowe `incline` 92 (30 powyżej 6 %). Brak tagu nie jest karany (poza krawężnikiem o nieznanej wysokości) — to niewiadoma, nie bariera. Wysokość krawężnika (`kerb:height`) nie jest pobierana.

Fakty na kołach (tylko gdy `mobility ≠ walk`): krawężniki/progi jako `kind: 'kerb'` (`barrier`: `kerbRaised`, `kerbUnknown`, `kerbRolled`, `step`, `nodeNoWheelchair`), odcinki jako `kind: 'surface'` z `length` (`sett`, `rough`, `steep`, `narrow`, `noWheelchair`, `impassable`; łączone po drodze OSM, od 10 m). `issues`: najpierw powody niepasowania (wózek: schody bez rampy, krawężnik bez obniżenia, próg, wąsko, `wheelchair=no`; oba: nieprzejezdne, limit dystansu), potem informacje, które nie zmieniają `fits` („Bruk na 120 m”, „Nierówna nawierzchnia na…”, „Strome nachylenie na…”, krawężnik o nieznanej wysokości, dla wózka dziecięcego także krawężnik bez obniżenia). Gdy nie ma trasy bez barier, pokazujemy najkrótszą z komunikatem i oznaczeniami.

Komunikacja na kołach: dla wózka inwalidzkiego kursy z `wheelchair_accessible=2` są usuwane przed scanem (`usableConnections`), a przystanki z `wheelchair_boarding=2` nie są brane jako dojście; warianty z kursami oznaczonymi `1` są wyżej niż nieznane. Wózek dziecięcy: bez wykluczeń, kursy `2` niżej. Każdy kurs bez informacji dostaje uwagę „Kurs bez informacji o przystosowaniu” (nie zmienia `fits`). **Ograniczenie danych:** w obecnym GTFS ZTP wszystkie 124 239 kursów mają `wheelchair_accessible=0` (brak informacji), a wszystkie 3 751 słupków `wheelchair_boarding=0` — mechanizm działa, ale dziś nic nie wyklucza ani nie różnicuje; uwaga pojawia się przy każdym wariancie.

## Taksówka i samochód (`transport: 'taxi' | 'car'`)

`acquire-roads.py` (pyosmium, ten sam PBF i obszar) zapisuje drogi przejezdne `motorway`…`living_street` + `service` (bez `area=yes`, `service=emergency_access`). Dostęp wg hierarchii `motorcar` > `motor_vehicle` > `vehicle` > `access`: `yes/designated/permissive` — tak; `destination/customers` — tak, z karą (×4 czasu + 60 s), więc tylko blisko końców; reszta (`no`, `private`, `delivery`, `psv`, `agricultural`…) — wykluczone. Jednokierunkowość: `oneway=yes/-1`, rondo (`junction=roundabout/circular`), autostrada; `oneway=reversible/alternating` pomijane. `roads.ts` buduje graf CSR na tablicach typowanych i wybiera największą silnie spójną składową.

**Model czasu (szacunek, bez ruchu na żywo):** prędkość = `maxspeed` (także `PL:urban` 50, `PL:rural` 90, `PL:zone30`, `PL:living_street` 20) albo domyślna dla klasy (autostrada 120, ekspresowa/trunk 90, główne do lokalnych 50, `unclassified` 40, `residential` 30, `living_street` 15, `service` 15 km/h) × współczynnik miejski 0,65 (≤ 50 km/h), 0,8 (≤ 80), 0,9 (> 80); do tego +15 s na sygnalizacji świetlnej (`highway=traffic_signals`) i +4 s na skrzyżowaniu ≥ 3 ramion. Nie liczymy czekania na taksówkę, szukania miejsca ani opłat — nie podajemy cen (brak cytowalnego oficjalnego cennika taksówek w Krakowie).

**Krawężnik (miejsce wsiadania/wysiadania):** spośród do 40 węzłów drogowych w promieniu 250 m (bez autostrad i dróg ekspresowych, tylko główna spójna składowa) wybieramy ten z najkrótszym dojściem pieszym z dzisiejszymi preferencjami — najbliższa droga bywa tunelem (np. pod Dworcem Głównym). Odcinek pieszy pojawia się, gdy krawężnik jest > 40 m od punktu.

- **Taksówka:** jeden wariant `id: 'taxi'`, `kind: 'taxi'`, etykieta „Taksówka”: [pieszo do krawężnika] → `DriveLeg` (`mode: 'taxi'`) → [pieszo do celu]. Dla wózka inwalidzkiego uwaga „Zamów pojazd przystosowany do wózka”.
- **Samochód:** parkingi do 600 m od celu (do 12 najbliższych), dojście z parkingu do celu jednym odwrotnym przeszukaniem (`reach`) z preferencjami, ranking po długości dojścia, do 3 różnych parkingów (≥ 80 m od siebie); dojazd jednym Dijkstrą do wszystkich parkingów. `id: 'car-way-123'`, `kind: 'car'`, etykieta „Samochód · {nazwa}” albo „Samochód · parking 180 m od celu”, `DriveLeg.parking: ParkingInfo`. Wózek inwalidzki: tylko miejsca z oznaczonymi miejscami dla osób z niepełnosprawnością. Brak parkingu: wariant `car-dropoff` „Samochód · podjazd pod cel” z powodem niepasowania „Brak parkingu (z miejscami dla osób z niepełnosprawnością) w promieniu 600 m”.

Warianty samochodowe/taksówki są na początku listy, za nimi jak dotąd piesze i komunikacja do porównania. Koszt po załadowaniu grafu: taksówka ~+20 ms, samochód ~+35 ms względem samej komunikacji (mediana, 2,3 km–12 km). Załadowanie grafu drogowego ~220–380 ms przy pierwszym żądaniu taxi/car, +~85 MB RSS (415 223 węzły, 797 032 krawędzie); graf pieszy pozostaje głównym kosztem (~2,3–4,7 s, ~0,9–1 GB RSS).

**Ograniczenia:** brak zakazów skrętu (relacje `restriction`), brak czasowych ograniczeń (`:conditional`), brak strefy płatnego parkowania i jej cen. Strefa Ograniczonego Ruchu na Starym Mieście jest respektowana tylko tam, gdzie OSM ma ją jako `access`/`motor_vehicle` (np. `destination` → kara, `no` → wykluczenie); harmonogramy i wyjątki dla posiadaczy kart parkingowych nie są modelowane.

## Parkingi (`parking.ts`)

`amenity=parking` (węzły, obrysy, multipoligony; środek ciężkości obrysu; bez `access=private/no`) z `name`, `capacity`, `capacity:disabled`, `fee`, `access`, `parking`. Miejsca dla osób z niepełnosprawnością `parking_space=disabled` / `amenity=parking_space` z `capacity:disabled` lub `disabled=designated` są przypisywane do parkingu, w którego obrysie leżą; pozostałe (często przy ulicy) są osobnymi miejscami `kind: 'disabled_space'`. Parking „ma miejsca dla osób z niepełnosprawnością”, gdy `capacity:disabled` > 0 / `yes` albo leży w nim zmapowane miejsce. `parkingNear(point, radius, { disabledOnly, locale, limit })` zwraca `ParkingInfo` (z `distance`) od najbliższego — do użycia w mapie „Odkrywaj”. Zajętość, godziny i ceny nie są znane.

## Języki odpowiedzi

`POST /api/journey` przyjmuje `locale` (`pl` domyślnie, `en`, `uk`). Wszystkie teksty planera (wskazówki, etykiety, tytuły faktów, `issues`, `errors`, błędy 400/500) pochodzą z `src/lib/i18n/server-messages.ts`; liczby mnogie przez `Intl.PluralRules` (pl: 1 stopień, 2–4 / 22–24 stopnie, 5–21 stopni; uk: 1/21 сходинка, 2–4 сходинки, 5–20 сходинок), dystanse w formacie lokalnym (1,2 km / 1.2 km / 1,2 км). Nazwy ulic, przystanków i miejsc pozostają jak w źródle.

## Wyszukiwanie miejsc

`places.ts` ładuje indeks raz (~230 ms), dalej zapytanie trwa < 4 ms: prefiksy słów bez wielkości liter i polskich znaków, numery domów, ranking z bliskością. Przystanki dochodzą z lokalnego rozkładu. Brak zapytań do zewnętrznego geokodera podczas pisania. Odwrotne geokodowanie („Moja lokalizacja”): adres ≤ 80 m, inaczej miejsce/ulica ≤ 150 m.

## Odkrywaj: obiekty, źródła, partnerzy

```
Geofabrik PBF ─acquire-objects.py─▶ data/krakow-objects.json.gz ─┐
UMK dok_id=2848 ─acquire-city-venues.ts (parse + geokod places.ts)─▶ data/krakow-city-venues.json ─┤
POST /api/partners/objects ─zod─▶ .runtime/reports.sqlite: partner_objects ─┤
Zgłoszenia użytkowników (reports) ────────────────────────────────────────┴▶ objects.ts ▶ GET /api/objects, /api/objects/[id]
```

`objects.ts` ładuje pliki raz (~70–300 ms), a nakładkę (partnerzy z SQLite, fixture demo, zgłoszenia) przebudowuje co 15 s lub natychmiast po zapisie partnera; zapytanie < 3 ms (do ~10 ms dla krótkich prefiksów).

- **Fakty, nie odznaka:** każdy `AccessFeature` ma klucz, wartość, oryginalny szczegół i `sourceId`. Tagi OSM obiektu → fakty obiektu; tagi wejść → fakty z osobnym źródłem „OpenStreetMap — wejście” (opis: które wejście, odległość). Brak tagu = brak faktu (UI: „brak danych”); `unknown` tylko gdy źródło tak mówi.
- **Źródła:** OSM `map` (obtainedAt = data ekstraktu, editedAt = edycja elementu, confirmedAt = tylko `check_date`), UMK `city`, partner `partner`, demo `example`, zgłoszenie `unverified`. Zgłoszenia ≤ 30 m (najbliższy obiekt) lub o tym samym ID OSM są tylko listowane jako niezweryfikowane źródła z opisem (`note`), bez zamiany na fakty.
- **Łączenie:** UMK ↔ OSM po podobnej nazwie ≤ 60 m lub tym samym adresie urzędu ≤ 150 m; partner może dołączyć dane do istniejącego obiektu (`existingObjectId`).
- **Konflikty:** ten sam klucz z `yes` i `no` od różnych źródeł obiektu → `conflicts[]`, `hasConflict`; oba fakty zostają. Różne wejścia jednego budynku nie są konfliktem. `wheelchair` w podsumowaniu: najlepsze źródło (miasto > OSM obiekt > OSM wejście > partner).
- **Ranking:** z zapytaniem — trafność nazwy/adresu (bez polskich znaków, prefiksy), potem odległość; bez zapytania — więcej znanych faktów, potem odległość; `withData=1` ukrywa obiekty bez faktów. Promowani partnerzy (plan `partner`) są na górze **tylko w dopasowanym zbiorze** i ≤ 5 km od punktu użytkownika, zawsze oznaczeni `partner.promoted`.
- **Model biznesowy (prototyp):** właściciele (hotele, organizatorzy, lokale) dodają deklaracje dostępności za darmo; plan `partner` daje wyróżnienie. Dalej: płatności, weryfikacja właściciela, audyt terenowy jako osobny status z datą.

**Nowe źródło:** parser do `{name, address, features[{key,value,detail}]}` z oryginalnym zdaniem, plik w `data/` z URL/obtainedAt/SHA-256, funkcja `attachX` w `buildCatalog` z własnym `SourceStatus` i regułą łączenia; test na zapisanej kopii. **Nowa kategoria:** `ObjectCategory` w `explore-types.ts`, `classify()` w `acquire-objects.py`, etykiety pl/en/uk w `objects.ts`. **Inne miasto:** BBOX i plik PBF w skryptach, kopertę w `pointSchema`/`partnerSubmissionSchema`, lokalny odpowiednik wykazu urzędu.

## AI

OpenAI Responses API, `gpt-5.6-luna` (dostęp sprawdzony przez `/v1/models` 3.10.2026), `reasoning.effort: low`, `store:false`, Structured Outputs walidowane Zod, limit 25 s, bez ponowień.

- **Zdjęcie:** jedno zapytanie na zdjęcie (bez ciągłej analizy wideo). Najpierw dekodowanie, zmniejszenie i usunięcie metadanych. Model zwraca rodzaj, opis, poręcz, nawierzchnię i ograniczenia obserwacji; kierunek jest zawsze „nieznany” (zdjęcie nie wyznacza kierunku na mapie). Zdania z pomiarami (cm, %, °, liczba stopni) są usuwane, bo fotografia ich nie uzasadnia. Zgłoszenie zapisuje się od razu jako niezweryfikowane; gdy AI zawiedzie, zapisuje się zdjęcie z prośbą o krótki opis. Autor może poprawić (`PATCH`) lub usunąć zgłoszenie.
- **Potrzeby:** tekst → ustawienia preferencji (schemat jak w formularzu) + krótka notatka. Ustawienia są od razu widoczne i edytowalne. Bez diagnozy.

AI nie tworzy ani nie wybiera tras.

## Interfejs

Next.js 16 (App Router), React 19, shadcn/ui (Radix) + Tailwind 4. MapLibre GL 6 z kafelkami OpenFreeMap; worker serwowany z `public/maplibre` (kopiowany skryptem `copy-maplibre-worker.mjs`). Telefon: mapa u góry i lista pod nią; podczas wpisywania mapa się chowa, a podpowiedzi są pod polem (popover nad klawiaturą iOS był nieczytelny). Desktop: panel 440 px + mapa. Panele: dolna szuflada (vaul) na telefonie, boczny arkusz na desktopie.

## Trwałość, bezpieczeństwo, prywatność

SQLite WAL, zapytania parametryzowane; zgłoszenie i zdjęcie w jednym rekordzie. Klucz API tylko w pamięci serwera. Walidacja Zod każdego żądania, zdjęcia JPEG/PNG/WebP faktycznie dekodowane, limity wielkości, kontrola Origin/Host przy zapisie, prosty limit zapytań AI w pamięci procesu. Preferencje i ostatnie miejsca są tylko w localStorage. GPS: lokalizacja zgłoszenia lub punkt startu, bez śladu.

## Dalej

PostgreSQL/PostGIS i zoptymalizowany graf zamiast budowy w pamięci (~1,2 GB RSS), moderacja i konta partnerów, statusy weryfikacji terenowej z datą, dane czasu rzeczywistego ZTP, pomiary progów i nachyleń, testy na fizycznym iPhonie z VoiceOver.
