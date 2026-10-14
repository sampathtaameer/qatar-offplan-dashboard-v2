"""Map Ministry of Justice district names to dashboard area ids.

MoJ bulletins spell districts many ways ("Al Thumama 46", "Al Thumama46", "Muaither 53", "Al Wakrah",
"Umm Slal Muhammed"). area_for() normalises the name (zone numbers, spacing, spelling) and then looks it
up in data/district_aliases.json first, then in the built-in table below. Districts with very few sales
fall into a per-municipality "other districts" area so that every registered sale is counted somewhere.

Usage from other tools:
    from district_map import area_for
    area_for('Al Thumama 46', 'Doha', aliases)  -> 'al-thumama'
Run directly to list any district that still falls through to an "other" bucket by name only.
"""
import re

# normalised district name -> area id
DISTRICTS = {
    # freehold / usufruct / existing areas
    'the pearl island': 'the-pearl', 'the pearl': 'the-pearl', 'lusail': 'lusail', 'legtaifiya': 'legtaifiya',
    'al dafna': 'al-dafna', 'onaiza': 'onaiza', 'al kharayej': 'al-kharayej', 'ghar thaileb': 'jabal-thuaileb',
    'ghar thuaileb': 'jabal-thuaileb', 'msheireb': 'msheireb', 'mushaireb': 'msheireb', 'fereej abdel aziz': 'fereej-abdul-aziz',
    'fereej abdul aziz': 'fereej-abdul-aziz', 'al doha al jadeeda': 'doha-al-jadeeda', 'al doha al jadeedah': 'doha-al-jadeeda',
    'doha al jadeeda': 'doha-al-jadeeda', 'old al ghanim': 'al-ghanim', 'al ghanim al jadeed': 'al-ghanim', 'new al ghanim': 'al-ghanim',
    'al rufaa': 'al-rufaa', 'new al hitmi': 'al-rufaa', 'old al hitmi': 'al-rufaa', 'al salata': 'al-salata', 'new slata': 'al-salata',
    'slata': 'al-salata', 'al mansoura': 'al-mansoura', 'fereej bin derhem': 'al-mansoura', 'fereej bin dirham': 'al-mansoura',
    'fereej bin mahmoud': 'fereej-bin-mahmoud', 'rawdat al khail': 'rawdat-al-khail', 'najma': 'najma',
    'umm ghuwailina': 'umm-ghuwailina', 'al khulaifat': 'al-khulaifat', 'al sadd': 'al-sadd', 'al mirqab al jadeed': 'al-mirqab',
    'new al mirqab': 'al-mirqab', 'fereej al nasr': 'al-mirqab', 'old airport': 'old-airport', 'al matar al qadeem': 'old-airport',
    'al wukair': 'al-wukair', 'muaither al wukair': 'al-wukair', 'al meshaf': 'al-meshaf', 'al mashaf': 'al-meshaf',
    'al wakra': 'al-wakra', 'al wakrah': 'al-wakra', 'al gharrafa': 'al-gharrafa', 'gharrafat al rayyan': 'al-gharrafa',
    'al waab': 'al-waab', 'ain khaled': 'ain-khaled', 'ain khalid': 'ain-khaled', 'al thumama': 'al-thumama', 'duhail': 'duhail',
    'madinat khalifa south': 'madinat-khalifa', 'madinat khalifa north': 'madinat-khalifa', 'madinat khalifa': 'madinat-khalifa',
    'al sakhama': 'al-sakhama', 'al ebb': 'al-ebb', 'umm al amad': 'umm-al-amad', 'muraikh': 'al-muraikh', 'al muraikh': 'al-muraikh',
    'muraikh south': 'al-muraikh', 'amuraikh al janoubi': 'al-muraikh', 'bu hamour': 'abu-hamour', 'abu hamour': 'abu-hamour',
    'umm ebairiya': 'umm-ebairiya', 'al kheesa': 'al-kheesa', 'umm slal ali': 'umm-salal', 'umm slal mohammed': 'umm-salal',
    'umm slal muhammed': 'umm-salal', 'umm salal ali': 'umm-salal', 'umm salal mohammed': 'umm-salal', 'izghawa': 'izghawa',
    'muaither': 'muaither', 'rawdat al hamama': 'rawdat-al-hamama', 'al maamoura': 'al-maamoura', 'industrial area': 'industrial-area',
    'al khor': 'al-khor', 'al hilal': 'al-hilal', 'simaisma': 'simaisma-town',
    # added in v2.0 so that every MoJ district has an area
    'umm garn': 'umm-qarn', 'umm qarn': 'umm-qarn', 'al kharaitiyat': 'al-kharaitiyat', 'al ruwais': 'al-ruwais',
    'aba al dalouf': 'abu-dhalouf', 'aba al duloof': 'abu-dhalouf', 'abu dhalouf': 'abu-dhalouf', 'madinat al shamal': 'madinat-al-shamal',
    'al thakhira': 'al-thakhira', 'al dakhira': 'al-thakhira', 'umm lekhba': 'umm-lekhba', 'nuaija': 'nuaija',
    'al aziziya': 'al-aziziya', 'new al rayyan': 'al-rayyan', 'old al rayyan': 'al-rayyan', 'al rayyan': 'al-rayyan', 'luaib': 'luaib',
    'fereej bin omran': 'fereej-bin-omran', 'jeryan jenaihat': 'jeryan-jenaihat', 'hazm al markhiya': 'al-markhiya',
    'al markhiya': 'al-markhiya', 'bu sidra': 'bu-sidra', 'al mearad': 'al-mearad', 'fereej al soudan': 'fereej-al-soudan',
    'mebaireek': 'mebaireek', 'al luqta': 'al-luqta', 'fereej al murra': 'fereej-al-murra', 'fereej al murrah': 'fereej-al-murra',
    'rawdat egdaim': 'rawdat-egdaim', 'fereej kulaib': 'fereej-kulaib', 'al sheehaniya': 'al-sheehaniya', 'lijmiliya': 'al-sheehaniya',
    'al nasraniya': 'al-sheehaniya', 'dahl al hamam': 'dahl-al-hamam', 'bani hajer': 'bani-hajer', 'mesaimeer': 'mesaimeer',
    'al themaid': 'al-themaid', 'al thumaid': 'al-themaid', 'leabaib': 'leabaib', 'umm al seneem': 'umm-al-seneem',
    'umm al senaim': 'umm-al-seneem', 'madinat al kaaban': 'al-khor-other',
}

# Fallback per municipality for districts with only a handful of sales.
OTHER = {
    'Doha': 'doha-other', 'Al Rayyan': 'al-rayyan-other', 'Al Wakra': 'al-wakra-other', 'Umm Slal': 'umm-salal-other',
    'Al Khor & Al Thakhira': 'al-khor-other', 'Al Shamal': 'al-shamal-other', 'Al Daayen': 'al-daayen-other',
    'Al Sheehaniya': 'al-sheehaniya',
}

ARABIC = {'نعيجة': 'nuaija', 'الدوحة الجديدة': 'al doha al jadeeda', 'الوكرة': 'al wakra', 'الخور': 'al khor',
          'الثمامة': 'al thumama', 'معيذر': 'muaither', 'الريان': 'al rayyan'}


def norm_muni(m):
    m = (m or '').replace('Municipality', '').strip()
    m = {'Al Doha': 'Doha', 'الدوحة': 'Doha', 'الظعاين': 'Al Daayen', 'الضعاين': 'Al Daayen', 'الوكرة': 'Al Wakra',
         'Al Wakrah': 'Al Wakra', 'Umm Salal': 'Umm Slal', 'أم صلال': 'Umm Slal', 'الريان': 'Al Rayyan', 'الشمال': 'Al Shamal',
         'Al Khor and Al Thakhira': 'Al Khor & Al Thakhira', 'Al Khor and Al Dakhira': 'Al Khor & Al Thakhira',
         'الخور والذخيرة': 'Al Khor & Al Thakhira', 'الشيحانية': 'Al Sheehaniya'}.get(m, m)
    return m


def norm(name):
    s = re.sub(r'\s+', ' ', name or '').strip()
    s = re.sub(r'\s*\d+$', '', s)          # zone numbers: "Al Thumama 46", "Al Thumama46"
    for ar, en in ARABIC.items():
        if s.startswith(ar):
            return en
    return s.lower()


def area_for(district, municipality=None, aliases=None):
    """Area id for a MoJ district, or None when the name is empty."""
    if not district:
        return None
    aliases = aliases or {}
    hit = aliases.get(district) or aliases.get(district.strip())
    if hit:
        return hit
    key = norm(district)
    if key in DISTRICTS:
        return DISTRICTS[key]
    return OTHER.get(norm_muni(municipality), 'doha-other')


if __name__ == '__main__':
    import json
    import os
    import sys
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    tx = json.load(open(os.path.join(root, 'data', 'transactions.json'), encoding='utf-8'))['records']
    seen = {}
    for r in tx:
        d = r.get('district')
        if d and norm(d) not in DISTRICTS:
            seen[(norm_muni(r['municipality']), d)] = seen.get((norm_muni(r['municipality']), d), 0) + r['count']
    sys.stdout.reconfigure(encoding='utf-8')
    for (m, d), n in sorted(seen.items(), key=lambda x: -x[1]):
        print(f'{n:5d}  {m:24s} {d} -> {OTHER.get(m, "doha-other")}')
