# -*- coding: utf-8 -*-
"""data/kandidatky-*.bin: plné názvy kandidátek a krátké štítky do tlačítek (gzip JSON)."""
import sys, json, gzip
import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, pandas as pd
from list_labels import build, tidy

def make(meta, D, full, por):
    mc = D["mcode"][D["mi"]]; mw = D["mward"][D["mi"]]
    keys = (mc.astype(np.int64) * 1000 + mw) * 10 + D["yr"]
    lab = build(keys, D["abbr"], full, por)
    F = [tidy(f) for f in full]
    uf = sorted(set(F)); fi = {s: i for i, s in enumerate(uf)}
    # -1 = štítek netřeba, -2 = štítek je celý plný název, jinak index do tabulky štítků
    ul = sorted(set(l for l, f in zip(lab, F) if l and l != f)); li = {s: i for i, s in enumerate(ul)}
    si = [-1 if not l else (-2 if l == f else li[l]) for l, f in zip(lab, F)]
    obj = {"v": 1, "years": meta["years"], "f": uf, "fi": [fi[s] for s in F], "s": ul, "si": si}
    return gzip.compress(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode(), 9), lab

