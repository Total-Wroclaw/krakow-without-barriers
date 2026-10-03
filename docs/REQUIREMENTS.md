# Zgodność z wymaganiami wyzwania „Kraków bez barier”

Stan na 3 października 2026, wieczór. Źródło: `docs/KRYTERIA Kraków Bez Barier.pdf` (sekcje 3–6). ✅ spełnione, 🟡 częściowo, ❌ brak.

## Prototyp (sekcja 3)

| Wymaganie | Stan | Gdzie / uwagi |
| --- | --- | --- |
| Konkretne bariery i udogodnienia: schody | ✅ | Trasy: każda klatka schodowa z kierunkiem względem drogi, stopniami, poręczą |
| progi, krawężniki | 🟡 | Krawężniki z OSM (5 853 węzły, 367 `raised`) w trasach na wózku; progi wejść rzadko otagowane |
| podjazdy, windy, schodołazy | ✅ | Odkrywaj: OSM, zestawienie UMK, deklaracje partnerów |
| szerokość wejścia | 🟡 | `door_width`, gdy jest w OSM lub u partnera; w OSM rzadkie |
| nawierzchnia | ✅ | Trasy (bruk, żwir — kary i uwagi „Bruk na 71 m”) |
| toaleta | ✅ | Kategoria Toalety (284, 160 z danymi) i cecha „Toaleta dostępna” |
| miejsca odpoczynku | ✅ | Ławki na trasie, przerzedzone co ≥150 m |
| Źródło, data aktualizacji, poziom wiarygodności | ✅ | Kropka statusu + panel: źródło, pobrano, edycja u źródła, potwierdzenie na miejscu |
| Dane z dostępnych źródeł, bez ręcznej bazy Miasta | ✅ | OSM (Geofabrik), ZTP GTFS, strona UMK, GUGiK, partnerzy, użytkownicy |
| Bez dostępu do systemów UMK/MJO | ✅ | Tylko publiczne strony i pliki |
| Potrzeby wybranej grupy | ✅ | Osoby o czasowo ograniczonej mobilności; profile: pieszo / wózek / wózek dziecięcy |
| Łatwy w użyciu i wdrożeniu | ✅ | Jeden ekran jak w Jakdojade; widżet `/embed` dla hoteli i wydarzeń |
| Potencjał rozwoju, komercjalizacji, skalowania | ✅ | Partnerzy (wpis bezpłatny / pakiet „Promowane” + widżet), opis w PROJECT.md |

## Wymagania formalne (sekcja 4)

| Wymaganie | Stan | Uwagi |
| --- | --- | --- |
| Opis rozwiązania i problemu | ✅ | `docs/competition/PROJECT.md` |
| Prototyp / demonstracja | ✅ | Aplikacja lokalnie; scenariusz w README |
| Grupa docelowa i sposób użycia | ✅ | PROJECT.md, README |
| Źródła danych i ocena aktualności/wiarygodności | ✅ | `docs/DATA-SOURCES.md` |
| Model biznesowy i rozwój | ✅ | PROJECT.md (partnerzy, widżet, API) — hipotezy bez cennika |
| PDF do 10 slajdów | ❌ | Istniejący PDF pokazuje starszy interfejs — do odświeżenia |
| Film do 3 min w otwartym repozytorium | ❌ | Istniejące nagranie jest nieaktualne i nieopublikowane; publikacja wymaga decyzji zespołu |

## Wymagania techniczne (sekcja 5)

| Wymaganie | Stan | Uwagi |
| --- | --- | --- |
| Główny scenariusz: wyszukanie miejsca lub trasy + informacja o dostępności | ✅ | Zakładki Trasa i Odkrywaj |
| Architektura: pozyskanie danych oddzielone od prezentacji; jak dodać źródło, kategorię, obszar | ✅ | `docs/ARCHITECTURE.md`, skrypty `data:*` |
| Konkretne zbiory miejskie, sposób pobierania, częstotliwość, awaria źródła | ✅ | UMK dok_id=2848 (propozycja: co tydzień, przy awarii zostaje poprzedni plik); portal otwartych danych sprawdzony i opisany |
| Przy każdej informacji: źródło, data, status; zgłoszenia odróżnione | ✅ | Statusy: mapa, Urząd Miasta, deklaracja właściciela, zgłoszenie niezweryfikowane, dane demonstracyjne |
| Poprawianie błędnych danych | 🟡 | Zgłoszenie zdjęciem przy barierze i miejscu, edycja/usunięcie przez autora, formularz właściciela; brak moderacji |
| WCAG 2.2 AA: klawiatura, czytnik ekranu, kontrast, tekstowa alternatywa mapy | 🟡 | axe-core: 0 naruszeń w całym scenariuszu (telefon, desktop, widżet); lista jest równoważna mapie. Brak ręcznego testu VoiceOver na iPhonie |
| Uruchomienie i utrzymanie poza UMK (hosting, aktualizacje, bezpieczeństwo, zgłoszenia, koszty) | ✅ | PROJECT.md, ARCHITECTURE.md |
| Ochrona danych i bezpieczeństwo, bez informacji o niepełnosprawności | ✅ | Preferencje tylko w przeglądarce; profil „na wózku” to sposób poruszania się, opcjonalny; zdjęcia bez EXIF; e-mail partnera niepubliczny |
| Zależności, licencje, przeniesienie, kolejne miasto | ✅ | DATA-SOURCES.md, ARCHITECTURE.md |

## Testowanie i walidacja (sekcja 6)

| Wymaganie | Stan | Uwagi |
| --- | --- | --- |
| Demonstracja dla grupy: potrzeby, miejsce/trasa, bariery i udogodnienia | ✅ | Np. „na wózku, samochodem” Floriańska → Plac Centralny; „Odkrywaj → Muzea” |
| Skąd informacje, kiedy pozyskane, jak oznaczone niepełne/niezweryfikowane; dane przykładowe oznaczone | ✅ | Partner demonstracyjny jawnie oznaczony „Przykład” |
| Co najmniej jeden przypadek danych sprzecznych, niepełnych lub niedostępnego źródła | ✅ | Niepełne: „Brak danych: …” przy miejscach; sprzeczne: zgłoszenie użytkownika vs OSM daje ostrzeżenie (w realnych danych OSM+UMK sprzeczności obecnie 0 — do pokazu trzeba dodać zgłoszenie lub deklarację partnera); niedostępne: ortofotomapa/AI/rozkład dają komunikat, reszta działa |
| Kontrola dostępności głównego scenariusza, ograniczenia i plan | 🟡 | Automatyczna ✅; ręczna z VoiceOver ❌ (plan w PROJECT.md) |
| Plan przejścia od prototypu do usługi | ✅ | PROJECT.md |

## Do zrobienia przed zgłoszeniem

1. Odświeżyć PDF (≤10 slajdów) i nagrać film (≤3 min) na nowym interfejsie; zdecydować o publikacji repozytorium/filmu.
2. Ręczny test VoiceOver na iPhonie (HTTPS potrzebny dla aparatu i GPS).
3. Potwierdzić z mentorami wagi oceny (kryteria 25/20/15/20/20 vs regulamin 30/30/20/10/10) i warunki ponownego użycia zestawienia UMK.
