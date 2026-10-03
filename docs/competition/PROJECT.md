# Każdy Krok / Every Step

## Problem i grupa docelowa

Osoba po urazie lub w rehabilitacji może dziś przejść kilometr, ale źle znosi schody w dół. Jutro jej możliwości będą inne. Osoba na wózku albo rodzic z wózkiem dziecięcym potrzebuje wiedzieć, gdzie są schody, krawężniki, bruk, winda i dostępna toaleta. Etykieta „dostępne / niedostępne” nie odpowiada na pytanie: „Czy dam radę dotrzeć tam dzisiaj?”.

Każdy Krok dobiera trasę i pokazuje miejsca według dzisiejszych preferencji dotyczących barier: schody (osobno w dół i w górę), poręcze, odpoczynek, dystans oraz sposób poruszania się (pieszo, na wózku, z wózkiem dziecięcym). Nie wymaga diagnozy, konta ani informacji o niepełnosprawności.

## Działający prototyp

Responsywna aplikacja webowa (PWA) po polsku, angielsku i niemiecku.

- **Trasa:** wyszukiwanie adresów, miejsc i przystanków jak w Jakdojade; warianty pieszo, tramwajem/autobusem ZTP z przesiadkami, taksówką lub samochodem z parkingiem (na wózku tylko parkingi z miejscami dla osób z niepełnosprawnościami). Każdy wariant ma pasek z barierami w miejscu, w którym wystąpią; mapa (standardowa lub satelitarna) i równoważna lista kroków.
- **Odkrywaj:** muzea, zabytki, kultura, urzędy, toalety, noclegi, zdrowie, parki z konkretnymi faktami (wejście bez stopni, podjazd, winda, schodołaz, szerokość drzwi, toaleta, język migowy), każdy ze źródłem, datą i statusem.
- **Zgłoszenie jednym zdjęciem:** AI opisuje barierę, zgłoszenie zapisuje się jako niezweryfikowane, autor może je poprawić.
- **Okolica z lotu ptaka:** AI opisuje ortofotomapę GUGiK — co widać, czego nie da się ocenić z góry, co sprawdzić na miejscu.
- **Widżet partnera** „Jak do nas dotrzeć bez barier” do osadzenia na stronie hotelu lub wydarzenia.

Trasy liczy deterministyczny silnik na grafach OSM i rozkładzie GTFS; AI (`gpt-5.6-luna`) nie wyznacza tras, nie mierzy zdjęć i nie zapewnia dostępności.

## Wiarygodność i aktualizacje

Każda informacja ma źródło, datę pozyskania, datę edycji u źródła, datę potwierdzenia na miejscu (jeśli była) i status: mapa OSM, Urząd Miasta Krakowa, deklaracja właściciela, zgłoszenie niezweryfikowane, dane demonstracyjne. Brak informacji jest pokazany jako „brak danych”, nigdy jako dostępność. Sprzeczne źródła są pokazane obok siebie z ostrzeżeniem. Przy awarii źródła aplikacja działa na ostatniej dobrej migawce i mówi, czego brakuje.

Źródła: OpenStreetMap (Geofabrik, ODbL), ZTP GTFS, zestawienie dostępności budynków UMK, ortofotomapa GUGiK, deklaracje partnerów, zgłoszenia użytkowników. Portal otwartych danych Krakowa sprawdzono — zbiory o instytucjach kultury nie mają pól dostępności. Szczegóły: `docs/DATA-SOURCES.md`.

## Model biznesowy

Dla użytkownika aplikacja jest bezpłatna i bez konta. Przychód pochodzi od podmiotów, którym zależy na gościach o różnych potrzebach:

1. **Partnerzy (obiekty, hotele, muzea, organizatorzy wydarzeń, zarządcy nieruchomości).** Bezpłatny wpis z deklaracją dostępności. Pakiet Partner (abonament): oznaczenie „Promowane” w Odkrywaj, widżet „Jak do nas dotrzeć” na stronę i w potwierdzeniu rezerwacji, statystyki. Promocja jest jawnie oznaczona i nigdy nie zmienia danych o dostępności.
2. **Audyt wejścia** (usługa dodatkowa, z organizacjami osób z niepełnosprawnościami): status „potwierdzone na miejscu” z datą i audytorem.
3. **API dla systemów rezerwacyjnych i aplikacji turystycznych:** fakty o dostępności miejsc i trasy dojścia, licencja za wywołania.
4. **Miasta:** uruchomienie dla kolejnego miasta (migawki OSM, GTFS, lokalne zbiory) oraz panel zgłoszonych barier dla zarządców przestrzeni.

To hipotezy do sprawdzenia w pilotażu; nie mamy cennika ani podpisanych klientów. Partnerzy stają się dodatkowym, aktualizowanym źródłem danych, więc Miasto nie musi utrzymywać bazy.

## Uruchomienie i utrzymanie

Operator produktu (zespół / spółka) odpowiada za hosting, aktualizacje, bezpieczeństwo, moderację zgłoszeń i koszty. Prototyp działa na jednym serwerze (Node.js, ok. 1,2 GB RAM na grafy, SQLite). Koszty zmienne: analizy AI liczone za zdjęcie, a nie za ciągłe wideo. Migawki odświeżane zadaniami: OSM codziennie, GTFS przy nowej wersji, zestawienie UMK co tydzień. Docelowo: PostgreSQL/PostGIS, konta partnerów z weryfikacją, moderacja, HTTPS, kopie zapasowe.

Kolejne miasto: nowy wyciąg OSM i GTFS, lokalne zbiory dostępności, testy routingu i próby terenowe; interfejs, kontrakty danych i model partnerów pozostają te same.

## Walidacja i ograniczenia

68 testów automatycznych (routing, kierunek schodów, profil wózka, samochód/parkingi, przesiadki, wyszukiwanie, miejsca, źródła i konflikty, zgłoszenia), kontrola Playwright + axe-core (WCAG 2.2 AA, 0 naruszeń) na telefonie i desktopie, Safari w symulatorze iPhone. Nie wykonano testu z VoiceOver na fizycznym iPhonie ani audytu terenowego. Rozkład ZTP nie podaje przystosowania kursów; tylko 5,6% parkingów w OSM ma oznaczone miejsca dla osób z niepełnosprawnościami — oba braki aplikacja pokazuje wprost.

Istniejące rozwiązania (AccessMap, Project Sidewalk) pokazują dorobek routingu dostępnościowego. Nasz wyróżnik: codziennie zmienne potrzeby, jawna niepewność, zgłaszanie jednym zdjęciem i model partnerów finansujący aktualne dane.
