"""Font catalogue shared by the browser preview and the libass burn-in.

Every font file is exposed as its own entry. The ASS side references the face
by its full name (name ID 4) so libass picks exactly that file, and the
browser loads the same file through @font-face. `scale` converts an ASS font
size into a CSS font size: libass sizes text so that winAscent + winDescent
equals the requested size, while CSS sizes the em square.
"""
from __future__ import annotations

import pathlib
from functools import lru_cache

from fontTools.ttLib import TTFont

FONTS_DIR = pathlib.Path(__file__).resolve().parent.parent / "fonts"

# Families shown first in the picker, in this order. Others follow alphabetically.
PREFERRED = ["Poppins", "Anton", "Bebas Neue", "Archivo Black", "Lato", "Bangers",
             "Noto Sans", "Hind", "Mukta"]


def _ranges(codepoints: list[int]) -> list[list[int]]:
    out: list[list[int]] = []
    for cp in sorted(codepoints):
        if out and cp == out[-1][1] + 1:
            out[-1][1] = cp
        else:
            out.append([cp, cp])
    return out


@lru_cache(maxsize=1)
def catalogue() -> list[dict]:
    fonts = []
    for path in sorted(FONTS_DIR.glob("*.[ot]tf")):
        tt = TTFont(path, lazy=True)
        name = tt["name"]
        os2 = tt["OS/2"]
        family = name.getDebugName(16) or name.getDebugName(1)
        full = name.getDebugName(4)
        upm = tt["head"].unitsPerEm
        win = os2.usWinAscent + os2.usWinDescent
        fonts.append({
            "id": path.stem,
            "file": path.name,
            "family": family,
            "assName": full,
            "weight": os2.usWeightClass,
            "scale": upm / win if win else 1.0,
            # Baseline position within a libass line box (line height == font size).
            "ascent": os2.usWinAscent / win if win else 0.8,
            "ranges": _ranges(list(tt.getBestCmap().keys())),
        })
        tt.close()

    def order(f):
        fam = f["family"]
        rank = PREFERRED.index(fam) if fam in PREFERRED else len(PREFERRED)
        return (rank, fam, f["weight"])

    return sorted(fonts, key=order)
