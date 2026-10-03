#!/usr/bin/env python3
"""Atomic, source-preserving ZTP GTFS cache. No invented times or accessibility."""
import csv, io, json, os, sqlite3, zipfile, urllib.request, hashlib, tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / '.runtime'
RUNTIME.mkdir(exist_ok=True, mode=0o700)
target = RUNTIME / 'transit.sqlite'
temporary = RUNTIME / 'transit.next.sqlite'
temporary.unlink(missing_ok=True)
db = sqlite3.connect(temporary)
db.executescript('''
CREATE TABLE stops(id TEXT PRIMARY KEY,name TEXT,code TEXT,lat REAL,lon REAL,wheelchair TEXT);
CREATE TABLE routes(id TEXT PRIMARY KEY,name TEXT,type INTEGER);
CREATE TABLE trips(id TEXT PRIMARY KEY,route TEXT,service TEXT,headsign TEXT,shape TEXT,wheelchair TEXT);
CREATE TABLE calendar(service TEXT PRIMARY KEY,start TEXT,end TEXT,days TEXT);
CREATE TABLE exceptions(service TEXT,date TEXT,type INTEGER);
CREATE TABLE connections(trip TEXT,from_id TEXT,to_id TEXT,departure INTEGER,arrival INTEGER,sequence INTEGER,pickup INTEGER,dropoff INTEGER);
CREATE TABLE shapes(id TEXT PRIMARY KEY,points TEXT);
CREATE TABLE metadata(body TEXT);
''')
def seconds(text):
    h, m, s = map(int, text.split(':')); return h*3600+m*60+s
metadata = {'obtainedAt': datetime.now(timezone.utc).isoformat(), 'source': 'https://gtfs.ztp.krakow.pl/', 'feeds': []}
for feed in 'AMT':
    url = f'https://gtfs.ztp.krakow.pl/GTFS_KRK_{feed}.zip'
    local = os.environ.get('GTFS_LOCAL_DIR')
    if local:
        raw = (Path(local) / f'krok-gtfs-{feed}.zip').read_bytes()
    else:
        req = urllib.request.Request(url, headers={'User-Agent': 'KazdyKrok-local-prototype/0.1'})
        with urllib.request.urlopen(req, timeout=90) as response: raw = response.read(80_000_000)
    archive = zipfile.ZipFile(io.BytesIO(raw))
    def rows(name):
        return csv.DictReader(io.TextIOWrapper(archive.open(name), encoding='utf-8-sig'))
    def key(value): return feed+':'+value
    counts = {}
    stops = list(rows('stops.txt'))
    db.executemany('INSERT INTO stops VALUES (?,?,?,?,?,?)', [(key(s['stop_id']),s['stop_name'],s.get('stop_code',''),float(s['stop_lat']),float(s['stop_lon']),s.get('wheelchair_boarding','')) for s in stops])
    routes = list(rows('routes.txt'))
    db.executemany('INSERT INTO routes VALUES (?,?,?)',[(key(r['route_id']),r['route_short_name'],int(r['route_type'])) for r in routes])
    trips = list(rows('trips.txt'))
    db.executemany('INSERT INTO trips VALUES (?,?,?,?,?,?)',[(key(t['trip_id']),key(t['route_id']),key(t['service_id']),t.get('trip_headsign',''),key(t.get('shape_id','')),t.get('wheelchair_accessible','')) for t in trips])
    db.executemany('INSERT INTO calendar VALUES (?,?,?,?)',[(key(c['service_id']),c['start_date'],c['end_date'],','.join(c[d] for d in ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])) for c in rows('calendar.txt')])
    db.executemany('INSERT INTO exceptions VALUES (?,?,?)',[(key(c['service_id']),c['date'],int(c['exception_type'])) for c in rows('calendar_dates.txt')])
    times = {}
    for s in rows('stop_times.txt'):
        times.setdefault(s['trip_id'],[]).append(s)
    batch = []
    for trip, sequence in times.items():
        sequence.sort(key=lambda s:int(s['stop_sequence']))
        for a,b in zip(sequence,sequence[1:]):
            dep,arr = seconds(a['departure_time']),seconds(b['arrival_time'])
            if arr < dep: raise ValueError('Non-monotonic GTFS times')
            batch.append((key(trip),key(a['stop_id']),key(b['stop_id']),dep,arr,int(a['stop_sequence']),int(a.get('pickup_type') or 0),int(b.get('drop_off_type') or 0)))
    db.executemany('INSERT INTO connections VALUES (?,?,?,?,?,?,?,?)',batch)
    shapes = {}
    for s in rows('shapes.txt'):
        shapes.setdefault(s['shape_id'],[]).append((int(s['shape_pt_sequence']),float(s['shape_pt_lat']),float(s['shape_pt_lon'])))
    db.executemany('INSERT INTO shapes VALUES (?,?)',[(key(k),json.dumps([[lat,lon] for _,lat,lon in sorted(v)],separators=(',',':'))) for k,v in shapes.items()])
    info = next(rows('feed_info.txt'))
    metadata['feeds'].append({'feed':feed,'url':url,'sha256':hashlib.sha256(raw).hexdigest(),'version':info['feed_version'],'stops':len(stops),'routes':len(routes),'trips':len(trips),'connections':len(batch)})
    db.commit()
db.executescript('CREATE INDEX departures ON connections(departure); CREATE INDEX trip_connections ON connections(trip,sequence); CREATE INDEX service_trips ON trips(service); CREATE INDEX service_dates ON exceptions(date);')
db.execute('INSERT INTO metadata VALUES (?)',(json.dumps(metadata),));db.commit();db.close()
os.replace(temporary,target)
(ROOT/'data'/'transit-metadata.json').write_text(json.dumps(metadata,indent=2)+'\n')
print(json.dumps(metadata,indent=2))
