"""Build a compact local search index (addresses, streets, named places) from a Geofabrik PBF.
Output is ODbL (OpenStreetMap contributors), with source checksum.
Usage: /tmp/krok-data-venv/bin/python scripts/acquire-places.py [/tmp/krok-malopolskie.osm.pbf]

Format of data/krakow-places.json.gz (compact arrays, coordinates rounded to 5 decimals ~1 m):
  areas:     [name, lat, lon]                      place=suburb/quarter/neighbourhood/village/town (detail labels)
  streets:   [name, lat, lon, areaIndex]           one point per spatially separate same-name cluster
  addresses: [street, housenumber, lat, lon, postcode, city, areaIndex, osmRef]
  pois:      [name, categoryIndex, lat, lon, areaIndex, osmRef]
  categories: Polish labels referenced by pois
"""
import osmium, json, sys, hashlib, os, gzip, math
from pathlib import Path
from datetime import datetime, timezone
ROOT=Path(__file__).resolve().parents[1]
BBOX=[19.75,49.94,20.25,50.20]
SOURCE='https://download.geofabrik.de/europe/poland/malopolskie.html'
STREET_CLASSES={'footway','path','pedestrian','living_street','residential','unclassified','service','tertiary','tertiary_link','secondary','secondary_link','primary','primary_link','trunk','trunk_link','cycleway','track','steps'}
AREA_PLACES={'suburb':0,'quarter':1,'neighbourhood':2,'village':1,'town':0,'hamlet':2,'city_block':3}
CATEGORIES={
 'amenity':{'hospital':'Szpital','clinic':'Przychodnia','doctors':'Lekarz','dentist':'Dentysta','pharmacy':'Apteka','university':'Uczelnia','college':'Szkoła','school':'Szkoła','kindergarten':'Przedszkole','library':'Biblioteka','cafe':'Kawiarnia','restaurant':'Restauracja','fast_food':'Bar szybkiej obsługi','bar':'Bar','pub':'Pub','ice_cream':'Lodziarnia','bank':'Bank','atm':'Bankomat','post_office':'Poczta','police':'Policja','fire_station':'Straż pożarna','townhall':'Urząd','courthouse':'Sąd','place_of_worship':'Kościół','theatre':'Teatr','cinema':'Kino','arts_centre':'Centrum kultury','community_centre':'Dom kultury','social_facility':'Pomoc społeczna','marketplace':'Targowisko','parking':'Parking','fuel':'Stacja paliw','bus_station':'Dworzec autobusowy','toilets':'Toaleta','veterinary':'Weterynarz','nightclub':'Klub','embassy':'Ambasada','car_rental':'Wypożyczalnia aut','bicycle_rental':'Rower miejski','charging_station':'Ładowarka','nursing_home':'Dom opieki','childcare':'Żłobek','events_venue':'Sala wydarzeń','conference_centre':'Centrum konferencyjne','music_school':'Szkoła muzyczna','language_school':'Szkoła językowa','driving_school':'Szkoła jazdy','studio':'Studio','post_depot':'Poczta','prison':'Areszt','grave_yard':'Cmentarz'},
 'shop':{'supermarket':'Supermarket','convenience':'Sklep spożywczy','bakery':'Piekarnia','mall':'Galeria handlowa','department_store':'Dom towarowy','clothes':'Odzież','shoes':'Obuwie','hairdresser':'Fryzjer','beauty':'Kosmetyczka','florist':'Kwiaciarnia','books':'Księgarnia','electronics':'Elektronika','mobile_phone':'Telefony','optician':'Optyk','butcher':'Mięsny','greengrocer':'Warzywniak','alcohol':'Alkohole','kiosk':'Kiosk','hardware':'Sklep budowlany','doityourself':'Market budowlany','furniture':'Meble','car':'Salon samochodowy','car_repair':'Warsztat','bicycle':'Sklep rowerowy','jewelry':'Jubiler','gift':'Upominki','pet':'Zoologiczny','chemist':'Drogeria','cosmetics':'Kosmetyki','medical_supply':'Sklep medyczny','travel_agency':'Biuro podróży','laundry':'Pralnia','dry_cleaning':'Pralnia','tobacco':'Tytoń','confectionery':'Słodycze','deli':'Delikatesy','sports':'Sklep sportowy','toys':'Zabawki','stationery':'Papierniczy','copyshop':'Punkt ksero','tailor':'Krawiec'},
 'tourism':{'museum':'Muzeum','hotel':'Hotel','hostel':'Hostel','guest_house':'Pensjonat','apartment':'Apartament','attraction':'Atrakcja','viewpoint':'Punkt widokowy','gallery':'Galeria','information':'Informacja turystyczna','zoo':'Zoo','artwork':'Dzieło sztuki','theme_park':'Park rozrywki','camp_site':'Kemping','motel':'Motel','aquarium':'Akwarium'},
 'leisure':{'park':'Park','garden':'Ogród','playground':'Plac zabaw','sports_centre':'Centrum sportowe','stadium':'Stadion','swimming_pool':'Basen','fitness_centre':'Siłownia','pitch':'Boisko','ice_rink':'Lodowisko','water_park':'Park wodny','dog_park':'Wybieg dla psów','nature_reserve':'Rezerwat','track':'Bieżnia','marina':'Przystań','sports_hall':'Hala sportowa','common':'Błonia'},
 'office':{'government':'Urząd','company':'Biuro','insurance':'Ubezpieczenia','lawyer':'Kancelaria','notary':'Notariusz','estate_agent':'Nieruchomości','educational_institution':'Instytucja edukacyjna','ngo':'Organizacja','association':'Stowarzyszenie','it':'Firma IT','employment_agency':'Agencja pracy','tax_advisor':'Doradca podatkowy','diplomatic':'Placówka dyplomatyczna'},
 'healthcare':{'hospital':'Szpital','clinic':'Przychodnia','doctor':'Lekarz','dentist':'Dentysta','pharmacy':'Apteka','physiotherapist':'Fizjoterapia','laboratory':'Laboratorium','rehabilitation':'Rehabilitacja','optometrist':'Optometrysta','psychotherapist':'Psychoterapia','centre':'Centrum medyczne'},
 'historic':{'monument':'Pomnik','memorial':'Miejsce pamięci','castle':'Zamek','church':'Kościół','building':'Zabytek','archaeological_site':'Stanowisko archeologiczne','fort':'Fort','city_gate':'Brama miejska','ruins':'Ruiny','wayside_shrine':'Kapliczka','wayside_cross':'Krzyż','tomb':'Grób','manor':'Dwór','palace':'Pałac','citywalls':'Mury miejskie'},
 'railway':{'station':'Dworzec','halt':'Przystanek kolejowy'},
 'public_transport':{'station':'Dworzec'},
 'building':{'university':'Uczelnia','hospital':'Szpital','church':'Kościół','cathedral':'Katedra','chapel':'Kaplica','school':'Szkoła','college':'Szkoła','kindergarten':'Przedszkole','train_station':'Dworzec','stadium':'Stadion','museum':'Muzeum','hotel':'Hotel','retail':'Handel','commercial':'Budynek','office':'Biurowiec','public':'Budynek publiczny','civic':'Budynek publiczny','dormitory':'Akademik','government':'Urząd','sports_hall':'Hala sportowa','castle':'Zamek','monastery':'Klasztor','synagogue':'Synagoga','mosque':'Meczet','temple':'Świątynia'},
 'place':{'square':'Plac'},
 'landuse':{'cemetery':'Cmentarz'},
 'natural':{'peak':'Wzgórze'},
}
POI_KEYS=list(CATEGORIES.keys())
GENERIC={'amenity':'Usługa','shop':'Sklep','tourism':'Turystyka','leisure':'Rekreacja','office':'Biuro','healthcare':'Zdrowie','historic':'Zabytek','building':'Budynek'}
# Too numerous or useless as a destination by name.
SKIP_POI={('amenity','bench'),('amenity','waste_basket'),('amenity','vending_machine'),('amenity','parking_space'),('amenity','bicycle_parking'),('amenity','recycling'),('amenity','post_box'),('amenity','telephone'),('amenity','drinking_water'),('amenity','shelter'),('leisure','picnic_table'),('tourism','artwork'),('amenity','parking_entrance'),('highway','bus_stop')}
def inside(lat,lon):return BBOX[0]<=lon<=BBOX[2] and BBOX[1]<=lat<=BBOX[3]
def r5(x):return round(x,5)
def metres(a,b):
 x=math.radians(b[1]-a[1])*math.cos(math.radians((a[0]+b[0])/2));y=math.radians(b[0]-a[0]);return 6371000*math.hypot(x,y)
def category(t):
 for k in POI_KEYS:
  v=t.get(k)
  if not v or (k,v) in SKIP_POI:continue
  if k=='building' and v in {'yes','house','residential','apartments','garage','garages','detached','semidetached_house','terrace','roof','shed'}:continue
  label=CATEGORIES[k].get(v)
  if label:return label
  if k in GENERIC and v not in {'no','yes'}:return GENERIC[k]
  if k=='building':return 'Budynek'
 if t.get('railway') in {'station','halt'}:return 'Dworzec'
 return None
class Collect(osmium.SimpleHandler):
 def __init__(self):
  super().__init__();self.areas=[];self.segments={};self.addresses=[];self.pois=[];self.squares=set()
 def address(self,t,lat,lon,ref):
  hn=t.get('addr:housenumber');street=t.get('addr:street') or t.get('addr:place')
  if not hn or not street or len(hn)>12:return
  self.addresses.append([street.strip(),hn.strip(),r5(lat),r5(lon),t.get('addr:postcode',''),t.get('addr:city',''),ref])
 def poi(self,t,lat,lon,ref):
  name=t.get('name')
  if not name or len(name)>120:return
  cat=category(t)
  if cat is None:return
  self.pois.append([name.strip(),cat,r5(lat),r5(lon),ref])
 def node(self,n):
  if not n.location.valid():return
  lat,lon=n.location.lat,n.location.lon
  if not inside(lat,lon):return
  t=n.tags
  if not len(t):return
  td={x.k:x.v for x in t}
  p=td.get('place')
  if p in AREA_PLACES and td.get('name'):self.areas.append([td['name'],r5(lat),r5(lon),AREA_PLACES[p]])
  if 'addr:housenumber' in td:self.address(td,lat,lon,f'n{n.id}')
  if 'name' in td:self.poi(td,lat,lon,f'n{n.id}')
 def way(self,w):
  td={x.k:x.v for x in w.tags}
  if not td:return
  hw=td.get('highway');want_addr='addr:housenumber' in td;want_poi='name' in td and category(td) is not None
  want_street=hw in STREET_CLASSES and 'name' in td
  if not(want_addr or want_poi or want_street):return
  coords=[]
  for n in w.nodes:
   if not n.location.valid():return
   coords.append((n.location.lat,n.location.lon))
  if len(coords)<2:return
  ring=coords[:-1] if coords[0]==coords[-1] and len(coords)>3 else coords
  clat=sum(c[0] for c in ring)/len(ring);clon=sum(c[1] for c in ring)/len(ring)
  if want_street and td.get('area')!='yes':
   inner=[c for c in coords if inside(*c)]
   if len(inner)>=2:
    length=sum(metres(inner[i-1],inner[i]) for i in range(1,len(inner)))
    mid=inner[len(inner)//2]
    if len(inner)==2:mid=((inner[0][0]+inner[1][0])/2,(inner[0][1]+inner[1][1])/2)
    self.segments.setdefault(td['name'].strip(),[]).append((length,mid,hw))
  elif want_street and inside(clat,clon):
   # Named pedestrian areas such as squares.
   self.pois.append([td['name'].strip(),'Plac',r5(clat),r5(clon),f'w{w.id}'])
  if not inside(clat,clon):return
  if want_addr:self.address(td,clat,clon,f'w{w.id}')
  if want_poi:self.poi(td,clat,clon,f'w{w.id}')
 def area(self,a):
  # Closed ways are handled in way(); here only multipolygon relations (e.g. Wawel, large campuses).
  if a.from_way():return
  td={x.k:x.v for x in a.tags}
  if 'addr:housenumber' not in td and not('name' in td and category(td) is not None):return
  pts=[(n.lat,n.lon) for ring in a.outer_rings() for n in ring if n.location.valid()]
  if not pts:return
  clat=sum(p[0] for p in pts)/len(pts);clon=sum(p[1] for p in pts)/len(pts)
  if not inside(clat,clon):return
  ref=f'r{a.orig_id()}'
  if 'addr:housenumber' in td:self.address(td,clat,clon,ref)
  if 'name' in td:self.poi(td,clat,clon,ref)
file=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/krok-malopolskie.osm.pbf');header=osmium.io.Reader(str(file)).header()
c=Collect();c.apply_file(str(file),locations=True,idx='flex_mem')

# Area lookup on a coarse grid: nearest named place node, preferring broader ones when close.
areas=c.areas;CELL=0.02;grid={}
for i,a in enumerate(areas):grid.setdefault((int(a[1]/CELL),int(a[2]/CELL)),[]).append(i)
def area_of(lat,lon):
 best=-1;bd=1e18;gy,gx=int(lat/CELL),int(lon/CELL)
 for dy in (-1,0,1):
  for dx in (-1,0,1):
   for i in grid.get((gy+dy,gx+dx),()):
    a=areas[i];d=metres((lat,lon),(a[1],a[2]))*(1+0.35*a[3])
    if d<bd:bd=d;best=i
 return best if bd<2500 else -1

# Streets: cluster same-name segments within 1.5 km; representative = middle of the longest segment.
streets=[]
for name,segs in c.segments.items():
 if len(name)>120:continue
 segs.sort(key=lambda s:-s[0]);clusters=[]
 for length,mid,hw in segs:
  for cl in clusters:
   if any(metres(mid,m)<1500 for m in cl['mids']):cl['mids'].append(mid);cl['total']+=length;break
  else:clusters.append({'rep':mid,'mids':[mid],'total':length,'hw':hw})
 for cl in clusters:
  # Skip tiny named footpaths/service roads that are probably park alleys or driveways.
  if cl['hw'] in {'footway','path','service','track','cycleway','steps'} and cl['total']<60:continue
  streets.append([name,r5(cl['rep'][0]),r5(cl['rep'][1]),area_of(*cl['rep'])])

# Dedupe addresses (node + building duplicates) by street+number, keeping the first (nodes come first).
seen=set();addresses=[]
for a in c.addresses:
 key=(a[0].lower(),a[1].lower())
 near=[k for k in ((key,round(a[2],2),round(a[3],2)),)]
 if near[0] in seen:continue
 seen.add(near[0]);city=a[5]
 addresses.append([a[0],a[1],a[2],a[3],a[4],'' if city in ('','Kraków') else city,area_of(a[2],a[3]),a[6]])

# Dedupe POIs: same name+category within ~150 m (node + building outline).
pois=[];pseen={}
for p in c.pois:
 key=(p[0].lower(),p[1]);dup=False
 for q in pseen.get(key,()):
  if metres((p[2],p[3]),(q[2],q[3]))<150:dup=True;break
 if dup:continue
 pseen.setdefault(key,[]).append(p);pois.append(p)
cats=sorted({p[1] for p in pois});ci={k:i for i,k in enumerate(cats)}
pois=[[p[0],ci[p[1]],p[2],p[3],area_of(p[2],p[3]),p[4]] for p in pois]

result={'v':1,'licence':'ODbL-1.0','attribution':'© OpenStreetMap contributors','areas':[a[:3] for a in areas],'categories':cats,'streets':streets,'addresses':addresses,'pois':pois}
out=ROOT/'data/krakow-places.json.gz';temp=out.with_suffix('.tmp')
temp.write_bytes(gzip.compress(json.dumps(result,ensure_ascii=False,separators=(',',':')).encode('utf8'),compresslevel=9,mtime=0));os.replace(temp,out)
counts={'areas':len(areas),'streets':len(streets),'streetNames':len({s[0] for s in streets}),'addresses':len(addresses),'pois':len(pois),'categories':len(cats)}
meta={'obtainedAt':datetime.now(timezone.utc).isoformat(),'sourceDate':header.get('osmosis_replication_timestamp') or None,'bbox':BBOX,'url':SOURCE,'sha256':hashlib.file_digest(file.open('rb'),'sha256').hexdigest(),'licence':'ODbL-1.0','counts':counts,'bytes':out.stat().st_size}
(ROOT/'data/places-metadata.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n');print(json.dumps(meta['counts']),meta['bytes'])
