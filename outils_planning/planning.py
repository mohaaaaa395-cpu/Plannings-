"""Outils de planning CEDIF Saint-Antoine : vérification, version lisible (xlsx/pdf), remplissage du modèle magasin.

Usage : python3 planning.py <periode.py> <sortie_lisible.xlsx> <modele.xlsx> <sortie_modele.xlsx>
Le fichier <periode.py> définit TITLE, EMP, CONTRAT, WEEKS (liste de (lundi, [7 jours])), NOTES et
éventuellement SPECIAL {date: (ouverture, fermeture)}. Chaque jour est un dict salarié -> segments
[('09:50','14:00'), ...] ou (libellé, minutes comptées) pour séminaire / indispo / congé / férié.
"""
import sys, copy, datetime as dt
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.pagebreak import Break
from openpyxl.formula.translate import Translator
from openpyxl.utils import get_column_letter as L, column_index_from_string as CI
from openpyxl.comments import Comment

OPEN = {'wk': ('09:50', '19:40'), 'sun': ('10:50', '19:10')}
JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
MOIS = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
        'septembre', 'octobre', 'novembre', 'décembre']
COLORS = {'Yassine': 'DBEAFE', 'Rose': 'FCE7F3', 'Jennyfer': 'DCFCE7', 'Sara': 'FFEDD5',
          'Emma': 'EDE9FE', 'Intérim': 'E5E7EB'}

def m(t): h, mi = t.split(':'); return int(h) * 60 + int(mi)
def dur(segs): return sum(m(b) - m(a) for a, b in segs)
def fmt(mins): return f"{mins // 60}h{mins % 60:02d}"
def hours(P, date, i): return P.get('SPECIAL', {}).get(date) or (OPEN['sun'] if i == 6 else OPEN['wk'])

# ---------------------------------------------------------------- vérification
def verify(P):
    ok = True
    for start, days in P['WEEKS']:
        tot = {e: 0 for e in P['EMP']}
        for i, d in enumerate(days):
            date = start + dt.timedelta(days=i)
            pres = [0] * 1440
            for e, v in d.items():
                if isinstance(v, tuple): tot[e] += v[1]; continue
                tot[e] += dur(v)
                for a, b in v:
                    for x in range(m(a), m(b)): pres[x] += 1
            if not any(isinstance(v, list) for v in d.values()):
                print(date, JOURS[i], 'fermé / férié'); continue
            o, c = hours(P, date, i)
            gaps = [x for x in range(m(o), m(c)) if pres[x] == 0]
            if gaps: ok = False
            print(date, f"{JOURS[i]:9}", 'pic', max(pres[m(o):m(c)]), 'OK' if not gaps else f'TROU à {fmt(gaps[0])}')
        print('  totaux', {e: fmt(v) for e, v in tot.items() if v or P['CONTRAT'].get(e)})
    print('COUVERTURE OK' if ok else 'PROBLEME DE COUVERTURE')
    return ok

# ---------------------------------------------------------------- version lisible
F = 'Arial'
def fill(c): return PatternFill('solid', fgColor=c)
thin = Side(style='thin', color='BFBFBF'); B = Border(left=thin, right=thin, top=thin, bottom=thin)
CENTER = Alignment(horizontal='center', vertical='center', wrap_text=True)
STY = {'ouv': ('D9F2E3', '14532D'), 'fer': ('DBE7FB', '1E3A8A'), 'ouvfer': ('FDE2C4', '7C2D12'),
       'jour': ('FFF4C2', '713F12'), 'sem': ('EADCF8', '581C87'), 'abs': ('FADBD8', '991B1B'),
       'repos': ('F5F5F5', 'A3A3A3'), 'ferme': ('6B7280', 'FFFFFF')}
LEG = [('ouv', 'Ouverture'), ('fer', 'Fermeture'), ('ouvfer', 'Ouverture + fermeture'), ('repos', 'Repos')]

def kind(P, segs, i, date):
    o, c = hours(P, date, i)
    so, sc = segs[0][0] == o, segs[-1][1] == c
    return 'ouvfer' if so and sc else 'ouv' if so else 'fer' if sc else 'jour'

def render(P, out):
    wb = Workbook(); ws = wb.active; ws.title = 'Planning'
    ws.sheet_view.showGridLines = False
    ws.column_dimensions['A'].width = 15
    for k in range(7): ws.column_dimensions[L(2 + k)].width = 16
    ws.column_dimensions['I'].width = 13
    r = 1
    ws.cell(r, 1, P['TITLE']).font = Font(name=F, bold=True, size=16); r += 1
    ws.cell(r, 1, 'Horaires magasin : lundi → samedi 09:50 – 19:40 · dimanche 10:50 – 19:10 · pause d’1h non payée').font = Font(name=F, size=10, color='555555'); r += 1
    for k, (t, lab) in enumerate(LEG):
        c = ws.cell(r, 2 + k, lab); c.fill = fill(STY[t][0]); c.font = Font(name=F, size=9, bold=True, color=STY[t][1]); c.alignment = CENTER; c.border = B
    ws.row_dimensions[r].height = 26; r += 2
    for wi, (start, days) in enumerate(P['WEEKS']):
        if wi: ws.row_breaks.append(Break(id=r - 1))
        end = start + dt.timedelta(days=6)
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=9)
        c = ws.cell(r, 1, f"SEMAINE {wi+1}  ·  du lundi {start.day} {MOIS[start.month]} au dimanche {end.day} {MOIS[end.month]}")
        c.font = Font(name=F, bold=True, size=13, color='FFFFFF'); c.fill = fill('1F2937'); c.alignment = Alignment(vertical='center', indent=1)
        ws.row_dimensions[r].height = 26; r += 1
        heads = ['Salarié'] + [f"{JOURS[i][:3]} {(start + dt.timedelta(days=i)):%d/%m}" for i in range(7)] + ['Total']
        for j, h in enumerate(heads):
            c = ws.cell(r, 1 + j, h); c.font = Font(name=F, bold=True, size=10); c.fill = fill('E5E7EB'); c.alignment = CENTER; c.border = B
        r += 1
        emps = [e for e in P['EMP'] if P['CONTRAT'].get(e) or any(e in d for d in days)]
        for e in emps:
            c = ws.cell(r, 1, f"{e}\ncontrat {P['CONTRAT'][e]}h" if P['CONTRAT'].get(e) else e)
            c.font = Font(name=F, bold=True, size=10); c.alignment = CENTER; c.border = B
            total = 0
            for i, d in enumerate(days):
                date = start + dt.timedelta(days=i)
                v = d.get(e)
                if v is None: txt, t = 'Repos', 'repos'
                elif isinstance(v, tuple):
                    lab, mins = v; total += mins
                    t = 'ferme' if lab == 'FÉRIÉ' else 'sem' if 'SÉMIN' in lab else 'abs'
                    lab = (lab.replace('SÉMINAIRE ', 'Séminaire\n').replace('INDISPONIBLE', 'Indispo')
                              .replace('CONGÉ', 'Congé').replace('FÉRIÉ', 'Férié\nnon travaillé'))
                    txt = lab + (f"\n{fmt(mins)}" if mins else '')
                else:
                    mins = dur(v); total += mins; t = kind(P, v, i, date)
                    txt = '\n'.join(f"{a} – {b}" for a, b in v) + f"\n{fmt(mins)}"
                c = ws.cell(r, 2 + i, txt)
                c.fill = fill(STY[t][0]); c.font = Font(name=F, size=10, color=STY[t][1], bold=t != 'repos'); c.alignment = CENTER; c.border = B
            tc = ws.cell(r, 9, fmt(total)); tc.font = Font(name=F, bold=True, size=12); tc.alignment = CENTER; tc.border = B
            if P['CONTRAT'].get(e): tc.fill = fill('D9F2E3' if total == P['CONTRAT'][e] * 60 else 'FDECC8')
            ws.row_dimensions[r].height = 58; r += 1
        c = ws.cell(r, 1, 'Présents'); c.font = Font(name=F, italic=True, size=9); c.alignment = CENTER; c.border = B
        for i, d in enumerate(days):
            n = sum(1 for v in d.values() if isinstance(v, list))
            c = ws.cell(r, 2 + i, 'Fermé' if n == 0 else f"{n} pers."); c.font = Font(name=F, italic=True, size=9, color='555555'); c.alignment = CENTER; c.border = B
        ws.cell(r, 9).border = B
        r += 2
    ws.page_setup.orientation = 'landscape'; ws.page_setup.paperSize = 9
    ws.sheet_properties.pageSetUpPr.fitToPage = True; ws.page_setup.fitToWidth = 1; ws.page_setup.fitToHeight = 0
    ws.page_margins.left = ws.page_margins.right = 0.4
    wb.save(out)

# ---------------------------------------------------------------- modèle magasin
# Modèle "planning ST Antoine" : 3 blocs (libellés lignes 8, 21, 34 ; jours en dessous ; total ; contrôle).
# Par salarié : Matin début/fin, Après-midi début/fin + colonnes de calcul. Bloc de 7 colonnes par salarié.
BLOCKS = [8, 21, 34]
TPL = 34
FIRST_COL = {'Yassine': 'C', 'Rose': 'K', 'Jennyfer': 'S', 'Sara': 'AA', 'Emma': 'AI'}
TITLE_NAME = {'Jennyfer': 'Jenny'}
CALC = ('E', 'H', 'I', 'M', 'P', 'Q', 'U', 'X', 'Y', 'AC', 'AF', 'AG')

def cols(first):  # matin début, fin, après-midi début, fin ; calc matin, calc aprem, total
    i = CI(first)
    return [L(i), L(i + 1), L(i + 3), L(i + 4)], [L(i + 2), L(i + 5), L(i + 6)]

def fill_template(P, src, out):
    wb = load_workbook(src); ws = wb.active
    ref = {c: ws[f'{c}{TPL+1}'].value for c in CALC}
    # Rétablir dans les blocs 1 et 2 les formules / libellés du bloc 3 (modèle complet)
    for top in BLOCKS[:2]:
        off = top - TPL
        for r in range(TPL, TPL + 10):
            for c in range(1, CI('AG') + 1):
                s = ws.cell(r, c); d = ws.cell(r + off, c)
                if type(d).__name__ == 'MergedCell': continue
                v = s.value
                if isinstance(v, str) and v.startswith('='):
                    v = Translator(v, origin=s.coordinate).translate_formula(d.coordinate)
                d.value = v; d._style = copy.copy(s._style)
    for top in BLOCKS:
        for r in range(top + 1, top + 8):
            for col in CALC:
                ws[f'{col}{r}'] = Translator(ref[col], origin=f'{col}{TPL+1}').translate_formula(f'{col}{r}')
                ws[f'{col}{r}']._style = copy.copy(ws[f'{col}{TPL+1}']._style)
        for col in ('I', 'Q', 'Y', 'AG'):
            ws[f'{col}{top+8}'] = f'=SUM({col}{top+1}:{col}{top+7})'
    # Salariés en plus (ex. Emma) : copier le bloc de Sara (AA:AG) vers une nouvelle colonne
    for e in P['EMP']:
        if e not in FIRST_COL or e in ('Yassine', 'Rose', 'Jennyfer', 'Sara'): continue
        if not any(e in d for _, days in P['WEEKS'] for d in days): continue
        off = CI(FIRST_COL[e]) - CI('AA')
        for k in range(7):
            ws.column_dimensions[L(CI('AA') + k + off)].width = ws.column_dimensions[L(CI('AA') + k)].width
        for top in BLOCKS:
            for r in range(top - 2, top + 10):
                for k in range(-1, 7):  # inclut la colonne séparatrice avant le bloc
                    s = ws.cell(r, CI('AA') + k); d = ws.cell(r, CI('AA') + k + off)
                    if type(s).__name__ == 'MergedCell' or type(d).__name__ == 'MergedCell': continue
                    v = s.value
                    if isinstance(v, str) and v.startswith('='):
                        v = Translator(v, origin=s.coordinate).translate_formula(d.coordinate)
                    d.value = v; d._style = copy.copy(s._style)
            for rng in list(ws.merged_cells.ranges):
                if rng.min_row in (top - 2, top) and CI('AA') <= rng.min_col <= CI('AG'):
                    ws.merge_cells(start_row=rng.min_row, start_column=rng.min_col + off,
                                   end_row=rng.max_row, end_column=rng.max_col + off)
    # Horaires
    def T(s): h, mi = s.split(':'); return dt.time(int(h), int(mi))
    for (start, days), top in zip(P['WEEKS'], BLOCKS):
        end = start + dt.timedelta(days=6)
        per = (f"du {start.day} au {end.day} {MOIS[end.month]}" if start.month == end.month
               else f"du {start.day} {MOIS[start.month]} au {end.day} {MOIS[end.month]}")
        for e, first in FIRST_COL.items():
            if e not in P['EMP'] or (e == 'Emma' and not any(e in d for d in days)): continue
            ws[f'{first}{top-2}'] = f"{TITLE_NAME.get(e, e)} {per}"
            inp, _ = cols(first)
            for i, d in enumerate(days):
                r = top + 1 + i
                for c in inp: ws[f'{c}{r}'] = None; ws[f'{c}{r}'].comment = None
                v = d.get(e)
                if isinstance(v, tuple):
                    ws[f'{inp[0]}{r}'].comment = Comment({'INDISPONIBLE': 'Indisponible', 'CONGÉ': 'Congé',
                        'FÉRIÉ': 'Jour férié : non travaillé'}.get(v[0], v[0].title()), 'Planning')
                    continue
                if not v: continue
                if len(v) == 2: am, pm = v
                elif m(v[0][0]) >= m('14:00'): am, pm = None, v[0]
                else: am, pm = v[0], None
                for seg, (c1, c2) in ((am, inp[:2]), (pm, inp[2:])):
                    if seg: ws[f'{c1}{r}'] = T(seg[0]); ws[f'{c2}{r}'] = T(seg[1])
    ws['D3'] = dt.datetime.combine(P['WEEKS'][0][0], dt.time())
    ws.title = f"{P['WEEKS'][0][0]:%d.%m} au {(P['WEEKS'][-1][0] + dt.timedelta(days=6)):%d.%m}"
    wb.save(out)

if __name__ == '__main__':
    P = {}
    exec(open(sys.argv[1]).read(), P)
    if verify(P) and len(sys.argv) > 2:
        render(P, sys.argv[2])
        if len(sys.argv) > 4: fill_template(P, sys.argv[3], sys.argv[4])
