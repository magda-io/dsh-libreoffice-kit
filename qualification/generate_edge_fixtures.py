#!/usr/bin/env python3
"""Generate edge-case fixtures: right-to-left worksheet, CJK text, a missing font and a long document."""
import sys, os
import docx, openpyxl
from docx.shared import Pt
out = sys.argv[1]
wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'RTL'; ws.sheet_view.rightToLeft = True
for r in range(1, 9):
    ws.cell(r, 1, f'Row {r} first'); ws.cell(r, 2, r * 10); ws.cell(r, 3, f'=B{r}*2'); ws.cell(r, 4, 'مرحبا بالعالم')
wb.save(os.path.join(out, 'edge-rtl.xlsx'))
d = docx.Document(); d.add_heading('多语言文档 Multilingual', 1)
d.add_paragraph('这是一个中文段落，用于测试字体回退。日本語のテキストも含みます。한국어 문장입니다.')
d.add_paragraph('Latin text after CJK.'); d.save(os.path.join(out, 'edge-cjk.docx'))
d = docx.Document(); p = d.add_paragraph(); run = p.add_run('This paragraph requests a font that is not installed.')
run.font.name = 'Magda Missing Font'; run.font.size = Pt(14); d.save(os.path.join(out, 'edge-missing-font.docx'))
d = docx.Document()
for i in range(1, 401):
    d.add_heading(f'Section {i}', 2)
    d.add_paragraph(f'Paragraph {i}. ' + 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. ' * 12)
d.save(os.path.join(out, 'edge-long.docx'))
print('ok')
