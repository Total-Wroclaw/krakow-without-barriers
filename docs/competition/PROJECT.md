# Każdy Krok / Every Step

## Problem i grupa docelowa

Osoba po urazie lub w rehabilitacji może dziś przejść kilometr, ale źle znosi schody w dół. Jutro jej możliwości będą inne. Osoba na wózku albo rodzic z wózkiem dziecięcym potrzebuje wiedzieć, gdzie są schody, krawężniki, bruk, winda i dostępna toaleta. Etykieta „dostępne / niedostępne” nie odpowiada na pytanie: „Czy dam radę dotrzeć tam dzisiaj?”.

Każdy Krok dobiera trasę i pokazuje miejsca według dzisiejszych preferencji dotyczących barier: schody (osobno w dół i w górę), poręcze, odpoczynek, dystans oraz sposób poruszania się (pieszo, na wózku, z wózkiem dziecięcym). Nie wymaga diagnozy, konta ani informacji o niepełnosprawności.

## Działający prototyp

Responsywna aplikacja webowa (PWA) po polsku, angielsku i niemiecku, działająca pod adresem [kazdy-krok.antek.page](https://kazdy-krok.antek.page) (Dokploy, Docker, za Cloudflare). Bez kont.

- **Trasa:** wyszukiwanie adresów, miejsc i przystanków; warianty pieszo, komunikacją ZTP z przesiadkami (GTFS), taksówką (szacunkowa cena wg maksymalnej taryfy Krakowa) lub samochodem z parkingiem (na wózku tylko parkingi z miejscami dla osób z niepełnosprawnościami). Profile: pieszo, o kulach, wózek, wózek dziecięcy. Schody omijane osobno w dół i w górę, odpoczynek na ławkach, dostępne toalety przy trasie. Każdy wariant ma pasek z barierami w miejscu wystąpienia; mapa (standardowa lub satelitarna) i równoważna lista kroków; udostępnianie trasy linkiem.
- **Odkrywaj:** ok. 3 080 miejsc z OSM (muzea, zabytki, kultura, urzędy, toalety, noclegi, gastronomia, zdrowie, parki) + zestawienie dostępności budynków UMK/MJO + deklaracje partnerów. Lista dopasowana do widocznego fragmentu mapy; karta miejsca ze skrótem faktów, konfliktami między źródłami i pochodzeniem każdej informacji.
- **Okolica z lotu ptaka:** ortofotomapa GUGiK z nakładką OSM i wskazówki dojścia od AI (OpenAI), strumieniowane w ok. 3 s; obserwacje ze zdjęcia są sprawdzane na zbliżeniach 50 × 50 m, a niepotwierdzone odrzucane. Zmierzona dokładność (12 miejsc): mediana błędu położenia 1,7–2,3 m, 14% obserwacji > 20 m od obiektu (`docs/VALIDATION.md`).
- **Zgłoszenie jednym zdjęciem:** AI opisuje barierę, zgłoszenie jest niezweryfikowane, autor poprawia lub usuwa je tokenem; zdjęcie jest publiczne tylko, gdy AI nie widzi na nim osób ani tablic. **Panel miasta `/city`** (hasło, sesja) z filtrami, odpowiedziami i eksportem CSV.
- **Widżet partnera** `/embed` „Jak do nas dotrzeć bez barier” do osadzenia na stronie hotelu lub wydarzenia.

Trasy liczy deterministyczny silnik na grafach OSM i rozkładzie GTFS; AI (`gpt-5.6-luna`) nie wyznacza tras, nie mierzy zdjęć i nie zapewnia dostępności. Uzasadnienie dostępności wejścia w odczycie z lotu ptaka tworzy serwer z rekordu danych, nie model.

## Wiarygodność i aktualizacje

Każda informacja ma źródło, datę pozyskania, datę edycji u źródła, datę potwierdzenia na miejscu (jeśli była) i status: mapa OSM, Urząd Miasta Krakowa, deklaracja właściciela, zgłoszenie niezweryfikowane, dane demonstracyjne. Brak informacji jest pokazany jako „brak danych”, nigdy jako dostępność. Sprzeczne źródła są pokazane obok siebie z ostrzeżeniem. Przy awarii źródła aplikacja działa na ostatniej dobrej migawce i mówi, czego brakuje.

Źródła: OpenStreetMap (Geofabrik, ODbL), ZTP GTFS, zestawienie dostępności budynków UMK, ortofotomapa GUGiK, kafelki OpenFreeMap, pogoda Open-Meteo, deklaracje partnerów, zgłoszenia użytkowników; rejestr z licencjami, częstotliwością i zachowaniem przy awarii: `docs/DATA-SOURCES.md`. Portal otwartych danych Krakowa sprawdzono — zbiory o instytucjach kultury nie mają pól dostępności.

## Model biznesowy

Dla użytkownika aplikacja jest i pozostaje **bezpłatna, bez konta i bez reklam**. Dostępność nie jest funkcją premium. Poniższe ceny i wolumeny to **HIPOTEZY** do sprawdzenia w pilotażu; nie mamy cennika, listów intencyjnych ani klientów.

### Kto płaci i za co

| Płatnik | Oferta | Cena (HIPOTEZA) | Co sprawdzamy w pilotażu |
| --- | --- | --- | --- |
| Hotele, muzea, obiekty kultury, organizatorzy wydarzeń | Wpis z deklaracją dostępności: bezpłatny. Pakiet Partner: oznaczenie „Promowane” w Odkrywaj (jawne, nie zmienia danych o dostępności), widżet `/embed` na stronie i w potwierdzeniu rezerwacji, statystyki odsłon i tras do obiektu | 49–149 zł / mies. za obiekt | czy ≥ 20–30% zaproszonych obiektów uzupełnia deklarację; czy ktokolwiek zapłaciłby po okresie próbnym |
| Obiekty chcące mieć potwierdzenie | Audyt wejścia z organizacją osób z niepełnosprawnościami: status „potwierdzone na miejscu” z datą i audytorem (dziś kod takiego statusu nie nadaje) | 400–1 200 zł jednorazowo (koszt audytora w cenie) | koszt i czas jednego audytu |
| Miasto / ZTP / MJO | Sponsor pilotażu i partner danych: panel `/city`, eksport CSV, wsparcie wdrożenia, raport z pilotażu | 15 000–40 000 zł za pilotaż 8–12 tyg. lub abonament roczny | czy zgłoszenia skracają czas reakcji; czy UMK udostępni ponowne wykorzystanie zestawienia |
| Platformy podróży i rezerwacji | API: fakty o miejscach (ze źródłem i statusem) i trasa dojścia; dziś API wewnętrzne, bez kluczy i limitów per klient | 500–2 000 zł / mies. za pakiet zapytań | czy integrator widzi wartość w polu „brak danych” zamiast fałszywego „dostępne” |

### Koszty (SZACUNEK, bez wynagrodzenia zespołu)

| Pozycja | Założenie | Miesięcznie |
| --- | --- | --- |
| Hosting | jeden VPS ok. 4 GB RAM / 2 vCPU (graf w pamięci ok. 1,2 GB RSS, rozkład ZTP ok. 320 MB w SQLite) + wolumen na zgłoszenia i cache; docelowo zarządzany PostgreSQL/PostGIS | 60–150 zł |
| Kafelki mapy | OpenFreeMap, bez opłat i klucza (brak SLA; przy dużym ruchu własny serwer kafelków lub plan płatny) | 0 zł |
| Ortofotomapa, pogoda, OSM, GTFS | publiczne źródła, bez opłat; kafelki ortofotomapy z cache na dysku | 0 zł |
| AI, odczyt z lotu ptaka | patrz niżej | 0,04–0,20 zł za odczyt |
| AI, opis zdjęcia zgłoszenia | 1 wywołanie na zdjęcie | 0,01–0,04 zł |
| Moderacja | 2–4 h tygodniowo przy kilkudziesięciu zgłoszeniach, ok. 60 zł/h | 500–1 000 zł |

**Koszt jednego odczytu z lotu ptaka (szacunek).** Odczyt to 2 równoległe wywołania (wskazówki dojścia; wstępne obserwacje) + do 6 sprawdzeń zbliżenia, czyli 2–8 wywołań. Obraz 960 × 720 w pełnej rozdzielczości to rzędu 1 tys. tokenów wejściowych, zbliżenie 512 × 512 ok. 0,8 tys., prompt z faktami 1–2 tys.; razem ok. 8–12 tys. tokenów wejściowych i 2–3 tys. wyjściowych (limity w kodzie: 1 500 / 1 500 / 300 tokenów wyjścia). Przy założonych cenach 0,5–2 USD za 1 mln tokenów wejściowych i 2–10 USD za 1 mln wyjściowych daje to ok. 0,01–0,05 USD, czyli 0,04–0,20 zł. **Ceny modelu nie zostały zweryfikowane w cenniku dostawcy; liczby tokenów to oszacowanie z rozmiarów obrazów, nie pomiar.** Powtórny odczyt tego samego miejsca przy tych samych warunkach nie kosztuje nic (cache plikowy po kluczu: miejsce, język, preferencje, pogoda, dane mapy). Ochrona przed nadużyciem: 20 zapytań AI na minutę z jednego adresu IP.

**Budżet przykładowy:** 3 000 odczytów/mies. (bez trafień w cache) ≈ 120–600 zł; 500 zdjęć ≈ 5–20 zł; hosting 60–150 zł; moderacja 500–1 000 zł. Razem ok. **0,7–1,8 tys. zł / mies.** kosztów zmiennych i stałych bez pracy programistów.

### Prosty rachunek progu rentowności (HIPOTEZA)

Przy średnio 99 zł / mies. za obiekt i kosztach 1 000–1 800 zł pokrycie wymaga ok. **10–18 płacących obiektów**; przy 49 zł ok. 20–37. Jeden pilotaż miejski (np. 25 000 zł na 10 tyg.) pokrywa w całości koszty pierwszego roku bez opłat od obiektów, ale nie rozwój. Praca programistów (utrzymanie, nowe miasta) jest poza tym rachunkiem i wymaga albo kontraktu z miastem, albo kilkudziesięciu partnerów. Przychód od partnerów ma sens tylko, jeśli Odkrywaj jest użyteczne bez nich, dlatego wpis podstawowy jest bezpłatny, a promocja nigdy nie zmienia danych o dostępności.

Partnerzy są jednocześnie dodatkowym, aktualizowanym źródłem danych (status „deklaracja właściciela”, dopóki nie ma potwierdzenia), więc Miasto nie musi utrzymywać bazy. Dziś prototyp nie ma płatności ani weryfikacji tożsamości partnera (każdy może zgłosić obiekt) — to warunek wstępny przed sprzedażą pakietu.

## Plan pilotażu (propozycja, 10 tygodni)

Zakres: jedna dzielnica (np. Stare Miasto i Kazimierz), 15–20 obiektów partnerskich (hotele, muzea, kawiarnie, urzędy), grupa 10–15 testerów z różnymi potrzebami (kule, wózek, wózek dziecięcy, rehabilitacja) rekrutowana z organizacji osób z niepełnosprawnościami. Cele poniżej to **założenia do zweryfikowania**; stanu wyjściowego nie mierzyliśmy.

| Tydzień | Działanie | Odpowiada |
| --- | --- | --- |
| 1–2 | Wskazanie operatora i administratora danych, polityka prywatności, umowa powierzenia z dostawcą AI, weryfikacja właściciela wpisu (e-mail/telefon), konta zamiast wspólnego hasła w `/city` | zespół, operator |
| 2–3 | Warunki ponownego wykorzystania zestawienia UMK i przystosowania kursów ZTP (`wheelchair_accessible`) | UMK/MJO, ZTP |
| 3–4 | Rekrutacja obiektów i testerów, szkolenie 1 h, audyt wejść w 5–8 obiektach | zespół, organizacje partnerskie |
| 4–9 | Używanie na co dzień, zgłoszenia, tygodniowy przegląd moderacji, raport tygodniowy | testerzy, zespół, moderator |
| 10 | Raport: wyniki, koszty, decyzja o rozszerzeniu | zespół, UMK |

| Miara | Cel (założenie) | Skąd dane |
| --- | --- | --- |
| Trasy zakończone bez nieoczekiwanej bariery (ankieta po trasie, 1 pytanie) | ≥ 80% z ≥ 150 ocenionych tras | ankieta w aplikacji (do dodania) |
| Zweryfikowane zgłoszenia barier (potwierdzone przez moderatora lub urząd) | ≥ 40 | panel `/city` |
| Obiekty z uzupełnioną deklaracją / zaproszone | ≥ 8 z 20 | rejestr partnerów |
| Płacący partner po okresie próbnym | ≥ 3 | rozmowy z partnerami |
| Czas od zgłoszenia do odpowiedzi urzędu (mediana) | ≤ 5 dni roboczych | znaczniki czasu w panelu `/city` |
| Odczyty z lotu ptaka, w których tester uznał wskazówkę za trafną | ≥ 70% | ocena w teście z testerami |
| Koszt AI i hostingu w pilotażu | w ramach 0,7–1,8 tys. zł / mies. | rachunki |

## Wdrożenie i utrzymanie poza UMK

**Operator:** do wskazania (zespół, fundacja albo firma). Do czasu wskazania nie ma administratora danych w rozumieniu RODO; wskazanie jest warunkiem uruchomienia produkcyjnego. Operator odpowiada za hosting, aktualizacje, bezpieczeństwo, moderację i koszty.

**Hosting dziś:** jeden kontener (Next.js 16, Node 24) budowany z `Dockerfile` przez Dokploy przy pushu na `main`, wolumen `/data` na zgłoszenia (SQLite), zdjęcia i cache; za proxy Cloudflare. Rozkład ZTP jest pobierany przy budowie obrazu. **Docelowo:** ten sam obraz, PostgreSQL/PostGIS zamiast SQLite, konta partnerów i urzędu (SSO), kolejka moderacji.

| Źródło | Odświeżanie | Przy awarii |
| --- | --- | --- |
| OSM (Geofabrik: miejsca, drogi, parkingi, graf) | co tydzień (skrypty `npm run data:*`, migawka w repozytorium z SHA-256) | zostaje ostatnia migawka z jej datą |
| GTFS ZTP | codziennie nocą przebudowa obrazu (dziś: przy każdym buildzie; harmonogram do ustawienia w CI) | zostaje poprzedni obraz z poprzednim rozkładem; wyniki oznaczone datą rozkładu |
| Zestawienie UMK (dok_id=2848) | co tydzień | skrypt kończy się błędem i zostawia poprzedni plik (zapis atomowy) |
| Ortofotomapa GUGiK | na żądanie, kafelki w cache dyskowym (30 dni w przeglądarce) | brak zdjęcia: komunikat, reszta planera działa |
| Pogoda Open-Meteo | na żądanie, limit czasu 4 s | odczyt bez pogody |
| AI (OpenAI) | na żądanie | trasy, lista i szczegóły działają; brak opisu AI to komunikat |

**Kopie zapasowe i odtwarzanie:** wolumen `/data` (zgłoszenia, zdjęcia) kopiowany co noc na osobny nośnik, test odtworzenia co kwartał — **planowane, nie skonfigurowane**. Dane źródłowe odtwarza się skryptami z repozytorium. **Monitoring:** sprawdzanie dostępności z zewnątrz i alerty o błędach 5xx oraz o kosztach AI — **planowane**. **Bezpieczeństwo:** aktualizacje zależności i obrazu co miesiąc, rotacja kluczy, dodatkowe limity zapytań na proxy; stan zabezpieczeń: `docs/PRIVACY-SECURITY.md`.

**Miesięczne koszty (HIPOTEZA):** hosting 60–150 zł, AI 130–620 zł, moderacja 500–1 000 zł, domena i kopie 20–50 zł; razem ok. 0,7–1,8 tys. zł.

**Kolejne miasto** (szacunek: kilka dni pracy na dane i kilka tygodni na próby terenowe): nowy wyciąg OSM i przycięcie obszaru (stałe `BBOX` w skryptach `acquire-*` i w walidacji współrzędnych), GTFS miasta, lokalna lista budynków/obiektów (parser jak dla UMK), taryfa taksówek, nazwy i język, testy routingu i próba terenowa. Interfejs, kontrakty danych i model partnerów pozostają te same; graf w pamięci wymaga PostGIS powyżej kilku milionów węzłów.

## Walidacja i ograniczenia

161 testów automatycznych (routing, kierunek schodów, profile, samochód/parkingi, przesiadki, wyszukiwanie, miejsca, źródła i konflikty, zgłoszenia i tokeny, odczyt z lotu ptaka), kontrola Playwright + axe-core (WCAG 2.2 AA, 0 naruszeń) na telefonie i desktopie, Safari w symulatorze iPhone. Nie wykonano testu z VoiceOver na fizycznym iPhonie ani audytu terenowego. Rozkład ZTP nie podaje przystosowania kursów; tylko 5,6% parkingów w OSM ma oznaczone miejsca dla osób z niepełnosprawnościami — oba braki aplikacja pokazuje wprost.

Istniejące rozwiązania (AccessMap, Project Sidewalk) pokazują dorobek routingu dostępnościowego. Nasz wyróżnik: codziennie zmienne potrzeby, jawna niepewność, zgłaszanie jednym zdjęciem i model partnerów finansujący aktualne dane.
