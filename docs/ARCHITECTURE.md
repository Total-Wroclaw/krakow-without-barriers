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
- odcinek bez ławki w promieniu 25 m przy „odpoczynek” lub zaplanowanych przerwach (`restEvery > 0`): +0,25 × długość,
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

To sposób poruszania się w danym dniu (`walk`, `crutches` — o kulach, `wheelchair`, `stroller` — wózek dziecięcy), nie diagnoza. Dla `walk` routing działa dokładnie jak wcześniej.

**O kulach (`crutches`, `crutchCosts` w `routing.ts`):** schody dozwolone zgodnie z ustawieniami schodów, ale droższe: każde schody +1 × długość, bez oznaczonej poręczy (`handrail*=yes`) +6 × długość + 20 m, długi bieg (`step_count` > 15, bit `LONG_FLIGHT`) +4 × długość + 30 m (do tego ewentualne +5 × z „wolę poręcze”); bruk/żwir (`ROUGH`) +1 ×, nawierzchnia bardzo nierówna +2 ×, nachylenie > 6 % +1 ×, `smoothness=impassable` wykluczone; krawężnik `raised` +15 m, próg +25 m; oś ulicy zamiast ścieżki tylko +0,1 × (krótsza droga ważniejsza niż spokojniejsza). Fakty: krawężniki bez obniżenia, progi i odcinki (bruk, nierówna, stroma, nieprzejezdna). Uwagi (nie zmieniają `fits`): „Schody bez poręczy”, „Schody bez danych o poręczy”, „Długie schody, ponad 15 stopni”, „Krawężnik bez obniżenia”, „Bruk na 120 m”, „Nierówna nawierzchnia na…”, „Strome nachylenie na…”. Komunikacja jak dla `walk` (bez uwag o przystosowaniu kursów).

Dla kół (`routing.ts`, bity `edgeMobility` na krawędziach i `nodeBarrier` na węzłach):

| Cecha OSM | Wózek inwalidzki | Wózek dziecięcy |
| --- | --- | --- |
| `highway=steps` | zawsze wykluczone (niezależnie od „unikam schodów”), chyba że `ramp:wheelchair=yes`; także 1–2 stopnie | dozwolone z `ramp=yes`/`ramp:wheelchair=yes` albo przy znanym `step_count` ≤ 2 (bit `SHORT_FLIGHT`, liczone na drogę OSM = jeden bieg; wózek się podnosi: +3 × długość + 40 m raz na bieg); `step_count` > 2, brak lub nieliczbowy — wykluczone |
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

**Pierwszeństwo reguł schodów na kołach:** dla `wheelchair` i `stroller` o schodach decyduje wyłącznie reguła profilu z tabeli (`stairsPassable`, `forbiddenFlags` w `routing.ts`); „unikam schodów”, „w górę” i „w dół” nie są dokładane na wierzch (wózek dziecięcy pokona 2 stopnie nawet przy „unikam schodów”, wózek inwalidzki nie pokona żadnych). Te ustawienia działają tylko dla `walk` i `crutches`. Każdy krótki bieg, przez który trzeba podnieść wózek dziecięcy, jest faktem `stairs` (z `step_count`) i uwagą niezmieniającą `fits`: „Krótkie schody (2 stopnie) — wózek trzeba podnieść” albo zbiorczo „Krótkie schody w 3 miejscach — wózek trzeba podnieść” (en „Short steps (2) — you'll need to lift the pushchair”, de „Kurze Stufen (2) — Kinderwagen muss gehoben werden”). Komunikat „każda droga prowadzi przez schody” (`errors.stairsOnly`) na kołach liczy tylko biegi wykluczone regułą profilu (`hasAvoidedStairs` w `journey.ts`), więc nie pojawia się, gdy na trasie są wyłącznie dozwolone krótkie biegi lub schody z rampą.

Pokrycie tagów w grafie pieszym (735 530 węzłów): `kerb` na 5 853 węzłach (4 271 `lowered`, 1 147 `flush`, 367 `raised`, 10 `yes`), `barrier=kerb` 5 369, `barrier=step` 59; na drogach `surface` 107 048, `smoothness` 19 577, `width` 4 708 (w tym 140 ścieżek < 0,9 m), `wheelchair` 1 039, liczbowe `incline` 92 (30 powyżej 6 %). Brak tagu nie jest karany (poza krawężnikiem o nieznanej wysokości) — to niewiadoma, nie bariera. Wysokość krawężnika (`kerb:height`) nie jest pobierana.

Fakty na kołach (tylko gdy `mobility ≠ walk`): krawężniki/progi jako `kind: 'kerb'` (`barrier`: `kerbRaised`, `kerbUnknown`, `kerbRolled`, `step`, `nodeNoWheelchair`), odcinki jako `kind: 'surface'` z `length` (`sett`, `rough`, `steep`, `narrow`, `noWheelchair`, `impassable`; łączone po drodze OSM, od 10 m). `issues`: najpierw powody niepasowania (wózek: schody bez rampy, krawężnik bez obniżenia, próg, wąsko, `wheelchair=no`; oba: nieprzejezdne, limit dystansu), potem informacje, które nie zmieniają `fits` („Bruk na 120 m”, „Nierówna nawierzchnia na…”, „Strome nachylenie na…”, krawężnik o nieznanej wysokości, dla wózka dziecięcego także krawężnik bez obniżenia). Gdy nie ma trasy bez barier, pokazujemy najkrótszą z komunikatem i oznaczeniami.

Komunikacja na kołach: dla wózka inwalidzkiego kursy z `wheelchair_accessible=2` są usuwane przed scanem (`usableConnections`), a przystanki z `wheelchair_boarding=2` nie są brane jako dojście; warianty z kursami oznaczonymi `1` są wyżej niż nieznane. Wózek dziecięcy: bez wykluczeń, kursy `2` niżej. Każdy kurs bez informacji dostaje uwagę „Kurs bez informacji o przystosowaniu” (nie zmienia `fits`). **Ograniczenie danych:** w obecnym GTFS ZTP wszystkie 124 239 kursów mają `wheelchair_accessible=0` (brak informacji), a wszystkie 3 751 słupków `wheelchair_boarding=0` — mechanizm działa, ale dziś nic nie wyklucza ani nie różnicuje; uwaga pojawia się przy każdym wariancie.

## Przerwy na ławce i toalety (`journey-extras.ts`)

Po zbudowaniu wszystkich wariantów `planJourney` wywołuje `applyExtras` (tylko gdy włączone).

- **Przerwy (`restEvery` = N min, 0 = wył.):** licznik marszu jest wspólny dla wszystkich odcinków pieszych wariantu (jazda go nie zwiększa), N min = N × 60 m przy 1 m/s. Przy każdym znaczniku szukamy ławki ≤ 60 m od trasy w oknie ±25 % N wzdłuż trasy (próbki co ~20 m); wynik = 0,5 × odchylenie od znacznika + 1,5 × odległość od trasy − 60 za `backrest=yes`. Następny znacznik liczy się od wybranej ławki. Znaczniki w ostatnich 25 % N przed końcem marszu są pomijane. Wybrana ławka jest faktem `kind: 'bench'` z `restAfterMinutes` (minuta marszu) — także gdy przy „odpoczynku” byłaby odfiltrowana; jeśli już jest na liście, dostaje tylko `restAfterMinutes` (bez duplikatu). Tytuł „Ławka z oparciem” lub „Ławka”. Każda przerwa to +2 min do `seconds` odcinka pieszego i do `duration`: przed pierwszym kursem wyjście jest wcześniej (ten sam tramwaj), po ostatnim (i bez kursów) przyjazd później; na przesiadce przerwa tylko w ramach zapasu do odjazdu. `JourneyOption.restStops`, `restMinutes` (= 2 × liczba), `rests` przeliczone. Brak ławki przy znaczniku → uwaga „Brak ławki ok. 10. minuty” (maks. 3, nie zmienia `fits`). Routing przy `restEvery > 0` traktuje ławki jak przy „odpoczynku”.
- **Toalety (`showToilets`):** z katalogu Odkrywaj (`accessibleToilets()` w `objects.ts`, synchronicznie: pełny katalog z partnerami, jeśli Odkrywaj go już wczytało, inaczej OSM + UMK; ~25 ms za pierwszym razem, potem z pamięci) bierzemy tylko obiekty, którym źródło przypisuje dostępną toaletę: toaleta z `wheelchair=yes|limited` albo dowolny obiekt z `accessible_toilet=yes` (`toilets:wheelchair=yes`, wykaz UMK, partner). Toalety bez informacji nigdy nie są pokazywane jako dostępne; obiekt, dla którego któreś źródło mówi „nie”, jest pomijany. Siatka przestrzenna (komórka ~200 m). Do 3 toalet ≤ 150 m od odcinków pieszych (co najmniej 400 m od siebie wzdłuż trasy) i do 2 ≤ 300 m od celu (na ostatnim odcinku pieszym; gdy wariant kończy się jazdą pod drzwi, tych nie ma). Fakt `kind: 'toilet'`, `id: 'toilet:<objectId>'`, `objectId` = id obiektu Odkrywaj, tytuł „Toaleta przystosowana · {nazwa}” / „Toaleta częściowo przystosowana · {nazwa}”, `tags.accessible_toilet`, `sourceUrl` i `editedAt` źródła.

Koszt (Dworzec Główny → Rynek, Rynek → Wawel, 4–6 wariantów): +20–40 ms na całe zapytanie.

## Tryb transportu (`transport`)

`'transit'` (domyślny): piesze + komunikacja. `'walk'`: tylko warianty piesze — bez komunikacji, taksówki i samochodu (graf drogowy i rozkład nie są ładowane); długie spacery nie są odrzucane (filtr „za daleko, gdy jest przejazd” działa tylko obok przejazdów), dodatki (przerwy na ławce, toalety, fakty, uwagi) jak zwykle. `'taxi'` / `'car'`: poniżej.

## Taksówka i samochód (`transport: 'taxi' | 'car'`)

`acquire-roads.py` (pyosmium, ten sam PBF i obszar) zapisuje drogi przejezdne `motorway`…`living_street` + `service` (bez `area=yes`, `service=emergency_access`). Dostęp wg hierarchii `motorcar` > `motor_vehicle` > `vehicle` > `access`: `yes/designated/permissive` — tak; `destination/customers` — tak, z karą (×4 czasu + 60 s), więc tylko blisko końców; reszta (`no`, `private`, `delivery`, `psv`, `agricultural`…) — wykluczone. Jednokierunkowość: `oneway=yes/-1`, rondo (`junction=roundabout/circular`), autostrada; `oneway=reversible/alternating` pomijane. `roads.ts` buduje graf CSR na tablicach typowanych i wybiera największą silnie spójną składową.

**Model czasu (szacunek, bez ruchu na żywo):** prędkość = `maxspeed` (także `PL:urban` 50, `PL:rural` 90, `PL:zone30`, `PL:living_street` 20) albo domyślna dla klasy (autostrada 120, ekspresowa/trunk 90, główne do lokalnych 50, `unclassified` 40, `residential` 30, `living_street` 15, `service` 15 km/h) × współczynnik miejski 0,65 (≤ 50 km/h), 0,8 (≤ 80), 0,9 (> 80); do tego +15 s na sygnalizacji świetlnej (`highway=traffic_signals`) i +4 s na skrzyżowaniu ≥ 3 ramion. Nie liczymy czekania na taksówkę ani szukania miejsca. Taksówka ma `DriveLeg.fare` — przedział z maksymalnych cen miejskich (strefa I: min taryfa 1, max taryfa 2 + 20 %; źródło i wzór w DATA-SOURCES.md) — oraz `JourneyOption.rideLinks` (Uber z wypełnionym odbiorem i celem, Bolt/FreeNow — oficjalne strony dla Krakowa).

**Krawężnik (miejsce wsiadania/wysiadania):** spośród do 40 węzłów drogowych w promieniu 250 m (bez autostrad i dróg ekspresowych, tylko główna spójna składowa) wybieramy ten z najkrótszym dojściem pieszym z dzisiejszymi preferencjami — najbliższa droga bywa tunelem (np. pod Dworcem Głównym). Odcinek pieszy pojawia się, gdy krawężnik jest > 40 m od punktu.

- **Taksówka:** jeden wariant `id: 'taxi'`, `kind: 'taxi'`, etykieta „Taksówka”: [pieszo do krawężnika] → `DriveLeg` (`mode: 'taxi'`) → [pieszo do celu]. Dla wózka inwalidzkiego uwaga „Zamów pojazd przystosowany do wózka”.
- **Samochód:** parkingi do 600 m od celu (do 12 najbliższych), dojście z parkingu do celu jednym odwrotnym przeszukaniem (`reach`) z preferencjami, ranking po długości dojścia, do 3 różnych parkingów (≥ 80 m od siebie); dojazd jednym Dijkstrą do wszystkich parkingów. `id: 'car-way-123'`, `kind: 'car'`, etykieta „Samochód · {nazwa}” albo „Samochód · parking 180 m od celu”, `DriveLeg.parking: ParkingInfo`. Wózek inwalidzki: tylko miejsca z oznaczonymi miejscami dla osób z niepełnosprawnością. Brak parkingu: wariant `car-dropoff` „Samochód · podjazd pod cel” z powodem niepasowania „Brak parkingu (z miejscami dla osób z niepełnosprawnością) w promieniu 600 m”.

Warianty samochodowe/taksówki są na początku listy, za nimi jak dotąd piesze i komunikacja do porównania. Koszt po załadowaniu grafu: taksówka ~+20 ms, samochód ~+35 ms względem samej komunikacji (mediana, 2,3 km–12 km). Załadowanie grafu drogowego ~220–380 ms przy pierwszym żądaniu taxi/car, +~85 MB RSS (415 223 węzły, 797 032 krawędzie); graf pieszy pozostaje głównym kosztem (~2,3–4,7 s, ~0,9–1 GB RSS).

**Ograniczenia:** brak zakazów skrętu (relacje `restriction`), brak czasowych ograniczeń (`:conditional`), brak strefy płatnego parkowania i jej cen. Strefa Ograniczonego Ruchu na Starym Mieście jest respektowana tylko tam, gdzie OSM ma ją jako `access`/`motor_vehicle` (np. `destination` → kara, `no` → wykluczenie); harmonogramy i wyjątki dla posiadaczy kart parkingowych nie są modelowane.

## Parkingi (`parking.ts`)

`amenity=parking` (węzły, obrysy, multipoligony; środek ciężkości obrysu; bez `access=private/no`) z `name`, `capacity`, `capacity:disabled`, `fee`, `access`, `parking`. Miejsca dla osób z niepełnosprawnością `parking_space=disabled` / `amenity=parking_space` z `capacity:disabled` lub `disabled=designated` są przypisywane do parkingu, w którego obrysie leżą; pozostałe (często przy ulicy) są osobnymi miejscami `kind: 'disabled_space'`. Parking „ma miejsca dla osób z niepełnosprawnością”, gdy `capacity:disabled` > 0 / `yes` albo leży w nim zmapowane miejsce. `parkingNear(point, radius, { disabledOnly, locale, limit })` zwraca `ParkingInfo` (z `distance`) od najbliższego — do użycia w mapie „Odkrywaj”. Zajętość, godziny i ceny nie są znane.

## Języki odpowiedzi

`POST /api/journey` przyjmuje `locale` (`pl` domyślnie, `en`, `de`). Wszystkie teksty planera (wskazówki, etykiety, tytuły faktów, `issues`, `errors`, błędy 400/500) pochodzą z `src/lib/i18n/server-messages.ts`; liczby mnogie przez `Intl.PluralRules` (pl: 1 stopień, 2–4 / 22–24 stopnie, 5–21 stopni; en i de: one/other — 1 step / 1 Stufe, 2 steps / 2 Stufen), dystanse w formacie lokalnym (1,2 km / 1.2 km / 1,2 km). Nazwy ulic, przystanków i miejsc pozostają jak w źródle.

## Wyszukiwanie miejsc

`places.ts` ładuje indeks raz (~230 ms), dalej zapytanie trwa < 4 ms: prefiksy słów bez wielkości liter i polskich znaków, numery domów, ranking z bliskością. Przystanki dochodzą z lokalnego rozkładu. Brak zapytań do zewnętrznego geokodera podczas pisania. Odwrotne geokodowanie („Moja lokalizacja”): adres ≤ 80 m, inaczej miejsce/ulica ≤ 150 m.

Najpierw Kraków: indeks nie ma granicy administracyjnej, więc przynależność punktu do miasta ustalamy z adresów — kody 30-/31- to Kraków, inny kod albo `addr:city` to poza miastem; o punkcie decyduje większość sklasyfikowanych adresów w siatce ~1 km (3×3 komórki), a bez adresów odległość ≤ 7 km od Rynku. Wyniki w Krakowie dostają premię, chyba że zapytanie oprócz nazwy wymienia inną miejscowość („rynek zabierzów”, „długa 10 wieliczka” — wtedy premię dostaje adres w tej miejscowości). Krótka lista znanych nazw (Rynek Główny, Wawel, Kazimierz…) ma dodatkową premię. Nazwy części miasta i miejscowości (OSM `place=suburb|quarter|neighbourhood|village…`) są podpowiadane jako miejsca („Część Krakowa” / „Okolice Krakowa”). Skróty „ul.” (pomijany), „os.”, „al.”, „pl.” (rozwijane do „osiedle”, „aleja”, „plac” i dopasowywane miękko) działają w dowolnym miejscu zapytania; „os. centrum a” bez numeru podpowiada samo osiedle (środek jego adresów).

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
- **Stronicowanie:** `GET /api/objects?category&q&lat&lon&locale&withData&limit&offset` → `ObjectPage { objects, total, nextOffset }` (`limit` domyślnie 30, maks. 100; `offset` domyślnie 0; `nextOffset: null` na ostatniej stronie). Kolejność jest pełna (remisy rozstrzyga id), więc strony się nie nakładają; nakładka partnerów/zgłoszeń przebudowuje się co 15 s, więc nowy obiekt może przesunąć dalsze strony.
- **Ranking:** z zapytaniem — trafność nazwy/adresu (bez polskich znaków, prefiksy), potem odległość; bez zapytania — więcej znanych faktów, potem odległość; `withData=1` ukrywa obiekty bez faktów. Promowani partnerzy (plan `partner`) są na górze **tylko w dopasowanym zbiorze** i ≤ 5 km od punktu użytkownika, zawsze oznaczeni `partner.promoted`.
- **Zgłoszenia w Odkrywaj:** kategoria „Zgłoszenia” (`explore.r.*`) listuje publiczne zgłoszenia użytkowników w widocznym obszarze mapy i pokazuje je na mapie; zawsze jako niezweryfikowane.
- **Partnerzy:** deklaracje bezpłatne, plan `partner` daje oznaczenie „Promowane”; poprawa i wycofanie tokenem, ukrywanie przez miasto. Płatności i weryfikacja właściciela: [PROJECT.md](competition/PROJECT.md).

**Nowe źródło:** parser do `{name, address, features[{key,value,detail}]}` z oryginalnym zdaniem, plik w `data/` z URL/obtainedAt/SHA-256, funkcja `attachX` w `buildCatalog` z własnym `SourceStatus` i regułą łączenia; test na zapisanej kopii. **Nowa kategoria:** `ObjectCategory` w `explore-types.ts`, `classify()` w `acquire-objects.py`, etykiety pl/en/de w `objects.ts`. **Inne miasto:** BBOX i plik PBF w skryptach, kopertę w `pointSchema`/`partnerSubmissionSchema`, lokalny odpowiednik wykazu urzędu.

## AI

OpenAI Responses API, `gpt-5.6-luna` (dostęp sprawdzony przez `/v1/models` 3.10.2026), `reasoning.effort: low`, `store:false`, Structured Outputs walidowane Zod, limit 25 s, bez ponowień.

- **Zdjęcie:** jedno zapytanie na zdjęcie (bez ciągłej analizy wideo). Najpierw dekodowanie, zmniejszenie i usunięcie metadanych. Model zwraca rodzaj, opis, poręcz, nawierzchnię i ograniczenia obserwacji; kierunek jest zawsze „nieznany” (zdjęcie nie wyznacza kierunku na mapie). Zdania z pomiarami (cm, %, °, liczba stopni) są usuwane, bo fotografia ich nie uzasadnia. Zgłoszenie zapisuje się od razu jako niezweryfikowane; gdy AI zawiedzie, zapisuje się zdjęcie z prośbą o krótki opis. Autor może poprawić (`PATCH`) lub usunąć zgłoszenie.
- **Potrzeby:** tekst → ustawienia preferencji (schemat jak w formularzu) + krótka notatka. Ustawienia są od razu widoczne i edytowalne. Bez diagnozy.

AI nie tworzy ani nie wybiera tras.

## Zgłoszenia i obsługa przez miasto

Dwa rodzaje zgłoszeń (`Report.type`): `barrier` — utrudnienie na trasie (domyślne), `blocked` — „uniemożliwiło mi dotarcie tam, gdzie chciałem/am” (dla miasta najważniejsze; osobny filtr i kafelek w panelu).

**API dla aplikacji (publiczne, kontrola Origin/Host, limit 20 zapytań AI/min):**

| Metoda i ścieżka | Treść | Wynik |
| --- | --- | --- |
| `POST /api/reports/auto` | `{ photo?, location, locationSource: 'gps'\|'map'\|'fact', factId?, locale?, type?: 'barrier'\|'blocked', comment? (≤ 800), destination? (≤ 200) }` | 201 `{ report, editToken }` |
| `POST /api/reports/[id]/photos` | nagłówek `x-report-token`; `{ photo, locale? }` — kolejne zdjęcie, maks. 4 na zgłoszenie (z pierwszym); także po zmianie statusu przez miasto | 201 `{ report, photo }`, 409 po limicie, 403, 404 |
| `GET /api/reports/[id]/photo` | pierwsze **publiczne** zdjęcie (zgodne z publicznym `photoPath`) | JPEG, 404 gdy brak |
| `GET /api/reports/[id]/photos/[photoId]` | zdjęcie, tylko jeśli publiczne (`main` = pierwsze zapisane ze zgłoszeniem) | JPEG, 404 dla ukrytych |
| `PATCH` / `DELETE /api/reports/[id]` | nagłówek `x-report-token`; poprawa opisu `{ observation, locale? }` / usunięcie (razem ze zdjęciami) | 403 zły/brak tokenu, 404, DELETE 409 gdy miasto zmieniło status |
| `GET /api/reports` | ostatnie 100 zgłoszeń z `cityStatus` i `cityNote`, bez `cityHistory` | |

Zdjęcie jest wymagane, chyba że `type: 'blocked'` albo jest komentarz (≥ 3 znaki). Bez zdjęcia nie ma AI: obserwacja to `kind: 'other'`, `description` = komentarz (albo „Nie udało się dotrzeć do celu: …”), `analysis: 'comment'`. Każde zdjęcie przechodzi przez `photoBytes()` (dekodowanie, zmniejszenie, bez EXIF/GPS) i jest opisywane przez AI osobno (`photos[].analysis`). Opis zgłoszenia zmienia się tylko, gdy nie pochodził ze zdjęcia (`failed`, `comment`) — wtedy bierze pierwszy opis AI; opis od AI lub poprawiony przez autora zostaje. Komentarz i cel podróży zostają w osobnych polach. **Token autora:** utworzenie zgłoszenia zwraca jednorazowo `editToken` (32 losowe bajty, base64url). Klient trzyma go w localStorage pod id zgłoszenia i wysyła jako nagłówek `x-report-token` przy `PATCH`/`DELETE /api/reports/[id]` i `POST /api/reports/[id]/photos`. Serwer zapisuje tylko SHA-256 tokenu w kolumnie `reports.edit_hash` (poza JSON-em `body`, więc nigdy nie trafia do API) i porównuje w stałym czasie. Nieznane id → 404, brak/zły token → 403. Gdy miasto zmieni `cityStatus` z `new`, autor nie może już usunąć zgłoszenia (409), ale może dodawać zdjęcia. Zgłoszenia sprzed tokenów nie mają skrótu — zmienić je może tylko urząd.

**Zdjęcia a prywatność:** AI przy opisie zwraca też `people: 'none'|'present'|'unclear'` (osoby, twarze, tablice rejestracyjne). Publicznie serwowane jest tylko zdjęcie z `visibility: 'public'`, czyli `people: 'none'` albo zatwierdzone przez urząd. Gdy AI nie zadziałało, widać ludzi lub nie da się tego wykluczyć — zdjęcie jest ukryte; tak samo zdjęcia sprzed tej zmiany. W publicznym JSON-ie ukryte zdjęcie to `{ id, createdAt, hidden: true, reason: 'privacy' }` bez ścieżki i opisu AI, a `photoPath` wskazuje pierwsze publiczne zdjęcie albo jest `null`. Panel miasta widzi wszystkie zdjęcia przez `GET /api/city/reports/[id]/photos/[photoId]` (ciasteczko) i decyduje `PATCH …/photos/[photoId] { visibility: 'public'|'hidden' }`; decyzja trafia do `cityHistory` (`photo: { id, visibility }`).

**Błędy API** są w języku żądania: `locale` z treści JSON, potem `?locale=`, potem `Accept-Language`, domyślnie polski (`src/lib/i18n/request-locale.ts`, teksty w `server-messages.ts` → `api`). Formularz partnera zwraca 400 `{ error, fields: [{ path, message }] }`.

Magazyn: `reports(id, body JSON, photo BLOB)` — pierwsze zdjęcie jak wcześniej; `report_photos(id, report_id, photo BLOB, created_at, analysis JSON NULL)` — kolejne. Lista `photos: {id, path, createdAt, analysis?}[]` jest w `body`; dodanie zdjęcia sprawdza limit ponownie po analizie AI, synchronicznie tuż przed zapisem.

**Panel miasta `/city`** (po polsku, dla UMK / ZDMK): kafelki (nowe, w trakcie analizy, „uniemożliwiło dotarcie” z ostatnich 7 dni, wszystkie — kliknięcie ustawia filtr), filtry (status, rodzaj, zakres dat w czasie Krakowa, wyszukiwanie po opisie, komentarzu, celu, miejscu), lista od najnowszych (miniatura, rodzaj, status, opis AI/osoby, komentarz, cel podróży, miejsce, współrzędne, linki OpenStreetMap/Google Maps), panel szczegółów (wszystkie zdjęcia z opisem AI każdego, mapa MapLibre, zmiana statusu, publiczna odpowiedź, historia zmian), eksport CSV z bieżącymi filtrami.

| Metoda i ścieżka | Treść |
| --- | --- |
| `POST /api/city/login` | `{ password }` → 204 + ciasteczko; 5 nieudanych prób na klienta na 15 min, potem 429; przy wielu nieudanych próbach łącznie (> 20 na 15 min) każda odpowiedź jest opóźniana o 250 ms za każdą kolejną, maks. 3 s — bez globalnej blokady, której ktoś mógłby użyć do zablokowania urzędników |
| `POST /api/city/logout` | usuwa ciasteczko |
| `GET /api/city/reports?status=&type=&from=&to=&q=` | `{ reports }` z `cityHistory`, do 5000 najnowszych; ścieżki zdjęć prowadzą do trasy miasta; `from` > `to` → 400 |
| `GET` / `PATCH /api/city/reports/[id]/photos/[photoId]` | zdjęcie (także ukryte) / `{ visibility: 'public'\|'hidden' }` → `{ report }` |
| `PATCH /api/city/reports/[id]` | `{ status?: 'new'\|'in_review'\|'forwarded'\|'resolved'\|'rejected', note? (≤ 1000, pusta = usuń) }` |
| `GET /api/city/reports.csv?…` | CSV (UTF-8 z BOM, RFC 4180, przecinek); te same filtry |

Każda zmiana statusu lub odpowiedzi ustawia `cityUpdatedAt` i dopisuje `{ at, status, note }` do `cityHistory` (tylko dopisywanie; zapis bez zmian nie tworzy wpisu). Nowe zgłoszenia mają `cityStatus: 'new'`; starsze bez pola są traktowane jako nowe. CSV zabezpiecza pola zaczynające się od `= + - @` (prefiks `'`), żeby arkusz nie wykonał formuły.

**Dostęp:** jedno hasło służbowe `CITY_DASHBOARD_PASSWORD` (bez niego panel i `/api/city/*` są wyłączone, 503). Logowanie wymienia hasło na ciasteczko `kk_city` = `v1.<wygaśnięcie>.<nonce>.<HMAC-SHA256>`: HttpOnly, SameSite=Strict, Secure w produkcji, ważne 12 h. Klucz HMAC: `CITY_DASHBOARD_SECRET` albo skrót hasła (zmiana hasła wylogowuje wszystkich). Hasło i podpis porównywane w stałym czasie. Strona `/city` sprawdza ciasteczko po stronie serwera (`await cookies()`), każda trasa `/api/city/*` — w nagłówku żądania; zapisy dodatkowo przez kontrolę Origin/Host. Prototyp nie ma kont ani ról — w docelowej wersji logowanie przez katalog urzędu (SSO), autor zmiany w historii.

**Ochrona danych:** co jest przechowywane, kto to widzi i jaka jest proponowana retencja (12 miesięcy po zamknięciu, jeszcze nie zautomatyzowana): [PRIVACY-SECURITY.md](PRIVACY-SECURITY.md). Komentarz i cel podróży są wolnym tekstem i mogą zawierać dane osobowe, dlatego formularz o tym ostrzega, a panel ostrzega urzędników przed wpisywaniem ich w publicznej odpowiedzi.

## Interfejs

Next.js 16 (App Router), React 19, shadcn/ui (Radix) + Tailwind 4. MapLibre GL 6 z kafelkami OpenFreeMap; worker serwowany z `public/maplibre` (kopiowany skryptem `copy-maplibre-worker.mjs`). Telefon: pełnoekranowa mapa, a panel jako przeciągany arkusz nad nią (`useBottomSheet.ts`: trzy wysokości, przeciąganie uchwytu lub treści, obsługa klawiaturą); podczas wpisywania arkusz otwiera się w pełni, a podpowiedzi są pod polem (popover nad klawiaturą iOS był nieczytelny). Dopasowanie kadru i obszar listy Odkrywaj pomijają zasłoniętą część mapy. Desktop: panel 440 px + mapa. Panele: dolna szuflada (vaul) na telefonie, boczny arkusz na desktopie.

## Trwałość, bezpieczeństwo, prywatność

SQLite WAL, zapytania parametryzowane; zgłoszenie i pierwsze zdjęcie w jednym rekordzie, kolejne zdjęcia w `report_photos`. Panel miasta za hasłem i podpisanym ciasteczkiem (wyżej). Klucz API tylko w pamięci serwera. Walidacja Zod każdego żądania, zdjęcia JPEG/PNG/WebP faktycznie dekodowane, limity wielkości, kontrola Origin/Host przy zapisie, prosty limit zapytań AI w pamięci procesu.

**Bezpieczeństwo:**
- `guard()` (`src/lib/server.ts`): nagłówek `Origin` musi zgadzać się z `Host`. Zapis (nie GET/HEAD/OPTIONS) bez `Origin` z `Sec-Fetch-Site: cross-site|same-site` → 403. W produkcji zapis bez `Origin` wymaga `Referer` z tym samym hostem albo `Sec-Fetch-Site: same-origin` — przeglądarki zawsze wysyłają `Origin` przy POST/PATCH/DELETE; skrypty i narzędzia muszą wysłać `Origin: https://<host>`. Poza produkcją (dev, testy) żądania bez tych nagłówków przechodzą.
- Adres klienta do limitów (`src/lib/client-ip.ts`): `CF-Connecting-IP`, jeśli jest (ustawia go Cloudflare), inaczej **ostatni** wpis `X-Forwarded-For` — ten dopisuje nasz Traefik, wcześniejsze może podać klient. Założenie: port Node nie jest publiczny, ruch idzie tylko przez proxy. Bez nagłówków: wspólny klucz `local`.
- Nagłówki bezpieczeństwa (`next.config.ts`, lista w [PRIVACY-SECURITY.md](PRIVACY-SECURITY.md)); `/embed` ma `frame-ancestors *` (widżet partnera; lokalizację przyznaje `<iframe allow="geolocation">`). Brak CSP dla skryptów celowo: MapLibre używa workerów, kafelki z OpenFreeMap i z naszego proxy. Preferencje i ostatnie miejsca są tylko w localStorage. GPS: lokalizacja zgłoszenia lub punkt startu, bez śladu.

## Dalej

PostgreSQL/PostGIS i zoptymalizowany graf zamiast budowy w pamięci (~1,2 GB RSS), moderacja i konta partnerów, statusy weryfikacji terenowej z datą, dane czasu rzeczywistego ZTP, pomiary progów i nachyleń, testy na fizycznym iPhonie z VoiceOver.
