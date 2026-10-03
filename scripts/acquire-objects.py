"""Extract named places for the "Odkrywaj" tab (museums, landmarks, culture, public offices, toilets, hotels, food, health, parks)
with their accessibility-relevant OSM tags and nearby entrance nodes. Output is ODbL (OpenStreetMap contributors).
Usage: /tmp/krok-data-venv/bin/python scripts/acquire-objects.py [/tmp/krok-malopolskie.osm.pbf]

data/krakow-objects.json.gz:
  {v, licence, attribution, obtainedAt, sourceDate, objects:[{
    id: 'node:1'|'way:2'|'relation:3', also: [other OSM ids merged as duplicates],
    c: category, k: 'tourism=museum' (OSM type), n: name|null, la, lo (centroid), ts: element timestamp,
    t: {kept tags}, e: [{id, d: metres from object point (0 = on/inside outline), ts, t: {entrance tags}}]}]}
Missing tags are simply absent: absence is never turned into "accessible".
"""
import osmium, json, sys, hashlib, os, gzip, math
from pathlib import Path
from datetime import datetime, timezone
ROOT=Path(__file__).resolve().parents[1]
BBOX=[19.75,49.94,20.25,50.20]
SOURCE='https://download.geofabrik.de/europe/poland/malopolskie.html'
ENTRANCE_RADIUS=25
MAX_ENTRANCES=8

def inside(lat,lon):return BBOX[0]<=lon<=BBOX[2] and BBOX[1]<=lat<=BBOX[3]
def r6(x):return round(x,6)
def metres(a,b):
 x=math.radians(b[1]-a[1])*math.cos(math.radians((a[0]+b[0])/2));y=math.radians(b[0]-a[0]);return 6371000*math.hypot(x,y)

NOTABLE_HISTORIC={'castle','monument','archaeological_site','city_gate','fort','palace','citywalls'}
def classify(t):
 """Return (category, osm type) or None. Order matters: museum beats attraction etc."""
 tourism=t.get('tourism');amenity=t.get('amenity');historic=t.get('historic');leisure=t.get('leisure');hc=t.get('healthcare')
 if t.get('access') in ('private','no'):return None
 if tourism=='museum':return 'museum','tourism=museum'
 if amenity in ('theatre','cinema','library','concert_hall','arts_centre'):return 'culture',f'amenity={amenity}'
 if tourism=='gallery':return 'culture','tourism=gallery'
 if amenity=='toilets':return 'toilet','amenity=toilets'
 if tourism in ('hotel','hostel','guest_house'):return 'hotel',f'tourism={tourism}'
 if amenity in ('hospital','clinic','pharmacy','doctors'):return 'health',f'amenity={amenity}'
 if hc in ('hospital','clinic','pharmacy','doctor') and not amenity:return 'health',f'healthcare={hc}'
 if amenity=='townhall' or t.get('office')=='government':return 'office','amenity=townhall' if amenity=='townhall' else 'office=government'
 if tourism=='attraction':return 'landmark','tourism=attraction'
 if historic in NOTABLE_HISTORIC:return 'landmark',f'historic={historic}'
 # Memorials and churches are numerous; keep the notable ones (with a Wikidata/Wikipedia entry).
 notable='wikidata' in t or 'wikipedia' in t
 if historic=='memorial' and notable:return 'landmark','historic=memorial'
 if amenity=='place_of_worship' and notable:return 'landmark','amenity=place_of_worship'
 if tourism=='viewpoint':return 'landmark','tourism=viewpoint'
 if amenity in ('restaurant','cafe') and any(k.startswith('wheelchair') for k in t):return 'food',f'amenity={amenity}'
 if leisure=='park':return 'park','leisure=park'
 return None

KEEP_EXACT={'wheelchair','toilets:wheelchair','toilets','step_count','elevator','door','width','door:width','automatic_door','hearing_loop','opening_hours','website','contact:website','name:en','name:de','check_date','fee','access','changing_table','entrance','handrail','capacity:disabled','tactile_paving','level','unisex','centralkey','kerb','surface','smoking','stars'}
KEEP_PREFIX=('wheelchair:','ramp','addr:','check_date:','toilets:wheelchair:','entrance:')
def keep(t):return {k:v[:600] for k,v in t.items() if k in KEEP_EXACT or k.startswith(KEEP_PREFIX)}
ENTRANCE_KEYS={'entrance','wheelchair','wheelchair:description','step_count','width','door','door:width','automatic_door','ramp','ramp:wheelchair','kerb','level','access','handrail','check_date','name','ref','description'}
def entrance_tags(t):return {k:v[:300] for k,v in t.items() if k in ENTRANCE_KEYS or k.startswith('wheelchair:') or k.startswith('ramp:')}

def point_in_ring(lat,lon,ring):
 hit=False;j=len(ring)-1
 for i in range(len(ring)):
  yi,xi=ring[i];yj,xj=ring[j]
  if (yi>lat)!=(yj>lat) and lon<(xj-xi)*(lat-yi)/((yj-yi) or 1e-12)+xi:hit=not hit
  j=i
 return hit

class Collect(osmium.SimpleHandler):
 def __init__(self):super().__init__();self.objects=[];self.entrances=[]
 def add(self,kind,oid,t,lat,lon,ts,rings=None):
  cls=classify(t)
  if cls is None:return
  name=(t.get('name') or '').strip() or None
  if name is None and cls[0]!='toilet':return
  if not inside(lat,lon):return
  # Entrances are matched to building outlines only: a square or park outline would collect unrelated shop doors.
  outline='building' if 'building' in t or 'building:part' in t else ('area' if rings else None)
  self.objects.append({'id':f'{kind}:{oid}','c':cls[0],'k':cls[1],'n':name,'la':r6(lat),'lo':r6(lon),'ts':ts,'t':keep(t),'rings':rings,'outline':outline})
 def node(self,n):
  if not n.location.valid() or not len(n.tags):return
  lat,lon=n.location.lat,n.location.lon
  if not inside(lat,lon):return
  t={x.k:x.v for x in n.tags}
  ts=n.timestamp.isoformat().replace('+00:00','Z') if n.timestamp else None
  if 'entrance' in t:self.entrances.append({'id':n.id,'la':lat,'lo':lon,'ts':ts,'t':entrance_tags(t)})
  self.add('node',n.id,t,lat,lon,ts)
 def way(self,w):
  t={x.k:x.v for x in w.tags}
  if not t or classify(t) is None:return
  coords=[]
  for n in w.nodes:
   if not n.location.valid():return
   coords.append((n.location.lat,n.location.lon))
  if len(coords)<2:return
  closed=coords[0]==coords[-1] and len(coords)>3
  ring=coords[:-1] if closed else coords
  clat=sum(c[0] for c in ring)/len(ring);clon=sum(c[1] for c in ring)/len(ring)
  ts=w.timestamp.isoformat().replace('+00:00','Z') if w.timestamp else None
  self.add('way',w.id,t,clat,clon,ts,[coords] if closed else None)
 def area(self,a):
  if a.from_way():return
  t={x.k:x.v for x in a.tags}
  if classify(t) is None:return
  rings=[[(n.lat,n.lon) for n in ring if n.location.valid()] for ring in a.outer_rings()]
  rings=[r for r in rings if len(r)>3]
  pts=[p for r in rings for p in r]
  if not pts:return
  clat=sum(p[0] for p in pts)/len(pts);clon=sum(p[1] for p in pts)/len(pts)
  ts=a.timestamp.isoformat().replace('+00:00','Z') if a.timestamp else None
  self.add('relation',a.orig_id(),t,clat,clon,ts,rings)

file=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/krok-malopolskie.osm.pbf');header=osmium.io.Reader(str(file)).header()
c=Collect();c.apply_file(str(file),locations=True,idx='flex_mem')

# Entrance grid (~110 m cells).
CELL=0.001;egrid={}
for i,e in enumerate(c.entrances):egrid.setdefault((int(e['la']/CELL),int(e['lo']/CELL)),[]).append(i)
def entrances_for(o):
 """Entrances on/inside the outline (d=0) or within ENTRANCE_RADIUS of the object point; nearest first, main first."""
 found={}
 if o['outline']=='area':return []
 lat,lon=o['la'],o['lo']
 rings=o['rings'] or []
 if rings:
  pts=[p for r in rings for p in r];minla=min(p[0] for p in pts);maxla=max(p[0] for p in pts);minlo=min(p[1] for p in pts);maxlo=max(p[1] for p in pts)
  # Skip huge outlines (parks, campuses): their many gates would not describe one entrance.
  if metres((minla,minlo),(maxla,maxlo))>800:rings=[]
 if rings:
  for gy in range(int(minla/CELL)-1,int(maxla/CELL)+2):
   for gx in range(int(minlo/CELL)-1,int(maxlo/CELL)+2):
    for i in egrid.get((gy,gx),()):
     e=c.entrances[i]
     # On the outline (exact vertex) or inside a ring.
     if any((e['la'],e['lo']) in r or point_in_ring(e['la'],e['lo'],r) for r in rings):found[i]=0.0
 gy,gx=int(lat/CELL),int(lon/CELL)
 for dy in (-1,0,1):
  for dx in (-1,0,1):
   for i in egrid.get((gy+dy,gx+dx),()):
    if i in found:continue
    e=c.entrances[i];d=metres((lat,lon),(e['la'],e['lo']))
    if d<=ENTRANCE_RADIUS:found[i]=round(d,1)
 rank={'main':0,'yes':1,'secondary':2,'home':2,'staircase':3,'service':4,'exit':5,'emergency':6}
 items=sorted(found.items(),key=lambda x:(rank.get(c.entrances[x[0]]['t'].get('entrance'),3),x[1]))[:MAX_ENTRANCES]
 return [{'id':f"node:{c.entrances[i]['id']}",'d':d,'ts':c.entrances[i]['ts'],'t':c.entrances[i]['t']} for i,d in items]

# Dedupe: same folded name + category within 150 m (POI node + building outline). Keep the richer record, union tags.
def richness(o):return sum(1 for k in o['t'] if k.startswith(('wheelchair','toilets:wheelchair','ramp','step_count','elevator','automatic_door','door','hearing_loop')))*10+len(o['t'])+(5 if o['rings'] else 0)
groups={};objects=[]
for o in sorted(c.objects,key=lambda o:-richness(o)):
 # Unnamed toilets: merge only near-identical points (paired M/F nodes).
 key=((o['n'] or '').lower(),o['c']);dup=None;limit=150 if o['n'] else 15
 for q in groups.get(key,()):
  if metres((o['la'],o['lo']),(q['la'],q['lo']))<limit:dup=q;break
 if dup:
  dup.setdefault('also',[]).append(o['id'])
  for k,v in o['t'].items():dup['t'].setdefault(k,v)
  if o['outline']=='building' and dup['outline']!='building':dup['rings']=o['rings'];dup['outline']='building'
  continue
 groups.setdefault(key,[]).append(o);objects.append(o)

ACCESS_KEYS=('wheelchair','toilets:wheelchair','ramp','step_count','elevator','automatic_door','door:width','hearing_loop','capacity:disabled')
counts={};with_access={};with_entrance_access={}
for o in objects:
 o['e']=entrances_for(o);del o['rings'];del o['outline']
 cat=o['c'];counts[cat]=counts.get(cat,0)+1
 has=any(k.startswith(ACCESS_KEYS) for k in o['t']);ent=any(any(k.startswith(('wheelchair','step_count','ramp','width','automatic_door','door')) for k in e['t']) for e in o['e'])
 if has or ent:with_access[cat]=with_access.get(cat,0)+1
 if ent:with_entrance_access[cat]=with_entrance_access.get(cat,0)+1
objects.sort(key=lambda o:(o['c'],o['id']))
obtained=datetime.now(timezone.utc).isoformat()
result={'v':1,'licence':'ODbL-1.0','attribution':'© OpenStreetMap contributors','obtainedAt':obtained,'sourceDate':header.get('osmosis_replication_timestamp') or None,'objects':objects}
out=ROOT/'data/krakow-objects.json.gz';temp=out.with_suffix('.tmp')
temp.write_bytes(gzip.compress(json.dumps(result,ensure_ascii=False,separators=(',',':')).encode('utf8'),compresslevel=9,mtime=0));os.replace(temp,out)
meta={'obtainedAt':obtained,'sourceDate':result['sourceDate'],'bbox':BBOX,'url':SOURCE,'sha256':hashlib.file_digest(file.open('rb'),'sha256').hexdigest(),'licence':'ODbL-1.0',
 'counts':dict(sorted(counts.items())),'withAccessibilityData':dict(sorted(with_access.items())),'withEntranceAccessibilityData':dict(sorted(with_entrance_access.items())),
 'total':len(objects),'totalWithAccessibilityData':sum(with_access.values()),'entranceNodesInArea':len(c.entrances),'bytes':out.stat().st_size,
 'note':'withAccessibilityData = object or an assigned entrance has at least one accessibility tag (wheelchair*, toilets:wheelchair, ramp*, step_count, elevator, automatic_door, door/width). Not a count of accessible places.'}
(ROOT/'data/objects-metadata.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'counts':meta['counts'],'withAccess':meta['withAccessibilityData'],'total':meta['total'],'bytes':meta['bytes']}))
