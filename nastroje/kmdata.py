# -*- coding: utf-8 -*-
"""Čtení a zápis datového balíku Křížkometru (stejný formát, jaký čte krizkometr.js)."""
import gzip, json, struct
import numpy as np

def _planes_read(b, o, k):
    a = np.frombuffer(b, np.uint8, 4 * k, o).reshape(4, k).astype(np.uint32)
    return a[0] | (a[1] << 8) | (a[2] << 16) | (a[3] << 24), o + 4 * k

def _planes_write(arr):
    a = np.asarray(arr, np.uint32)
    return b"".join(((a >> s) & 255).astype(np.uint8).tobytes() for s in (0, 8, 16, 24))

def read_payload(path_or_bytes):
    b = path_or_bytes if isinstance(path_or_bytes, (bytes, bytearray)) else open(path_or_bytes, "rb").read()
    if b[:2] == b"\x1f\x8b": b = gzip.decompress(b)
    ml = struct.unpack_from("<I", b, 0)[0]
    meta = json.loads(b[4:4 + ml]); buf = b[4 + ml:]
    L, N = struct.unpack_from("<II", buf, 0); o = 8
    def u8(k):
        nonlocal o; a = np.frombuffer(buf, np.uint8, k, o).copy(); o += k; return a
    def cp(k, dt):
        nonlocal o; a = np.frombuffer(buf, dt, k, o).copy(); o += k * np.dtype(dt).itemsize; return a
    def pl(k):
        nonlocal o; a, o = _planes_read(buf, o, k); return a
    D = dict(L=L, N=N)
    D["yr"], D["mand"], D["seats"], D["n"] = u8(L), u8(L), u8(L), u8(L)
    D["mi"] = cp(L, "<u2"); D["pop"] = cp(L, "<u4"); D["mask"] = cp(L, "<u4"); D["pv"] = pl(L)
    D["pos"] = u8(N); D["votes"] = pl(N)
    nb = (N + 7) >> 3
    for k in ("bEl", "bOr", "bCl", "bBe", "bHi"):
        D[k] = np.unpackbits(u8(nb), bitorder="little")[:N].astype(bool)
    k = struct.unpack_from("<I", buf, o)[0]; o += 4
    D["names"] = buf[o:o + k].decode().split("\n"); o += k
    k = struct.unpack_from("<I", buf, o)[0]; o += 4
    D["abbr"] = buf[o:o + k].decode().split("\n"); o += k
    M = struct.unpack_from("<I", buf, o)[0]; o += 4
    D["M"] = M; D["mcode"] = cp(M, "<u4"); D["mward"] = u8(M); D["mokr"] = u8(M); D["mtyp"] = u8(M)
    assert o == len(buf), (o, len(buf))
    D["off"] = np.concatenate([[0], np.cumsum(D["n"].astype(np.int64))[:-1]])
    return meta, D

def write_payload(meta, D):
    L, N, M = len(D["yr"]), len(D["pos"]), len(D["mcode"])
    m = json.dumps(meta, ensure_ascii=False).encode()
    parts = [struct.pack("<I", len(m)), m, struct.pack("<II", L, N)]
    for k in ("yr", "mand", "seats", "n"): parts.append(np.asarray(D[k], np.uint8).tobytes())
    parts += [np.asarray(D["mi"], "<u2").tobytes(), np.asarray(D["pop"], "<u4").tobytes(),
              np.asarray(D["mask"], "<u4").tobytes(), _planes_write(D["pv"]),
              np.asarray(D["pos"], np.uint8).tobytes(), _planes_write(D["votes"])]
    for k in ("bEl", "bOr", "bCl", "bBe", "bHi"):
        parts.append(np.packbits(np.asarray(D[k], bool), bitorder="little").tobytes())
    for k in ("names", "abbr"):
        s = "\n".join(D[k]).encode(); parts += [struct.pack("<I", len(s)), s]
    parts += [struct.pack("<I", M), np.asarray(D["mcode"], "<u4").tobytes(),
              np.asarray(D["mward"], np.uint8).tobytes(), np.asarray(D["mokr"], np.uint8).tobytes(),
              np.asarray(D["mtyp"], np.uint8).tobytes()]
    return gzip.compress(b"".join(parts), 9)

def read_names(path_or_bytes):
    b = path_or_bytes if isinstance(path_or_bytes, (bytes, bytearray)) else open(path_or_bytes, "rb").read()
    if b[:2] == b"\x1f\x8b": b = gzip.decompress(b)
    n, _x, ls, lg = struct.unpack_from("<IIII", b, 0); o = 16
    sur = b[o:o + ls].decode().split("\n"); o += ls
    giv = b[o:o + lg].decode().split("\n"); o += lg
    si, o = _planes_read(b, o, n); gi, o = _planes_read(b, o, n)
    return [f"{sur[a]} {giv[c]}".strip() for a, c in zip(si, gi)]

def allocate(votes, pos_order, M, pv=None):
    """§ 45 odst. 3–4: kdo je zvolen. votes v pořadí na lístku. Vrací (zvolen[bool], hranice, překročil[bool])."""
    v = np.asarray(votes, np.int64); n = len(v)
    tot = v.sum() if pv is None else pv
    a = np.floor(tot / n); t = a + a / 10
    cl = v >= t - 1e-9
    jump = sorted(np.where(cl)[0], key=lambda i: (-v[i], i))
    rest = [i for i in range(n) if not cl[i]]
    el = np.zeros(n, bool); el[(jump + rest)[:M]] = True
    return el, t, cl
