#!/usr/bin/env python3
"""Compare two run.mjs result sets case by case.

Usage: compare.py <reference-out> <candidate-out> <report.json> [--strict] [--summary <markdown>]

A case is EQUAL when status, error code, page count, extracted text, embedded fonts, missing
fonts, image geometry, recalculated values and exported files match, and rendered PNG pixels
match exactly. Installation identity (kit version and install paths) is ignored. With --strict,
any other difference exits non-zero.
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('reference'); parser.add_argument('candidate'); parser.add_argument('report')
parser.add_argument('--strict', action='store_true'); parser.add_argument('--summary')
parser.add_argument('--label', default='candidate vs reference')
args = parser.parse_args()
load = lambda d: json.load(open(os.path.join(d, 'results.json')))
R, C = load(args.reference), load(args.candidate)
RC, CC = R['cases'], C['cases']

def strip(value):
    if isinstance(value, dict):
        return {k: strip(v) for k, v in value.items() if k != 'ms'}
    if isinstance(value, list):
        return [strip(v) for v in value]
    return value

def installation_neutral(case, value):
    if case == 'capabilities' and value.get('ok'):
        runtime = value['value']['runtime']
        for key in ('version', 'cliPath', 'nodeApiPath'):
            runtime.pop(key, None)
    return value

def pixels(out, case, image):
    path = os.path.join(out, 'png', case.split(':', 1)[1], image['file'])
    return np.asarray(Image.open(path).convert('RGBA'), dtype=np.int16)

def image_delta(case, r, c):
    worst = {'max_abs': 0, 'changed_fraction': 0.0}
    for ri, ci in zip(r.get('images', []), c.get('images', [])):
        a, b = pixels(args.reference, case, ri), pixels(args.candidate, case, ci)
        if a.shape != b.shape:
            return {'shape': [list(a.shape), list(b.shape)]}
        d = np.abs(a - b)
        worst['max_abs'] = max(worst['max_abs'], int(d.max()))
        worst['changed_fraction'] = max(worst['changed_fraction'], float((d.max(axis=2) > 16).mean()))
    return worst

def compare(case):
    r, c = RC.get(case), CC.get(case)
    if r is None or c is None:
        return {'verdict': 'MISSING'}
    rs, cs = installation_neutral(case, strip(r)), installation_neutral(case, strip(c))
    entry = {}
    if case.startswith('render:') and r.get('ok') and c.get('ok'):
        entry['pixels'] = image_delta(case, r, c)
    exact_pixels = 'pixels' not in entry or entry['pixels'].get('max_abs') == 0
    entry['verdict'] = 'EQUAL' if rs == cs and exact_pixels else 'PIXELS-DIFFER' if rs == cs else 'DIFFERENT'
    if entry['verdict'] == 'DIFFERENT':
        entry['reference'], entry['candidate'] = rs, cs
    return entry

report = {case: compare(case) for case in sorted(set(RC) | set(CC))}
summary = {}
for entry in report.values():
    summary[entry['verdict']] = summary.get(entry['verdict'], 0) + 1
json.dump({'reference': R['kit'], 'candidate': C['kit'], 'summary': summary, 'cases': report}, open(args.report, 'w'), indent=2, default=str)
failures = {case: entry for case, entry in report.items() if entry['verdict'] != 'EQUAL'}
print(args.label, json.dumps(summary))
for case, entry in failures.items():
    print(' ', case, entry['verdict'], json.dumps({k: v for k, v in entry.items() if k != 'verdict'}, default=str)[:600])
if args.summary:
    with open(args.summary, 'a') as out:
        out.write(f"### {args.label}\n\n{R['kit']} vs {C['kit']}: " + ', '.join(f'{v} {k}' for k, v in sorted(summary.items())) + '\n\n')
        for case, entry in failures.items():
            out.write(f"- `{case}`: {entry['verdict']}\n")
        out.write('\n')
sys.exit(1 if args.strict and failures else 0)
