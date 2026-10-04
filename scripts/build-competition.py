"""Build the Polish 10-slide competition deck (16:9 PDF) from real screenshots of the running app.

Usage: python3 scripts/build-competition.py [assets-dir]
  assets-dir defaults to artifacts/competition/assets (made by `node scripts/capture-competition.mjs shots`).
Output: docs/competition/kazdy-krok.pdf (DECK_OUT=path overrides, e.g. to build next to the old one first)
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
OUT = Path(__import__('os').environ.get('DECK_OUT', ROOT / 'docs/competition/kazdy-krok.pdf'))
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


# ---------- design system ----------
# 960×540 pt, 64 pt side margins, title band at the top, one idea per slide: a headline and at most three short
# points or one big number, next to large real screenshots in device frames.
BG = HexColor('#f6f7fb')
M = 64


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


def shadow(x, y, w, h, r, dark=False):
    """A soft drop shadow: a few offset translucent layers."""
    for i, a in enumerate([0.05, 0.04, 0.03, 0.02]):
        s = 2 + i * 3
        c.setFillColor(Color(0, 0, 0.1, alpha=a * (2.2 if dark else 1)))
        c.roundRect(x - s / 2, y - 3 - s, w + s, h + s, r + s / 2, fill=1, stroke=0)


def load(name, crop=None):
    path = ASSETS / f'{name}.png'
    if not path.exists():
        raise FileNotFoundError(f'{path} — run: node scripts/capture-competition.mjs shots')
    im = Image.open(path).convert('RGB')
    if crop:
        im = im.crop(tuple(round(v * 2) for v in crop))
    return im


def clipped(im, x, y, w, h, r):
    c.saveState()
    p = c.beginPath()
    p.roundRect(x, y, w, h, r)
    c.clipPath(p, stroke=0, fill=0)
    c.drawImage(ImageReader(im), x, y, w, h)
    c.restoreState()


def phone(name, x, y, h, crop=None, dark=False):
    """Phone screenshot in a rounded device frame with a soft shadow. Returns the frame width."""
    im = load(name, crop)
    bez = max(5, h * 0.018)
    sh = h - 2 * bez
    sw = sh * im.width / im.height
    w = sw + 2 * bez
    r = h * 0.075
    shadow(x, y, w, h, r, dark)
    rect(x, y, w, h, HexColor('#0b1226'), r=r)
    clipped(im, x + bez, y + bez, sw, sh, r - bez)
    return w


def browser(name, x, y, w, crop=None, dark=False):
    """Desktop screenshot in a minimal browser frame. Returns the frame height."""
    im = load(name, crop)
    bar = 20
    ih = w * im.height / im.width
    h = ih + bar
    shadow(x, y, w, h, 10, dark)
    rect(x, y, w, h, SURFACE, r=10)
    c.saveState()
    p = c.beginPath()
    p.roundRect(x, y, w, h, 10)
    c.clipPath(p, stroke=0, fill=0)
    c.setFillColor(HexColor('#e7eaf1'))
    c.rect(x, y + ih, w, bar, fill=1, stroke=0)
    c.drawImage(ImageReader(im), x, y, w, ih)
    c.restoreState()
    for i, col in enumerate(['#ff5f57', '#febc2e', '#28c840']):
        c.setFillColor(HexColor(col))
        c.circle(x + 14 + i * 12, y + ih + bar / 2, 3.6, fill=1, stroke=0)
    rect(x + w / 2 - 90, y + ih + 5, 180, 10, SURFACE, r=5)
    para('kazdy-krok.antek.page', x + w / 2 - 90, y + ih + 14.5, 180, size=6.5, color=MUTED, align=1)
    return h


def slide(n, eyebrow, title, color=BLUE, dark=False, width=832):
    c.setFillColor(NAVY if dark else BG)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillColor(color)
    c.roundRect(M, 478, 22, 4, 2, fill=1, stroke=0)
    para(eyebrow.upper(), M + 30, 487, 600, size=11, color=SOFT_ON_DARK if dark else color, font='Bold')
    end = para(title, M, 464, width, size=31, color=SURFACE if dark else INK, font='Black', leading=1.12)
    col = SOFT_ON_DARK if dark else MUTED
    para('Każdy Krok · Kraków bez barier', M, 30, 300, size=9.5, color=col)
    para(f'{n:02d} / {TOTAL:02d}', W - M - 60, 30, 60, size=9.5, color=col, font='Bold', align=2)
    return end


def source(text, dark=False):
    para(text, 330, 30, W - M - 70 - 330, size=9.5, color=SOFT_ON_DARK if dark else MUTED, align=2)


def point(title, body, x, y, w, color=BLUE, dark=False):
    """One short point: colour bar, bold line, one muted line."""
    c.setFillColor(color)
    c.roundRect(x, y - 44, 4, 44, 2, fill=1, stroke=0)
    yy = para(title, x + 16, y + 1, w - 16, size=17, font='Bold', color=SURFACE if dark else INK, leading=1.2)
    return para(body, x + 16, yy - 3, w - 16, size=14, color=LIGHT_ON_DARK if dark else MUTED, leading=1.3) - 22


def big(value, label, x, y, w, color=BLUE, size=46, dark=False):
    para(value, x, y, w, size=size, color=color, font='Black', leading=1.0)
    return para(label, x, y - size - 6, w, size=14, color=LIGHT_ON_DARK if dark else MUTED, leading=1.3)


def chip(text, x, y, fill, color, size=12, pad=9):
    w = pdfmetrics.stringWidth(text, 'Bold', size) + 2 * pad
    hh = size + 2 * pad - 4
    rect(x, y, w, hh, fill, r=hh / 2)
    c.setFillColor(color)
    c.setFont('Bold', size)
    c.drawString(x + pad, y + pad - 1, text)
    return w


def caption(num, text, x, y, w, color=BLUE):
    c.setFillColor(color)
    c.circle(x + 10, y - 9, 10, fill=1, stroke=0)
    c.setFillColor(SURFACE)
    c.setFont('Bold', 11)
    c.drawCentredString(x + 10, y - 13, num)
    para(text, x + 28, y, w - 28, size=14, color=INK, font='Semi', leading=1.25)


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


# ---------- 1. title (dark) ----------
c.setFillColor(NAVY)
c.rect(0, 0, W, H, fill=1, stroke=0)
c.setFillColor(RED)
c.roundRect(M, 424, 56, 5, 2.5, fill=1, stroke=0)
para('KAŻDY KROK · KRAKÓW BEZ BARIER', M, 470, 440, size=12, color=SOFT_ON_DARK, font='Bold')
y = para('Czy dam radę przejść tę trasę dzisiaj?', M, 404, 440, size=48, color=SURFACE, font='Black', leading=1.06)
para('Trasy i miejsca w Krakowie dla osób, których możliwości ruchowe zmieniają się z dnia na dzień.',
     M, y - 22, 420, size=18, color=LIGHT_ON_DARK, leading=1.35)
para('<b>kazdy-krok.antek.page</b> · telefon i komputer · PL / EN / DE · bez konta', M, 74, 440, size=12.5, color=SOFT_ON_DARK)
w1 = phone('phone-routes', 536, 90, 380, dark=True)
phone('phone-lift', 536 + w1 + 22, 58, 380, dark=True)
para(f'01 / {TOTAL:02d}', W - M - 60, 30, 60, size=9.5, color=SOFT_ON_DARK, font='Bold', align=2)
c.showPage()

# ---------- 2. problem and users ----------
y = slide(2, 'Problem i użytkownicy', '„Dostępne / niedostępne” nie mówi,<br/>czy dam radę <font color="#2443b0">dzisiaj</font>.')
yy = y - 34
yy = point('Po urazie, o kulach', 'Schody w dół bolą bardziej niż w górę.', M, yy, 380, AMBER)
yy = point('Na wózku', 'Każdy stopień i krawężnik zmienia trasę.', M, yy, 380, BLUE)
yy = point('Z wózkiem dziecięcym', 'Długie schody odpadają, liczy się winda.', M, yy, 380, TEAL)
para('Pytamy o potrzeby, nie o powody.', M, 92, 380, size=16, font='Bold', color=INK)
wa = phone('phone-needs-settings', 506, 62, 330)
phone('phone-lift', 506 + wa + 24, 62, 330)
source('Zrzuty z działającej aplikacji')
c.showPage()

# ---------- 3. scenario ----------
slide(3, 'Scenariusz', 'Anna o kulach: z Dworca na Wawel i z powrotem')
shots = [('phone-needs-ai', '1', 'Opisuje potrzeby własnymi słowami', BLUE),
         ('phone-routes', '2', 'Widzi bariery na każdym wariancie', BLUE),
         ('phone-detail-steps', '3', '25 stopni w górę, z poręczą', BLUE),
         ('phone-walk-back', '4', 'Powrót: te same schody są w dół', RED)]
x = M
for name, num, text, col in shots:
    pw = phone(name, x + 10, 112, 290)
    caption(num, text, x, 96, 196, col)
    x += 212
source('Graf pieszy z OSM (735 530 węzłów) i rozkład ZTP GTFS, bez AI · docs/ARCHITECTURE.md')
c.showPage()

# ---------- 4. data provenance ----------
y = slide(4, 'Wiarygodność danych', 'Każdy fakt ma źródło i datę.<br/>Brak danych zostaje brakiem.', color=TEAL, width=520)
big('~3 080', 'miejsc w Odkrywaj: OSM, wykaz budynków UMK i deklaracje partnerów', M, y - 34, 360, color=TEAL, size=50)
yy = 210
yy = point('Pochodzenie przy każdym fakcie', 'Źródło, data pobrania i edycji.', M, yy, 400, TEAL)
yy = point('Sprzeczne źródła obok siebie', 'Z ostrzeżeniem, bez wybierania za Ciebie.', M, yy, 400, AMBER)
wa = phone('phone-place-sources', 520, 62, 390)
phone('phone-place-missing', 520 + wa + 24, 62, 390)
source('docs/DATA-SOURCES.md')
c.showPage()

# ---------- 5. WOW: bird's-eye ----------
y = slide(5, 'Efekt WOW', 'Z lotu ptaka: jak dojść i wejść', color=BLUE)
browser('desktop-aerial-advice', M, 62, 540)
nx = 640
yy = y - 30
for value, label in [('~3 s', 'do wskazówek AI (5 miejsc)'),
                     ('1,7–2,3 m', 'mediana błędu położenia obserwacji'),
                     ('14%', 'obserwacji dalej niż 20 m — mówimy wprost')]:
    yy = big(value, label, nx, yy, 256, color=BLUE, size=34) - 24
para('Ortofotomapa GUGiK + OSM. Opis oznaczony jako niesprawdzony na miejscu.', nx, yy - 2, 256, size=12, color=MUTED, leading=1.3)
source('Pomiary: docs/VALIDATION.md (4.10.2026)')
c.showPage()

# ---------- 6. reports ----------
y = slide(6, 'Społeczność i miasto', 'Zgłoszenie jednym zdjęciem<br/>wraca do mapy', color=VIOLET, width=480)
yy = y - 34
yy = point('Jedno zdjęcie', 'AI opisuje barierę. Bez EXIF i GPS.', M, yy, 330, VIOLET)
yy = point('Publicznie, ze statusem', 'Kategoria „Zgłoszenia” w Odkrywaj, z oznaczeniem „niezweryfikowane”.', M, yy, 330, VIOLET)
yy = point('Miasto odpowiada', 'Panel /city: status, odpowiedź, eksport CSV.', M, yy, 330, BLUE)
pw = phone('phone-report-edit', 524, 62, 370)
phone('phone-reports', 524 + pw + 24, 62, 370)
source('docs/ARCHITECTURE.md (Zgłoszenia)')
c.showPage()

# ---------- 7. architecture ----------
y = slide(7, 'Architektura', 'Pozyskanie danych oddzielone od prezentacji')
boxes = [('Źródła', 'OSM · ZTP · UMK', TEAL), ('Migawki', 'z datą i SHA-256', BLUE), ('Silniki', 'trasy bez AI', INK),
         ('API', 'walidacja i limity', VIOLET), ('Interfejs', 'mapa + lista', RED)]
bw, gap = 136, 38
x = M
for i, (title, sub, col) in enumerate(boxes):
    shadow(x, 238, bw, 110, 14)
    rect(x, 238, bw, 110, SURFACE, r=14)
    c.setFillColor(col)
    c.roundRect(x + 18, 318, 26, 5, 2.5, fill=1, stroke=0)
    para(title, x + 18, 308, bw - 30, size=19, font='Black', color=INK)
    para(sub, x + 18, 278, bw - 30, size=13.5, color=MUTED, leading=1.25)
    if i < len(boxes) - 1:
        arrow(x + bw + 8, 293, x + bw + gap - 8)
    x += bw + gap
yy = 190
for i, (t, b, col) in enumerate([('Awaria źródła', 'Ostatnia dobra migawka z jej datą.', AMBER),
                                 ('Nowe miasto', 'Wyciąg OSM, GTFS i lokalna lista.', TEAL),
                                 ('AI obok, nie w środku', 'Bez AI trasy i miejsca działają.', BLUE)]):
    point(t, b, M + i * 284, yy, 260, col)
source('1 kontener Docker, ~1,2 GB RAM · docs/ARCHITECTURE.md')
c.showPage()

# ---------- 8. business model ----------
y = slide(8, 'Model biznesowy', 'Bezpłatne dla ludzi. Płacą obiekty, miasto i platformy.')
chip('HIPOTEZY do sprawdzenia w pilotażu', M, y - 40, AMBER_SOFT, AMBER, size=12)
cards = [('Obiekty', '49–149 zł', 'miesięcznie · widżet na stronie, statystyki', BLUE),
         ('Miasto', '15–40 tys. zł', 'pilotaż 8–12 tygodni · panel /city, raport', TEAL),
         ('Platformy', '500–2 000 zł', 'miesięcznie · API faktów i tras', VIOLET)]
cw = 190
for i, (who, price, what, col) in enumerate(cards):
    x = M + i * (cw + 20)
    shadow(x, 120, cw, 200, 16)
    rect(x, 120, cw, 200, SURFACE, r=16)
    c.setFillColor(col)
    c.roundRect(x + 20, 292, 26, 5, 2.5, fill=1, stroke=0)
    para(who, x + 20, 282, cw - 40, size=17, font='Bold', color=INK)
    para(price, x + 20, 246, cw - 30, size=23, font='Black', color=col, leading=1.0)
    para(what, x + 20, 206, cw - 40, size=13, color=MUTED, leading=1.3)
rect(704, 120, 192, 200, NAVY, r=16)
para('KOSZT DZIAŁANIA', 722, 292, 160, size=10.5, font='Bold', color=SOFT_ON_DARK)
para('0,7–1,8 tys. zł', 722, 270, 165, size=21, font='Black', color=SURFACE, leading=1.05)
para('miesięcznie, szacunek: hosting, AI, moderacja', 722, 206, 160, size=13, color=LIGHT_ON_DARK, leading=1.3)
para('Dostępność nigdy nie jest funkcją premium.', M, 92, 600, size=16, font='Bold', color=INK)
source('docs/competition/PROJECT.md (hipotezy i szacunki)')
c.showPage()

# ---------- 9. accessibility and privacy ----------
y = slide(9, 'Dostępność cyfrowa i prywatność', 'Projektowane pod WCAG 2.2 AA.<br/>Bez kont, bez diagnozy.', color=TEAL, width=600)
big('Zero', 'naruszeń axe-core (WCAG 2.2 A+AA) na telefonie i komputerze', M, y - 30, 360, color=TEAL, size=56)
yy = 222
yy = point('Dane zostają u Ciebie', 'Potrzeby tylko w tej przeglądarce.', M, yy, 420, BLUE)
yy = point('Jeszcze nie sprawdzone', 'VoiceOver i TalkBack na telefonie.', M, yy, 420, AMBER)
phone('phone-about-privacy', 700, 62, 390)
source('docs/VALIDATION.md, docs/PRIVACY-SECURITY.md')
c.showPage()

# ---------- 10. pilot and ask (dark) ----------
y = slide(10, 'Pilotaż i prośba', '10 tygodni na Starym Mieście<br/>i Kazimierzu', dark=True, color=HexColor('#ffb3bf'), width=600)
para('CELE DO WERYFIKACJI (HIPOTEZY)', M, y - 34, 500, size=11, font='Bold', color=SOFT_ON_DARK)
for i, (v, l) in enumerate([('≥ 80%', 'tras bez nieoczekiwanej bariery'), ('≥ 40', 'zweryfikowanych zgłoszeń'),
                            ('≤ 5 dni', 'mediana odpowiedzi urzędu')]):
    big(v, l, M + i * 196, y - 60, 176, color=SURFACE, size=38, dark=True)
rect(M, 66, 572, 134, HexColor('#18254a'), r=16)
para('Prosimy o', M + 24, 180, 300, size=17, font='Black', color=HexColor('#ffb3bf'))
for i, t in enumerate(['UMK / MJO: partnera danych i sponsora pilotażu',
                       'Obiekty w centrum: hotele, muzea, urzędy',
                       'Organizacje osób z niepełnosprawnościami: testy i audyty']):
    c.setFillColor(RED)
    c.circle(M + 30, 145 - i * 26, 3.4, fill=1, stroke=0)
    para(t, M + 42, 153 - i * 26, 520, size=14.5, color=LIGHT_ON_DARK)
phone('phone-explore', 712, 62, 380, dark=True)
source('docs/competition/PROJECT.md', dark=True)
c.showPage()

c.save()
print(OUT)
