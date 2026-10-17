"""Builds the caption font library in ./fonts.

The same files are used by the browser preview (@font-face) and by libass when
burning captions, so what editors see is what gets rendered. libass only draws
the default instance of a variable font, so variable Google Fonts are turned
into one static file per weight here (fontTools instancer) and renamed so every
file is its own family. All fonts are open source (SIL OFL or Apache 2.0).

    python scripts/fetch_fonts.py          # download what's missing
    python scripts/fetch_fonts.py --clean  # also delete fonts no longer listed
"""
from __future__ import annotations

import io
import json
import pathlib
import re
import sys
import urllib.parse
import urllib.request

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = pathlib.Path(__file__).resolve().parent.parent / "fonts"
GF = "https://raw.githubusercontent.com/google/fonts/main"
NOTO = "https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts"

WEIGHT_NAMES = {100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular", 500: "Medium",
                600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black"}

# (Google Fonts directory, category, upright weights, italic weights, extra axes, label)
# Category drives grouping in the picker and font fallback for other scripts.
GOOGLE = [
    # Sans
    ("ofl/poppins", "sans", [500, 600, 700, 800, 900], [800], {}, None),
    ("ofl/montserrat", "sans", [500, 700, 800, 900], [], {}, None),
    ("ofl/inter", "sans", [500, 700, 900], [], {}, None),
    ("ofl/dmsans", "sans", [500, 700, 900], [], {}, None),
    ("ofl/plusjakartasans", "sans", [500, 700, 800], [], {}, None),
    ("ofl/manrope", "sans", [500, 700, 800], [], {}, None),
    ("ofl/outfit", "sans", [500, 700, 900], [], {}, None),
    ("ofl/sora", "sans", [600, 800], [], {}, None),
    ("ofl/figtree", "sans", [500, 700, 900], [], {}, None),
    ("ofl/urbanist", "sans", [700, 900], [], {}, None),
    ("ofl/lato", "sans", [700, 900], [], {}, None),
    # Display
    ("ofl/anton", "display", [400], [], {}, None),
    ("ofl/bebasneue", "display", [400], [], {}, None),
    ("ofl/archivoblack", "display", [400], [], {}, None),
    ("ofl/archivo", "display", [800, 900], [], {"wdth": 125}, "Archivo Expanded"),
    ("ofl/bricolagegrotesque", "display", [600, 800], [], {}, None),
    ("ofl/unbounded", "display", [600, 900], [], {}, None),
    ("ofl/syne", "display", [700, 800], [], {}, None),
    ("ofl/spacegrotesk", "display", [500, 700], [], {}, None),
    ("ofl/rubik", "display", [700, 900], [900], {}, None),
    ("ofl/delagothicone", "display", [400], [], {}, None),
    ("ofl/bungee", "display", [400], [], {}, None),
    ("ofl/titanone", "display", [400], [], {}, None),
    ("apache/luckiestguy", "display", [400], [], {}, None),
    ("ofl/rubikmonoone", "display", [400], [], {}, None),
    ("ofl/kronaone", "display", [400], [], {}, None),
    ("ofl/bangers", "display", [400], [], {}, None),
    # Condensed
    ("ofl/oswald", "condensed", [500, 700], [], {}, None),
    ("ofl/barlowcondensed", "condensed", [600, 800, 900], [800], {}, None),
    ("ofl/leaguegothic", "condensed", [400], [], {}, None),
    ("ofl/bigshouldersdisplay", "condensed", [700, 900], [], {}, None),
    ("ofl/teko", "condensed", [500, 700], [], {}, None),
    # Serif / editorial
    ("ofl/playfairdisplay", "serif", [700, 900], [600, 800], {}, None),
    ("ofl/dmserifdisplay", "serif", [400], [400], {}, None),
    ("ofl/instrumentserif", "serif", [400], [400], {}, None),
    ("ofl/fraunces", "serif", [600, 900], [600], {"opsz": 144}, None),
    ("ofl/bodonimoda", "serif", [800], [700], {"opsz": 96}, None),
    ("ofl/abrilfatface", "serif", [400], [], {}, None),
    ("ofl/gloock", "serif", [400], [], {}, None),
    ("ofl/cormorantgaramond", "serif", [600, 700], [600], {}, None),
    # Handwritten / expressive
    ("apache/permanentmarker", "script", [400], [], {}, None),
    ("ofl/caveat", "script", [700], [], {}, None),
    ("ofl/pacifico", "script", [400], [], {}, None),
    ("ofl/sedgwickavedisplay", "script", [400], [], {}, None),
    ("ofl/monoton", "display", [400], [], {}, None),
    # Mono
    ("ofl/jetbrainsmono", "mono", [700, 800], [], {}, None),
    ("ofl/spacemono", "mono", [700], [], {}, None),
    # Indian scripts (all also cover Latin unless noted)
    ("ofl/hind", "sans", [600, 700], [], {}, None),
    ("ofl/mukta", "sans", [700, 800], [], {}, None),
    ("ofl/baloo2", "display", [600, 800], [], {}, None),
    ("ofl/balooda2", "display", [600, 800], [], {}, None),
    ("ofl/baloothambi2", "display", [600, 800], [], {}, None),
    ("ofl/balootammudu2", "display", [600, 800], [], {}, None),
    ("ofl/baloochettan2", "display", [600, 800], [], {}, None),
    ("ofl/baloobhai2", "display", [600, 800], [], {}, None),
    ("ofl/baloopaaji2", "display", [600, 800], [], {}, None),
    ("ofl/baloobhaina2", "display", [600, 800], [], {}, None),
    ("ofl/balootamma2", "display", [600, 800], [], {}, None),
    ("ofl/rozhaone", "serif", [400], [], {}, None),
    ("ofl/tirodevanagarihindi", "serif", [400], [400], {}, None),
    ("ofl/martel", "serif", [800], [], {}, None),
    ("ofl/rajdhani", "condensed", [600, 700], [], {}, None),
    ("ofl/yatraone", "display", [400], [], {}, None),
    ("ofl/kalam", "script", [700], [], {}, None),
    ("ofl/shrikhand", "display", [400], [], {}, None),
    ("ofl/hindsiliguri", "sans", [600, 700], [], {}, None),
    ("ofl/hindmadurai", "sans", [600, 700], [], {}, None),
    ("ofl/hindguntur", "sans", [600, 700], [], {}, None),
    ("ofl/hindvadodara", "sans", [600, 700], [], {}, None),
]

NOTO_FAMILIES = [
    "NotoSans", "NotoSansDevanagari", "NotoSansBengali", "NotoSansTamil", "NotoSansTelugu",
    "NotoSansKannada", "NotoSansMalayalam", "NotoSansGujarati", "NotoSansGurmukhi", "NotoSansOriya",
    "NotoSansArabic", "NotoSansSinhala",
]
NOTO_WEIGHTS = {"Regular": 400, "Bold": 700, "Black": 900}


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()


def parse_metadata(text: str) -> tuple[str, list[dict], dict[str, tuple[float, float]]]:
    name = re.search(r'^name: "(.+)"', text, re.M).group(1)
    fonts = [{"style": m.group(1), "weight": int(m.group(2)), "filename": m.group(3)}
             for m in re.finditer(r'fonts \{[^}]*?style: "(\w+)"[^}]*?weight: (\d+)[^}]*?filename: "([^"]+)"',
                                  text, re.S)]
    axes = {m.group(1): (float(m.group(2)), float(m.group(3)))
            for m in re.finditer(r'axes \{\s*tag: "(\w+)"\s*min_value: ([\d.]+)\s*max_value: ([\d.]+)', text)}
    return name, fonts, axes


def rename(tt: TTFont, family: str, weight: int, italic: bool) -> None:
    """Make every file a standalone family named e.g. "Montserrat ExtraBold"."""
    style = WEIGHT_NAMES[weight] + (" Italic" if italic else "")
    style = style.replace("Regular Italic", "Italic")
    full = f"{family} {style}".replace(" Regular", "") if style != "Regular" else family
    ps = re.sub(r"[^A-Za-z0-9-]", "", f"{family.replace(' ', '')}-{style.replace(' ', '')}")
    name = tt["name"]
    for rec in list(name.names):
        if rec.nameID in (1, 2, 3, 4, 6, 16, 17, 21, 22, 25):
            name.removeNames(nameID=rec.nameID)
    for nid, value in ((1, full), (2, "Regular"), (3, f"{ps};caption-panel"), (4, full), (6, ps),
                       (16, family), (17, style)):
        name.setName(value, nid, 3, 1, 0x409)
        name.setName(value, nid, 1, 0, 0)
    tt["OS/2"].usWeightClass = weight
    tt["OS/2"].fsSelection = (tt["OS/2"].fsSelection & ~0b1100001) | (0b1 if italic else 0b1000000)
    tt["head"].macStyle = 0b10 if italic else 0
    if "STAT" in tt:
        del tt["STAT"]


def out_name(family: str, weight: int, italic: bool) -> str:
    style = "Italic" if italic and weight == 400 else WEIGHT_NAMES[weight] + ("Italic" if italic else "")
    return f"{family.replace(' ', '')}-{style}.ttf"


def build_google(entry, clean_keep: set[str], categories: dict[str, str]) -> int:
    path, category, weights, italics, extra_axes, label = entry
    meta = fetch(f"{GF}/{path}/METADATA.pb").decode()
    family, files, axes = parse_metadata(meta)
    family = label or family
    categories[family] = category
    made = 0
    for italic, wanted in ((False, weights), (True, italics)):
        style = "italic" if italic else "normal"
        for weight in wanted:
            dest = ROOT / out_name(family, weight, italic)
            clean_keep.add(dest.name)
            if dest.exists():
                continue
            static = next((f for f in files if f["style"] == style and f["weight"] == weight
                           and "[" not in f["filename"]), None)
            variable = next((f for f in files if f["style"] == style and "[" in f["filename"]), None)
            src = static or variable
            if not src:
                print(f"skip {family} {weight}{' italic' if italic else ''}: not available")
                continue
            data = fetch(f"{GF}/{path}/{urllib.parse.quote(src['filename'])}")
            tt = TTFont(io.BytesIO(data))
            if "fvar" in tt:
                loc = {"wght": weight} if "wght" in axes else {}
                for tag, value in extra_axes.items():
                    if tag in axes:
                        lo, hi = axes[tag]
                        loc[tag] = min(max(value, lo), hi)
                loc = {t: v for t, v in loc.items() if t in {a.axisTag for a in tt["fvar"].axes}}
                tt = instancer.instantiateVariableFont(tt, loc, inplace=False)
                # pin any remaining axes to their defaults
                if "fvar" in tt:
                    tt = instancer.instantiateVariableFont(
                        tt, {a.axisTag: a.defaultValue for a in tt["fvar"].axes}, inplace=False)
            rename(tt, family, weight, italic)
            tt.save(dest)
            made += 1
            print("ok  ", dest.name)
    return made


def build_noto(clean_keep: set[str]) -> int:
    made = 0
    for fam in NOTO_FAMILIES:
        for wname in NOTO_WEIGHTS:
            dest = ROOT / f"{fam}-{wname}.ttf"
            clean_keep.add(dest.name)
            if dest.exists():
                continue
            dest.write_bytes(fetch(f"{NOTO}/{fam}/hinted/ttf/{fam}-{wname}.ttf"))
            made += 1
            print("ok  ", dest.name)
    return made


def main() -> int:
    ROOT.mkdir(exist_ok=True)
    keep: set[str] = {"families.json"}
    categories: dict[str, str] = {}
    failed = 0
    for entry in GOOGLE:
        try:
            build_google(entry, keep, categories)
        except Exception as e:  # noqa: BLE001 - report and continue with the rest
            print(f"FAIL {entry[0]}: {e}")
            failed += 1
    build_noto(keep)
    (ROOT / "families.json").write_text(json.dumps(categories, indent=1, sort_keys=True))
    if "--clean" in sys.argv:
        for f in ROOT.glob("*.ttf"):
            if f.name not in keep:
                f.unlink()
                print("removed", f.name)
    total = len(list(ROOT.glob("*.ttf")))
    size = sum(f.stat().st_size for f in ROOT.glob("*.ttf")) / 1e6
    print(f"{total} fonts ({size:.1f} MB) in {ROOT}" + (f", {failed} families failed" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
