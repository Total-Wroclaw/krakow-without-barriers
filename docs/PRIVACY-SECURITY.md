# Ochrona danych i bezpieczeństwo — streszczenie

Stan na 4 października 2026. Pełny, docelowy opis: [`compliance/Polityka_ochrony_danych_Kazdy_Krok.docx`](compliance/Polityka_ochrony_danych_Kazdy_Krok.docx). Polityka opisuje wersję docelową; to streszczenie rozdziela, co **sprawdzono w kodzie prototypu**, od tego, co jest tylko planem. Nie jest to opinia prawna ani ocena skutków dla ochrony danych (DPIA).

Administrator danych **nie jest jeszcze wskazany** (operator: „do wskazania”). Do tego czasu aplikacja nie powinna być uruchamiana dla szerokiej publiczności.

## Działa w prototypie

Każdy punkt sprawdzono w kodzie (ścieżka w nawiasie).

**Dane użytkownika**
- Brak kont i rejestracji; nie pytamy o diagnozę ani orzeczenie. Profil „na wózku / o kulach” to opcjonalny sposób poruszania się. Brak plików cookie śledzących i zewnętrznych skryptów analitycznych (`src/lib/i18n/messages.ts`, `about.privacy.*`; w `package.json` brak narzędzi analitycznych).
- Preferencje, ostatnie miejsca, język i klucze edycji zgłoszeń są w `localStorage`/`sessionStorage` przeglądarki. Serwer dostaje je tylko jako parametry konkretnego żądania trasy; nie ma historii tras ani śladu GPS.
- Przycisk „Usuń dane z tej przeglądarki” w „O aplikacji” kasuje klucze `krok-*` z obu magazynów (`src/components/planner/About.tsx`).
- Link do udostępnienia trasy zawiera tylko start, cel, środek transportu i termin, bez preferencji (`src/lib/trip-sharing.ts`, `writeTrip`).
- Punkty (trasa, zgłoszenie, odczyt z lotu ptaka) są walidowane na serwerze do obszaru Krakowa (`src/lib/city-types.ts`, `pointSchema`).

**Zgłoszenia i zdjęcia**
- Zdjęcie jest zmniejszane do 1400 px i ponownie kodowane w przeglądarce (`src/components/planner/Reports.tsx`), a serwer niezależnie dekoduje je i koduje ponownie przez `sharp` (limit 25 Mpx, 3 MB, tylko JPEG/PNG/WebP), co usuwa EXIF i GPS; oryginał nie jest zapisywany (`src/lib/server.ts`, `photoBytes`).
- Publikacja zdjęcia jest bramkowana: model zwraca `people` (`none` / `present` / `unclear`); zdjęcie jest publiczne tylko przy `none`, przy `present`, `unclear` i awarii AI jest ukryte do decyzji urzędu (`src/lib/report-photos.ts`, `initialVisibility`; `src/lib/ai.ts`).
- Token edycji: 32 losowe bajty, zwracany raz; w bazie tylko skrót SHA-256 w osobnej kolumnie, porównanie w stałym czasie; zmiana, usunięcie i dodanie zdjęć wymagają nagłówka `x-report-token` (`src/lib/reports-server.ts`). Autor może poprawić opis, komentarz i cel albo usunąć zgłoszenie razem ze zdjęciami.
- Przed wysłaniem użytkownik widzi komunikat, że opis, cel i zdjęcia są publiczne i widoczne dla urzędu oraz żeby nie podawać danych osobowych (`report.publicNote`). Zgłoszenia mają status „niezweryfikowane”; do 4 zdjęć, opis do 800 znaków.
- Ponawianie wysyłki z tym samym identyfikatorem nie tworzy duplikatów, a cudzy identyfikator jest odrzucany.

**Partnerzy**
- E-mail kontaktowy jest zapisywany tylko w bazie i nie jest zwracany w żadnej odpowiedzi API (`src/lib/objects.ts`). Wpis ma status „deklaracja właściciela” i `confirmedAt: null`.
- Poprawa i wycofanie deklaracji bez kont: utworzenie zwraca raz token edycji (32 losowe bajty); w bazie (`partner_objects.edit_hash`) tylko skrót SHA-256, porównanie w stałym czasie, ten sam mechanizm co przy zgłoszeniach. Przeglądarka trzyma token w `localStorage` (`krok-partner-tokens-v1`, czyści go „Usuń dane z tej przeglądarki”). `GET`/`PATCH`/`DELETE /api/partners/objects/[id]` wymagają nagłówka `x-partner-token` (403 przy złym tokenie, 404 dla nieznanej lub wycofanej deklaracji); `GET` zwraca właścicielowi jego własny rekord z e-mailem tylko do wypełnienia formularza. Wycofanie to usunięcie miękkie: deklaracja znika z katalogu, wiersz zostaje do audytu, a e-mail kontaktowy jest z niego usuwany. Dane demonstracyjne partnera nie są edytowalne. Token dowodzi tylko, że to ta sama przeglądarka, która wysłała deklarację; nie dowodzi własności obiektu, a po utracie przeglądarki nie ma odzyskiwania.
- Miasto może ukryć fałszywą deklarację w panelu `/city` (i przywrócić ją): ukryta nie trafia do katalogu, ale zostaje w bazie (`hidden_at`). Ukrycie przez miasto nie jest cofane przez poprawkę właściciela.

**Panel miasta `/city`**
- Jedno wspólne hasło (`CITY_DASHBOARD_PASSWORD`) wymieniane na podpisane ciasteczko sesji (HMAC-SHA256, 12 h, `HttpOnly`, `SameSite=Strict`, `Secure` w produkcji), porównania w stałym czasie. Brak hasła w konfiguracji wyłącza panel (`src/lib/city-auth.ts`).
- Limit nieudanych logowań: 5 na 15 min na klienta, plus globalne opóźnienie przy masowych próbach.

**Infrastruktura i API**
- Nagłówki: HSTS (`max-age=63072000; includeSubDomains`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (kamera i geolokalizacja tylko dla własnej domeny), `X-Frame-Options: SAMEORIGIN` i `frame-ancestors 'self'`; `/embed` celowo osadzalny wszędzie (`frame-ancestors *`) (`next.config.ts`). Potwierdzone w odpowiedzi działającej instalacji (4.10.2026, przez Cloudflare).
- Ochrona przed żądaniami z innych witryn (kontrola `Origin`/`Sec-Fetch-Site`), limit rozmiaru żądania 5 MB, walidacja Zod wejść, parametryzowane zapytania SQL (`src/lib/server.ts`, `guard`).
- Limit 20 zapytań AI na minutę z jednego adresu IP (w pamięci procesu; adres z `CF-Connecting-IP` lub ostatniego wpisu `X-Forwarded-For`, `src/lib/client-ip.ts`).
- Zapytania do OpenAI z `store: false`; klucz API tylko w pamięci serwera, ze zmiennej środowiskowej. To prośba do dostawcy, nie deklaracja zerowej retencji.
- Zapytania o adresy i miejsca nie opuszczają serwera (lokalny indeks), brak Nominatim.
- Mapa: przeglądarka łączy się bezpośrednio z OpenFreeMap; ortofotomapa GUGiK jest pobierana przez serwer. Kafelki ortofotomapy są buforowane na dysku.

## Planowane przed wdrożeniem

- Wskazanie administratora, kontaktu i podstaw prawnych; klauzula informacyjna art. 13 RODO w aplikacji (dziś jest krótki opis „Prywatność” bez danych administratora); ocena potrzeby DPIA; rejestr podprocesorów.
- Umowa powierzenia z dostawcą AI i potwierdzone warunki retencji (w tym tryb zerowej retencji, jeśli ma być deklarowany); ocena transferów poza EOG.
- Serwerowe skanowanie plików i **automatyczne zamazywanie twarzy i tablic** (polityka je opisuje; prototyp tylko ukrywa zdjęcia z osobami do decyzji urzędu).
- Szyfrowanie danych w spoczynku, szyfrowane kopie zapasowe i test odtworzenia, menedżer sekretów z rotacją.
- Panel urzędu: SSO, role, MFA, dziennik zmian z identyfikatorem autora (dziś jedno wspólne hasło, bez ról i bez śladu autora).
- Moderacja zgłoszeń i kolejka do przeglądu; konta partnerów z weryfikacją własności wpisu (dziś miasto ręcznie ukrywa fałszywe deklaracje, bez kolejki i bez historii zmian).
- Automatyczna retencja: usuwanie zdjęć, komentarza i celu 12 miesięcy po zamknięciu zgłoszenia (dziś brak mechanizmu).
- Ścisła polityka CSP dla skryptów i stylów (dziś tylko ograniczenie osadzania w ramkach, bo MapLibre potrzebuje `blob:`), logi bez treści zgłoszeń, PostgreSQL/PostGIS zamiast SQLite, limity zapytań na proxy zamiast w pamięci procesu.
- Wymuszenie HTTPS, przekierowanie HTTP i minimalne TLS 1.2 na poziomie proxy; automatyczne odnawianie certyfikatów.

## Znane ograniczenia

- **Partnerzy bez weryfikacji własności:** każdy może zgłosić obiekt i wybrać pakiet; wpisy są oznaczone jako „deklaracja właściciela, bez weryfikacji”, ale ich autorstwo nie jest sprawdzane. Token edycji pozwala poprawić lub wycofać wpis tylko z tej samej przeglądarki; osoba, która podała się za właściciela, może więc zostawić nieprawdziwą deklarację, dopóki miasto jej nie ukryje.
- **Publiczne pola tekstowe:** opis, komentarz i cel zgłoszenia są publiczne; model i filtr ograniczają część danych osobowych, ale nie gwarantują ich wykrycia. Użytkownik jest tylko proszony o niewpisywanie danych osobowych.
- **Brak automatycznego zamazywania twarzy i tablic.** Zdjęcie z osobą jest ukrywane, a nie przetwarzane; ocena „brak osób” pochodzi z modelu i może być błędna.
- **Retencja nie jest egzekwowana automatycznie**; zgłoszenia i zdjęcia zostają do usunięcia przez autora lub urząd.
- **Wspólne hasło urzędu**, brak ról, MFA i dziennika audytu; limity logowania i zapytań są w pamięci procesu (zerują się po restarcie, a przy wielu instancjach nie są wspólne).
- **Treści trafiają do dostawcy AI** (zdjęcie zgłoszenia, wycinek ortofotomapy, opis potrzeb) przy jawnej akcji użytkownika; bez umowy powierzenia i potwierdzonej retencji produkcyjne użycie nie jest uzasadnione.
- Tokeny edycji leżą w przeglądarce; usunięcie danych z przeglądarki odbiera autorowi możliwość edycji (zgłoszenie można wtedy usunąć tylko przez urząd lub na wniosek).
- Nie przeprowadzono testów penetracyjnych ani audytu bezpieczeństwa.
