// Průběžné výsledky komunálních voleb 2026 pro Křížkometr.
//
//   dotnet run nastroje/prubezne2026.cs          (stačí .NET 10 SDK, nic dalšího)
//
// Zapíše do data/ tři soubory ve stejném formátu jako soubory 2006–2022:
//   vysledky-2026.bin   hlasy, mandáty a bity; přepisuje se při každém spuštění
//   jmena-2026.bin      jména kandidátů z registru ČSÚ; mění se, jen když se změní registr
//   kandidatky-2026.bin plné názvy kandidátek a štítky; totéž
// Kandidátky a kandidáti jsou v souborech všichni (z registru), i v obcích, kde se ještě
// nesčítá, takže pořadí kandidátů je při každém spuštění stejné a jména k nim sedí.
// Zdroj: stavové XML za okresy (opendata ČSÚ, kolik okrsků je sečteno a jestli jsou rozdělené
// mandáty) a JSON prezentační aplikace volby.gov.cz (hlasy všech kandidátů, i průběžně).
// Stažené JSONy se drží v nastroje/cache2026 a znovu se stahují jen u obcí, kde se od
// posledně něco změnilo.
using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;

Console.OutputEncoding = Encoding.UTF8;
CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;
CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;

const string APP = "https://volby.gov.cz/appdata/kv2026/20261009";
const string REG_URL = "https://volby.gov.cz/opendata/kv2026/KV2026reg20261007_csv.zip";
const int ROK = 2026;

var scriptPath = AppContext.GetData("EntryPointFilePath") as string;
var repo = args.FirstOrDefault(a => !a.StartsWith("--"))
    ?? (scriptPath != null ? Path.GetFullPath(Path.Combine(Path.GetDirectoryName(scriptPath)!, "..")) : Directory.GetCurrentDirectory());
var dataDir = Path.Combine(repo, "data");
if (!File.Exists(Path.Combine(dataDir, "vysledky.bin"))) { Console.Error.WriteLine($"Nenašla jsem {dataDir}/vysledky.bin, zadejte cestu k repu jako argument."); return 1; }
var cache = Path.Combine(repo, "nastroje", "cache2026");
Directory.CreateDirectory(Path.Combine(cache, "json"));
bool vse = args.Contains("--vse");          // stáhnout znovu všechny JSONy

var http = new HttpClient(new HttpClientHandler { AutomaticDecompression = System.Net.DecompressionMethods.All }) { Timeout = TimeSpan.FromSeconds(60) };
http.DefaultRequestHeaders.UserAgent.ParseAdd("Krizkometr/1.0 (+https://www.ih21.org/krizkometr)");
async Task<byte[]> Get(string url) {
    for (int k = 1; ; k++) {
        try {
            using var r = await http.GetAsync(url);
            r.EnsureSuccessStatusCode();
            return await r.Content.ReadAsByteArrayAsync();
        } catch (Exception e) when (k < 7) { Console.Error.WriteLine($"  znovu ({k}): {url} – {e.Message}"); await Task.Delay(2000 * k); }
    }
}

// ------------------------------------------------------------------ registr
var regZip = Path.Combine(cache, Path.GetFileName(REG_URL));
if (!File.Exists(regZip)) { Console.WriteLine("Stahuji registr…"); File.WriteAllBytes(regZip, await Get(REG_URL)); }
List<Dictionary<string, string>> ReadCsv(ZipArchive z, string name) {
    using var rd = new StreamReader(z.GetEntry(name)!.Open(), Encoding.UTF8);
    var rows = new List<Dictionary<string, string>>(); string[]? head = null; string? line;
    while ((line = rd.ReadLine()) != null) {
        var f = Csv.Split(line);
        if (head == null) { head = f; continue; }
        var d = new Dictionary<string, string>(head.Length);
        for (int i = 0; i < head.Length; i++) d[head[i]] = i < f.Length ? f[i] : "";
        rows.Add(d);
    }
    return rows;
}
List<Dictionary<string, string>> rzcoco, ros, rk;
using (var z = ZipFile.OpenRead(regZip)) {
    rzcoco = ReadCsv(z, "csv_od/kvrzcoco.csv"); ros = ReadCsv(z, "csv_od/kvros.csv"); rk = ReadCsv(z, "csv_od/kvrk.csv");
}
int Int(Dictionary<string, string> r, string k) => int.Parse(r[k], CultureInfo.InvariantCulture);

// základní data: štítky stran, kraje a okresy musí ležet ve stejném pořadí
var baseRaw = Bin.Gunzip(File.ReadAllBytes(Path.Combine(dataDir, "vysledky.bin")));
var baseMeta = JsonDocument.Parse(Encoding.UTF8.GetString(baseRaw, 4, BitConverter.ToInt32(baseRaw, 0))).RootElement;
var tags = baseMeta.GetProperty("tags").EnumerateArray().Select(x => x.GetString()!).ToArray();
var okresyMeta = baseMeta.GetProperty("okresy").EnumerateArray().Select(x => (x[0].GetString()!, x[1].GetInt32())).ToArray();
var kraje = baseMeta.GetProperty("kraje").EnumerateArray().Select(x => x.GetString()!).ToArray();

// okres: číselné kódy ČSÚ (1100, 2101 … 8106) jdou ve stejném pořadí jako META.okresy
var okrCodes = rzcoco.Select(r => Int(r, "OKRES")).Distinct().OrderBy(x => x).ToArray();
if (okrCodes.Length != okresyMeta.Length) throw new Exception($"okresů {okrCodes.Length}, v datech {okresyMeta.Length}");
var okrIdx = okrCodes.Select((c, i) => (c, i)).ToDictionary(p => p.c, p => p.i);

// zastupitelstva a volební obvody; obec s obvody má souhrnný řádek (OBVODY=1) a řádky obvodů (OBVODY=2)
var ent = new SortedDictionary<(int kod, int obv), Dictionary<string, string>>();
var maObvody = new HashSet<int>();
var nekonaji = new SortedSet<int>();         // STAV_OBCE 1: volby se nekonají pro nedostatek kandidátů
foreach (var r in rzcoco) {
    int ob = Int(r, "OBVODY"), kod = Int(r, "KODZASTUP");
    if (r["STAV_OBCE"] != "0") { nekonaji.Add(kod); continue; }
    if (ob == 1) { maObvody.Add(kod); continue; }
    var key = (kod, ob == 2 ? Int(r, "COBVODU") : 1);
    if (!ent.ContainsKey(key)) ent[key] = r;
}
var entKeys = ent.Keys.ToList();
var entIdx = entKeys.Select((k, i) => (k, i)).ToDictionary(p => p.k, p => p.i);
int M = entKeys.Count;

// kandidátky v pořadí kód, obvod, číslo na lístku; kandidáti jen platní, v pořadí na lístku
var kandByList = rk.Where(r => r["PLATNOST"] == "A")
    .GroupBy(r => (Int(r, "KODZASTUP"), Int(r, "COBVODU"), Int(r, "POR_STR_HL")))
    .ToDictionary(g => g.Key, g => g.OrderBy(r => Int(r, "PORCISLO")).ToList());
var lists = ros.Select(r => (key: (kod: Int(r, "KODZASTUP"), obv: Int(r, "COBVODU"), por: Int(r, "POR_STR_HL")), r))
    .Where(x => kandByList.ContainsKey(x.key) && entIdx.ContainsKey((x.key.kod, x.key.obv)))
    .OrderBy(x => x.key.kod).ThenBy(x => x.key.obv).ThenBy(x => x.key.por).ToList();
int L = lists.Count;
var off = new int[L]; int N = 0;
for (int l = 0; l < L; l++) { off[l] = N; N += kandByList[lists[l].key].Count; }
Console.WriteLine($"Registr: {entKeys.Select(k => k.kod).Distinct().Count()} zastupitelstev ({M} s obvody), {L} kandidátek, {N} kandidátů");

// strany na kandidátce -> štítky filtru; pravidlo odvozené z dat 2022 (sedí na 23 054 z 23 083 kandidátek)
var named = new Dictionary<string, string> {
    ["001"] = "KDU-ČSL", ["005"] = "Zelení", ["007"] = "SOCDEM", ["759"] = "SOCDEM", ["047"] = "KSČM", ["053"] = "ODS",
    ["088"] = "NEZ", ["1114"] = "SPD", ["1227"] = "Trikolora", ["1245"] = "PŘÍSAHA", ["129"] = "SNK ED", ["166"] = "STAN",
    ["181"] = "Nestraníci", ["714"] = "Svobodní", ["716"] = "Soukromníci", ["720"] = "Piráti", ["721"] = "TOP 09", ["768"] = "ANO" };
uint MaskOf(string slozeni) {
    uint m = 0;
    foreach (var c in slozeni.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)) {
        if (c == "080") continue;                       // nezávislý kandidát
        m |= 1u << Array.IndexOf(tags, named.TryGetValue(c, out var t) ? t : "jiná strana");
    }
    return m != 0 ? m : 1u << Array.IndexOf(tags, "bez politické strany");
}

// ----------------------------------------------- jména a názvy kandidátek (jen z registru)
var jmenaPath = Path.Combine(dataDir, "jmena-2026.bin");
var kandPath = Path.Combine(dataDir, "kandidatky-2026.bin");
{
    var sur = new string[N]; var giv = new string[N];
    for (int l = 0; l < L; l++) { var ks = kandByList[lists[l].key]; for (int i = 0; i < ks.Count; i++) { sur[off[l] + i] = ks[i]["PRIJMENI"].Trim(); giv[off[l] + i] = ks[i]["JMENO"].Trim(); } }
    Bin.WriteIfChanged(jmenaPath, Bin.Names(sur, giv));
    var full = lists.Select(x => x.r["NAZEVCELK"]).ToArray();
    var abbr = lists.Select(x => x.r["ZKRATKAO8"]).ToArray();
    var keys = lists.Select(x => (long)x.key.kod * 1000 + x.key.obv).ToArray();
    var por = lists.Select(x => x.key.por).ToArray();
    Bin.WriteIfChanged(kandPath, Labels.ListsFile(ROK, keys, abbr, full, por));
}

// ------------------------------------------------------- stav sčítání (XML za okresy)
var nav = JsonDocument.Parse(await Get(APP + "/navig/okresy.json")).RootElement.GetProperty("okresy");
var nuts = new List<string>();
foreach (var kr in nav.EnumerateObject()) foreach (var o in kr.Value.EnumerateArray()) nuts.Add(o[0].GetString() == "CZ010" ? "CZ0100" : o[0].GetString()!);
Console.WriteLine($"Stahuji stav za {nuts.Count} okresů…");
var xmlSig = new Dictionary<(int, int), string>();       // kód, obvod -> spočteno|okrsky|hlasy kandidátek
var xmlZprac = new Dictionary<(int, int), (int z, int c, bool sp)>();
string cas = "";
XNamespace ns = "http://www.volby.cz/kv/";
await Parallel.ForEachAsync(nuts, new ParallelOptions { MaxDegreeOfParallelism = 4 }, async (code, _) => {
    var x = XDocument.Parse(Encoding.UTF8.GetString(await Get($"{APP}/odata/okresy/vysledky_obce_okres_{code}.xml")));
    var root = x.Root!;
    if (root.Element(ns + "CHYBA") != null) throw new Exception($"{code}: {root.Element(ns + "CHYBA")}");
    lock (xmlSig) {
        var g = (string?)root.Attribute("DATUM_CAS_GENEROVANI") ?? "";
        if (string.CompareOrdinal(g, cas) > 0) cas = g;
        foreach (var ob in root.Elements(ns + "OBEC")) {
            int kod = (int)ob.Attribute("KODZASTUP")!; bool sp = (string)ob.Attribute("JE_SPOCTENO")! == "1";
            var obv = ob.Elements(ns + "OBVOD").ToList();
            var parts = obv.Count > 0 ? obv.Select(o => ((int)o.Attribute("CIS_OBVODU")!, o.Element(ns + "VYSLEDEK")!))
                                      : new[] { (1, ob.Element(ns + "VYSLEDEK")!) };
            foreach (var (c, v) in parts) {
                var u = v.Element(ns + "UCAST")!;
                int zp = (int)u.Attribute("OKRSKY_ZPRAC")!, ce = (int)u.Attribute("OKRSKY_CELKEM")!;
                var hl = v.Elements(ns + "VOLEBNI_STRANA").OrderBy(s => (int)s.Attribute("POR_STR_HLAS_LIST")!).Select(s => (string)s.Attribute("HLASY")!);
                xmlSig[(kod, c)] = Sig(sp, zp, ce, hl);
                xmlZprac[(kod, c)] = (zp, ce, sp);
            }
        }
    }
});
static string Sig(bool sp, int z, int c, IEnumerable<string> hl) => $"{(sp ? 1 : 0)}|{z}/{c}|{string.Join(",", hl)}";
Console.WriteLine($"Stav ČSÚ k {cas}; obcí v XML: {xmlSig.Count}");
var chybi = entKeys.Where(k => !xmlSig.ContainsKey(k)).ToList();
if (chybi.Count > 0) Console.WriteLine($"  POZOR: {chybi.Count} zastupitelstev z registru v XML není, např. {string.Join(", ", chybi.Take(5))}");

// ------------------------------------------------- výsledky zastupitelstev (JSON aplikace)
string JsonPath((int kod, int obv) k) => Path.Combine(cache, "json", $"{k.kod}_{k.obv}.json");
string JsonUrl((int kod, int obv) k) => $"{APP}/vysled/{Int(ent[k], "OKRES")}/{k.kod}{(maObvody.Contains(k.kod) ? "_" + k.obv : "")}.json";
static string SigOf(JsonElement j) {
    var p = j.GetProperty("prehled");
    var hl = j.GetProperty("vysledky").EnumerateArray().OrderBy(r => r[0].GetInt32()).Select(r => r[2].GetInt64().ToString());
    return Sig(j.GetProperty("zvoleno").GetBoolean(), p[3].GetInt32(), p[2].GetInt32(), hl);
}
var res = new Dictionary<(int, int), JsonElement>();
var stahnout = new List<(int, int)>();
foreach (var k in entKeys) {
    if (!xmlZprac.TryGetValue(k, out var st) || st.z == 0) continue;     // tady se ještě nic nesečetlo
    var p = JsonPath(k);
    if (!vse && File.Exists(p)) {
        var j = JsonDocument.Parse(File.ReadAllBytes(p)).RootElement;
        if (SigOf(j) == xmlSig[k]) { res[k] = j; continue; }
    }
    stahnout.Add(k);
}
Console.WriteLine($"Stahuji {stahnout.Count} zastupitelstev (beze změny {res.Count})…");
int hotovo = 0;
await Parallel.ForEachAsync(stahnout, new ParallelOptions { MaxDegreeOfParallelism = 6 }, async (k, _) => {
    var b = await Get(JsonUrl(k));
    var j = JsonDocument.Parse(b).RootElement;
    await File.WriteAllBytesAsync(JsonPath(k), b);
    lock (res) { res[k] = j; if (++hotovo % 500 == 0) Console.WriteLine($"  {hotovo}/{stahnout.Count}"); }
});

// --------------------------------------------------------------------- sestavení
var yr = new byte[L]; var mand = new byte[L]; var seats = new byte[L]; var nArr = new byte[L];
var mi = new ushort[L]; var pop = new uint[L]; var mask = new uint[L]; var pv = new uint[L];
var pos = new byte[N]; var votes = new uint[N];
var bEl = new bool[N]; var bOr = new bool[N]; var bCl = new bool[N]; var bBe = new bool[N]; var bHi = new bool[N];
var stEnt = new byte[M];                        // 0 sečteno a rozdělené mandáty, 1 průběžně, 2 nic
int chHranice = 0, chPrideleni = 0, chPocet = 0, chSoucet = 0, chMandaty = 0;
var varovani = new List<string>();
for (int m = 0; m < M; m++) {
    var k = entKeys[m];
    stEnt[m] = (byte)(res.TryGetValue(k, out var j0) ? (j0.GetProperty("zvoleno").GetBoolean() ? 0 : 1) : 2);
}
for (int l = 0; l < L; l++) {
    var (key, r) = lists[l]; var ks = kandByList[key]; int n = ks.Count, o = off[l];
    if (n > 255) throw new Exception($"kandidátka {key} má {n} kandidátů");
    var ek = (key.kod, key.obv); int m = entIdx[ek]; var e = ent[ek];
    yr[l] = 0; mand[l] = (byte)Int(e, "MANDATY"); nArr[l] = (byte)n; mi[l] = (ushort)m;
    pop[l] = uint.Parse(e["POCOBYV"]); mask[l] = MaskOf(r["SLOZENI"]);
    for (int i = 0; i < n; i++) pos[o + i] = (byte)Int(ks[i], "PORCISLO");
    if (stEnt[m] == 2) continue;
    var j = res[ek];
    if (!j.GetProperty("hlasy").TryGetProperty(key.por.ToString(), out var hl)) { varovani.Add($"{key}: v JSONu chybí kandidátka"); continue; }
    var byPos = new Dictionary<int, JsonElement>();
    foreach (var row in hl.EnumerateArray()) byPos[row[0].GetInt32()] = row;
    if (byPos.Count != n) { chPocet++; varovani.Add($"{key}: kandidátů v JSONu {byPos.Count}, v registru {n}"); }
    long sum = 0; int S = 0;
    bool done = stEnt[m] == 0;
    for (int i = 0; i < n; i++) {
        if (!byPos.TryGetValue(pos[o + i], out var row)) continue;
        votes[o + i] = (uint)row[3].GetInt64(); sum += votes[o + i];
        if (done && row[5].ValueKind == JsonValueKind.True) { bEl[o + i] = true; S++; }
    }
    pv[l] = (uint)sum;
    var vr = j.GetProperty("vysledky").EnumerateArray().FirstOrDefault(x => x[0].GetInt32() == key.por);
    if (vr.ValueKind == JsonValueKind.Array && vr[2].GetInt64() != sum) { chSoucet++; varovani.Add($"{key}: součet hlasů {sum}, kandidátka {vr[2]}"); }
    if (done && vr.ValueKind == JsonValueKind.Array && vr.GetArrayLength() > 7 && vr[7].GetInt32() != S) { chMandaty++; varovani.Add($"{key}: zvolených {S}, mandátů {vr[7]}"); }
    seats[l] = (byte)S;
    // bity přesně jako v datech 2006–2022 (ověřeno přepočtem na všech 1 071 645 kandidátech)
    double avg = (double)sum / n, a = Math.Floor(avg), t = a + a / 10;
    long minEl = long.MaxValue;
    for (int i = 0; i < n; i++) if (bEl[o + i]) minEl = Math.Min(minEl, votes[o + i]);
    for (int i = 0; i < n; i++) {
        int ix = o + i; long v = votes[ix];
        bool cl = v >= t - 1e-9;
        if (n == 1 && sum == 0) cl = false;
        if (!done && sum == 0) cl = false;          // průběžně bez hlasů: hranici zatím nikdo nepřekročil
        bCl[ix] = cl; bHi[ix] = !cl && v > avg;
        bOr[ix] = i < S;
        bBe[ix] = done && !bEl[ix] && minEl != long.MaxValue && v > minEl;
    }
    if (j.TryGetProperty("hranice", out var hr) && hr.TryGetProperty(key.por.ToString(), out var hv) && hv.ValueKind == JsonValueKind.Number
        && Math.Abs(hv.GetDouble() - Math.Round(t, 2)) > 0.011) { chHranice++; if (chHranice <= 10) varovani.Add($"{key}: hranice {t}, ČSÚ {hv.GetDouble()}"); }
    // přepočet podle § 45 odst. 3–4 musí dát stejné zvolené jako ČSÚ
    if (done) {
        var order = Enumerable.Range(0, n).Where(i => bCl[o + i]).OrderByDescending(i => votes[o + i]).ThenBy(i => i)
            .Concat(Enumerable.Range(0, n).Where(i => !bCl[o + i])).Take(S).ToHashSet();
        for (int i = 0; i < n; i++) if (order.Contains(i) != bEl[o + i]) { chPrideleni++; varovani.Add($"{key}: přepočet nesedí na místě {pos[o + i]}"); break; }
    }
}
foreach (var w in varovani.Take(30)) Console.WriteLine("  ! " + w);
if (varovani.Count > 30) Console.WriteLine($"  ! … a dalších {varovani.Count - 30}");
Console.WriteLine($"Kontroly: počet kandidátů {chPocet}, součty {chSoucet}, mandáty {chMandaty}, hranice {chHranice}, přepočet zvolených {chPrideleni} neshod");

// ------------------------------------------------------------------------ zápis
int zastup = entKeys.Select(k => k.kod).Distinct().Count();
var stKod = entKeys.Select((k, m) => (k.kod, s: stEnt[m])).GroupBy(x => x.kod).Select(g => g.Max(x => x.s)).ToList();
int secteno = stKod.Count(s => s == 0), castecne = stKod.Count(s => s == 1);
using var metaMs = new MemoryStream();
using (var w = new Utf8JsonWriter(metaMs, new JsonWriterOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping })) {
    w.WriteStartObject();
    w.WriteStartArray("years"); w.WriteNumberValue(ROK); w.WriteEndArray();
    w.WriteStartArray("tags"); foreach (var t in tags) w.WriteStringValue(t); w.WriteEndArray();
    w.WriteNumber("n_lists", L); w.WriteNumber("n_cands", N); w.WriteNumber("n_munis", M);
    w.WriteStartArray("kraje"); foreach (var k in kraje) w.WriteStringValue(k); w.WriteEndArray();
    w.WriteStartArray("okresy"); foreach (var (nm, kr) in okresyMeta) { w.WriteStartArray(); w.WriteStringValue(nm); w.WriteNumberValue(kr); w.WriteEndArray(); } w.WriteEndArray();
    // průběh sčítání: čas ČSÚ, počty zastupitelstev a okrsky u těch, kde ještě nejsou rozdělené mandáty
    w.WriteStartObject("stav");
    w.WriteString("cas", cas); w.WriteString("sestaveno", DateTime.Now.ToString("yyyy-MM-dd'T'HH:mm:ss"));
    w.WriteNumber("zastup", zastup); w.WriteNumber("secteno", secteno); w.WriteNumber("castecne", castecne);
    w.WriteStartArray("nekonaji"); foreach (var k in nekonaji) w.WriteNumberValue(k); w.WriteEndArray();
    w.WriteStartArray("obce");
    for (int m = 0; m < M; m++) if (stEnt[m] != 0) {
        var z = xmlZprac.TryGetValue(entKeys[m], out var q) ? q : (0, 0, false);
        if (stEnt[m] == 1 && res.TryGetValue(entKeys[m], out var j)) { var p = j.GetProperty("prehled"); z = (p[3].GetInt32(), p[2].GetInt32(), false); }
        w.WriteStartArray(); w.WriteNumberValue(m); w.WriteNumberValue(z.Item1); w.WriteNumberValue(z.Item2); w.WriteEndArray();
    }
    w.WriteEndArray(); w.WriteEndObject();
    w.WriteEndObject();
}
var names = entKeys.Select(k => ent[k]["NAZEVZAST"]).ToArray();
var abbrAll = lists.Select(x => x.r["ZKRATKAO8"]).ToArray();
var body = Bin.Body(L, yr, mand, seats, nArr, mi, pop, mask, pv, pos, votes, new[] { bEl, bOr, bCl, bBe, bHi }, names, abbrAll,
    entKeys.Select(k => (uint)k.kod).ToArray(), entKeys.Select(k => (byte)k.obv).ToArray(),
    entKeys.Select(k => (byte)okrIdx[Int(ent[k], "OKRES")]).ToArray(), entKeys.Select(k => (byte)Int(ent[k], "TYPZASTUP")).ToArray());
var outPath = Path.Combine(dataDir, "vysledky-2026.bin");
var souhrn = $"sečteno {secteno} z {zastup} zastupitelstev, průběžně {castecne}, bez výsledků {zastup - secteno - castecne}";
// jen nový čas ČSÚ bez nových hlasů soubor nepřepisuje: v gitu by to byl prázdný commit
if (File.Exists(outPath)) {
    var old = Bin.Gunzip(File.ReadAllBytes(outPath)); int oml = BitConverter.ToInt32(old, 0);
    var oldStav = JsonDocument.Parse(Encoding.UTF8.GetString(old, 4, oml)).RootElement.GetProperty("stav");
    var newStav = JsonDocument.Parse(metaMs.ToArray()).RootElement.GetProperty("stav");
    string Klic(JsonElement s) => $"{s.GetProperty("secteno")}|{s.GetProperty("castecne")}|{s.GetProperty("obce").GetRawText()}";
    if (Klic(oldStav) == Klic(newStav) && old.AsSpan(4 + oml).SequenceEqual(body)) {
        Console.WriteLine($"Beze změny proti minulému sestavení ({souhrn}), vysledky-2026.bin nepřepisuji.");
        return 0;
    }
}
var payload = Bin.Gzip(Bin.Concat(BitConverter.GetBytes((uint)metaMs.Length), metaMs.ToArray(), body));
File.WriteAllBytes(outPath, payload);
Console.WriteLine($"Hotovo: {souhrn}. vysledky-2026.bin {payload.Length / 1024} kB, stav ČSÚ k {cas}");
return 0;

// =====================================================================================
static class Csv {
    public static string[] Split(string line) {
        var f = new List<string>(); var sb = new StringBuilder(); bool q = false;
        for (int i = 0; i < line.Length; i++) {
            char c = line[i];
            if (q) { if (c == '"') { if (i + 1 < line.Length && line[i + 1] == '"') { sb.Append('"'); i++; } else q = false; } else sb.Append(c); }
            else if (c == '"') q = true;
            else if (c == ',') { f.Add(sb.ToString()); sb.Clear(); }
            else sb.Append(c);
        }
        f.Add(sb.ToString());
        return f.ToArray();
    }
}

static class Bin {
    public static byte[] Gunzip(byte[] b) {
        if (b.Length < 2 || b[0] != 0x1f || b[1] != 0x8b) return b;
        using var ms = new MemoryStream(b); using var gz = new GZipStream(ms, CompressionMode.Decompress); using var o = new MemoryStream();
        gz.CopyTo(o); return o.ToArray();
    }
    public static byte[] Gzip(byte[] b) {
        using var o = new MemoryStream();
        using (var gz = new GZipStream(o, CompressionLevel.SmallestSize)) gz.Write(b);
        return o.ToArray();
    }
    // stejný soubor se nepřepisuje, aby se v gitu neobjevil jako změněný
    public static void WriteIfChanged(string path, byte[] b) {
        if (File.Exists(path) && Gunzip(File.ReadAllBytes(path)).AsSpan().SequenceEqual(Gunzip(b))) return;
        File.WriteAllBytes(path, b); Console.WriteLine($"Zapsáno {Path.GetFileName(path)} ({b.Length / 1024} kB)");
    }
    static void U32(Stream s, uint v) => s.Write(BitConverter.GetBytes(v));
    static void Planes(Stream s, uint[] a) { for (int sh = 0; sh < 32; sh += 8) foreach (var v in a) s.WriteByte((byte)(v >> sh)); }
    static void Bits(Stream s, bool[] a) {
        var b = new byte[(a.Length + 7) >> 3];
        for (int i = 0; i < a.Length; i++) if (a[i]) b[i >> 3] |= (byte)(1 << (i & 7));
        s.Write(b);
    }
    static void Text(Stream s, IEnumerable<string> lines) { var b = Encoding.UTF8.GetBytes(string.Join("\n", lines)); U32(s, (uint)b.Length); s.Write(b); }
    public static byte[] Concat(params byte[][] parts) { using var s = new MemoryStream(); foreach (var p in parts) s.Write(p); return s.ToArray(); }
    // část za META, přesně podle write_payload() v kmdata.py a parse() v krizkometr.js
    public static byte[] Body(int L, byte[] yr, byte[] mand, byte[] seats, byte[] n, ushort[] mi, uint[] pop, uint[] mask, uint[] pv,
                              byte[] pos, uint[] votes, bool[][] bits, string[] names, string[] abbr, uint[] mcode, byte[] mward, byte[] mokr, byte[] mtyp) {
        using var s = new MemoryStream();
        U32(s, (uint)L); U32(s, (uint)pos.Length);
        s.Write(yr); s.Write(mand); s.Write(seats); s.Write(n);
        foreach (var v in mi) s.Write(BitConverter.GetBytes(v));
        foreach (var v in pop) U32(s, v);
        foreach (var v in mask) U32(s, v);
        Planes(s, pv); s.Write(pos); Planes(s, votes);
        foreach (var b in bits) Bits(s, b);
        Text(s, names); Text(s, abbr);
        U32(s, (uint)mcode.Length); foreach (var v in mcode) U32(s, v); s.Write(mward); s.Write(mokr); s.Write(mtyp);
        return s.ToArray();
    }
    // podle read_names() v kmdata.py a loadNames() v krizkometr.js: příjmení a jména bez opakování, indexy po bajtových rovinách
    public static byte[] Names(string[] sur, string[] giv) {
        var us = sur.Distinct().OrderBy(x => x, StringComparer.Ordinal).ToArray(); var ug = giv.Distinct().OrderBy(x => x, StringComparer.Ordinal).ToArray();
        var si = us.Select((x, i) => (x, i)).ToDictionary(p => p.x, p => p.i); var gi = ug.Select((x, i) => (x, i)).ToDictionary(p => p.x, p => p.i);
        var bs = Encoding.UTF8.GetBytes(string.Join("\n", us)); var bg = Encoding.UTF8.GetBytes(string.Join("\n", ug));
        using var s = new MemoryStream();
        U32(s, (uint)sur.Length); U32(s, (uint)us.Length); U32(s, (uint)bs.Length); U32(s, (uint)bg.Length);
        s.Write(bs); s.Write(bg);
        Planes(s, sur.Select(x => (uint)si[x]).ToArray()); Planes(s, giv.Select(x => (uint)gi[x]).ToArray());
        return Gzip(s.ToArray());
    }
}

// krátké štítky kandidátek do tlačítek: přepis list_labels.py a build_lists_file.py
static class Labels {
    static readonly Regex GEN = new(@"^\s*(?:(?:místní\s+)?sdru[žz](?:ení|\.)\s*nez(?:ávislých|\.)?\s*kand(?:idátů|\.)?|snk(?=[\s\-–—:,.]|$)|nez(?:ávislí|ávislý)\s+kandidáti?)\s*[\-–—:,.]*\s*", RegexOptions.IgnoreCase);
    static readonly Regex NK_PRE = new(@"^\s*nezávisl[áý]\s+kandidát(?:ka)?\s*[\-–—:,]*\s*", RegexOptions.IgnoreCase);
    static readonly Regex NK_SUF = new(@"\s*[,\-–—(]\s*nezávisl[áý]\s+kandidát(?:ka)?\)?\s*$", RegexOptions.IgnoreCase);
    static readonly char[] QUOTES = "„“”\"'‚‘’»«".ToCharArray();
    static readonly char[] QS = QUOTES.Append(' ').ToArray();
    static readonly char[] END = " -–—:,.".ToCharArray().Concat(QUOTES).ToArray();
    public static string Tidy(string s) => Regex.Replace(s, @"\s+", " ").Trim();
    static string Person(string full) => NK_SUF.Replace(NK_PRE.Replace(Tidy(full).Trim(QS), ""), "").Trim(END);
    static string Remainder(string full) {
        var r = Tidy(full).Trim(QS);
        for (int k = 0; k < 2; k++) { var r2 = GEN.Replace(r, "", 1); if (r2 == r) break; r = r2; }
        return r.Trim(END);
    }
    static string Cut(string s, int n) {
        if (s.Length <= n) return s;
        var p = s[..(n + 1)]; int sp = p.LastIndexOf(' ');
        var c = (sp >= 0 ? p[..sp] : p).TrimEnd(" ,.-–—:(".ToCharArray());
        return (c.Length >= n * 0.5 ? c : s[..n].TrimEnd()) + "…";
    }
    static string[] Build(long[] keys, string[] abbr, string[] full, int[] por, int LIM = 22) {
        int L = keys.Length; var lab = new string[L]; Array.Fill(lab, "");
        var cnt = new Dictionary<(long, string), int>();
        for (int i = 0; i < L; i++) { var k = (keys[i], abbr[i]); cnt[k] = cnt.GetValueOrDefault(k) + 1; }
        var need = Enumerable.Range(0, L).Where(i => cnt[(keys[i], abbr[i])] > 1 || abbr[i] == "");
        foreach (var g in need.GroupBy(i => keys[i])) {
            var idx = g.ToList();
            var bas = idx.ToDictionary(i => i, i => abbr[i] == "NK" ? Person(full[i]) : Remainder(full[i]));
            foreach (var i in idx) if (bas[i] == "") bas[i] = $"č. {por[i]} na lístku";
            var outp = idx.ToDictionary(i => i, i => Cut(bas[i], LIM));
            // dvě stejné zkratky se nesmí slít do stejného štítku
            foreach (var lim in new[] { 30, 60 }) {
                var clash = idx.GroupBy(i => (abbr[i], outp[i].ToLowerInvariant())).Where(x => x.Count() > 1).ToList();
                if (clash.Count == 0) break;
                foreach (var c in clash) foreach (var i in c) outp[i] = Cut(bas[i], lim);
            }
            foreach (var c in idx.GroupBy(i => (abbr[i], outp[i].ToLowerInvariant())).Where(x => x.Count() > 1))
                foreach (var i in c) outp[i] = $"{outp[i]} (č. {por[i]})";
            foreach (var i in idx) lab[i] = outp[i];
        }
        return lab;
    }
    // gzip JSON {f: plné názvy, fi: index na kandidátku, s: štítky, si: -1 bez štítku / -2 štítek je plný název / index}
    public static byte[] ListsFile(int rok, long[] keys, string[] abbr, string[] full, int[] por) {
        var lab = Build(keys, abbr, full, por);
        var F = full.Select(Tidy).ToArray();
        var uf = F.Distinct().OrderBy(x => x, StringComparer.Ordinal).ToArray(); var fi = uf.Select((x, i) => (x, i)).ToDictionary(p => p.x, p => p.i);
        var ul = lab.Where((l, i) => l != "" && l != F[i]).Distinct().OrderBy(x => x, StringComparer.Ordinal).ToArray();
        var li = ul.Select((x, i) => (x, i)).ToDictionary(p => p.x, p => p.i);
        using var ms = new MemoryStream();
        using (var w = new Utf8JsonWriter(ms, new JsonWriterOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping })) {
            w.WriteStartObject(); w.WriteNumber("v", 1);
            w.WriteStartArray("years"); w.WriteNumberValue(rok); w.WriteEndArray();
            w.WriteStartArray("f"); foreach (var x in uf) w.WriteStringValue(x); w.WriteEndArray();
            w.WriteStartArray("fi"); foreach (var x in F) w.WriteNumberValue(fi[x]); w.WriteEndArray();
            w.WriteStartArray("s"); foreach (var x in ul) w.WriteStringValue(x); w.WriteEndArray();
            w.WriteStartArray("si"); for (int i = 0; i < lab.Length; i++) w.WriteNumberValue(lab[i] == "" ? -1 : lab[i] == F[i] ? -2 : li[lab[i]]); w.WriteEndArray();
            w.WriteEndObject();
        }
        return Bin.Gzip(ms.ToArray());
    }
}
