"""Compose before/after top, left, right, and back render sheets."""
import argparse
from pathlib import Path

from PIL import Image, ImageDraw

SLUGS = (
    "logitech-m100", "logitech-g903-hero",
    "logitech-signature-comfort-plus-m850l", "logitech-m750", "logitech-m325s",
)
VIEWS = ("top", "left", "right", "back")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    sheets = []
    for slug in SLUGS:
        sheet = Image.new("RGB", (4*384, 2*408), "white")
        draw = ImageDraw.Draw(sheet)
        for row, (label, folder) in enumerate((("before", args.before), ("after", args.after))):
            for col, view in enumerate(VIEWS):
                with Image.open(folder / f"{slug}__{view}.png") as image:
                    image = image.convert("RGB")
                    image.thumbnail((384, 384))
                    sheet.paste(image, (col*384+(384-image.width)//2, row*408+24))
                draw.text((col*384+8, row*408+7), f"{slug} / {label} / {view}", fill="black")
        sheet.save(args.output / f"{slug}.png")
        sheets.append(sheet)
    combined = Image.new("RGB", (4*384, len(sheets)*2*408), "white")
    for index, sheet in enumerate(sheets):
        combined.paste(sheet, (0, index*2*408))
    combined.save(args.output / "combined.png")


if __name__ == "__main__":
    main()
