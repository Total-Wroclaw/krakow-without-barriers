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

## Poprawki po przeglądzie desktop/mobile (4 października 2026)

Zakres: 15 usterek z pełnego przeglądu. Prace i weryfikacja podzielone między agentów domeny tras, desktopu i urządzeń mobilnych; integracja na lokalnym serwerze produkcyjnym `:3133`, z oddzielnym magazynem zgłoszeń. Zachowano równoległą zmianę panelu telefonu (`5318d2a`). Końcowy build QA ukończono o 03:59:50 czasu lokalnego; niezależne zmiany prywatności/pochodzenia danych dodane później nie należą do opisanych tu re-testów.

| ID | Poprawka i regresja |
| --- | --- |
| QA-01 | `/city` czeka na żądanie przed sprawdzeniem konfiguracji. Build z pustym hasłem + hasło dopiero przy uruchomieniu: formularz logowania, logowanie 204, panel i API 200. |
| QA-02 | TypeScript pomija `artifacts/` i `.runtime/`; istniejące pliki robocze pozostają na dysku i nie blokują buildu. |
| QA-03 | Każde niezerowe dojście do/z samochodu lub taksówki podlega ocenie grafu. Testy krótkich schodów i nieznanej drogi zachowują ostrzeżenia. |
| QA-04 | Odtwarzanie trasy, podpis i ranking używają tej samej przefiltrowanej tablicy GTFS co wyszukiwanie. Test wybiera dostępny kurs po odrzuconym niedostępnym. |
| QA-05 | Odpoczynki przed pierwszym pojazdem są uwzględniane przed zatwierdzeniem połączenia; wyszukiwanie może wybrać późniejszy kurs. Regresja rzeczywistych danych 08:06, 10:02, 14:02: żaden wariant nie wymaga wcześniejszego wyjścia niż zadano. |
| QA-06 | Przykładowe deklaracje toalet nie trafiają do planowania ani mapy lotniczej. Rzeczywiste źródło, status i daty są zachowane; test także po załadowaniu hotelu demo w Odkrywaj. |
| QA-07 | Zgłoszenia przy trasie są wyszukiwane względem całych odcinków, nie tylko wierzchołków. Regresje długiego odcinka i powtórzonych punktów. |
| QA-08 | Rampa przy schodach nie usuwa ograniczeń szerokości, przejezdności ani `wheelchair=no` z oceny wariantu zastępczego. |
| QA-09 | Model wybiera numer wejścia, a uzasadnienie dostępności tworzy serwer z rekordu tego wejścia w PL/EN/DE. Brak informacji pozostaje brakiem informacji. Cache v10 jest pomijany; zmiana danych mapy również zmienia klucz. Żywy odczyt Wawelu zwraca informację o braku danych zamiast niepopartej deklaracji braku stopni. |
| QA-10 | Link i historia zachowują datę oraz godzinę wyjazdu. Walidowane są prawdziwe daty i godziny; ponowne otwarcie formularza pokazuje zapisany termin. |
| QA-11 | Autor może poprawić komentarz i cel niezależnie od opisu zdjęcia. Widok publiczny, panel miasta i CSV pokazują poprawione słowa. |
| QA-12 | Częściowy zapis zdjęć pokazuje błąd i zachowuje kolejkę po zamknięciu panelu. Ponowienie z tymi samymi identyfikatorami nie tworzy kopii zgłoszenia ani zdjęcia; testy obejmują utratę odpowiedzi i próbę użycia cudzego identyfikatora. |
| QA-13 | Język widżetu ma pierwszeństwo przed zapisaną preferencją i językiem przeglądarki, także w początkowym HTML. |
| QA-14 | Przyciski mapy na telefonie mieszczą się w jednym rzędzie nad panelem, także w poziomie; cele dotykowe mają co najmniej 44 px. |
| QA-15 | Błąd sieci planera używa tłumaczonego komunikatu, zachowując obsługę anulowania żądania i ponowienia. |

Uzasadnienie dostępności wejścia jest deterministyczne. Pozostałe wskazówki i obserwacje modelu nadal są interpretacją danych i zdjęcia, a nie potwierdzeniem warunków w terenie. Filtr tekstu jest dodatkowym zabezpieczeniem, nie dowodem poprawności każdej wypowiedzi modelu. Niewysłane zdjęcia pozostają w pamięci otwartej aplikacji; zamknięcie całej karty może je utracić (przeglądarka otrzymuje ostrzeżenie przed opuszczeniem).

Końcowe kontrole:

| Kontrola | Wynik |
| --- | --- |
| `npm test` | **161/161**, bez pominięć. Równoległy build obciążył wcześniejszy przebieg: istniejący test szybkości podpowiedzi przekroczył 20 ms/zapytanie; samodzielny przebieg przeszedł (7 zapytań w ok. 19 ms łącznie). |
| `npm run typecheck`, `npm run build`, `git diff --check` | przeszły |
| Macierz API | 48/48 kombinacji 4 środków transportu × 4 profili × PL/EN/DE: HTTP 200, niepuste warianty; nieprawidłowe dane 400, obcy Origin 403 |
| AI | test modelu, preferencji i syntetycznego zdjęcia przeszedł; świeży odczyt Wawelu ok. 9 s, wejście jawnie z nieznaną dostępnością |
| Desktop Chromium | poprawa słów i eksport CSV, częściowa wysyłka, zamknięcie/otwarcie panelu, ponowienie bez kopii: przeszły; zero błędów strony i naruszeń axe w poprawionych panelach |
| Odzyskiwanie formularza zgłoszenia | bez `crypto.randomUUID` działa UUID v4 z CSPRNG; awaria losowości lub zapisu tokena nie wysyła zgłoszenia i przywraca przyciski. Trzy scenariusze w przeglądarce: przeszły. |
| Responsywność i stan planera | szerokości 320/390 oraz 844×390, udostępnienie i odtworzenie terminu, język widżetu oraz błąd offline i ponowienie: przeszły |
| iPhone 18 Pro, iOS 27 Simulator, Safari | mapa i trasy działają; termin 8 października 09:30 odtworzony. Końcowy zrzut potwierdza, że pola daty i czasu mieszczą się w popoverze po poprawce szerokości. |
| Android Emulator, Chrome | planowanie i szczegóły trasy działają. Obraz mapy pozostaje niezweryfikowany: także oficjalny przykład MapLibre wyświetla pusty canvas na tym samym emulatorze (ANGLE/SwiftShader), mimo działającego WebGL2 i odpowiedzi sieciowych 200. |

Nie wykonano weryfikacji na fizycznym telefonie ani testów VoiceOver/TalkBack w tej rundzie.

Dowody lokalne: `artifacts/qa-fixes-2026-10-04/` (poza Gitem); pierwotny raport pozostaje w `artifacts/qa-2026-10-04/` jako zapis stanu sprzed poprawek.
