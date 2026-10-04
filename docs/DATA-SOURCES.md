# Źródła, aktualność i licencje

Sprawdzono 3 października 2026. Żaden rekord OSM nie jest przedstawiany jako audyt terenowy zespołu.

## Rejestr źródeł (4 października 2026)

„Licencja” to stan zweryfikowany przez zespół albo wprost zaznaczone **do potwierdzenia**. Nie zakładamy, że publiczna strona oznacza dowolną licencję.

| Źródło | Licencja / warunki | Jak pozyskane | Częstotliwość odświeżania | Zachowanie przy awarii | Otwarte pytania |
| --- | --- | --- | --- | --- | --- |
| OpenStreetMap, wyciąg Geofabrik (Małopolska) | ODbL-1.0, © OpenStreetMap contributors; atrybucja na mapie | `scripts/acquire-city.py`, `npm run data:places`, `data:roads`, `data:objects` (pyosmium) z jednego PBF; migawki w `data/` z SHA-256 | co tydzień (propozycja; dziś ręcznie, ostatnia migawka z 2.10.2026) | działa ostatnia migawka w repozytorium, z datą | obowiązki share-alike dla bazy pochodnej przy publicznej dystrybucji migawek |
| ZTP Kraków GTFS (A/M/T) | brak jednoznacznej licencji w indeksie, publiczne rozkłady | `scripts/acquire-transit.py` → SQLite, przy budowie obrazu Docker | codziennie (propozycja: nocna przebudowa; dziś przy każdym buildzie) | zostaje poprzedni obraz z poprzednim rozkładem | licencja do komercyjnej dystrybucji; pola `wheelchair_accessible`/`wheelchair_boarding` są dziś puste (0) |
| UMK: dostępność budynków UMK i MJO (`dok_id=2848`) | brak deklaracji licencji; krótkie fakty z linkiem i datą odczytu | `scripts/acquire-city-venues.ts`, parser deterministyczny | co tydzień: `npm run data:refresh` / workflow `Refresh data` (na razie uruchamiany ręcznie; harmonogram gotowy do włączenia) | zapis atomowy; przy błędzie lub zmianie struktury poprzedni plik | zgoda UMK na ponowne wykorzystanie komercyjne |
| Portal Otwarte Dane Kraków, MSIP | warunki portalu: swobodne ponowne wykorzystanie z informacją o źródle, wyjątki w opisie zasobu | sprawdzone ręcznie, **nie importowane** | nie dotyczy | nie dotyczy | brak zbioru z polami dostępności; do ponownej oceny przy nowych zbiorach |
| GUGiK: ortofotomapa (WMS `mapy.geoportal.gov.pl/.../PZGIK/ORTO`) | dane PZGiK; w kodzie założone „ponowne wykorzystanie z atrybucją” (nie zweryfikowano treści aktualnych warunków) | serwer pobiera kafelki i wycinki, stałe rozmiary, współrzędne tylko w Krakowie; cache na dysku | na żądanie, bez wygasania; przeglądarka trzyma kafelki 30 dni | komunikat o braku zdjęcia; planer i lista działają | potwierdzić warunki dla zastosowania komercyjnego i objętość zapytań |
| OpenFreeMap (podkład Positron) | darmowe kafelki bez klucza (dane OpenMapTiles, © OSM) | przeglądarka łączy się bezpośrednio (`tiles.openfreemap.org`) | na bieżąco u dostawcy | brak SLA; lista wariantów i kroki działają bez podkładu | polityka prywatności dostawcy (adres IP trafia do niego); przy dużym ruchu własny serwer kafelków |
| Open-Meteo (pogoda bieżąca dla Krakowa) | dane CC BY 4.0 (komentarz w kodzie), darmowe API bez klucza | `src/lib/weather.ts`, jedno zapytanie dla całego miasta | cache 15 min (1 min po błędzie), limit czasu 4 s | odczyt z lotu ptaka bez pogody | darmowy plan jest przeznaczony do użytku niekomercyjnego; przy sprzedaży pakietów potrzebny plan płatny lub inne źródło (do potwierdzenia) |
| OpenAI (`gpt-5.6-luna`) | warunki dostawcy; `store: false` to prośba, nie zerowa retencja | `src/lib/ai.ts`, na żądanie użytkownika: opis potrzeb, zdjęcie zgłoszenia, wycinki ortofotomapy | na żądanie; odczyty z lotu ptaka w cache plikowym (klucz: miejsce, język, preferencje, pogoda, dane mapy) | trasy, lista i szczegóły działają; komunikat o braku opisu AI | umowa powierzenia, retencja, transfer poza EOG; cena modelu (szacunki kosztów w PROJECT.md) |
| Partnerzy (`POST /api/partners/objects`) | dane dostarczone przez właściciela, status „deklaracja właściciela” | formularz w aplikacji, SQLite; e-mail tylko w bazie | przez partnera | nie dotyczy | brak weryfikacji własności i tożsamości; zgoda na publikację danych w regulaminie |
| Zgłoszenia użytkowników | treść użytkownika, publiczna, „niezweryfikowane”; zdjęcia bez EXIF | zdjęcie w aplikacji, opis AI, SQLite + pliki na wolumenie | na bieżąco | zgłoszenie zapisuje się także przy awarii AI (bez opisu AI, zdjęcie ukryte) | retencja i moderacja (zob. `PRIVACY-SECURITY.md`) |
| Taryfa taksówek: uchwała XCII/2512/22 RM Krakowa | akt prawa miejscowego | ręcznie wpisane stawki (sekcja „Drogi i parkingi”) | przy zmianie uchwały (ostatnie sprawdzenie 3.10.2026) | stawki w kodzie | cena jest szacunkiem, nie ofertą przewoźnika |
| Linki Uber / Bolt / FREENOW | linki zewnętrzne po kliknięciu | stałe wzorce URL | nie dotyczy | link otwiera stronę dostawcy | zmiany formatu linków |

Źródeł spoza tej listy w `src/lib` nie znaleziono: usługi sieciowe wołane przez serwer to GUGiK WMS, Open-Meteo i OpenAI; przeglądarka łączy się z OpenFreeMap.

## Szczegóły i historia kontroli

| Źródło | Wykorzystanie | Aktualność i warunki |
| --- | --- | --- |
| [OSM steps](https://wiki.openstreetmap.org/wiki/Steps) | `highway=steps`, `step_count`, względny `incline`, warianty `handrail`, `surface` | Brak tagu jest niewiadomą. Ławki: `amenity=bench`; bliskość nie dowodzi dojścia. |
| [UMK: dostosowania obiektów](https://www.krakow.pl/getHtml?dok_id=2848) | Fakty o 20 budynkach UMK/MJO w zakładce „Odkrywaj” (sekcja niżej) | Data wytworzenia i ostatniego potwierdzenia nieustalone. Odczyt 3.10.2026; brak danych o bieżącym działaniu wind. Przechowujemy krótkie oryginalne sformułowania z linkiem do źródła, bez zdjęć. |
| [Portal otwartych danych](https://otwartedane.um.krakow.pl/zbiory-danych), [MSIP katalog](https://msip.krakow.pl/228340,artykul,katalog-danych.html), [przystanki 1490](https://msip.krakow.pl/dataset/1490) | Sprawdzone kandydatury, brak importu do MVP | Katalog przystanków nie jest kompletnym wykazem barier. Nie ustalono kompletnej miejskiej bazy barier; licencję i aktualność trzeba potwierdzić dla każdego konkretnego zasobu. |
| [ORS routing options](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/routing-options), [publiczne API](https://api.openrouteservice.org/) | Rozważany dostawca routingu, niewykorzystywany w MVP | Obsługuje unikanie schodów i ograniczenia wheelchair. Publiczna usługa wymaga konta i klucza. Nie sprawdzono jej pokrycia barier dla Krakowa; MVP nie wymaga tego dostępu. Kierunek schodów i odpoczynek i tak wymagają dodatkowej logiki. |

## Warunki miejskie

Sprawdzono [archiwalną informację BIP o ponownym wykorzystaniu](https://www.bip.krakow.pl/?bip_id=511&id=12438): wymienia źródło, czas i przetworzenie, ale jest dokumentem archiwalnym konkretnej jednostki. Nie dowodzi aktualnych warunków dla zestawienia UMK. Dlatego w aplikacji są krótkie oryginalne sformułowania z bezpośrednim linkiem, datą odczytu i statusem „dane miasta”; użycie komercyjne tego zestawienia czeka na potwierdzenie warunków przez UMK. Nie przyjęto założenia „publiczna strona = dowolna licencja”.

## Stany wiarygodności

- Dane mapowe: źródło i edycja znane, potwierdzenie terenowe nieznane.
- Informacja ze strony właściciela/UMK: opis źródłowy, bez gwarancji bieżącego stanu.
- Zgłoszenie użytkownika: opis ze zdjęcia przygotowuje AI, autor może go poprawić; zgłoszenie pozostaje niezweryfikowane.
- Audyt terenowy: przyszły status, wymaga osoby/organizacji weryfikującej, zakresu i daty; MVP go nie przyznaje.
- Dane przykładowe: wyraźny opis. Syntetyczne zdjęcia są wyłącznie testami/demo, nigdy dowodem stanu konkretnego miejsca.

## Biblioteki i inspiracje

Next.js, React, OpenAI SDK, Zod, Lucide, Sharp i dotenv mają własne licencje w przypiętych pakietach npm. Atkinson Hyperlegible Next (Braille Institute): SIL Open Font License, ładowany przez `next/font/google`. OSM ODbL dotyczy bazy danych, nie automatycznie całego kodu aplikacji. Nie wybrano ani nie udzielono licencji na kod projektu w imieniu właściciela.

[AccessMap](https://tcat.cs.washington.edu/accessmap/) już personalizuje mobilność i prowadzenie piesze. [Project Sidewalk](https://makeabilitylab.cs.washington.edu/projects/sidewalk/) rozwija zbieranie danych o dostępności. Wyróżnik Każdego Kroku to zmienne potrzeby dnia, niepewność i wygodne zgłaszanie; nie twierdzimy, że wymyśliliśmy routing dostępnościowy.

AI: model `gpt-5.6-luna` (dostępność sprawdzona przez `/v1/models` 3.10.2026), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [obrazy](https://developers.openai.com/api/docs/guides/images-vision). Dostęp modelu oraz oba przepływy (zdjęcie, potrzeby) sprawdzono rzeczywistymi zapytaniami. Prośba `store:false` nie jest deklaracją zerowej retencji całej usługi dostawcy.

## Źródła dodane dla całego miasta

| Źródło | Rzeczywiste wykorzystanie | Aktualność / ograniczenia |
| --- | --- | --- |
| [Geofabrik: Małopolska](https://download.geofabrik.de/europe/poland/malopolskie.html) | Lokalnie filtrowany PBF, gzip grafu i punktów; podstawowy routing miejski | Dane do 2.10.2026 20:21:34 UTC, pozyskano 3.10.2026; SHA-256 w `data/city-metadata.json`. OSM/ODbL. Obszar 19.75–20.25 E, 49.94–50.20 N obejmuje Kraków i okolice. |
| [ZTP: GTFS A/M/T](https://gtfs.ztp.krakow.pl/) | Rzeczywiste przystanki, kalendarze, kursy, czasy i shapes autobusów/tramwajów | Pozyskano 3.10.2026; wersje i SHA-256 poszczególnych feedów w `data/transit-metadata.json`. Publicznie opublikowane rozkłady; nie importujemy komunikatów/pozycji live. Nie ustalono osobnej jednoznacznej licencji GTFS w indeksie — potwierdzić przed publiczną dystrybucją komercyjną. |
| [OpenFreeMap](https://openfreemap.org/) | Wektorowy podkład mapy (styl Positron) w MapLibre | Darmowe kafelki bez klucza, dane OpenMapTiles i © OpenStreetMap; atrybucja widoczna na mapie. Brak SLA — awaria podkładu nie blokuje listy wariantów. |

Miejska migawka ma 735 530 węzłów, 196 973 drogi, 7 206 odcinków schodów, 14 187 ławek i 14 333 wejścia **w całym obszarze usługi wraz z okolicą**. To liczby obiektów i tagów, nie liczba skontrolowanych barier ani wyłącznie statystyka granic administracyjnych Krakowa. Wcześniejsza mała migawka Wawelu (OSM API) została usunięta; całe planowanie korzysta z migawki miejskiej.

Dla MSIP 1490 odczytano również rzeczywisty [serwis ArcGIS przystanków](https://msip.um.krakow.pl/arcgis/rest/services/Obserwatorium/K04_KOMUNIKACJA/MapServer/0). Ma lokalizacje i pole `aktualnosc`, a nie kompletny opis barier. Metadane odsyłają do regulaminu MSIP. Nie kopiujemy go jako rozkładu — podstawą czasów jest bezpośrednio ZTP GTFS. [Warunki portalu](https://otwartedane.um.krakow.pl/warunki-wykorzystania-danych-udostepnianych-w-portalu) przewidują co do zasady swobodne ponowne wykorzystanie danych portalu z informacją o źródle, wytworzeniu i pozyskaniu, z wyjątkami w opisie zasobu. Nie rozszerzamy tych warunków automatycznie na dowolną stronę UMK lub odrębny feed.

Dodatkowe biblioteki: shadcn/ui i Radix, cmdk, vaul, sonner, Tailwind CSS, MapLibre GL JS (BSD-3) — licencje pakietów / źródeł. Oficjalne komponenty shadcn są częścią kodu, a motyw jest autorski. Zainstalowano w lokalnym środowisku agenta oficjalny skill shadcn i Taste Skill; Impeccable i Emil były dostępne wcześniej. Popularność sprawdzono na publicznych repozytoriach; nie jest to dowód jakości dostępności.

## Lokalny indeks wyszukiwania miejsc

`npm run data:places` (`scripts/acquire-places.py`, pyosmium) filtruje ten sam PBF Geofabrik (obszar 19.75–20.25 E, 49.94–50.20 N) do `data/krakow-places.json.gz` (~2,9 MB gzip, zwarte tablice). Metadane, SHA-256 PBF i liczby: `data/places-metadata.json`. Licencja ODbL-1.0, © OpenStreetMap contributors.

- Adresy (155 891): węzły, budynki i multipoligony z `addr:housenumber` + `addr:street`/`addr:place`; środek geometrii; kod pocztowy i miejscowość, jeśli są.
- Ulice (6 261 punktów, 3 923 nazwy): nazwane drogi `highway=*`; odcinki o tej samej nazwie w promieniu 1,5 km łączone w jeden punkt (środek najdłuższego odcinka).
- Miejsca (20 381): nazwane `amenity`, `shop`, `tourism`, `leisure`, `office`, `healthcare`, `historic`, dworce, place, wybrane budynki; krótka polska kategoria (np. Szpital, Apteka, Uczelnia).
- Dzielnice/osiedla (1 385 węzłów `place=*`) służą tylko jako opis drugiej linii („Stare Miasto”) — to najbliższy punkt nazwy, nie granica administracyjna.
- Przystanki: w czasie działania z `.runtime/transit.sqlite` (ZTP GTFS), jedna podpowiedź na nazwę (środek słupków; te same nazwy dalej niż 1,5 km osobno).

`src/lib/places.ts` ładuje indeks raz, wyszukuje bez wielkości liter i polskich znaków (ł→l), po prefiksach słów, z numerami domów, i rankuje z uwzględnieniem bliskości. Endpoint: `GET /api/places?q=…[&lat&lon]`, `GET /api/places?reverse=1&lat&lon` (adres ≤ 80 m, inaczej miejsce/ulica ≤ 150 m). Zapytania nie opuszczają serwera aplikacji — autocomplete nie korzysta z publicznego Nominatim.

## Odkrywaj: obiekty z faktami o dostępności

### OSM (`npm run data:objects`, `scripts/acquire-objects.py`)

Ten sam PBF Geofabrik (dane do 2.10.2026 20:21 UTC, obszar 19.75–20.25 E, 49.94–50.20 N) → `data/krakow-objects.json.gz` (~190 kB) + `data/objects-metadata.json` (liczby, SHA-256 PBF). ODbL. Kategorie: muzea (`tourism=museum`), zabytki i atrakcje (`tourism=attraction|viewpoint`, `historic=castle|monument|archaeological_site|city_gate|fort|palace|citywalls`, pomniki i świątynie tylko z Wikidata/Wikipedią), kultura (teatry, kina, biblioteki, sale koncertowe, centra sztuki, galerie), urzędy (`amenity=townhall`, `office=government`), toalety (także bez nazwy; bez `access=private|no`), noclegi (hotel, hostel, pensjonat), gastronomia (restauracje/kawiarnie **tylko z tagiem `wheelchair*`**), zdrowie (szpital, przychodnia, apteka, lekarz), parki. Parkingi pomija (osobny moduł). Środek geometrii dla dróg/relacji; ID i czas edycji elementu OSM; duplikaty (punkt + obrys) w promieniu 150 m łączone.

Zachowane tagi: `wheelchair*`, `toilets:wheelchair`, `step_count`, `ramp*`, `elevator`, `door`, `door:width`, `automatic_door`, `hearing_loop`, `capacity:disabled`, `check_date*`, `opening_hours`, `website`, `addr:*`, `name:en/de` (plik danych sprzed 3.10.2026 ma jeszcze `name:uk`; nazwy niemieckie pojawią się po ponownym `npm run data:objects`). Wejścia (`entrance=*`, 14 333 w obszarze): na obrysie/wewnątrz **budynku** obiektu albo ≤ 25 m od punktu obiektu (z odległością w opisie); obrysy placów i parków nie zbierają wejść.

| Kategoria | Obiekty | Z jakimkolwiek tagiem dostępności (obiekt lub wejście) |
| --- | ---: | ---: |
| muzea | 99 | 23 |
| zabytki i atrakcje | 635 | 90 |
| kultura | 225 | 63 |
| urzędy | 166 | 30 |
| toalety | 284 | 160 |
| noclegi | 446 | 70 |
| gastronomia | 238 | 238 (z definicji) |
| zdrowie | 820 | 206 |
| parki | 167 | 6 |
| **razem** | **3 080** | **886** |

To liczba obiektów z *jakąkolwiek* informacją, nie liczba dostępnych miejsc. Brak tagu = „brak danych”, nigdy „dostępne”.

### UMK: „Dostępność budynków Urzędu Miasta Krakowa i MJO” (`npm run data:city-venues`)

- **Co:** [strona UMK](https://www.krakow.pl/getHtml?dok_id=2848) — 20 budynków, każdy z „adres:” i „dostosowania:” (podjazd, winda, WC, język migowy, schodołaz, platforma, zejście urzędnika, „budynek trudny architektonicznie”, „brak możliwości wjazdu na wyższe piętra”, „budynek niedostosowany”).
- **Jak:** `scripts/acquire-city-venues.ts` pobiera HTML, parsuje deterministycznie (`src/lib/city-venues.ts`: nagłówki `h5`, akapity „adres/dostosowania”, listy `li`), mapuje każde sformułowanie na klucz faktu z **oryginalnym zdaniem jako szczegółem** (np. „schodołaz” → `stair_lift=yes`, „brak możliwości wjazdu na wyższe piętra” → `lift=no`, „budynek niedostosowany” → `step_free_entrance=no` + `difficult_building=yes`, „wideofon” → `staff_assistance=yes`). Niezmapowane zdania byłyby zachowane w `unmapped` (obecnie 0). Adresy geokodowane lokalnym indeksem adresów OSM — tylko dokładny numer w Krakowie (zakres „3-4” → „3”); **19/20** rozwiązane, „Czerwieńskiego 16” (ZBK) nie ma w indeksie i jest wypisany w `unresolved` bez współrzędnych (nie zgadujemy). Plik `data/krakow-city-venues.json` zawiera URL, `obtainedAt`, SHA-256 HTML. Kopia strony do testów: `tests/fixtures/umk-dostepnosc-2848.html`.
- **Łączenie:** budynek z wykazu łączy się z obiektem OSM ≤ 60 m o podobnej nazwie albo z urzędem OSM pod tym samym adresem (≤ 150 m); 12 z 19 połączonych (w 11 obiektach OSM; Wydział Spraw Administracyjnych i Wydział Sportu dzielą budynek), 7 to osobne obiekty kategorii „Urząd”.
- **Aktualizacja:** proponowana co tydzień (cron); zmiana SHA-256 = nowa wersja.
- **Awaria:** gdy strona nie odpowiada (limit 20 s) albo zmieniła strukturę (< 5 rozpoznanych budynków), skrypt kończy się kodem 1 i **zostawia poprzedni plik bez zmian** (zapis atomowy: plik tymczasowy + rename). Aplikacja pokazuje wtedy dane z poprzedniego odczytu z jego datą.
- **Warunki:** strona nie ma deklaracji licencji; zob. „Warunki miejskie” wyżej. Przechowujemy krótkie fakty z linkiem i datą odczytu; przed komercyjnym użyciem potwierdzić warunki z UMK.

### Portal Otwarte Dane Kraków — sprawdzone 3.10.2026

Portal nie jest CKAN (`/api/3/action/*` zwraca HTML); zbiory mają własne API `api.um.krakow.pl/opendata-*` (JSON). 45 zbiorów; istotne: „Lista muzeów miejskich” (30 rekordów: nazwa, adres; aktualizacja danych 9.04.2024), „Lista teatrów miejskich”, „Lista bibliotek miejskich”, „Parki miejskie” (nazwa, powierzchnia), „Podmioty lecznicze prowadzone przez GMK”. **Żaden nie zawiera informacji o dostępności** (brak pól o wejściu, windzie, WC itp.), brak zbioru toalet publicznych. Nie importujemy ich: dodałyby tylko „źródło miejskie” bez faktów, a te obiekty są już w OSM. Kandydat na przyszłość: oficjalna nazwa/adres instytucji jako potwierdzenie tożsamości obiektu. Warunki portalu pozwalają na ponowne wykorzystanie z podaniem źródła.

### Partnerzy i dane demonstracyjne

Dane partnera (`POST /api/partners/objects`) to deklaracja właściciela: status „partner”, `confirmedAt: null`, bez weryfikacji terenowej. E-mail kontaktowy jest tylko w bazie, nigdy w API. Obiekt demonstracyjny „Hotel Przykładowy (dane demonstracyjne)” (`partner-demo-hotel`) jest stałym fixture w kodzie (`DEMO_PARTNER`, status `example`, adres „to nie jest prawdziwy hotel”); wyłączenie: `KROK_DEMO_PARTNER=0`.

## Drogi i parkingi dla taksówki/samochodu (`npm run data:roads`)

`scripts/acquire-roads.py` (pyosmium; ten sam PBF Geofabrik z 2.10.2026 20:21:34 UTC, obszar 19.75–20.25 E, 49.94–50.20 N; SHA-256 w `data/roads-metadata.json`) zapisuje `data/krakow-roads.json.gz` (~4,4 MB) i `data/krakow-parking.json.gz` (~0,24 MB). ODbL-1.0, © OpenStreetMap contributors. Uruchomienie: `/tmp/krok-data-venv/bin/python scripts/acquire-roads.py [/tmp/krok-malopolskie.osm.pbf]` (~60 s, ~0,6 GB RAM).

- **Drogi:** 102 774 drogi przejezdne, 415 223 węzły; 10 433 jednokierunkowe (z rondami i autostradami), 16 397 z `maxspeed` (16 %; reszta dostaje domyślną prędkość klasy), 716 tylko dla dojazdu (`destination`/`customers`), 1 057 sygnalizacji świetlnych. Pominięte w całym PBF: 30 391 dróg z zakazem dla samochodów (`no`, `private`, `delivery`, `psv`…), 13 o zmiennym kierunku. Czasy przejazdu to szacunek (ograniczenie × współczynnik miejski + opóźnienia skrzyżowań), bez danych o ruchu, bez zakazów skrętu i ograniczeń czasowych.
- **Parkingi:** 11 045 `amenity=parking` (bez prywatnych), tylko 116 z nazwą; 2 590 z tagiem `fee`; 992 z tagiem `capacity:disabled` (w tym `no`/0), **616 (5,6 %) z miejscami dla osób z niepełnosprawnością** (liczba > 0, `yes` albo zmapowane miejsce w obrysie).
- **Miejsca dla osób z niepełnosprawnością:** 1 673 obiekty (`parking_space=disabled` i pokrewne; 1 770 miejsc), z czego 1 281 poza obrysem zmapowanego parkingu (najczęściej przy ulicy) — pokazywane jako osobne miejsca.
- **Pokrycie (szacunek):** dla 155 891 punktów adresowych z indeksu wyszukiwania oznaczone miejsce dla osób z niepełnosprawnością jest w linii prostej do 300 m od 21,7 % adresów i do 600 m od 39,2 %; jakikolwiek parking do 600 m — 83,8 %. Brak oznaczenia w OSM nie znaczy, że miejsca nie ma; zajętość, godziny, płatność w strefie płatnego parkowania i aktualność nie są znane.
- **Taksówki — cena (szacunek):** maksymalne ceny za przewóz osób taksówkami w Krakowie, **uchwała nr XCII/2512/22 Rady Miasta Krakowa z 6 lipca 2022 r.** (zmiana uchwały nr LXXVI/977/09 z 17 czerwca 2009 r.; Dz. Urz. Woj. Małopolskiego z 14.07.2022, poz. 5009; obowiązuje od 29.07.2022). Tekst: https://www.bip.krakow.pl/zalaczniki/dokumenty/n/343506 (karta: https://www.bip.krakow.pl/zalaczniki/dokumenty/n/343506/karta, przegląd BIP: https://www.bip.krakow.pl/?dok_id=69213). Miejski informator „Taksówką po Krakowie” z 15.07.2026 (https://krakow.pl/getPdf?dok_id=321432) podaje te same stawki dla 2026 r.; nowszej uchwały nie znaleziono (sprawdzone 3.10.2026). Strefa I (zwarta zabudowa miasta): opłata początkowa z pierwszymi ≥ 200 m **9,00 zł**; **taryfa 1** (dni powszednie 6–22) **4,00 zł/km**; **taryfa 2** (dni powszednie 22–6, niedziele, święta) **6,00 zł/km**; postój **55,00 zł/h**. Strefa II (dalsze części miasta): ta sama opłata początkowa i postój, taryfa 3 **8,00 zł/km**, taryfa 4 **12,00 zł/km** — granica stref to opis ulic w załączniku do uchwały z 2009 r. (https://www.bip.krakow.pl/zalaczniki/dokumenty/n/63804), nie mamy jej jako wielokąta, więc **liczymy strefę I**. Wzór (`taxi.ts`): `min = ⌊9 + max(0, km − 0,2) × 4⌋`, `max = ⌈(9 + max(0, km − 0,2) × 6) × 1,2⌉` (+20% zamiast nieznanego postoju w korkach), km z grafu drogowego. To szacunek ceny maksymalnej, nie oferta: aplikacje przewozowe mogą stosować inne ceny (krakow.pl, 28.05.2025, zwraca uwagę na ceny dynamiczne). Dopłat (np. bagaż) i taryf 3/4 nie modelujemy. Nie wiemy też, czy pojazd jest przystosowany do wózka; wariant dla wózka inwalidzkiego prosi o zamówienie takiego pojazdu.
- **Linki do aplikacji przewozowych (`JourneyOption.rideLinks`):** Uber — udokumentowany link uniwersalny (https://developer.uber.com/docs/riders/ride-requests/tutorials/deep-links/introduction): `https://m.uber.com/looking?pickup=<JSON {latitude, longitude, addressLine1}>&drop[0]=<JSON>` (bez `client_id` — przykłady w dokumentacji go zawierają, ale nie jest opisany jako wymagany; sprawdzić na telefonie). Starszy format `m.uber.com/ul/?action=setPickup…` nie występuje już w aktualnej dokumentacji. Bolt i FreeNow (od 2025 „Freenow by Lyft”) nie publikują linków z współrzędnymi — link otwiera oficjalną stronę dla Krakowa: https://bolt.eu/pl-pl/cities/krakow/ (en/de: https://bolt.eu/en/cities/krakow/) i https://www.free-now.com/pl/pasazer/taxi-krakowie/. Nieoficjalnych schematów (`bolt://…`) nie używamy.
- **Przystosowanie kursów ZTP:** sprawdzone w lokalnym GTFS (3.10.2026): `wheelchair_accessible` = 0 dla wszystkich 124 239 kursów (352 puste), `wheelchair_boarding` = 0 dla wszystkich 3 751 słupków. Planer obsługuje te pola (wykluczenia/ranking), ale dziś każdy kurs jest „bez informacji”.
