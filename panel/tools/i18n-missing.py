# Тексты интерфейса без перевода: python3 tools/i18n-missing.py  (из папки panel)
# Выводит русские строки из public/js, которых нет в public/i18n/pl.json — их нужно добавить во все словари (pl, en, uk).
import re,glob,json,sys,os
os.chdir(os.path.join(os.path.dirname(__file__), '..', 'public'))
cyr=re.compile('[А-Яа-яЁё]')
out={}
for f in sorted(glob.glob('js/**/*.js',recursive=True)):
    s=open(f).read()
    s=re.sub(r'/\*.*?\*/','',s,flags=re.S)
    s=re.sub(r'(^|[ \t;])//[^\n]*','\\1',s,flags=re.M)
    for frag in re.split(r'[`\'"<>{}\n]|\$\{', s):
        # attribute-ish residue like 'placeholder=' removed by split; keep text
        t=frag.strip()
        if not cyr.search(t): continue
        t=re.sub(r'\s+',' ',t)
        out.setdefault(t,f)
have=json.load(open('i18n/pl.json'))
miss=sorted(k for k in out if k not in have)
json.dump(miss, sys.stdout, ensure_ascii=False, indent=0)
print('\n', len(miss), 'без перевода', file=sys.stderr)
