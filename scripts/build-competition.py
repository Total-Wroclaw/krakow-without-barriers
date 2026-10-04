"""Build the Polish 10-slide competition deck (16:9 PDF) from real screenshots of the running app.

Usage: python3 scripts/build-competition.py [assets-dir]
  assets-dir defaults to artifacts/competition/assets (made by `node scripts/capture-competition.mjs shots`).
Output: docs/competition/kazdy-krok.pdf
Requires reportlab, fonttools and Pillow. Font: Atkinson Hyperlegible Next (OFL), downloaded once from the
google/fonts repository into artifacts/competition/fonts; falls back to public/fonts/manrope.ttf offline.
Numbers on the slides come from docs/VALIDATION.md, docs/ARCHITECTURE.md and docs/competition/PROJECT.md
(business figures there are labelled hypotheses, and so they are here).
"""
from pathlib import Path
import sys
import urllib.request
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor, Color
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.lib.utils import ImageReader
from fontTools.ttLib import TTFont as Font
from fontTools.varLib.instancer import instantiateVariableFont
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'artifacts/competition/assets'
WORK = ROOT / 'artifacts/competition'
FONTS = WORK / 'fonts'
OUT = ROOT / 'docs/competition/kazdy-krok.pdf'
FONT_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/atkinsonhyperlegiblenext/AtkinsonHyperlegibleNext%5Bwght%5D.ttf'
TOTAL = 10

# ---------- fonts ----------
FONTS.mkdir(parents=True, exist_ok=True)
variable = FONTS / 'AtkinsonHyperlegibleNext-VF.ttf'
if not variable.exists():
    try:
        urllib.request.urlretrieve(FONT_URL, variable)
    except Exception:
        variable = ROOT / 'public/fonts/manrope.ttf'
FAMILY = 'Atkinson' if 'Atkinson' in variable.name else 'Manrope'
for name, weight in [('Regular', 400), ('Semi', 600), ('Bold', 700), ('Black', 800)]:
    path = FONTS / f'{FAMILY}-{name}-{weight}.ttf'
    if not path.exists():
        static = instantiateVariableFont(Font(variable), {'wght': weight})
        # Unique internal names, otherwise the PDF embeds every weight as the same face.
        for record in static['name'].names:
            if record.nameID in (1, 3, 4, 6, 16):
                record.string = f'{FAMILY}{name}' if record.nameID in (6, 3) else f'{FAMILY} {name}'
        static.save(path)
    pdfmetrics.registerFont(TTFont(name, str(path)))
pdfmetrics.registerFontFamily('Regular', normal='Regular', bold='Bold')

# ---------- palette (src/app/globals.css) ----------
INK, CANVAS, SURFACE = HexColor('#14213d'), HexColor('#eef1f5'), HexColor('#ffffff')
BLUE, RED, TEAL, TEAL_SOFT = HexColor('#2443b0'), HexColor('#c4122f'), HexColor('#0f766e'), HexColor('#d5f0ec')
AMBER, AMBER_SOFT, PURPLE, VIOLET = HexColor('#a1460a'), HexColor('#fdecc8'), HexColor('#7a3e9d'), HexColor('#6d28d9')
MUTED, BORDER, ACCENT, NAVY = HexColor('#4a5672'), HexColor('#d3d9e3'), HexColor('#e3e9fb'), HexColor('#0d1730')
LIGHT_ON_DARK, SOFT_ON_DARK = HexColor('#e3e8f5'), HexColor('#9fb0d6')

W, H = 960, 540
c = canvas.Canvas(str(OUT), pagesize=(W, H))
c.setTitle('Każdy Krok — Kraków bez barier')
c.setAuthor('Zespół Każdy Krok')
c.setSubject('Prezentacja konkursowa HackYeah 2026, wyzwanie „Kraków bez barier”; 10 slajdów')


# ---------- primitives ----------
def para(value, x, y, width, size=16, color=INK, font='Regular', leading=1.3, align=0):
    style = ParagraphStyle('p', fontName=font, fontSize=size, leading=size * leading, textColor=color, alignment=align)
    p = Paragraph(value, style)
    _, h = p.wrap(width, H)
    p.drawOn(c, x, y - h)
    return y - h


def rect(x, y, w, h, fill, r=12, stroke=None, width=1):
    c.setFillColor(fill)
    if stroke:
        c.setStrokeColor(stroke)
        c.setLineWidth(width)
    c.roundRect(x, y, w, h, r, fill=1, stroke=1 if stroke else 0)


def image(name, x, y, w=None, h=None, crop=None, r=10, frame=None):
    """Draw a screenshot into a box; crop=(left, top, right, bottom) in CSS px of the 2× capture."""
    path = ASSETS / f'{name}.png'
    if not path.exists():
        raise FileNotFoundError(f'{path} — run: node scripts/capture-competition.mjs shots')
    im = Image.open(path).convert('RGB')
    if crop:
        im = im.crop(tuple(round(v * 2) for v in crop))
    ratio = im.width / im.height
    if w and not h:
        h = w / ratio
    elif h and not w:
        w = h * ratio
    if frame:
        rect(x - 5, y - 5, w + 10, h + 10, frame, r + 5)
    c.saveState()
    p = c.beginPath()
    p.roundRect(x, y, w, h, r)
    c.clipPath(p, stroke=0, fill=0)
    c.drawImage(ImageReader(im), x, y, w, h)
    c.restoreState()
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.6)
    c.roundRect(x, y, w, h, r, fill=0, stroke=1)
    return w, h


def phone(name, x, y, h, crop=None, dark=False):
    """A phone screenshot in a slim device frame."""
    return image(name, x, y, h=h, crop=crop, r=14, frame=HexColor('#060b18') if dark else INK)


def header(n, eyebrow, title, color=BLUE, dark=False, width=880):
    c.setFillColor(NAVY if dark else CANVAS)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillColor(color)
    c.rect(40, 496, 26, 4, fill=1, stroke=0)
    para(eyebrow.upper(), 74, 504, 600, size=10.5, color=SOFT_ON_DARK if dark else color, font='Bold')
    end = para(title, 40, 484, width, size=29, color=SURFACE if dark else INK, font='Black', leading=1.12)
    footer(n, dark)
    return end


def footer(n, dark=False, source=None):
    col = SOFT_ON_DARK if dark else MUTED
    para('Każdy Krok · Kraków bez barier · HackYeah 2026', 40, 24, 400, size=8.5, color=col)
    para(f'{n:02d} / {TOTAL:02d}', 880, 24, 40, size=8.5, color=col, font='Bold', align=2)


def source(text, dark=False):
    para(text, 470, 24, 400, size=8.5, color=SOFT_ON_DARK if dark else MUTED, align=2)


def chip(text, x, y, fill, color, size=11.5, pad=8):
    w = pdfmetrics.stringWidth(text, 'Bold', size) + 2 * pad
    rect(x, y, w, size + 2 * pad - 4, fill, r=(size + 2 * pad - 4) / 2)
    c.setFillColor(color)
    c.setFont('Bold', size)
    c.drawString(x + pad, y + pad - 1, text)
    return w


def number(value, label, x, y, w, color=SURFACE, sub=SOFT_ON_DARK, size=34):
    para(value, x, y, w, size=size, color=color, font='Black', leading=1.0)
    return para(label, x, y - size - 4, w, size=11.5, color=sub, leading=1.3)


def bullet_list(items, x, y, w, size=14, color=INK, dot=BLUE, gap=8, leading=1.3):
    for item in items:
        c.setFillColor(dot)
        c.circle(x + 4, y - size * 0.62, 3.2, fill=1, stroke=0)
        y = para(item, x + 16, y, w - 16, size=size, color=color, leading=leading) - gap
    return y


def arrow(x1, y, x2, color=MUTED):
    c.setStrokeColor(color)
    c.setFillColor(color)
    c.setLineWidth(1.6)
    c.line(x1, y, x2 - 6, y)
    p = c.beginPath()
    p.moveTo(x2, y)
    p.lineTo(x2 - 7, y + 4.5)
    p.lineTo(x2 - 7, y - 4.5)
    p.close()
    c.drawPath(p, fill=1, stroke=0)


# ---------- 1. title ----------
c.setFillColor(NAVY)
c.rect(0, 0, W, H, fill=1, stroke=0)
c.setFillColor(RED)
c.rect(48, 440, 60, 5, fill=1, stroke=0)
para('KAŻDY KROK · KRAKÓW BEZ BARIER', 48, 478, 500, size=12, color=SOFT_ON_DARK, font='Bold')
y = para('Czy dam radę przejść tę trasę dzisiaj?', 48, 424, 520, size=46, color=SURFACE, font='Black', leading=1.06)
y = para('Planer tras i miejsc w Krakowie dla osób, których możliwości ruchowe zmieniają się z dnia na dzień: '
         'po urazie, o kulach, na wózku, z wózkiem dziecięcym.', 48, y - 18, 500, size=17, color=LIGHT_ON_DARK, leading=1.35)
yy = y - 40
for text, fill, col in [('Potrzeby, nie diagnoza', HexColor('#24356a'), SURFACE),
                        ('Bariery tam, gdzie występują', HexColor('#24356a'), SURFACE),
                        ('Źródło i data przy każdym fakcie', HexColor('#24356a'), SURFACE)]:
    chip(text, 48, yy, fill, col, size=12)
    yy -= 32
para('Działający prototyp: <b>kazdy-krok.antek.page</b> · telefon i komputer · PL / EN / DE · bez konta',
     48, 62, 520, size=11.5, color=SOFT_ON_DARK)
phone('phone-routes', 600, 52, 420, dark=True)
phone('phone-detail-steps', 772, 92, 380, dark=True)
para(f'01 / {TOTAL:02d}', 880, 24, 40, size=8.5, color=SOFT_ON_DARK, font='Bold', align=2)
c.showPage()

# ---------- 2. problem and users ----------
y = header(2, 'Problem i użytkownicy', '„Dostępne / niedostępne” nie mówi, czy dam radę <font color="#2443b0">dzisiaj</font>.', width=860)
cards = [
    ('Po urazie, w rehabilitacji', 'Schody w dół bolą bardziej niż w górę. Dystans, który dziś jest możliwy, za tydzień będzie inny.', AMBER, AMBER_SOFT),
    ('Na wózku', 'Każdy stopień, wysoki krawężnik, bruk i wąskie przejście decyduje o trasie.', BLUE, ACCENT),
    ('Z wózkiem dziecięcym', 'Jeden lub dwa stopnie da się pokonać, długie schody już nie. Potrzebna winda i toaleta.', TEAL, TEAL_SOFT),
]
cy = y - 22
for title, body, col, soft in cards:
    rect(40, cy - 82, 410, 82, SURFACE, r=12)
    c.setFillColor(col)
    c.rect(40, cy - 82, 5, 82, fill=1, stroke=0)
    para(title, 60, cy - 12, 380, size=15.5, font='Bold', color=col)
    para(body, 60, cy - 34, 375, size=12.5, color=INK, leading=1.3)
    cy -= 96
para('Cztery sposoby poruszania się: pieszo, o kulach, na wózku, z wózkiem dziecięcym. '
     '<b>Pytamy o potrzeby, nie o powody. Bez konta.</b>', 40, cy - 6, 430, size=13.5, color=INK, leading=1.35)
image('desktop-needs-settings', 500, 96, h=350, crop=(1000, 0, 1440, 760), r=12)
para('Ekran „Jak idziesz dzisiaj?”: schody osobno w górę i w dół, poręcze, odpoczynek co N minut, toalety, dystans. '
     'Można też opisać potrzeby własnymi słowami; AI zamienia opis na te same ustawienia.', 500, 86, 420, size=10.5, color=MUTED, leading=1.3)
source('Zrzut z działającej aplikacji')
c.showPage()

# ---------- 3. live scenario ----------
y = header(3, 'Scenariusz demonstracji', 'Anna, o kulach: z Dworca Głównego na Wawel i z powrotem')
steps = [
    ('phone-needs-ai', '1', 'Potrzeby', 'Opis własnymi słowami, z niego ustawienia: o kulach, bez schodów w dół, przerwa co 10 min, toalety.', None),
    ('phone-routes', '2', 'Trasy', 'Pasek barier: schody, ławki i przerwy w miejscu, gdzie występują.', None),
    ('phone-detail-steps', '3', 'Krok po kroku', 'Schody w górę: 25 stopni, z poręczą (OSM). Ławka po 10 min.', None),
    ('phone-walk-back', '4', 'Powrót', 'Te same schody są teraz w dół: wariant „nie pasuje do dzisiaj”.', None),
]
x = 40
for name, num, title, body, crop in steps:
    phone(name, x + 10, 150, 262)
    c.setFillColor(RED if num == '4' else BLUE)
    c.circle(x + 18, 132, 10, fill=1, stroke=0)
    c.setFillColor(SURFACE)
    c.setFont('Bold', 11)
    c.drawCentredString(x + 18, 128, num)
    para(title, x + 34, 140, 180, size=13.5, font='Bold')
    para(body, x + 8, 116, 205, size=10.5, color=MUTED, leading=1.3)
    x += 225
rect(40, 44, 880, 30, SURFACE, r=8)
para('<b>Silnik tras bez AI:</b> własny graf pieszy z OSM (735 530 węzłów, A* z jawnymi kosztami) i rozkład ZTP GTFS (connection scan, do 3 pojazdów).',
     52, 66, 860, size=10.5, color=INK)
source('docs/ARCHITECTURE.md, docs/VALIDATION.md')
c.showPage()

# ---------- 4. places and provenance ----------
y = header(4, 'Wiarygodność danych', 'Każdy fakt ma źródło i datę. Brak danych zostaje brakiem.', color=TEAL)
statuses = [
    (BLUE, 'Mapa OSM', 'pobrano, edycja u źródła, potwierdzenie tylko z check_date'),
    (TEAL, 'Urząd Miasta Krakowa', 'wykaz dostępności budynków UMK/MJO (dok_id=2848)'),
    (PURPLE, 'Deklaracja właściciela', 'formularz partnera, do czasu audytu'),
    (VIOLET, 'Zgłoszenie użytkownika', 'zawsze „niezweryfikowane”'),
    (AMBER, 'Dane demonstracyjne', 'wyraźnie oznaczone, nie trafiają do tras'),
]
sy = y - 20
for col, name, desc in statuses:
    c.setFillColor(col)
    c.circle(48, sy - 7, 5, fill=1, stroke=0)
    sy = para(f'<b>{name}</b> · <font color="#4a5672">{desc}</font>', 62, sy, 330, size=12.5, leading=1.3) - 8
sy -= 6
rect(40, sy - 98, 352, 98, SURFACE, r=12)
bullet_list(['Różne wejścia: „nie przy każdym wejściu”, każde z osobna.',
             'Sprzeczne źródła obok siebie z ostrzeżeniem, bez wybierania za Ciebie.',
             'Awaria źródła: ostatnia dobra migawka z jej datą.'], 52, sy - 10, 330, size=11.5, gap=5)
para('~3 080 miejsc w Odkrywaj', 40, 96, 330, size=20, font='Black', color=TEAL)
para('OSM + wykaz budynków UMK + deklaracje partnerów; lista podąża za widocznym fragmentem mapy.', 40, 68, 340, size=10.5, color=MUTED)
for i, (name, label) in enumerate([('phone-place', 'Kluczowe fakty, wejścia się różnią'),
                                   ('phone-place-sources', 'Pochodzenie: źródło, pobrano, edycja'),
                                   ('phone-place-missing', 'Filharmonia: „Brak danych”')]):
    px = 412 + i * 178
    phone(name, px, 112, 296, crop=(0, 160, 390, 844))
    para(label, px - 2, 92, 165, size=10.5, color=MUTED, leading=1.25)
source('docs/DATA-SOURCES.md, docs/ARCHITECTURE.md (Odkrywaj)')
c.showPage()

# ---------- 5. WOW: bird's-eye ----------
y = header(5, 'Efekt WOW', 'Z lotu ptaka: jak dojść i wejść, zanim wyjdziesz z domu', dark=True, color=HexColor('#9fb4ff'), width=880)
image('desktop-aerial', 40, 60, h=360, crop=(958, 96, 1374, 858), r=12, frame=HexColor('#060b18'))
image('desktop-aerial-advice', 252, 60, h=360, crop=(958, 96, 1374, 858), r=12, frame=HexColor('#060b18'))
bx = 486
para('Ortofotomapa GUGiK z punktami z OSM i przystankami ZTP. AI (OpenAI) układa wskazówki dojścia z tych danych '
     'i z dzisiejszych potrzeb; uzasadnienie dostępności wejścia tworzy serwer z rekordu danych, nie model.',
     bx, y - 22, 430, size=13.5, color=LIGHT_ON_DARK, leading=1.38)
ny = 268
for value, label in [('~3 s', 'do wskazówek (2,7–3,5 s,<br/>5 miejsc, API)'),
                     ('1,7–2,3 m', 'mediana błędu położenia<br/>obserwacji (12 miejsc)'),
                     ('14%', 'obserwacji > 20 m od obiektu<br/>(25 z 180) — mówimy wprost')]:
    pass
cols = [(bx, '~3 s', 'do wskazówek<br/>(2,7–3,5 s, 5 miejsc)'),
        (bx + 148, '1,7–2,3 m', 'mediana błędu położenia<br/>obserwacji, 12 miejsc'),
        (bx + 300, '14%', 'obserwacji dalej niż 20 m<br/>od obiektu (25 / 180)')]
for x0, value, label in cols:
    number(value, label, x0, ny, 140, color=SURFACE, size=27)
bullet_list(['Każda obserwacja jest sprawdzana na zbliżeniu 50 × 50 m; niepotwierdzone (~20%) są odrzucane.',
             'Opis jest oznaczony jako automatyczny i niesprawdzony na miejscu. Gdy wejście nie ma danych, piszemy to.'],
            bx, 178, 430, size=12, color=LIGHT_ON_DARK, dot=HexColor('#9fb4ff'), gap=6)
source('Pomiary: docs/VALIDATION.md (4.10.2026)', dark=True)
c.showPage()

# ---------- 6. reports and city loop ----------
y = header(6, 'Społeczność i miasto', 'Zgłoszenie jednym zdjęciem wraca do mapy jako poprawka', color=VIOLET)
flow = [('1', 'Zdjęcie', 'AI opisuje barierę. Metadane i GPS usunięte.', VIOLET),
        ('2', 'Niezweryfikowane', 'Widoczne przy trasie i miejscu. Autor poprawia lub usuwa tokenem.', VIOLET),
        ('3', 'Panel miasta', 'Statusy, odpowiedź, filtry, eksport CSV.', BLUE),
        ('4', 'Poprawka', 'Odpowiedź miasta wraca do zgłoszenia; właściciel uzupełnia deklarację.', TEAL)]
fx = 40
for num, title, body, col in flow:
    rect(fx, 332, 196, 96, SURFACE, r=12)
    c.setFillColor(col)
    c.circle(fx + 22, 406, 11, fill=1, stroke=0)
    c.setFillColor(SURFACE)
    c.setFont('Bold', 12)
    c.drawCentredString(fx + 22, 402, num)
    para(title, fx + 40, 414, 150, size=14, font='Bold', color=col)
    para(body, fx + 14, 388, 172, size=11, color=INK, leading=1.3)
    if num != '4':
        arrow(fx + 199, 380, fx + 222)
    fx += 224
phone('phone-report-edit', 48, 50, 262, crop=(0, 100, 390, 844))
image('desktop-city', 202, 82, w=436, crop=(90, 0, 1350, 640), r=10)
para('Panel /city na lokalnej instancji z danymi testowymi', 202, 74, 400, size=9.5, color=MUTED)
para('<b>„Uniemożliwiło mi dotarcie”</b> to osobny rodzaj zgłoszenia: dla miasta najważniejszy sygnał, z celem podróży.',
     660, 312, 260, size=11.5, color=INK, leading=1.35)
para('Hasło służbowe, podpisane ciasteczko, limity prób. Zdjęcia z osobami lub tablicami są ukryte publicznie, dopóki urząd ich nie zatwierdzi.',
     660, 236, 260, size=11.5, color=MUTED, leading=1.35)
para('Partnerzy mogą dodać deklarację dostępności obiektu przez formularz; ma status „deklaracja właściciela”.',
     660, 150, 260, size=11.5, color=MUTED, leading=1.35)
source('docs/ARCHITECTURE.md (Zgłoszenia, Panel miasta)')
c.showPage()

# ---------- 7. architecture ----------
y = header(7, 'Architektura i skalowanie', 'Pozyskanie danych oddzielone od prezentacji')
cols = [
    ('Źródła', ['OSM (Geofabrik, ODbL)', 'ZTP GTFS: tramwaje, autobusy', 'Wykaz budynków UMK', 'Ortofotomapa GUGiK', 'Pogoda Open-Meteo', 'Partnerzy, zgłoszenia'], TEAL),
    ('Pozyskanie', ['skrypty acquire-*', '(pyosmium, parser UMK)', 'migawki w data/', 'z datą i SHA-256', 'zapis atomowy;', 'błąd = stara migawka'], BLUE),
    ('Silniki (bez AI)', ['graf pieszy CSR + A*', 'connection scan ZTP', 'graf drogowy: taxi, auto', 'katalog miejsc:', 'łączenie źródeł,', 'konflikty, braki'], INK),
    ('API', ['Next.js route handlers', 'walidacja Zod', 'kontrola Origin', 'limity zapytań AI', 'SQLite: zgłoszenia,', 'partnerzy'], PURPLE),
    ('Interfejs', ['Next.js 16, React 19', 'MapLibre GL, shadcn', 'PWA, PL / EN / DE', 'widżet /embed', 'panel miasta /city', 'lista = tekst mapy'], RED),
]
x = 40
for i, (title, lines, col) in enumerate(cols):
    rect(x, 222, 160, 212, SURFACE, r=12)
    c.setFillColor(col)
    c.roundRect(x, 404, 160, 30, 12, fill=1, stroke=0)
    c.rect(x, 404, 160, 14, fill=1, stroke=0)
    para(title, x + 12, 427, 140, size=12.5, color=SURFACE, font='Bold')
    yy = 392
    for line in lines:
        yy = para(line, x + 12, yy, 142, size=12, color=INK, leading=1.22) - 4
    if i < len(cols) - 1:
        arrow(x + 162, 328, x + 178)
    x += 176
rect(40, 176, 880, 32, ACCENT, r=10)
para('<b>AI obok, nie w środku:</b> zamienia opis potrzeb na ustawienia, opisuje zdjęcie zgłoszenia i odczytuje okolicę z lotu ptaka. Bez AI trasy i miejsca działają.',
     54, 198, 860, size=11, color=HexColor('#1b348c'), leading=1.25)
boxes = [
    ('Odświeżanie', 'OSM i wykaz UMK co tydzień, GTFS co noc (propozycja; dziś ręcznie / przy budowie obrazu).'),
    ('Gdy źródło zawiedzie', 'Ostatnia dobra migawka z datą. Bez ortofotomapy, pogody lub AI reszta działa i mówi, czego brakuje.'),
    ('Nowe źródło, kategoria, miasto', 'Parser do faktów z oryginalnym zdaniem + status źródła. Miasto: obszar, wyciąg OSM, GTFS, lokalna lista, taryfa.'),
    ('Wdrożenie', 'Jeden kontener Docker, wolumen /data, dowolny VPS (dziś Dokploy za Cloudflare). ~1,2 GB RAM; dalej PostGIS.'),
]
x = 40
for title, body in boxes:
    para(title, x, 156, 206, size=13.5, font='Bold', color=BLUE)
    para(body, x, 134, 206, size=11.5, color=INK, leading=1.32)
    x += 222
source('docs/ARCHITECTURE.md, docs/DATA-SOURCES.md, docs/competition/PROJECT.md')
c.showPage()

# ---------- 8. business model ----------
y = header(8, 'Model biznesowy', 'Bezpłatne dla ludzi. Płacą obiekty, miasto i platformy.', width=880)
chip('HIPOTEZY do sprawdzenia w pilotażu: nie mamy jeszcze cennika, listów intencyjnych ani klientów', 40, 412, AMBER_SOFT, AMBER, size=11)
rows = [
    ('Hotele, muzea, organizatorzy', 'Wpis z deklaracją: bezpłatnie. Pakiet Partner: widżet /embed, oznaczenie „Promowane” (nie zmienia danych), statystyki', '49–149 zł / mies.'),
    ('Obiekty chcące potwierdzenia', 'Audyt wejścia z organizacją osób z niepełnosprawnościami, status „potwierdzone na miejscu”', '400–1 200 zł jednorazowo'),
    ('Miasto / ZTP / MJO', 'Pilotaż i partnerstwo danych: panel /city, eksport CSV, wdrożenie, raport', '15–40 tys. zł za 8–12 tyg.'),
    ('Platformy podróży', 'API: fakty o miejscach ze źródłem i statusem + trasa dojścia', '500–2 000 zł / mies.'),
]
ty = 398
for i, (who, what, price) in enumerate(rows):
    rect(40, ty - 62, 566, 58, SURFACE, r=10)
    para(who, 54, ty - 14, 150, size=13, font='Bold', color=INK, leading=1.2)
    para(what, 200, ty - 12, 240, size=10.5, color=MUTED, leading=1.28)
    para(price, 452, ty - 16, 150, size=13, font='Black', color=BLUE, leading=1.15)
    ty -= 66
rect(624, 156, 296, 244, NAVY, r=14)
para('KOSZT DZIAŁANIA (SZACUNEK)', 642, 382, 270, size=9.5, color=SOFT_ON_DARK, font='Bold')
para('0,7–1,8 tys. zł', 642, 362, 270, size=30, color=SURFACE, font='Black', leading=1.0)
para('miesięcznie: hosting 60–150 zł, AI ok. 0,04–0,20 zł za odczyt z lotu ptaka, moderacja 2–4 h / tydz.; bez pracy programistów',
     642, 322, 262, size=10.5, color=LIGHT_ON_DARK, leading=1.32)
para('PRÓG POKRYCIA KOSZTÓW', 642, 232, 270, size=9.5, color=SOFT_ON_DARK, font='Bold')
para('10–18 obiektów', 642, 214, 270, size=24, color=SURFACE, font='Black', leading=1.0)
para('po 99 zł / mies. albo jeden pilotaż miejski na rok', 642, 186, 262, size=10.5, color=LIGHT_ON_DARK, leading=1.3)
image('desktop-embed-partner', 624, 46, w=160, r=6)
para('Widżet „Jak do nas dotrzeć bez barier” na stronie partnera (przykładowej)', 794, 138, 126, size=9.5, color=MUTED, leading=1.25)
para('Partnerzy są też źródłem aktualnych danych: miasto nie musi utrzymywać bazy. <b>Dostępność nigdy nie jest funkcją premium</b>, '
     'a „Promowane” nie zmienia danych o dostępności.', 40, 120, 566, size=12.5, color=INK, leading=1.35)
source('Liczby: docs/competition/PROJECT.md (hipotezy i szacunki)')
c.showPage()

# ---------- 9. accessibility and privacy ----------
y = header(9, 'Dostępność cyfrowa i prywatność', 'Projektowane pod WCAG 2.2 AA. Bez kont, bez diagnozy.', color=TEAL)
para('Sprawdzone', 40, y - 18, 300, size=15, font='Bold', color=TEAL)
by = bullet_list(['axe-core, tagi WCAG 2.0/2.1/2.2 A+AA: <b>0 naruszeń</b> na telefonie i komputerze, także w widżecie /embed',
                  'Obsługa klawiaturą, widoczny fokus, cele dotykowe ≥ 44 px na telefonie',
                  'Lista kroków i lista miejsc to tekstowy odpowiednik mapy',
                  'Krój Atkinson Hyperlegible Next, kontrast, PL / EN / DE'], 40, y - 44, 330, size=13, dot=TEAL, gap=7)
para('Jeszcze nie sprawdzone', 40, by - 12, 300, size=15, font='Bold', color=AMBER)
bullet_list(['VoiceOver i TalkBack na fizycznym telefonie', 'Audyt terenowy i test przy słabej sieci'],
            40, by - 34, 330, size=13, dot=AMBER, gap=7)
para('Prywatność', 394, y - 18, 300, size=15, font='Bold', color=BLUE)
bullet_list(['Potrzeby, ostatnie miejsca i język tylko w tej przeglądarce; przycisk „Usuń dane z tej przeglądarki”',
             'Bez historii tras i śladu GPS na serwerze, bez śledzących cookies i analityki',
             'Zdjęcia: zmniejszone, bez EXIF/GPS; publicznie tylko bez osób i tablic',
             'AI tylko do opisu potrzeb, zdjęć i odczytu z lotu ptaka; HTTPS, kontrola Origin, limity'],
            394, y - 44, 330, size=13, dot=BLUE, gap=7)
phone('phone-about-privacy', 750, 52, 380, crop=(0, 40, 390, 844))
rect(40, 56, 690, 92, SURFACE, r=12)
for i, (value, label) in enumerate([('162', 'testy automatyczne: trasy, kierunek schodów, profile, źródła, konflikty, zgłoszenia (npm test, 4.10.2026)'),
                                    ('48 / 48', 'kombinacji API: 4 środki transportu × 4 profile × PL / EN / DE'),
                                    ('0', 'naruszeń axe na telefonie i komputerze (Playwright, Chromium)')]):
    number(value, label, 58 + i * 228, 134, 205, color=TEAL if i != 1 else BLUE, sub=MUTED, size=24)
source('docs/VALIDATION.md, docs/PRIVACY-SECURITY.md')
c.showPage()

# ---------- 10. pilot and ask ----------
y = header(10, 'Pilotaż i prośba', '10 tygodni na Starym Mieście i Kazimierzu', dark=True, color=HexColor('#ffb3bf'))
plan = [('1–2', 'Operator, polityka prywatności, weryfikacja właścicieli, konta w /city'),
        ('2–3', 'Warunki ponownego użycia wykazu UMK i danych ZTP'),
        ('3–4', '15–20 obiektów, 10–15 testerów, audyt 5–8 wejść'),
        ('4–9', 'Codzienne użycie, zgłoszenia, cotygodniowa moderacja'),
        ('10', 'Raport: wyniki, koszty, decyzja o rozszerzeniu')]
py = y - 22
for wk, text in plan:
    rect(40, py - 36, 58, 32, HexColor('#24356a'), r=8)
    para(wk, 40, py - 12, 58, size=13, font='Bold', color=SURFACE, align=1)
    para(text, 110, py - 8, 330, size=13.5, color=LIGHT_ON_DARK, leading=1.25)
    py -= 54
para('MIERZYMY (CELE DO WERYFIKACJI)', 470, y - 22, 440, size=10, color=SOFT_ON_DARK, font='Bold')
kpis = [('≥ 80%', 'tras bez nieoczekiwanej bariery'), ('≥ 40', 'zweryfikowanych zgłoszeń'),
        ('≥ 8 / 20', 'obiektów z deklaracją'), ('≤ 5 dni', 'mediana odpowiedzi urzędu'),
        ('≥ 3', 'płacących partnerów'), ('≥ 70%', 'trafnych wskazówek z lotu ptaka')]
for i, (v, l) in enumerate(kpis):
    kx, ky = 470 + (i % 3) * 150, y - 48 - (i // 3) * 74
    number(v, l, kx, ky, 140, size=22)
rect(470, 66, 450, 118, SURFACE, r=14)
para('Prosimy o', 488, 168, 400, size=15, font='Black', color=RED)
bullet_list(['UMK / MJO: partnera danych i sponsora pilotażu',
             'obiekty w centrum: hotele, muzea, kawiarnie, urzędy',
             'organizacje osób z niepełnosprawnościami: testerzy i audyty'], 488, 146, 420, size=12, dot=RED, gap=4)
para('<b>Dalej:</b> weryfikacja właściciela, status „potwierdzone na miejscu”, PostGIS, ZTP na żywo, kolejne miasta.',
     40, 92, 400, size=13, color=LIGHT_ON_DARK, leading=1.35)
source('Plan i cele: docs/competition/PROJECT.md', dark=True)
c.showPage()

c.save()
print(OUT.relative_to(ROOT))
