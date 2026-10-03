"""Create the Polish nine-slide PDF from actual local browser screenshots.

Usage: python3 scripts/build-competition.py [screenshot-directory]
Requires reportlab, fonttools and pillow; no credentials or network access.
"""
from pathlib import Path
import sys
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.lib.utils import ImageReader
from fontTools.ttLib import TTFont as Font
from fontTools.varLib.instancer import instantiateVariableFont
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'artifacts/competition/assets'
WORK = ROOT / 'artifacts/competition'
WORK.mkdir(parents=True, exist_ok=True)
for name, weight in [('Regular', 450), ('Bold', 700)]:
    font = instantiateVariableFont(Font(ROOT / 'public/fonts/manrope.ttf'), {'wght': weight})
    path = WORK / f'Manrope-{name}.ttf'
    font.save(path)
    pdfmetrics.registerFont(TTFont(name, str(path)))
pdfmetrics.registerFontFamily('Regular', normal='Regular', bold='Bold')
W, H = 960, 540
PAPER, INK, GREEN, MUTED, LIME, LINE, ORANGE = map(HexColor, ['#f6f3eb', '#243c30', '#245940', '#626b60', '#e1edaf', '#dddcd1', '#9b482b'])
OUT = ROOT / 'docs/competition/kazdy-krok.pdf'
c = canvas.Canvas(str(OUT), pagesize=(W, H))
c.setTitle('Każdy Krok / Every Step — Kraków Bez Barier')
c.setAuthor('Zespół Każdy Krok')
c.setSubject('Polska prezentacja lokalnego prototypu; 9 slajdów')

def text(value, x, y, width=840, size=18, color=INK, bold=False):
    style = ParagraphStyle('p', fontName='Bold' if bold else 'Regular', fontSize=size, leading=size*1.38, textColor=color)
    p = Paragraph(value, style)
    _, height = p.wrap(width, H)
    p.drawOn(c, x, y-height)
    return y-height

def page(number, eyebrow, title, subtitle=None):
    c.setFillColor(PAPER); c.rect(0, 0, W, H, fill=1, stroke=0)
    text('KAŻDY KROK / EVERY STEP', 42, 510, size=9, bold=True, color=GREEN)
    text(eyebrow.upper(), 42, 468, size=10, bold=True, color=MUTED)
    text(title, 42, 442, size=33, bold=True)
    if subtitle: text(subtitle, 42, 389, size=14, color=MUTED)
    c.setStrokeColor(LINE); c.line(42, 36, 918, 36)
    text('Kraków Bez Barier · lokalny prototyp · 3.10.2026', 42, 26, size=8, color=MUTED)
    text(f'{number:02d} / 09', 860, 26, width=60, size=8, color=MUTED)

def shot(name, x, y, width, height, crop=None):
    path = ASSETS / f'{name}.png'
    if not path.exists(): raise FileNotFoundError(path)
    im = Image.open(path).convert('RGB')
    if crop:
        # Crop coordinates are expressed against a 2880 px reference viewport.
        scale = im.width / 2880
        im = im.crop(tuple(round(v * scale) for v in crop))
    c.drawImage(ImageReader(im), x, y, width=width, height=height, preserveAspectRatio=True, anchor='c')

def item(title, body, y, width=390):
    y = text(title, 42, y, width=width, size=20, bold=True)
    return text(body, 42, y-9, width=width, size=15, color=MUTED)-25

# 1. The daily question, with an actual phone-sized view.
c.setFillColor(GREEN); c.rect(0, 0, W, H, fill=1, stroke=0)
text('KAŻDY KROK / EVERY STEP', 44, 497, size=12, bold=True, color=LIME)
text('Czy dam radę<br/>przejść tę trasę<br/>dzisiaj?', 44, 425, width=540, size=48, color=PAPER, bold=True)
text('Kraków dla osób z czasowo ograniczoną mobilnością,<br/>także w rehabilitacji.', 44, 207, width=530, size=19, color=PAPER)
text('Dzisiejsze potrzeby. Konkretne bariery. Jawna niepewność.', 44, 120, width=530, size=14, color=LIME)
shot('mobile', 625, 46, 275, 455)
text('Lokalny prototyp · Kraków Bez Barier · 01 / 09', 44, 28, size=9, color=PAPER)
c.showPage()

# 2. Needs without diagnosis.
page(2, 'Problem i użytkownik', 'Możliwości zmieniają się z dnia na dzień.')
y = item('Dziś zejście może być trudniejsze.', 'Schody w dół i w górę są osobnymi preferencjami. Nie pytamy o diagnozę.', 360)
y = item('Krótki spacer, poręcz, odpoczynek.', 'Użytkownik określa dzisiejszy dystans i znaczenie oznaczonych poręczy oraz ławek.', y)
item('AI pomaga nazwać potrzeby.', 'Szkic w języku naturalnym trafia do formularza. Użytkownik może go zmienić przed zastosowaniem.', y)
shot('app', 467, 73, 450, 295)
c.showPage()

# 3. An explainable measured example.
page(3, 'Działający scenariusz Wawelu', '31 metrów różnicy. Inny wysiłek.', 'Podzamcze → Smok Wawelski · dwa rzeczywiste przebiegi z migawki OSM')
text('409 m', 45, 333, size=49, color=GREEN, bold=True)
text('Bez schodów oznaczonych na grafie', 45, 264, width=360, size=17, bold=True)
text('378 m', 45, 203, size=49, color=ORANGE, bold=True)
text('Jeden odcinek schodów · w górę', 45, 134, width=380, size=17, bold=True)
shot('wawel', 453, 103, 465, 254, crop=(810, 0, 2800, 1120))
text('Odwrócenie trasy odwraca kierunek schodów. Dystans to suma geometrii węzłów, nie pomiar terenowy. Brak oznaczonych schodów nie wyklucza nieznanych barier.', 454, 91, width=455, size=10, color=MUTED)
c.showPage()

# 4. Whole-city search and planned transport, not fabricated live data.
page(4, 'Kraków i komunikacja miejska', 'Od adresu do adresu. Z dojściami pieszymi.')
y = item('Wyszukaj adres, miejsce lub przystanek.', 'Nominatim / OSM i lokalne przystanki ZTP. Można zamienić start z celem, datę i godzinę.', 361)
y = item('Porównaj chodzenie z tramwajem lub autobusem.', 'Wszystkie trzy feedy GTFS ZTP, obliczone dojścia i do jednej przesiadki na tym samym stanowisku.', y)
text('<b>Przykład: okolice dworca → Plac Centralny</b><br/>7 536 m bez oznaczonych schodów lub 7 111 m z 8 odcinkami. Wariant KMK skraca dystans pieszy do około 0,5 km w sprawdzonym rozkładzie.', 42, y, width=398, size=14)
shot('city', 470, 88, 448, 287, crop=(810, 0, 2800, 1340))
text('Rozkład planowy, bez opóźnień i odwołań na żywo. Obszar grafu obejmuje Kraków i najbliższą okolicę; wiedza o barierach pozostaje niepełna.', 470, 81, width=448, size=10, color=MUTED)
c.showPage()

# 5. Provenance and responsible unknowns.
page(5, 'Źródła i wiarygodność', 'Wiesz, co wiemy. Wiesz, czego nie wiemy.')
y = item('OSM / Geofabrik', 'Schody, kierunki, poręcze, nawierzchnia, ławki i wejścia. Pozyskanie i edycja są osobnymi datami.', 358)
y = item('ZTP, GUGiK i konkretne źródło UMK', 'Rozkłady planowe, ortofotomapa oraz linkowany opis wejścia przy Stachowicza 18. Brak deklaracji bieżącego działania windy.', y)
item('„Nieznane” to informacja.', 'Data ostatniego potwierdzenia terenowego pozostaje nieznana. Zgłoszenia użytkowników nie nadpisują mapy automatycznie.', y)
shot('facts', 463, 102, 455, 269, crop=(820, 0, 2800, 1280))
text('OSM: © OpenStreetMap contributors, ODbL. Pozostałe źródła i warunki: docs/DATA-SOURCES.md. MSIP i portal miejski sprawdzono jako katalogi; nie ustalono kompletnej bazy barier.', 462, 85, width=455, size=10, color=MUTED)
c.showPage()

# 6. Human review is part of the flow.
page(6, 'AI i wygodne zgłaszanie', 'Zdjęcie → szkic → poprawka → zgłoszenie.')
y = item('Jedno zdjęcie na żądanie.', 'Aparat lub plik, świadoma zgoda na AI. Zdjęcie jest zmniejszane i pozbawiane metadanych EXIF.', 360)
y = item('Obserwacja, nie gwarancja.', 'AI nie określa dokładnych wymiarów ani nachylenia. Użytkownik poprawia opis i potwierdza treść.', y)
item('Trwały zapis jako niezweryfikowane.', 'Raport ze zdjęciem trafia do SQLite. Zatwierdzenie opisu przez użytkownika nie jest audytem terenowym.', y)
shot('report', 460, 95, 456, 278, crop=(75, 0, 1780, 1300))
text('Zdjęcie na ekranie jest oznaczoną ilustracją testową, nie obserwacją z Krakowa. Nakładka aparatu/GPS jest przybliżona; nie jest precyzyjnym AR.', 460, 80, width=456, size=10, color=MUTED)
c.showPage()

# 7. Architecture: deterministic routing plus constrained assistance.
page(7, 'Architektura', 'Fakty i algorytmy tworzą przebieg. AI go objaśnia.')
rows = [
 ('Dane', 'Migawka OSM/Geofabrik + cache GTFS ZTP. Źródła, daty, status i nieznane pola.'),
 ('Routing', 'Graf pieszy, Dijkstra i jawne koszty. Scan rozkładu z obliczonymi dojściami.'),
 ('AI na serwerze', 'Responses API + Zod: preferencje, wybór podanych faktów, szkic zdjęcia i kontekst z góry.'),
 ('Interfejs', 'Next.js / TypeScript, shadcn/ui, Leaflet, polski ekran telefonu i równoważna lista.'),
 ('Raporty', 'SQLite WAL, walidacja, usunięcie EXIF, jawne potwierdzenie i status unverified.'),
]
y=364
for name, body in rows:
    c.setStrokeColor(LINE);c.line(42,y+5,917,y+5)
    text(name,42,y-6,width=165,size=17,bold=True)
    text(body,225,y-6,width=690,size=15,color=MUTED)
    y-=57
text('Awaria AI nie blokuje formularzy ani lokalnych tras. Ortofotomapa daje tylko edytowalny kontekst, bez zmiany grafu i bez oceny dostępności.', 42, 69, width=855, size=12, color=GREEN)
c.showPage()

# 8. A practical hypothesis, not invented traction.
page(8, 'Model biznesowy', 'Hotel lub wydarzenie: „Jak dojść dzisiaj?”')
text('Partner osadza widget lub link przy rezerwacji.<br/>Gość wybiera swoje potrzeby bez konta i diagnozy.',42,360,width=820,size=24,bold=True)
y=253
for x,title,body in [(42,'Abonament B2B','Widget, obsługa zgłoszeń i aktualizacje źródeł.'),(346,'Wejście partnera','Źródłowy opis, data aktualizacji i osobny audyt terenowy.'),(650,'Operator usługi','Hosting, AI, kopie danych, moderacja i integracje.')]:
    text(title,x,y,width=250,size=19,bold=True)
    text(body,x,y-42,width=250,size=16,color=MUTED)
text('Hipoteza do pilotażu, bez deklarowania klientów i cennika.<br/>Panel partnera i gotowy widget są kolejnym etapem.',42,102,width=810,size=15,color=GREEN)
c.showPage()

# 9. Honest validation and concrete next steps.
page(9, 'Gotowość i dalsze kroki', 'Działający MVP. Kolejny krok: teren i użytkownicy.')
text('29 testów',42,359,width=350,size=43,color=GREEN,bold=True)
text('Routing, kierunki, kalendarze GTFS, schematy, trwałość, EXIF i błędy. Build i TypeScript przechodzą.',42,294,width=385,size=17)
text('Rzeczywiste przepływy AI i przeglądarki.',42,204,width=385,size=20,bold=True)
text('Telefonowy i komputerowy viewport, zapis/odczyt/usunięcie zgłoszenia. Otwarcie w Safari na symulatorze iPhone.',42,165,width=385,size=16,color=MUTED)
text('Pilotaż',500,361,width=370,size=26,bold=True)
y=310
for line in ['1. Test fizycznego iPhone’a i VoiceOver.', '2. Audyt tras i wejść z użytkownikami w rehabilitacji.', '3. Moderacja, role partnerów i retencja.', '4. Produkcyjny indeks przestrzenny i aktualizacje.']:
    y=text(line,500,y,width=390,size=18)-20
text('Wyróżnik: codzienne potrzeby odzyskiwania sprawności i jawna niepewność. Korzystamy z dorobku AccessMap / Project Sidewalk; nie deklarujemy wynalezienia routingu dostępnościowego.',42,76,width=861,size=11,color=MUTED)
c.showPage()
c.save()
print(f'Created {OUT.relative_to(ROOT)} — 9 slides')
