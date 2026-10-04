# Materiały konkursowe — Każdy Krok (HackYeah 2026, „Kraków bez barier”)

Wszystkie zrzuty i nagrania pochodzą z działającej aplikacji (Next.js 16, MapLibre GL, własny graf pieszy z OSM, rozkład ZTP GTFS). Zgłoszenia pokazane w panelu miasta to dane testowe na lokalnej, osobnej instancji. Materiały nie zostały nigdzie przesłane ani opublikowane.

| Plik | Co to jest | Limit z regulaminu |
| --- | --- | --- |
| `kazdy-krok.pdf` | Prezentacja po polsku, 16:9, **10 slajdów** | maks. 10 slajdów |
| `demo.mp4` | Demo po polsku z napisami wtopionymi w obraz, 1920×1080, H.264/yuv420p, faststart, **ok. 2:28** | maks. 3 minuty |
| `demo.srt` | Te same napisy jako osobny plik (UTF-8) | — |
| [PROJECT.md](PROJECT.md) | Opis projektu do formularza: problem, prototyp, dane, model biznesowy, pilotaż, utrzymanie | — |

## Slajdy

1. Czy dam radę przejść tę trasę dzisiaj? (tytuł)
2. „Dostępne / niedostępne” nie mówi, czy dam radę dzisiaj (problem i użytkownicy)
3. Anna, o kulach: z Dworca Głównego na Wawel i z powrotem (scenariusz: potrzeby → trasa → bariery → kierunek schodów)
4. Każdy fakt ma źródło i datę. Brak danych zostaje brakiem (wiarygodność danych)
5. Z lotu ptaka: jak dojść i wejść, zanim wyjdziesz z domu (efekt WOW, zmierzona dokładność)
6. Zgłoszenie jednym zdjęciem wraca do mapy jako poprawka (społeczność i panel miasta)
7. Pozyskanie danych oddzielone od prezentacji (architektura, odświeżanie, awarie, nowe miasto, wdrożenie)
8. Bezpłatne dla ludzi. Płacą obiekty, miasto i platformy (model biznesowy — hipotezy)
9. Projektowane pod WCAG 2.2 AA. Bez kont, bez diagnozy (dostępność cyfrowa i prywatność, z tym, czego jeszcze nie sprawdzono)
10. 10 tygodni na Starym Mieście i Kazimierzu (pilotaż, mierniki, prośba)

Liczby na slajdach pochodzą z `docs/VALIDATION.md`, `docs/ARCHITECTURE.md`, `docs/DATA-SOURCES.md` i `PROJECT.md`; ceny, koszty i cele pilotażu są tam oznaczone jako hipotezy i tak samo opisane na slajdach.

## Film (kolejność)

Potrzeby opisane własnymi słowami → poprawka kierunku schodów → warianty Dworzec Główny → Wawel z paskiem barier → krok po kroku (schody w górę 25 stopni z poręczą, ławka po 10 min, toalety) → źródło i daty faktu → droga powrotna: te same schody w dół, wariant „nie pasuje” → miejsce z różnymi wejściami i „brak danych” o parkingu, pochodzenie danych → Filharmonia bez danych → widok z lotu ptaka i wskazówki AI → zgłoszenie zdjęciem testowym (zapisane i od razu usunięte tokenem autora) → widżet na przykładowej stronie hotelu → panel miasta (dane testowe) → karta końcowa.

## Jak odtworzyć po zmianach interfejsu

Potrzebne: działający serwer aplikacji (domyślnie `http://localhost:3030`), Chromium dla `playwright-core`, `ffmpeg`, Python 3 z `reportlab`, `fonttools`, `Pillow`.

```sh
# (opcjonalnie) osobna instancja dla panelu miasta z własnym magazynem zgłoszeń i hasłem testowym
CITY_DASHBOARD_PASSWORD=pokaz-lokalny KROK_STORAGE_DIR=/tmp/kk-comp-runtime npx next dev -p 3140   # w kopii repozytorium

# 1. zrzuty ekranu (telefon 390×844 i desktop 1440×900, 2×) → artifacts/competition/assets/
CITY_URL=http://localhost:3140 CITY_PASSWORD=pokaz-lokalny node scripts/capture-competition.mjs shots http://localhost:3030
#    pojedyncze sceny: ONLY=routes,place,aerial …

# 2. prezentacja → docs/competition/kazdy-krok.pdf
python3 scripts/build-competition.py

# 3. surowe nagranie (telefon + desktop) → artifacts/competition/video/raw/, potem montaż → demo.mp4 + demo.srt
CITY_URL=http://localhost:3140 CITY_PASSWORD=pokaz-lokalny node scripts/capture-competition.mjs video http://localhost:3030
#    VIDEO_PART=phone albo VIDEO_PART=desktop nagrywa ponownie tylko jedną część
python3 scripts/competition-video.py
```

Skrypty czekają na treść (nagłówki, koniec odczytu z lotu ptaka, zapis zgłoszenia), a nie na stałe opóźnienia. Gdy serwer deweloperski przeładuje stronę w trakcie nagrania, ujęcie jest powtarzane. Scena zgłoszenia tworzy jedno zgłoszenie ze sztucznym zdjęciem schodów i usuwa je tokenem autora. Panel miasta jest pomijany bez `CITY_URL` i `CITY_PASSWORD`; nie należy wskazywać instancji produkcyjnej. Montaż sprawdza limit: przy surowym materiale dłuższym niż 170 s przyspiesza całość równomiernie.

## Do uzupełnienia przed wysłaniem

Identyfikator zespołu nie został podany; należy dodać go w formularzu zgłoszenia. Kryteria wymagają filmu w otwartym repozytorium; publikacja wymaga osobnej decyzji zespołu. Nie zaakceptowano umów i nie przeniesiono praw.
