# Każdy Krok — interface

Scene: a phone outdoors, someone deciding how much effort is manageable today, often in a hurry and sometimes in pain. The app behaves like a city trip planner (Jakdojade, Google Maps) and adds one layer: the barriers that matter today, placed where they occur.

Typeface: Atkinson Hyperlegible Next (Braille Institute, OFL) for everything. It was designed for low-vision legibility, which fits the audience. Tabular numerals for times and distances.

Palette (tokens in `src/app/globals.css`):
- ink `#14213d` — text, walking legs
- canvas `#eef1f5`, surface `#ffffff`
- tram blue `#2443b0` — primary actions, buses
- crest red `#c4122f` — trams (Kraków coat of arms)
- barrier amber `#a1460a` on `#fdecc8` — stairs and anything that does not fit today
- rest teal `#0f766e` on `#d5f0ec` — benches
- report violet `#6d28d9` — user reports

The memorable element is the **barrier strip** on each route card: a time-proportional bar of walking and riding with stair and bench marks placed where they happen. Everything else stays quiet.

Progressive disclosure instead of disclaimers: each fact has a small status dot; source, dates and verification sit in a detail sheet. One "O danych" dialog covers sources. Benches and entrances appear on the map only once zoomed in; stairs always show.

Layout: phone — full-screen map with the planner as a draggable sheet on top (peek / half / full; drag the handle or the content, flick to snap; keyboard: the handle is a button, arrows step heights, focus inside raises the sheet). Typing a place opens the sheet fully so suggestions sit right under the field (above the iOS keyboard); route detail's List/Map switch maps to half/peek; fits and the Explore area leave the covered part of the map out. Desktop — 440 px planner panel and a full-height map. Panels are vaul drawers on phones and side sheets on desktop.

Accessibility: shadcn/Radix primitives (no native selects), visible focus rings, 24 px+ targets, labelled comboboxes, the map region announces that the same content is in the list, reduced-motion respected. Verified with axe (WCAG 2.2 AA tags) in `scripts/ui-check.mjs`.
