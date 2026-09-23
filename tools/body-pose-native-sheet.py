"""Make a labeled visual index of the actual native Blender preset renders (requires Pillow)."""
from pathlib import Path
import argparse
from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser()
parser.add_argument('directory', type=Path)
args = parser.parse_args()
font_path = Path('/System/Library/Fonts/Supplemental/Arial.ttf')
def font(size):
    return ImageFont.truetype(str(font_path), size) if font_path.exists() else ImageFont.load_default()

presets = [('neutral', 'Neutral'), ('relaxed', 'Relaxed'), ('arms_out', 'Arms out'),
           ('arm_showcase', 'Arm showcase'), ('flex', 'Bent arms'), ('step', 'Step')]
width, height, top, gap = 400, 442, 80, 14
sheet = Image.new('RGB', (3 * (width + gap) + gap, top + 4 * (height + gap)), '#eef2f6')
draw = ImageDraw.Draw(sheet)
draw.text((gap, 12), 'Pose presets — native Blender verification', font=font(28), fill='#182a3d')
draw.text((gap, 49), 'Both figures · final pose math · rendered subdivision level 3', font=font(19), fill='#45546a')
for person, sex in enumerate(('male', 'female')):
    for i, (key, label) in enumerate(presets):
        x, y = gap + (i % 3) * (width + gap), top + (person * 2 + i // 3) * (height + gap)
        draw.rectangle((x, y, x + width, y + 42), fill='white')
        draw.text((x + 12, y + 10), f'{sex.title()} · {label}', font=font(21), fill='#182a3d')
        rendered = Image.open(args.directory / f'{sex}-{key}-front.png').convert('RGB')
        rendered.thumbnail((width, width), Image.Resampling.LANCZOS)
        sheet.paste(rendered, (x, y + 42))
sheet.save(args.directory / 'native-presets.png')
print(args.directory / 'native-presets.png')
