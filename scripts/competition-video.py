"""Assemble the Polish demo video from the raw recording made by capture-competition.mjs.

Usage: python3 scripts/competition-video.py
Input:  artifacts/competition/video/raw/timeline.json (+ the .webm files it names)
Output: docs/competition/demo.mp4 (H.264, yuv420p, 1920x1080, 30 fps, faststart) and docs/competition/demo.srt
Requires ffmpeg/ffprobe and Pillow. Captions are burned in (rendered with Atkinson Hyperlegible Next) and also
written as SRT. The total is checked against the 3-minute limit (target <= 170 s).
"""
from pathlib import Path
import json
import subprocess
import sys
import urllib.request
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'artifacts/competition/video'
RAW = WORK / 'raw'
CLIPS = WORK / 'clips'
OUT = ROOT / 'docs/competition/demo.mp4'
SRT = ROOT / 'docs/competition/demo.srt'
FONT_DIR = ROOT / 'artifacts/competition/fonts'
FONT_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/atkinsonhyperlegiblenext/AtkinsonHyperlegibleNext%5Bwght%5D.ttf'
W, H, FPS = 1920, 1080, 30
LIMIT = 170.0

INK, NAVY, BLUE, RED, TEAL, AMBER, CANVAS, WHITE = '#14213d', '#0d1730', '#2443b0', '#c4122f', '#0f766e', '#f2b45a', '#eef1f5', '#ffffff'
STEP_COLORS = {'Potrzeby': '#9fb4ff', 'Trasa': '#9fb4ff', 'Bariery i udogodnienia': '#7fd6c9', 'Źródło i data': '#7fd6c9',
               'Kierunek schodów': AMBER, 'Miejsca': '#d4a9ec', 'Niepełne dane': AMBER, 'Brak danych': AMBER,
               'Z lotu ptaka': '#9fb4ff', 'Zgłoszenie': '#c9b3ff', 'Partnerzy': '#7fd6c9', 'Miasto': '#ffb3bf'}


def font_path():
    path = FONT_DIR / 'AtkinsonHyperlegibleNext-VF.ttf'
    if not path.exists():
        FONT_DIR.mkdir(parents=True, exist_ok=True)
        try:
            urllib.request.urlretrieve(FONT_URL, path)
        except Exception:
            return ROOT / 'public/fonts/manrope.ttf'
    return path


FONT = font_path()


def font(size, weight=400):
    f = ImageFont.truetype(str(FONT), size)
    try:
        f.set_variation_by_axes([weight])
    except Exception:
        pass
    return f


def wrap(draw, text, f, width):
    lines, line = [], ''
    for word in text.split():
        test = f'{line} {word}'.strip()
        if draw.textlength(test, font=f) <= width:
            line = test
        else:
            lines.append(line)
            line = word
    lines.append(line)
    return lines


def text_block(draw, xy, text, f, width, fill, spacing=1.28):
    x, y = xy
    for line in wrap(draw, text, f, width):
        draw.text((x, y), line, font=f, fill=fill)
        y += round(f.size * spacing)
    return y


def gradient_bg():
    im = Image.new('RGB', (W, H), NAVY)
    top, bottom = (20, 33, 61), (13, 23, 48)
    d = ImageDraw.Draw(im)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    return im


def brand(d, y=H - 70):
    d.rounded_rectangle((120, y, 150, y + 30), 8, fill=BLUE)
    d.text((166, y - 2), 'Każdy Krok', font=font(28, 700), fill=WHITE)
    d.text((330, y + 1), '· Kraków bez barier · prototyp', font=font(24), fill='#9aa6c2')


PHONE = {'h': 960, 'x': 1270, 'y': 60}


def phone_geometry():
    h = PHONE['h']
    w = round(h * 390 / 844)
    w -= w % 2
    return PHONE['x'], PHONE['y'], w, h


def phone_bg(caption, step, index, total):
    im = gradient_bg()
    d = ImageDraw.Draw(im)
    x, y, w, h = phone_geometry()
    pad = 16
    d.rounded_rectangle((x - pad, y - pad, x + w + pad, y + h + pad), 58, fill='#060b18', outline='#32436b', width=3)
    color = STEP_COLORS.get(step, '#9fb4ff')
    d.text((120, 250), f'{index:02d} / {total:02d}  ·  {step.upper()}', font=font(30, 700), fill=color)
    d.rectangle((120, 300, 200, 306), fill=color)
    text_block(d, (120, 340), caption, font(58, 700), 1000, WHITE, 1.25)
    brand(d)
    return im


def phone_mask():
    """Transparent screen with rounded corners on top of the video, opaque bezel colour outside it."""
    x, y, w, h = phone_geometry()
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    corner = Image.new('L', (w, h), 255)
    ImageDraw.Draw(corner).rounded_rectangle((0, 0, w - 1, h - 1), 44, fill=0)
    over = Image.new('RGBA', (w, h), (6, 11, 24, 255))
    over.putalpha(corner)
    im.paste(over, (x, y), over)
    return im


DESK = {'w': 1376, 'h': 860, 'y': 28}


def desktop_bg(caption, step, index, total):
    im = gradient_bg()
    d = ImageDraw.Draw(im)
    x = (W - DESK['w']) // 2
    d.rounded_rectangle((x - 10, DESK['y'] - 10, x + DESK['w'] + 10, DESK['y'] + DESK['h'] + 10), 18, fill='#060b18', outline='#32436b', width=3)
    color = STEP_COLORS.get(step, '#9fb4ff')
    d.text((x, 920), f'{index:02d} / {total:02d}  ·  {step.upper()}', font=font(26, 700), fill=color)
    text_block(d, (x, 960), caption, font(40, 700), DESK['w'], WHITE, 1.22)
    return im


def card(kind):
    im = gradient_bg()
    d = ImageDraw.Draw(im)
    if kind == 'title':
        d.rectangle((120, 300, 220, 308), fill=RED)
        d.text((120, 340), 'Każdy Krok', font=font(120, 800), fill=WHITE)
        d.text((126, 480), 'Czy dam radę przejść tę trasę dzisiaj?', font=font(56, 600), fill='#c9d3ee')
        d.text((126, 580), 'Planer tras i miejsc w Krakowie dla osób, których możliwości zmieniają się z dnia na dzień.', font=font(34), fill='#9aa6c2')
        d.text((126, 900), 'Demonstracja działającego prototypu · nagranie z przeglądarki · HackYeah 2026, wyzwanie „Kraków bez barier”', font=font(26), fill='#9aa6c2')
    else:
        d.rectangle((120, 230, 220, 238), fill=RED)
        d.text((120, 270), 'Każdy Krok', font=font(96, 800), fill=WHITE)
        y = 420
        for line in ['Potrzeby na dziś zamiast diagnozy i etykiety „dostępne”.',
                     'Konkretne bariery z miejscem, źródłem i datą. Braki pokazane wprost.',
                     'Zgłoszenia jednym zdjęciem, panel miasta, widżet dla partnerów.',
                     'Otwarte dane: OSM, ZTP GTFS, Urząd Miasta Krakowa, GUGiK.']:
            d.ellipse((126, y + 16, 140, y + 30), fill=TEAL)
            d.text((160, y), line, font=font(40, 600), fill='#e3e8f5')
            y += 70
        d.text((126, 820), 'kazdy-krok.antek.page · bez konta · PL / EN / DE · telefon i komputer', font=font(32), fill='#c9d3ee')
        d.text((126, 900), 'Wszystkie ujęcia: działająca aplikacja; zgłoszenia i panel miasta na danych testowych.', font=font(26), fill='#9aa6c2')
    return im


def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


ENC = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', str(FPS), '-profile:v', 'high', '-tune', 'stillimage']
ENC_MOTION = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', str(FPS), '-profile:v', 'high']


def still_clip(image, seconds, out):
    path = CLIPS / f'{out}.png'
    image.save(path)
    run(['ffmpeg', '-y', '-loop', '1', '-i', str(path), '-t', f'{seconds:.3f}', '-vf', f'fps={FPS},format=yuv420p,fade=in:0:8', *ENC, str(CLIPS / f'{out}.mp4')])
    return seconds


def video_clip(src, device, start, end, bg, out, speed=1.0, viewport=None):
    bg_path = CLIPS / f'{out}.png'
    bg.save(bg_path)
    dur = (end - start) / speed
    # The recording may pad the viewport into a larger frame; keep only the page area.
    crop = f'crop={viewport["width"]}:{viewport["height"]}:0:0,' if viewport else ''
    if device == 'phone':
        x, y, w, h = phone_geometry()
        mask_path = CLIPS / 'phone-mask.png'
        if not mask_path.exists():
            phone_mask().save(mask_path)
        graph = (f'[1:v]{crop}setpts=(PTS-STARTPTS)/{speed},scale={w}:{h}:flags=lanczos,fps={FPS}[v];'
                 f'[0:v][v]overlay={x}:{y}:shortest=1[a];[a][2:v]overlay=0:0,format=yuv420p')
        inputs = ['-loop', '1', '-i', str(bg_path), '-ss', f'{start:.3f}', '-t', f'{end - start:.3f}', '-i', src, '-loop', '1', '-i', str(mask_path)]
    else:
        x = (W - DESK['w']) // 2
        graph = (f'[1:v]{crop}setpts=(PTS-STARTPTS)/{speed},scale={DESK["w"]}:{DESK["h"]}:flags=lanczos,fps={FPS}[v];'
                 f'[0:v][v]overlay={x}:{DESK["y"]}:shortest=1,format=yuv420p')
        inputs = ['-loop', '1', '-i', str(bg_path), '-ss', f'{start:.3f}', '-t', f'{end - start:.3f}', '-i', src]
    run(['ffmpeg', '-y', *inputs, '-filter_complex', graph, '-t', f'{dur:.3f}', *ENC_MOTION, str(CLIPS / f'{out}.mp4')])
    return dur


def srt_time(t):
    ms = round(t * 1000)
    return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}'


def main():
    timeline = json.loads((RAW / 'timeline.json').read_text())
    CLIPS.mkdir(parents=True, exist_ok=True)
    for old in CLIPS.glob('*'):
        old.unlink()
    pieces = [(v, c) for v in timeline['videos'] for c in v['clips'] if c.get('end') and c['end'] - c['start'] > 0.3]
    steps = []
    for _, c in pieces:
        if not steps or steps[-1] != c['step']:
            steps.append(c['step'])
    raw_total = sum(c['end'] - c['start'] for _, c in pieces)
    title_s, end_s = 4.0, 6.0
    # One speed for everything if the raw cut is too long; never slower than real time.
    speed = max(1.0, raw_total / (LIMIT - title_s - end_s))
    print(f'raw {raw_total:.1f} s, speed ×{speed:.2f}')

    names, subs, t = [], [], 0.0
    t += still_clip(card('title'), title_s, '000-title')
    names.append('000-title')
    subs.append((0.0, t, 'Każdy Krok — czy dam radę przejść tę trasę dzisiaj?'))
    step_index = 0
    last_step = None
    for i, (v, c) in enumerate(pieces, 1):
        if c['step'] != last_step:
            step_index += 1
            last_step = c['step']
        bg = (phone_bg if v['device'] == 'phone' else desktop_bg)(c['caption'], c['step'], step_index, len(steps))
        name = f'{i:03d}-clip'
        dur = video_clip(v['file'], v['device'], c['start'], c['end'], bg, name, speed, v.get('viewport'))
        names.append(name)
        if subs and subs[-1][2] == c['caption'] and abs(subs[-1][1] - t) < 0.01:
            subs[-1] = (subs[-1][0], t + dur, c['caption'])
        else:
            subs.append((t, t + dur, c['caption']))
        t += dur
    start_end = t
    t += still_clip(card('end'), end_s, '999-end')
    names.append('999-end')
    subs.append((start_end, t, 'Każdy Krok: potrzeby na dziś, konkretne bariery ze źródłem i datą, braki pokazane wprost.'))

    lst = CLIPS / 'list.txt'
    lst.write_text(''.join(f"file '{CLIPS / n}.mp4'\n" for n in names))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    run(['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', str(lst), '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
         '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '32k', '-shortest',
         '-movflags', '+faststart', '-metadata', 'title=Każdy Krok — demo (Kraków bez barier)', '-metadata', 'language=pol', str(OUT)])
    SRT.write_text(''.join(f'{i}\n{srt_time(a)} --> {srt_time(b)}\n{text}\n\n' for i, (a, b, text) in enumerate(subs, 1)), encoding='utf-8')
    probe = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration,size', '-of', 'json', str(OUT)], capture_output=True, text=True).stdout)
    dur, size = float(probe['format']['duration']), int(probe['format']['size'])
    print(f'{OUT.relative_to(ROOT)}: {dur:.1f} s, {size / 1e6:.1f} MB, {len(names)} clips, {len(subs)} captions')
    if dur > 180:
        sys.exit('demo longer than 3 minutes')


if __name__ == '__main__':
    main()
