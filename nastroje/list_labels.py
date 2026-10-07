# -*- coding: utf-8 -*-
"""Krátké rozlišující štítky kandidátek pro tlačítka (jen tam, kde se zkratka v obci opakuje)."""
import re
import numpy as np, pandas as pd

GEN = re.compile(r"^\s*(?:(?:místní\s+)?sdru[žz](?:ení|\.)\s*nez(?:ávislých|\.)?\s*kand(?:idátů|\.)?|snk(?=[\s\-–—:,.]|$)|"
                 r"nez(?:ávislí|ávislý)\s+kandidáti?)\s*[\-–—:,.]*\s*", re.I)

NK_PRE = re.compile(r"^\s*nezávisl[áý]\s+kandidát(?:ka)?\s*[\-–—:,]*\s*", re.I)
NK_SUF = re.compile(r"\s*[,\-–—(]\s*nezávisl[áý]\s+kandidát(?:ka)?\)?\s*$", re.I)

def tidy(s):
    return re.sub(r"\s+", " ", s).strip()

QUOTES = "„“”\"'‚‘’»«"

def person(full):
    return NK_SUF.sub("", NK_PRE.sub("", tidy(full).strip(QUOTES + " "))).strip(" -–—:,." + QUOTES)

def remainder(full):
    r = tidy(full).strip(QUOTES + " ")
    for _ in range(2):
        r2 = GEN.sub("", r, count=1)
        if r2 == r: break
        r = r2
    return r.strip(" -–—:,." + QUOTES)

def cut(s, n):
    if len(s) <= n: return s
    c = s[:n + 1].rsplit(" ", 1)[0].rstrip(" ,.-–—:(")
    return (c if len(c) >= n * 0.5 else s[:n].rstrip()) + "…"

def build(keys, abbr, full, por, LIM=22):
    """keys: kandidátky ve stejné obci/obvodu/roce mají stejný klíč. Vrací štítek nebo '' (není potřeba)."""
    df = pd.DataFrame({"k": keys, "a": abbr, "f": full, "p": por})
    need = (df.groupby(["k", "a"]).a.transform("size") > 1) | df.a.eq("")
    lab = pd.Series([""] * len(df))
    for k, g in df[need].groupby("k"):
        base = {i: (person(f) if a == "NK" else remainder(f)) for i, a, f in zip(g.index, g.a, g.f)}
        for i in base:
            if not base[i]: base[i] = f"č. {df.p[i]} na lístku"
        out = {i: cut(base[i], LIM) for i in base}
        # dvě stejné zkratky se nesmí slít do stejného štítku
        for lim in (30, 60):
            seen = {}
            for i in out: seen.setdefault((df.a[i], out[i].lower()), []).append(i)
            clash = [ix for ix in seen.values() if len(ix) > 1]
            if not clash: break
            for ix in clash:
                for i in ix: out[i] = cut(base[i], lim)
        seen = {}
        for i in out: seen.setdefault((df.a[i], out[i].lower()), []).append(i)
        for ix in seen.values():
            if len(ix) > 1:
                for i in ix: out[i] = f"{out[i]} (č. {df.p[i]})"
        for i, v in out.items(): lab[i] = v
    return lab.tolist()
