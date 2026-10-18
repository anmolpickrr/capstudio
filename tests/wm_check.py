"""Measures a watermark in an exported frame: the mean brightness change inside the
watermark's shape and outside it, in the top quarter of the frame (clear of the
captions). Usage: wm_check.py source.png export.png overlay.png (all the same size).
Prints two numbers: inside outside."""
import sys

from PIL import Image, ImageChops

src, out, wm = (Image.open(p) for p in sys.argv[1:4])
box = (0, 0, src.width, src.height // 4)
src, out, wm = (im.crop(box) for im in (src, out, wm))
alpha = wm.convert("RGBA").getchannel("A")
inside = alpha.point(lambda a: 255 if a > 15 else 0)
outside = alpha.point(lambda a: 255 if a == 0 else 0)
diff = ImageChops.subtract(out.convert("L"), src.convert("L"), offset=128)  # 128 = no change


def mean(mask):
    hist = diff.histogram(mask)
    n = sum(hist)
    return sum(i * c for i, c in enumerate(hist)) / n - 128 if n else 0


print(f"{mean(inside):.2f} {mean(outside):.2f}")
