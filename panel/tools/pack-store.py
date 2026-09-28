#!/usr/bin/env python3
"""Собрать zip для Chrome Web Store: manifest.json в корне архива, польское название и описание,
без localhost/127.0.0.1 (они нужны только для локальной разработки). Результат: dist/pulsecar-chrome-store-<версия>.zip"""
import json, os, zipfile

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(root, 'extension')
m = json.load(open(os.path.join(src, 'manifest.json'), encoding='utf-8'))

DEV = ('http://localhost/*', 'http://127.0.0.1/*')
m['name'] = 'Pulsecar'
m['short_name'] = 'Pulsecar'
m['description'] = 'Części z hurtowni motoryzacyjnych i Allegro jednym kliknięciem do zleceń, wycen i magazynu w CRM Pulsecar.'
m['homepage_url'] = 'https://panel.pulsecar.tech'
m['host_permissions'] = [h for h in m['host_permissions'] if h not in DEV]
for cs in m['content_scripts']:
    cs['matches'] = [h for h in cs['matches'] if h not in DEV]
m.pop('update_url', None)
m.pop('key', None)
assert len(m['description']) <= 132 and len(m['name']) <= 75

os.makedirs(os.path.join(root, 'dist'), exist_ok=True)
out = os.path.join(root, 'dist', f"pulsecar-chrome-store-{m['version']}.zip")
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('manifest.json', json.dumps(m, ensure_ascii=False, indent=2))
    for d, _, files in os.walk(src):
        for f in sorted(files):
            if f == 'manifest.json' and d == src:
                continue
            if f.startswith('.'):
                continue
            p = os.path.join(d, f)
            z.write(p, os.path.relpath(p, src))
print(out, os.path.getsize(out), 'bytes')
