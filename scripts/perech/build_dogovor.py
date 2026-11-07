#!/usr/bin/env python3
"""Шаблон договора поставки для раздела «Перечисление».

Берёт Word-договор (.docx; .doc сначала сохранить как .docx, например:
  soffice --headless --convert-to docx dogovor.doc)
и заменяет данные конкретной сделки на метки {{...}}. Текст договора не меняется.
Результат — public/perech/dogovor.json: части .docx (XML), сайт подставляет в них данные и собирает файл.
В JSON не остаётся реквизитов ни поставщика, ни покупателя — только метки.

  python3 scripts/perech/build_dogovor.py dogovor.docx public/perech/dogovor.json
"""
import json, re, sys, zipfile

T_RE = re.compile(r'(<w:t(?: [^>]*)?>)(.*?)(</w:t>)', re.S)


def para_text(p):
    return ''.join(m.group(2) for m in T_RE.finditer(p))


def replace_in_para(p, old, new):
    """Заменяет текст old (может быть разбит на несколько <w:t>) на new: в первом затронутом <w:t>."""
    ms = list(T_RE.finditer(p))
    full = ''.join(m.group(2) for m in ms)
    at = full.find(old)
    if at < 0:
        raise SystemExit('не найдено: %r в %r' % (old, full[:120]))
    end = at + len(old)
    pos, out, last = 0, [], 0
    for m in ms:
        t = m.group(2)
        a, b = pos, pos + len(t)
        pos = b
        if b <= at or a >= end:
            continue
        s0, e0 = max(at, a) - a, min(end, b) - a
        nt = t[:s0] + (new if a <= at < b else '') + t[e0:]
        open_tag = m.group(1)
        if 'xml:space' not in open_tag:
            open_tag = open_tag[:-1] + ' xml:space="preserve">'
        out.append(p[last:m.start()] + open_tag + nt + m.group(3))
        last = m.end()
    out.append(p[last:])
    return ''.join(out)


def main(src, dst):
    z = zipfile.ZipFile(src)
    parts = {n: z.read(n).decode('utf8') for n in z.namelist() if n.endswith('.xml') or n.endswith('.rels')}
    doc = parts['word/document.xml']
    paras = [(m.start(), m.end()) for m in re.finditer(r'<w:p[ >].*?</w:p>', doc, re.S)]

    def find_para(text, nth=0):
        hits = [i for i, (a, b) in enumerate(paras) if text in para_text(doc[a:b])]
        if len(hits) <= nth:
            raise SystemExit('абзац не найден: %r' % text)
        return hits[nth]

    edits = {}  # индекс абзаца → список замен

    def rep(text, old, new, nth=0):
        edits.setdefault(find_para(text, nth), []).append((old, new))

    NB = ' '
    rep('ДОГОВОР ПОСТАВКИ ТОВАРА', 'ТОВАРА А-10', 'ТОВАРА {{NO}}')
    rep('г. Ташкент', '«23»' + NB + 'Октябр' + NB + ' 2026', '«{{D}}»' + NB + '{{M}}' + NB + '{{Y}}')
    p3 = 'именуемое в дальнейшем «Поставщик»'
    rep(p3, 'OOO «PEGASUS INC»', '{{S_NAME}}')
    rep(p3, 'Абдуллахужаева' + NB + 'A.' + NB + 'A', '{{S_DIR_GEN}}')
    rep(p3, 'ООО &quot; ALVIERO&quot;', '{{B_NAME}}')
    rep(p3, 'ARTIKXODJAYEV' + NB + 'Z.A.', '{{B_DIR_GEN}}')
    rep(p3, 'основании Устава ,', 'основании {{B_BASIS}},')
    rep('1.3. Ориентировочная стоимость', '210' + NB + '000' + NB + '000,00  (Двести десять миллионов', '{{T_SUM_F}} ({{T_WORDS}}')
    rep('1.3. Ориентировочная стоимость', 'сум 00 тийин', 'сум {{T_TIYIN}} тийин')
    rep('OOO “PEGASUS INС”', 'OOO “PEGASUS INС”', '{{S_NAME}}')
    rep('ALVIERO &quot;', 'ООО &quot; ALVIERO &quot;', '{{B_NAME}}')
    rep('ул.Янги олмазор', 'г.Ташкент, Алмазарский район, ул.Янги олмазор, 3А', '{{S_ADDR}}')
    rep('Ibroxim ota MFY', "город Ташкент, Алмазарский район, Ibroxim ota MFY, Ibroxim ota ko&apos;chasi, 7-a-uy", '{{B_ADDR}}')
    rep('Р/с: 2020', '2020' + NB + '8000' + NB + '9051' + NB + '3223' + NB + '6001', '{{S_RS}}')
    rep('в АКБ «Капиталбанк»', 'в АКБ «Капиталбанк» филиал Чорсу', '{{S_BANK}}')
    rep('МФО: 01033', '01033', '{{S_MFO}}')
    rep('ИНН: 306768320', '306768320', '{{S_INN}}')
    rep('Регистрационный код НДС: 326050086563', '326050086563', '{{S_VAT}}')
    rep('Абдуллахужаев' + NB + 'A.' + NB + 'A ', 'Абдуллахужаев' + NB + 'A.' + NB + 'A', '{{S_DIR}}')
    rep('ARTIKXODJAYEV Z.A.', 'ARTIKXODJAYEV Z.A.', '{{B_DIR}}')
    rep('ИНН: 203697731', '203697731', '{{B_INN}}')
    rep('ОПЕРУ', 'ОПЕРУ ', '{{B_BANK}}')
    # у покупателя пустые «Р/с:», «МФО:», «Регистрационный код НДС:» — второе вхождение (первое — у поставщика)
    edits.setdefault([i for i, (a, b) in enumerate(paras) if para_text(doc[a:b]).strip() == 'Р/с:'][0], []).append(('Р/с:', 'Р/с: {{B_RS}}'))
    edits.setdefault([i for i, (a, b) in enumerate(paras) if para_text(doc[a:b]).strip() == 'МФО:'][0], []).append(('МФО:', 'МФО: {{B_MFO}}'))
    edits.setdefault([i for i, (a, b) in enumerate(paras) if para_text(doc[a:b]).strip() == 'Регистрационный код НДС:'][0], []).append(('НДС:', 'НДС: {{B_VAT}}'))

    # спецификация: строка товара → метки строки (сайт повторяет её для каждой позиции), «Итого» → суммы
    tbl = re.search(r'<w:tbl>.*?</w:tbl>', doc, re.S)
    rows = list(re.finditer(r'<w:tr[ >].*?</w:tr>', tbl.group(0), re.S))
    row_marks = ['{{R_N}}', '{{R_NAME}}', '{{R_UNIT}}', '{{R_QTY}}', '{{R_PRICE}}', '{{R_NOVAT}}', '{{R_VAT}}', '{{R_SUM}}']
    tot_marks = [None, None, None, None, None, '{{T_NOVAT}}', '{{T_VAT}}', '{{T_SUM}}']

    def mark_row(row, marks):
        cells = list(re.finditer(r'<w:tc>.*?</w:tc>', row, re.S))
        out, last = [], 0
        for c, mk in zip(cells, marks):
            cx = c.group(0)
            if mk:
                txt = para_text(cx)
                cx = replace_in_para(cx, txt, mk) if txt else cx
            out.append(row[last:c.start()] + cx)
            last = c.end()
        return ''.join(out) + row[last:]

    item_row = next(r for r in rows if 'Трубы и фитинги' in para_text(r.group(0)))
    tot_row = next(r for r in rows if 'Итого:' in para_text(r.group(0)))
    t = tbl.group(0)
    t = t[:tot_row.start()] + mark_row(tot_row.group(0), tot_marks) + t[tot_row.end():]
    t = t[:item_row.start()] + mark_row(item_row.group(0), row_marks) + t[item_row.end():]

    # абзацы правим с конца, чтобы позиции не сдвигались; таблица спецификации — после
    for i in sorted(edits, reverse=True):
        a, b = paras[i]
        p = doc[a:b]
        for old, new in edits[i]:
            p = replace_in_para(p, old, new)
        doc = doc[:a] + p + doc[b:]
    tbl = re.search(r'<w:tbl>.*?</w:tbl>', doc, re.S)
    doc = doc[:tbl.start()] + t + doc[tbl.end():]

    left = [w for w in ['ALVIERO', 'PEGASUS', '306768320', '203697731', 'Капиталбанк', 'ARTIKXODJAYEV', 'Абдуллахужа', '175' + NB + '000'] if w in doc]
    if left:
        raise SystemExit('в шаблоне остались данные сделки: %s' % left)
    parts['word/document.xml'] = doc
    # свойства файла (автор, название) — без данных сделки
    parts['docProps/core.xml'] = re.sub(r'<dc:title>.*?</dc:title>', '<dc:title>Договор поставки</dc:title>', parts.get('docProps/core.xml', ''), flags=re.S)
    with open(dst, 'w', encoding='utf8') as f:
        json.dump({'v': 1, 'parts': parts, 'order': [n for n in z.namelist() if n in parts]}, f, ensure_ascii=False)
    marks = sorted(set(re.findall(r'\{\{[A-Z_]+\}\}', doc)))
    print('ok:', dst, len(json.dumps(parts)) // 1024, 'KB; метки:', ' '.join(marks))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
