"""Download the open-licensed (OFL) caption fonts into ./fonts.

The same files are used by the browser preview (@font-face) and by libass when
burning captions, so what editors see in the preview is what gets rendered.
Static (non-variable) files are used on purpose: libass only renders the
default instance of variable fonts.
"""
import pathlib
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent / "fonts"
GF = "https://raw.githubusercontent.com/google/fonts/main/ofl"
NOTO = "https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts"

FONTS = [
    # Latin display faces
    f"{GF}/poppins/Poppins-Medium.ttf",
    f"{GF}/poppins/Poppins-SemiBold.ttf",
    f"{GF}/poppins/Poppins-Bold.ttf",
    f"{GF}/poppins/Poppins-ExtraBold.ttf",
    f"{GF}/poppins/Poppins-Black.ttf",
    f"{GF}/anton/Anton-Regular.ttf",
    f"{GF}/bebasneue/BebasNeue-Regular.ttf",
    f"{GF}/lato/Lato-Bold.ttf",
    f"{GF}/lato/Lato-Black.ttf",
    f"{GF}/bangers/Bangers-Regular.ttf",
    f"{GF}/archivoblack/ArchivoBlack-Regular.ttf",
    # Devanagari + Latin (good for Hindi, Marathi and Hinglish)
    f"{GF}/hind/Hind-SemiBold.ttf",
    f"{GF}/hind/Hind-Bold.ttf",
    f"{GF}/mukta/Mukta-Bold.ttf",
    f"{GF}/mukta/Mukta-ExtraBold.ttf",
]
NOTO_FAMILIES = [
    "NotoSans", "NotoSansDevanagari", "NotoSansBengali", "NotoSansTamil",
    "NotoSansTelugu", "NotoSansKannada", "NotoSansMalayalam", "NotoSansGujarati",
    "NotoSansGurmukhi", "NotoSansOriya", "NotoSansArabic", "NotoSansSinhala",
]
for fam in NOTO_FAMILIES:
    for weight in ("Regular", "Bold", "Black"):
        FONTS.append(f"{NOTO}/{fam}/hinted/ttf/{fam}-{weight}.ttf")


def main() -> int:
    ROOT.mkdir(exist_ok=True)
    failed = 0
    for url in FONTS:
        dest = ROOT / url.rsplit("/", 1)[1]
        if dest.exists() and dest.stat().st_size > 0:
            continue
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                dest.write_bytes(r.read())
            print("ok  ", dest.name)
        except Exception as e:  # some weights don't exist for every family
            print("skip", dest.name, f"({e})")
            failed += 1
    print(f"{len(list(ROOT.glob('*.ttf')))} fonts in {ROOT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
