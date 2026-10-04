"""Filter a Geofabrik PBF locally. Output is ODbL, with source timestamps.
Usage: python3 scripts/acquire-city.py /path/to/malopolskie.osm.pbf   (needs the osmium package)
"""
import osmium, json, sys, hashlib, os, gzip
from pathlib import Path
from datetime import datetime, timezone
ROOT=Path(__file__).resolve().parents[1]
BBOX=[19.75,49.94,20.25,50.20]
SOURCE='https://download.geofabrik.de/europe/poland/malopolskie.html'
allowed={'footway','path','steps','pedestrian','living_street','residential','unclassified','service','tertiary','tertiary_link','secondary','secondary_link','primary','primary_link'}
keep={'highway','name','surface','smoothness','incline','step_count','handrail','handrail:left','handrail:right','handrail:center','handrail:both','access','foot','barrier','oneway','oneway:foot','sidewalk','sidewalk:left','sidewalk:right','width','kerb','wheelchair','entrance','amenity','backrest','material','indoor','fee','area','lit','ramp','ramp:wheelchair'}
def tags(obj):return {t.k:t.v for t in obj.tags if t.k in keep}
def inside(lat,lon):return BBOX[0]<=lon<=BBOX[2] and BBOX[1]<=lat<=BBOX[3]
class Collect(osmium.SimpleHandler):
 def __init__(self):super().__init__();self.nodes={};self.features=[];self.ways=[];self.node_tags={}
 def node(self,n):
  if not n.location.valid() or not inside(n.location.lat,n.location.lon):return
  t=tags(n)
  if not t:return
  data={'id':str(n.id),'lat':n.location.lat,'lon':n.location.lon,'tags':t,'editedAt':str(n.timestamp)}
  if t.get('amenity')=='bench' or t.get('entrance') or t.get('barrier'):self.features.append(data)
  self.node_tags[str(n.id)]=data
 def way(self,w):
  t=tags(w)
  if t.get('highway') not in allowed or t.get('area')=='yes' or t.get('access') in {'private','no','customers'} or t.get('foot') in {'private','no'} or t.get('indoor')=='yes' or t.get('fee')=='yes':return
  coords=[]
  for n in w.nodes:
   if not n.location.valid() or not inside(n.location.lat,n.location.lon):return
   coords.append((str(n.ref),n.location.lat,n.location.lon))
  if len(coords)<2:return
  for id,lat,lon in coords:self.nodes[id]=self.node_tags.get(id,{'id':id,'lat':lat,'lon':lon,'tags':{},'editedAt':None})
  self.ways.append({'id':str(w.id),'nodes':[c[0] for c in coords],'tags':t,'editedAt':str(w.timestamp)})
file=Path(sys.argv[1]);header=osmium.io.Reader(str(file)).header()
c=Collect();c.apply_file(str(file),locations=True,idx='flex_mem')
result={'obtainedAt':datetime.now(timezone.utc).isoformat(),'sourceDate':header.get('osmosis_replication_timestamp') or None,'bbox':BBOX,'url':SOURCE,'sha256':hashlib.file_digest(file.open('rb'),'sha256').hexdigest(),'licence':'ODbL-1.0','nodes':c.nodes,'ways':c.ways,'features':c.features,'context':[]}
out=ROOT/'data/krakow-city.json.gz';temp=out.with_suffix('.tmp');temp.write_bytes(gzip.compress(json.dumps(result,ensure_ascii=False,separators=(',',':')).encode('utf8'),mtime=0));os.replace(temp,out)
stats={'nodes':len(c.nodes),'ways':len(c.ways),'stairs':sum(w['tags'].get('highway')=='steps' for w in c.ways),'benches':sum(n['tags'].get('amenity')=='bench' for n in c.features),'entrances':sum(bool(n['tags'].get('entrance')) for n in c.features)}
meta={k:v for k,v in result.items() if k not in ['nodes','ways','features','context']};meta['counts']=stats
(ROOT/'data/city-metadata.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n');print(json.dumps(stats))
