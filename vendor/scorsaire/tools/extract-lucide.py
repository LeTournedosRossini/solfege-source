#!/usr/bin/env python3
"""Extract the Lucide icons used by Scorsaire from the `lucide-static` npm package (ISC licence, see LICENSES/Lucide-ISC.txt).

Usage: python3 -I tools/extract-lucide.py <path to the unpacked lucide-static package>
Writes src/model/icons-data.json: { name: [[tag, {attrs}], ...] } (24 x 24 viewBox, stroke icons). Add a name to NAMES and rerun to add an icon.
"""
import json, sys, pathlib

NAMES = [
    'monitor', 'tablet', 'smartphone', 'pencil', 'trash', 'plus', 'minus', 'eraser', 'rotate-ccw', 'sliders-vertical', 'drum', 'spline', 'copy', 'scissors',
    'clipboard-paste', 'move', 'circle-dot', 'rectangle-horizontal', 'settings', 'x', 'funnel', 'eye', 'eye-off', 'volume-x',
    'volume-2', 'chevron-left', 'chevron-right', 'chevron-up', 'chevron-down', 'ellipsis', 'type', 'undo-2', 'redo-2', 'lock',
    'lock-open', 'pause', 'replace', 'piano', 'keyboard-music', 'bell', 'mic-vocal', 'drumstick', 'guitar', 'arrow-up-down', 'grip-vertical', 'arrow-up', 'arrow-down', 'arrow-left', 'arrow-right', 'columns-2', 'corner-down-left', 'square-dashed', 'maximize-2', 'minimize-2', 'text-align-start', 'text-align-center', 'text-align-end', 'link', 'triangle-alert', 'check', 'chevrons-right', 'play', 'square', 'repeat', 'folder-open', 'save', 'file-plus', 'download', 'layers', 'file', 'metronome', 'copy-plus',
]

pkg = pathlib.Path(sys.argv[1])
nodes = json.load(open(pkg / 'icon-nodes.json'))
missing = [n for n in NAMES if n not in nodes]
if missing:
    sys.exit(f'missing in lucide-static: {missing}')
out = {n: nodes[n] for n in NAMES}
dest = pathlib.Path(__file__).resolve().parent.parent / 'src' / 'model' / 'icons-data.json'
dest.write_text(json.dumps(out, separators=(',', ':')), encoding='utf-8')
print(f'{len(out)} icons -> {dest} ({dest.stat().st_size} bytes)')
