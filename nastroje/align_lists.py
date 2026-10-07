# -*- coding: utf-8 -*-
"""Přiřadí kandidátkám v datovém balíku plné názvy z registru ČSÚ (kvros) a ověří shodu."""
import zipfile, io, sys, os
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kmdata import read_payload

REG = {2006: "reg2006.zip", 2010: "reg2010.zip", 2014: "reg2014.zip", 2018: "reg2018.zip", 2022: "reg2022.zip"}

def load(y):
    z = zipfile.ZipFile(f"{os.environ.get("REG_DIR", "csu")}/{REG[y]}")
    rd = lambda f: pd.read_csv(io.BytesIO(z.read(f"csv_od/{f}")), sep=None, engine="python", dtype=str, encoding="utf-8-sig")
    ros, rk = rd("kvros.csv"), rd("kvrk.csv")
    # jen řádné volby: opakované a dodatečné volby mají jiné datum
    reg = ros.DATUMVOLEB.mode()[0]
    ros, rk = ros[ros.DATUMVOLEB.eq(reg)].copy(), rk[rk.DATUMVOLEB.eq(reg)].copy()
    ros = ros.fillna({"ZKRATKAO8": "", "ZKRATKAO30": "", "NAZEVCELK": ""})
    k = ["KODZASTUP", "COBVODU", "POR_STR_HL"]
    rk = rk[rk.PLATNOST.eq("A")].copy()
    rk["POCHLASU"] = pd.to_numeric(rk.POCHLASU, errors="coerce").fillna(0).astype(int)
    agg = rk.groupby(k).agg(n=("PORCISLO", "size"), pv=("POCHLASU", "sum")).reset_index()
    ros = ros.merge(agg, on=k, how="inner")
    for c in k: ros[c] = ros[c].astype(int)
    return ros.sort_values(k).reset_index(drop=True)

def align(meta, D):
    yrs = meta["years"]; full = [None] * D["L"]; z30 = [None] * D["L"]; bad = []
    mc = D["mcode"][D["mi"]]; mw = D["mward"][D["mi"]]
    for yi, y in enumerate(yrs):
        ros = load(y); idx = np.where(D["yr"] == yi)[0]
        g_ros = {key: grp for key, grp in ros.groupby(["KODZASTUP", "COBVODU"], sort=False)}
        # balík: seskupit podle (kód, obvod) v pořadí, v jakém leží
        pk = pd.DataFrame({"l": idx, "c": mc[idx].astype(int), "w": mw[idx].astype(int)})
        for (c, w), grp in pk.groupby(["c", "w"], sort=False):
            ls = grp.l.to_numpy(); r = g_ros.get((c, w))
            if r is None and w == 0: r = g_ros.get((c, 1))
            ok = r is not None and len(r) == len(ls)
            if ok:
                ok = all(D["abbr"][l] == a and D["n"][l] == n and D["pv"][l] == p
                         for l, a, n, p in zip(ls, r.ZKRATKAO8, r.n, r.pv))
            if not ok and r is not None:      # pořadí se může lišit: párovat podle (zkratka, n, hlasy)
                cand = {(a, n, p): i for i, (a, n, p) in enumerate(zip(r.ZKRATKAO8, r.n, r.pv))}
                hits = [cand.get((D["abbr"][l], D["n"][l], D["pv"][l])) for l in ls]
                if None not in hits and len(set(hits)) == len(hits):
                    r = r.iloc[hits]; ok = True
            if not ok:
                bad.append((y, c, w, len(ls), None if r is None else len(r))); continue
            for l, f, s in zip(ls, r.NAZEVCELK, r.ZKRATKAO30): full[l] = f; z30[l] = s
    return full, z30, bad

