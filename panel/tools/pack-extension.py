#!/usr/bin/env python3
"""Собрать public/pulsecar-extension.zip из папки extension/ и записать версию в public/pulsecar-extension.json."""
import json, os, zipfile
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(root, 'extension')
ver = json.load(open(os.path.join(src, 'manifest.json'), encoding='utf-8'))['version']
out = os.path.join(root, 'public', 'pulsecar-extension.zip')
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for d, _, files in os.walk(src):
        for f in sorted(files):
            p = os.path.join(d, f)
            z.write(p, os.path.join('pulsecar-extension', os.path.relpath(p, src)))
json.dump({'version': ver}, open(os.path.join(root, 'public', 'pulsecar-extension.json'), 'w'))
print('pulsecar-extension', ver, os.path.getsize(out), 'bytes')
