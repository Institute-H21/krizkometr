# Vložení Křížkometru na web institutu

Kódy počítají s adresou `https://instituth21.github.io/pruzkumnik-komunalek/`. Pokud se repo jmenuje jinak, upravte ji ve všech kódech níže. Repo je lepší nepřejmenovávat po vložení na web: s novým jménem se změní i adresa a embedy přestanou fungovat.

## 1. Skript, který dorovnává výšku (jednou na stránku)

Embedy samy hlásí, jak jsou vysoké, a tenhle skript jim podle toho nastaví výšku, takže se nic neořízne. Stačí ho na stránce mít jednou, například v Custom Code stránky nebo v prvním Embed prvku. Když se omylem vloží víckrát, nic se nestane.

```html
<script>
(function () {
  if (window.krizkometrVyska) return; window.krizkometrVyska = true;
  window.addEventListener("message", function (e) {
    if (e.origin !== "https://instituth21.github.io") return;
    var d = e.data; if (!d || !d.ih21Explorer || typeof d.height !== "number") return;
    var f = document.querySelectorAll("iframe.krizkometr");
    for (var i = 0; i < f.length; i++) if (f[i].contentWindow === e.source) f[i].style.height = (d.height + 2) + "px";
  });
})();
</script>
```

## 2. Průzkumník (logo, předvolby, filtry, anekdoty, kandidátka)

```html
<iframe class="krizkometr" src="https://instituth21.github.io/pruzkumnik-komunalek/pruzkumnik.html"
  title="Křížkometr – průzkumník přeskakování v komunálních volbách" loading="lazy"
  style="display:block;width:100%;border:0;height:1300px"></iframe>
```

## 3. Grafy: Co překročení hranice přineslo a Podle velikosti obce

Vkládá se níž do článku. Přebírá výběr, který si čtenář nastavil v průzkumníku, a nad grafy píše, pro jaký výběr čísla platí. Funguje jen na stejné stránce jako průzkumník; samotný ukazuje poslední volby.

```html
<iframe class="krizkometr" src="https://instituth21.github.io/pruzkumnik-komunalek/grafy.html"
  title="Křížkometr – co překročení hranice přineslo" loading="lazy"
  style="display:block;width:100%;border:0;height:900px"></iframe>
```

## 4. Čtečka kandidátek

Políčko pro obec a kandidátka, dole logo. Je samostatná, dá se vložit i na jinou stránku.

```html
<iframe class="krizkometr" src="https://instituth21.github.io/pruzkumnik-komunalek/kandidatka.html"
  title="Křížkometr – kandidátky ve vaší obci" loading="lazy"
  style="display:block;width:100%;border:0;height:420px"></iframe>
```

## Další adresy

- Celý Křížkometr na jedné stránce, na sdílení odkazu: `https://instituth21.github.io/pruzkumnik-komunalek/`
- Ukázka, jak budou embedy vypadat pod sebou: `https://instituth21.github.io/pruzkumnik-komunalek/ukazka.html`
