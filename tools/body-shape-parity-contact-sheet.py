"""Label native Blender comparison renders without changing rendered content.

Run with Pillow: python tools/body-shape-parity-contact-sheet.py reports/body-shape/blender
Each source PNG has old deformation on the left and new deformation on the right.
"""
import argparse
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser()
parser.add_argument('directory', type=Path)
args = parser.parse_args()
font_path = Path('/System/Library/Fonts/Supplemental/Arial.ttf')
def font(size):
    return ImageFont.truetype(str(font_path), size) if font_path.exists() else ImageFont.load_default()

labels = {'default': 'Default', 'arms-min': 'Arms -100', 'arms-max': 'Arms +100',
          'build-min': 'Build -100', 'build-max': 'Build +100', 'all-min': 'All sliders -100', 'all-max': 'All sliders +100'}
def sheet(rows, columns, target, title):
    width, image_height, cell_header = 600, 467, 68
    top, gap = 94, 16
    canvas = Image.new('RGB', (len(columns) * (width + gap) + gap, top + len(rows) * (image_height + cell_header + gap)), '#f0f3f7')
    draw = ImageDraw.Draw(canvas)
    draw.text((gap, 15), title, font=font(30), fill='#182a3d')
    draw.text((gap, 54), 'Actual Blender models at render subdivision level 3', font=font(20), fill='#45546a')
    for row, case in enumerate(rows):
        for col, (sex, view) in enumerate(columns):
            x, y = gap + col * (width + gap), top + row * (image_height + cell_header + gap)
            draw.rectangle((x, y, x + width, y + cell_header), fill='#ffffff')
            draw.text((x + 12, y + 7), f'{sex.title()} · {labels[case]} · {view}', font=font(22), fill='#182a3d')
            draw.text((x + 108, y + 39), 'BEFORE', font=font(19), fill='#8b3134')
            draw.text((x + 415, y + 39), 'AFTER', font=font(19), fill='#216848')
            image = Image.open(args.directory / f'{sex}-{case}-{view}.png').convert('RGB')
            image.thumbnail((width, image_height), Image.Resampling.LANCZOS)
            canvas.paste(image, (x, y + cell_header))
    canvas.save(args.directory / target)

sheet(['arms-min', 'build-min', 'all-min', 'all-max'], [('male', 'front'), ('female', 'front')],
      'native-comparison.png', 'Figure adjustments — before and after')
for sex in ('male', 'female'):
    sheet(list(labels), [(sex, 'front'), (sex, 'side')], f'{sex}-native-all-views.png', f'{sex.title()} figure — every native render check')
print(args.directory / 'native-comparison.png')
