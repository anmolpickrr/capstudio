"""Font catalogue shared by the browser preview and the libass burn-in.

Every font file is exposed as its own entry. The ASS side references the face
by its full name (name ID 4) so libass picks exactly that file, and the
browser loads the same file through @font-face. libass sizes text so that
winAscent + winDescent equals the requested size, while CSS/SVG size the em
square: `scale` converts one into the other, and `ascent` places the baseline
inside a libass line box. `scripts` lists the writing systems the font can
fully render, so the editor never offers a font that would show empty boxes.
"""
from __future__ import annotations

import json
import pathlib
from functools import lru_cache

from fontTools.ttLib import TTFont

FONTS_DIR = pathlib.Path(__file__).resolve().parent.parent / "fonts"

# Letters a font must contain to count as supporting a script.
SCRIPT_SAMPLES = {
    "latin": "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "devanagari": "अआइईउऊएऐओऔकखगघचछजझटठडढणतथदधनपफबभमयरलवशषसहािीुूेैोौ्ं",
    "bengali": "অআইঈউঊএঐওঔকখগঘচছজঝটঠডঢণতথদধনপফবভমযরলশষসহািীুে্",
    "gurmukhi": "ਅਆਇਈਉਊਏਐਓਔਕਖਗਘਚਛਜਝਟਠਡਢਣਤਥਦਧਨਪਫਬਭਮਯਰਲਵਸਹਾਿੀੁੇ੍",
    "gujarati": "અઆઇઈઉઊએઐઓઔકખગઘચછજઝટઠડઢણતથદધનપફબભમયરલવશષસહાિીુે્",
    "oriya": "ଅଆଇଈଉଊଏଐଓଔକଖଗଘଚଛଜଝଟଠଡଢଣତଥଦଧନପଫବଭମଯରଲଶଷସହାିୀୁେ୍",
    "tamil": "அஆஇஈஉஊஎஏஐஒஓஔகஙசஞடணதநபமயரலவழளறனாிீுெ்",
    "telugu": "అఆఇఈఉఊఎఏఐఒఓఔకఖగఘచఛజఝటఠడఢణతథదధనపఫబభమయరలవశషసహాిీుె్",
    "kannada": "ಅಆಇಈಉಊಎಏಐಒಓಔಕಖಗಘಚಛಜಝಟಠಡಢಣತಥದಧನಪಫಬಭಮಯರಲವಶಷಸಹಾಿೀುೆ್",
    "malayalam": "അആഇഈഉഊഎഏഐഒഓഔകഖഗഘചഛജഝടഠഡഢണതഥദധനപഫബഭമയരലവശഷസഹാിീുെ്",
    "arabic": "ابتثجحخدذرزسشصضطظعغفقكلمنهوي",
    "sinhala": "අආඉඊඋඌඑඒඓඔඕඖකඛගඝචඡජඣටඨඩඪණතථදධනපඵබභමයරලවශෂසහ",
}

WEIGHT_LABELS = {100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular", 500: "Medium",
                 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black"}

# Families shown first in the picker, in this order. Others follow by category.
PREFERRED = ["Poppins", "Montserrat", "Inter", "Anton", "Bebas Neue", "Archivo Expanded",
             "Bricolage Grotesque", "Playfair Display", "Instrument Serif", "Baloo 2", "Noto Sans"]
CATEGORY_ORDER = ["sans", "display", "condensed", "serif", "script", "mono"]


def _ranges(codepoints: list[int]) -> list[list[int]]:
    out: list[list[int]] = []
    for cp in sorted(codepoints):
        if out and cp == out[-1][1] + 1:
            out[-1][1] = cp
        else:
            out.append([cp, cp])
    return out


def _categories() -> dict[str, str]:
    path = FONTS_DIR / "families.json"
    return json.loads(path.read_text()) if path.exists() else {}


@lru_cache(maxsize=1)
def catalogue() -> list[dict]:
    categories = _categories()
    fonts = []
    for path in sorted(FONTS_DIR.glob("*.[ot]tf")):
        tt = TTFont(path, lazy=True)
        name = tt["name"]
        os2 = tt["OS/2"]
        family = name.getDebugName(16) or name.getDebugName(1)
        full = name.getDebugName(4)
        upm = tt["head"].unitsPerEm
        win = os2.usWinAscent + os2.usWinDescent
        cmap = tt.getBestCmap()
        italic = bool(os2.fsSelection & 1) or "Italic" in (name.getDebugName(17) or name.getDebugName(2) or "")
        scripts = [s for s, sample in SCRIPT_SAMPLES.items() if all(ord(c) in cmap for c in sample)]
        category = categories.get(family) or ("sans" if family.startswith("Noto") else "sans")
        fonts.append({
            "id": path.stem,
            "file": path.name,
            "family": family,
            "assName": full,
            "weight": os2.usWeightClass,
            "italic": italic,
            "label": WEIGHT_LABELS.get(os2.usWeightClass, str(os2.usWeightClass)) + (" Italic" if italic else ""),
            "category": category,
            "scripts": scripts,
            "scale": upm / win if win else 1.0,
            "ascent": os2.usWinAscent / win if win else 0.8,
            "ranges": _ranges(list(cmap.keys())),
        })
        tt.close()

    def order(f):
        fam = f["family"]
        rank = PREFERRED.index(fam) if fam in PREFERRED else len(PREFERRED)
        cat = CATEGORY_ORDER.index(f["category"]) if f["category"] in CATEGORY_ORDER else 9
        return (rank, cat, fam, f["italic"], f["weight"])

    return sorted(fonts, key=order)
