"""Drivable road graph and car parks from a local Geofabrik PBF. Output is ODbL, with source timestamps.
Usage: /tmp/krok-data-venv/bin/python scripts/acquire-roads.py [/tmp/krok-malopolskie.osm.pbf]

Writes data/krakow-roads.json.gz (compact parallel arrays), data/krakow-parking.json.gz
and data/roads-metadata.json (counts). No travel times are invented here: speeds are
derived at runtime from maxspeed or a road-class default (see src/lib/roads.ts).
"""
import osmium, json, sys, hashlib, os, gzip, re
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
BBOX = [19.75, 49.94, 20.25, 50.20]
SOURCE = 'https://download.geofabrik.de/europe/poland/malopolskie.html'
CLASSES = ['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
           'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service']
CLASS_INDEX = {c: i for i, c in enumerate(CLASSES)}
ALLOW = {'yes', 'designated', 'permissive', 'unknown'}
DESTINATION = {'destination', 'customers'}
# Most specific key wins (OSM access hierarchy for a private car).
ACCESS_KEYS = ['motorcar', 'motor_vehicle', 'vehicle', 'access']
NAMED_SPEEDS = {'PL:urban': 50, 'PL:rural': 90, 'PL:living_street': 20, 'PL:zone30': 30, 'PL:motorway': 140, 'PL:expressway': 120, 'walk': 10}


def inside(lat, lon):
    return BBOX[0] <= lon <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]


def car_access(t):
    """'yes', 'destination' (allowed, penalised at runtime) or 'no'."""
    for key in ACCESS_KEYS:
        value = t.get(key)
        if value is None:
            continue
        value = value.split(';')[0].strip()
        if value in ALLOW:
            return 'yes'
        if value in DESTINATION:
            return 'destination'
        return 'no'  # no, private, delivery, agricultural, forestry, psv, bus, emergency, permit, ...
    return 'yes'


def oneway(t):
    value = t.get('oneway')
    if value in ('yes', 'true', '1'):
        return 1
    if value in ('-1', 'reverse'):
        return -1
    if value in ('reversible', 'alternating'):
        return None  # direction changes over time: not routable without schedules
    if value == 'no':
        return 0
    if t.get('junction') in ('roundabout', 'circular') or t.get('highway') in ('motorway', 'motorway_link'):
        return 1
    return 0


def maxspeed(t):
    value = (t.get('maxspeed') or '').strip()
    if value in NAMED_SPEEDS:
        return NAMED_SPEEDS[value]
    m = re.match(r'^(\d+(?:\.\d+)?)\s*(mph|km/h|kmh)?$', value)
    if not m:
        return 0
    speed = float(m.group(1)) * (1.609 if m.group(2) == 'mph' else 1)
    return int(round(speed)) if 0 < speed < 200 else 0


def number(value):
    try:
        n = int(str(value).strip())
        return n if n >= 0 else None
    except (TypeError, ValueError):
        return None


def ring_centroid(points):
    """Area centroid of a closed ring of (lat, lon); falls back to the vertex mean."""
    a = cx = cy = 0.0
    for (y0, x0), (y1, x1) in zip(points, points[1:] + points[:1]):
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if abs(a) < 1e-14:
        return sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points)
    return cy / (3 * a), cx / (3 * a)


def contains(ring, lat, lon):
    hit = False
    for (y0, x0), (y1, x1) in zip(ring, ring[1:] + ring[:1]):
        if (y0 > lat) != (y1 > lat) and lon < (x1 - x0) * (lat - y0) / (y1 - y0) + x0:
            hit = not hit
    return hit


def disabled_space(t):
    """Capacity of a disabled parking space feature, or None if it is not one."""
    if t.get('amenity') != 'parking_space' and t.get('parking_space') != 'disabled':
        return None
    if t.get('parking_space') == 'disabled' or t.get('disabled') == 'designated' or t.get('access:disabled') == 'designated':
        return number(t.get('capacity')) or 1
    n = number(t.get('capacity:disabled'))
    if n:
        return n
    return 1 if t.get('capacity:disabled') == 'yes' else None


class Collect(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.index = {}
        self.lat = []
        self.lon = []
        self.signals = set()
        self.names = {}
        self.ways = {'id': [], 'cls': [], 'oneway': [], 'maxspeed': [], 'dest': [], 'name': [], 'offsets': [0], 'nodes': []}
        self.parkings = []
        self.rings = []
        self.spaces = []
        self.skipped = {'access': 0, 'reversible': 0, 'outsideBbox': 0}

    def node_index(self, ref, lat, lon):
        i = self.index.get(ref)
        if i is None:
            i = len(self.lat)
            self.index[ref] = i
            self.lat.append(round(lat * 1e6))
            self.lon.append(round(lon * 1e6))
        return i

    def node(self, n):
        if not n.location.valid() or not inside(n.location.lat, n.location.lon):
            return
        t = n.tags
        if t.get('highway') == 'traffic_signals':
            self.signals.add(n.id)
        if t.get('amenity') == 'parking':
            self.add_parking(t, f'node/{n.id}', n.location.lat, n.location.lon, str(n.timestamp), None)
        capacity = disabled_space(t)
        if capacity:
            self.spaces.append({'id': f'node/{n.id}', 'lat': round(n.location.lat, 7), 'lon': round(n.location.lon, 7), 'capacity': capacity})

    def way(self, w):
        t = w.tags
        highway = t.get('highway')
        if highway not in CLASS_INDEX or t.get('area') == 'yes' or t.get('service') == 'emergency_access':
            return
        access = car_access(t)
        if access == 'no':
            self.skipped['access'] += 1
            return
        direction = oneway(t)
        if direction is None:
            self.skipped['reversible'] += 1
            return
        refs = []
        for n in w.nodes:
            if not n.location.valid() or not inside(n.location.lat, n.location.lon):
                self.skipped['outsideBbox'] += 1
                return
            refs.append((n.ref, n.location.lat, n.location.lon))
        if len(refs) < 2:
            return
        name = t.get('name')
        name_index = -1
        if name:
            name_index = self.names.setdefault(name, len(self.names))
        ways = self.ways
        ways['id'].append(w.id)
        ways['cls'].append(CLASS_INDEX[highway])
        ways['oneway'].append(direction)
        ways['maxspeed'].append(maxspeed(t))
        ways['dest'].append(1 if access == 'destination' else 0)
        ways['name'].append(name_index)
        ways['nodes'].extend(self.node_index(ref, lat, lon) for ref, lat, lon in refs)
        ways['offsets'].append(len(ways['nodes']))

    def area(self, a):
        t = a.tags
        parking = t.get('amenity') == 'parking'
        capacity = disabled_space(t)
        if not parking and not capacity:
            return
        rings = [[(n.lat, n.lon) for n in ring] for ring in a.outer_rings()]
        rings = [r[:-1] if len(r) > 1 and r[0] == r[-1] else r for r in rings]
        rings = [r for r in rings if len(r) >= 3]
        if not rings:
            return
        ring = max(rings, key=len)
        lat, lon = ring_centroid(ring)
        if not inside(lat, lon):
            return
        source = f"{'way' if a.from_way() else 'relation'}/{a.orig_id()}"
        if parking:
            self.add_parking(t, source, lat, lon, str(a.timestamp), rings)
        if capacity:
            self.spaces.append({'id': source, 'lat': round(lat, 7), 'lon': round(lon, 7), 'capacity': capacity})

    def add_parking(self, t, source, lat, lon, edited, rings):
        if t.get('access') in ('private', 'no') or t.get('motor_vehicle') in ('private', 'no') or t.get('motorcar') in ('private', 'no'):
            return
        disabled = t.get('capacity:disabled')
        self.parkings.append({
            'id': source,
            'name': t.get('name') or None,
            'lat': round(lat, 7),
            'lon': round(lon, 7),
            'capacity': number(t.get('capacity')),
            # 'yes' | 'no' | integer count | None (not tagged)
            'disabled': number(disabled) if number(disabled) is not None else (disabled if disabled in ('yes', 'no') else None),
            'mappedDisabled': 0,
            'fee': t.get('fee') if t.get('fee') in ('yes', 'no') else None,
            'access': t.get('access') or None,
            'type': t.get('parking') or None,
            'editedAt': edited,
        })
        self.rings.append(rings)


def main():
    file = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/krok-malopolskie.osm.pbf')
    header = osmium.io.Reader(str(file)).header()
    c = Collect()
    c.apply_file(str(file), locations=True, idx='flex_mem')

    # Attach mapped disabled spaces to the car park whose outline contains them.
    for space in c.spaces:
        space['parking'] = -1
        for i, rings in enumerate(c.rings):
            if not rings:
                continue
            p = c.parkings[i]
            if abs(p['lat'] - space['lat']) > 0.01 or abs(p['lon'] - space['lon']) > 0.015:
                continue
            if any(contains(r, space['lat'], space['lon']) for r in rings):
                space['parking'] = i
                p['mappedDisabled'] += space['capacity']
                break

    signals = sorted(c.index[s] for s in c.signals if s in c.index)
    names = [None] * len(c.names)
    for name, i in c.names.items():
        names[i] = name
    meta = {
        'obtainedAt': datetime.now(timezone.utc).isoformat(),
        'sourceDate': header.get('osmosis_replication_timestamp') or None,
        'bbox': BBOX,
        'url': SOURCE,
        'sha256': hashlib.file_digest(file.open('rb'), 'sha256').hexdigest(),
        'licence': 'ODbL-1.0',
    }
    roads = {**meta, 'classes': CLASSES, 'names': names, 'lat': c.lat, 'lon': c.lon, 'signals': signals, 'ways': c.ways}
    parking = {**meta, 'parkings': c.parkings, 'spaces': c.spaces}

    def write(name, body):
        out = ROOT / 'data' / name
        temp = out.with_suffix('.tmp')
        temp.write_bytes(gzip.compress(json.dumps(body, ensure_ascii=False, separators=(',', ':')).encode('utf8'), mtime=0))
        os.replace(temp, out)

    write('krakow-roads.json.gz', roads)
    write('krakow-parking.json.gz', parking)

    with_disabled = [p for p in c.parkings if (isinstance(p['disabled'], int) and p['disabled'] > 0) or p['disabled'] == 'yes' or p['mappedDisabled'] > 0]
    counts = {
        'roadWays': len(c.ways['id']),
        'roadNodes': len(c.lat),
        'trafficSignals': len(signals),
        'oneway': sum(1 for o in c.ways['oneway'] if o != 0),
        'withMaxspeed': sum(1 for s in c.ways['maxspeed'] if s),
        'destinationOnly': sum(c.ways['dest']),
        'skipped': c.skipped,
        'parkings': len(c.parkings),
        'parkingsNamed': sum(1 for p in c.parkings if p['name']),
        'parkingsWithDisabledTag': sum(1 for p in c.parkings if p['disabled'] is not None),
        'parkingsWithDisabledSpaces': len(with_disabled),
        'parkingsWithFeeTag': sum(1 for p in c.parkings if p['fee']),
        'disabledSpaceFeatures': len(c.spaces),
        'disabledSpaceCapacity': sum(s['capacity'] for s in c.spaces),
        'disabledSpacesOutsideCarParks': sum(1 for s in c.spaces if s['parking'] < 0),
    }
    (ROOT / 'data' / 'roads-metadata.json').write_text(json.dumps({**meta, 'counts': counts}, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(counts, indent=2))


main()
