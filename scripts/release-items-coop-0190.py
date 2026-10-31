"""Freeze/verify/ZIP a local 0.19.0 checkout. No app launch, network or profile access."""
from pathlib import Path
import hashlib, json, os, stat, subprocess, sys, zipfile

def digest(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
    return h.hexdigest()

def dump(p,value):
    p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')

def row(root,rel,source):
    p=root/rel
    if not p.is_file() or p.is_symlink(): raise RuntimeError('Nonregular file '+str(p))
    return {'path':rel,'source':source,'bytes':p.stat().st_size,'mode':stat.S_IMODE(p.stat().st_mode),'sha256':digest(p)}

def verify(root,manifest):
    bad=[]
    for old in manifest['files']:
        try:
            new=row(root,old['path'],old['source'])
            if new!=old: bad.append({'path':old['path'],'actual':new})
        except Exception as e: bad.append({'path':old['path'],'error':str(e)})
    if bad: raise RuntimeError(json.dumps(bad,ensure_ascii=False))
    return len(manifest['files'])

command=sys.argv[1]
root=Path(sys.argv[2]).resolve(strict=True)
if json.loads((root/'package.json').read_text())['version']!='0.19.0': raise RuntimeError('Wrong source version')
if command=='freeze':
    if subprocess.check_output(['git','status','--porcelain','--untracked-files=normal'],cwd=root,text=True).strip(): raise RuntimeError('Commit all source changes before freeze')
    out=Path(sys.argv[3]).resolve()
    tracked=subprocess.check_output(['git','ls-files','-z'],cwd=root).decode().split('\0')
    paths={s:True for s in tracked if s}
    if any(s.startswith(('.superpowers/','.git/','node_modules/','dist/','release/','work/')) for s in paths): raise RuntimeError('Unexpected generated tracked path')
    runtime=['dist/main.cjs','dist/preload.cjs','dist/game-worker.cjs','dist/action-worker.cjs','dist/dungeon-worker.cjs','dist/party-field-worker.cjs']
    runtime += [str(p.relative_to(root)) for p in (root/'dist/renderer').rglob('*') if p.is_file() and p.name not in {'foundation-probe.js','foundation-probe.html','foundation-probe.css'}]
    runtime += [str(p.relative_to(root)) for p in (root/'licenses').rglob('*') if p.is_file()]
    for s in runtime: paths.setdefault(s,False)
    files=[row(root,s,paths[s]) for s in sorted(paths)]
    canonical=hashlib.sha256(json.dumps(files,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
    manifest={'version':'0.19.0','root':'.','commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'canonical':canonical,'files':files}
    dump(out,manifest)
    print(json.dumps({'status':'PASS','files':len(files),'sourceFiles':sum(r['source'] for r in files),'canonical':canonical,'manifest':str(out)}))
elif command=='verify':
    manifest=json.loads(Path(sys.argv[3]).read_text())
    print(json.dumps({'status':'PASS','matched':verify(root,manifest),'canonical':manifest['canonical']}))
elif command=='zip':
    manifest=json.loads(Path(sys.argv[3]).read_text());verify(root,manifest)
    out=Path(sys.argv[4]).resolve(); receipt=Path(sys.argv[5]).resolve()
    if out.exists(): raise RuntimeError('Refusing to overwrite '+str(out))
    sources=[r for r in manifest['files'] if r['source']]
    out.parent.mkdir(parents=True,exist_ok=True)
    prefix='PixelStreet-0.19.0/'
    with zipfile.ZipFile(out,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for r in sources: z.write(root/r['path'],prefix+r['path'])
    with zipfile.ZipFile(out) as z:
        corrupt=z.testzip()
        if corrupt: raise RuntimeError('CRC '+corrupt)
        if set(z.namelist())!={prefix+r['path'] for r in sources}: raise RuntimeError('ZIP path mismatch')
        for r in sources:
            h=hashlib.sha256();count=0
            with z.open(prefix+r['path']) as f:
                for block in iter(lambda:f.read(1024*1024),b''):h.update(block);count+=len(block)
            if count!=r['bytes'] or h.hexdigest()!=r['sha256'] or stat.S_IMODE(z.getinfo(prefix+r['path']).external_attr>>16)!=r['mode']: raise RuntimeError('ZIP byte/mode mismatch '+r['path'])
    dump(receipt,{'status':'PASS','version':'0.19.0','sourceCommit':manifest['commit'],'frozenCanonical':manifest['canonical'],'zip':str(out),'bytes':out.stat().st_size,'sha256':digest(out),'crc':'PASS','files':sources})
    print(json.dumps({'status':'PASS','files':len(sources),'bytes':out.stat().st_size,'sha256':digest(out),'receipt':str(receipt)}))
elif command=='install-audit':
    # Read compressed entries one at a time; never extract a second App.
    app=Path(sys.argv[3]).resolve(strict=True); archive=Path(sys.argv[4]).resolve(strict=True); receipt=Path(sys.argv[5]).resolve()
    expected={}
    def appwalk(folder):
        for p in folder.iterdir():
            rel=str(p.relative_to(app.parent)); mode=p.lstat().st_mode
            if p.is_symlink():
                target=os.readlink(p)
                if not p.resolve(strict=True).is_relative_to(app): raise RuntimeError('Escaping App symlink '+str(p))
                data=target.encode(); expected[rel]={'kind':'link','bytes':len(data),'mode':stat.S_IMODE(mode),'sha256':hashlib.sha256(data).hexdigest(),'target':target}
            elif p.is_dir():
                expected[rel+'/']={'kind':'directory','mode':stat.S_IMODE(mode)}; appwalk(p)
            elif p.is_file(): expected[rel]={'kind':'file','bytes':p.stat().st_size,'mode':stat.S_IMODE(mode),'sha256':digest(p)}
            else: raise RuntimeError('Unexpected App entry '+str(p))
    expected[app.name+'/']={'kind':'directory','mode':stat.S_IMODE(app.stat().st_mode)};appwalk(app)
    with zipfile.ZipFile(archive) as z:
        names=z.namelist()
        if len(names)!=len(set(names)): raise RuntimeError('Duplicate install ZIP paths')
        metadata=[n for n in names if n.startswith('__MACOSX/')]
        for n in metadata:
            rel=n[len('__MACOSX/'):];parts=rel.rstrip('/').split('/')
            if parts[-1].startswith('._'): parts[-1]=parts[-1][2:]
            mapped='/'.join(parts)
            if rel and mapped not in expected and mapped+'/' not in expected: raise RuntimeError('Unbounded AppleDouble metadata '+n)
        if any('..' in Path(n).parts or n.startswith('/') for n in names): raise RuntimeError('Unsafe ZIP path')
        if set(names)-set(metadata)!=set(expected): raise RuntimeError('Install ZIP path set mismatch '+str((set(names)-set(metadata))^set(expected)))
        for name,row in expected.items():
            info=z.getinfo(name);mode=info.external_attr>>16
            if stat.S_IMODE(mode)!=row['mode']: raise RuntimeError('ZIP mode mismatch '+name)
            if row['kind']=='directory':
                if not info.is_dir(): raise RuntimeError('ZIP directory mismatch '+name)
            else:
                if row['kind']=='link' and not stat.S_ISLNK(mode): raise RuntimeError('ZIP lost symlink '+name)
                h=hashlib.sha256();count=0
                with z.open(info) as f:
                    for block in iter(lambda:f.read(1024*1024),b''):h.update(block);count+=len(block)
                if h.hexdigest()!=row['sha256'] or count!=row['bytes']: raise RuntimeError('Install ZIP bytes mismatch '+name)
        if z.testzip(): raise RuntimeError('Install ZIP CRC failure')
    dump(receipt,{'status':'PASS','archive':str(archive),'sha256':digest(archive),'bytes':archive.stat().st_size,'paths':len(expected),'symlinks':sum(r['kind']=='link' for r in expected.values()),'metadataPaths':metadata,'method':'stream readback against sole signed App, regular SHA/bytes/mode and symlink payload/mode exact','files':expected})
    print(json.dumps({'status':'PASS','paths':len(expected),'symlinks':sum(r['kind']=='link' for r in expected.values()),'sha256':digest(archive),'receipt':str(receipt)}))
else: raise RuntimeError('Usage: freeze SOURCE MANIFEST | verify SOURCE MANIFEST | zip SOURCE MANIFEST ZIP RECEIPT | install-audit SOURCE APP ZIP RECEIPT')
