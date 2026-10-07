import sys
import numpy as np
from PIL import Image
from scipy import ndimage

rgb = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(np.float64)
distance = (255 - rgb).max(axis=2)

near_white = distance < 24
labels, _ = ndimage.label(near_white)
border = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
background = np.isin(labels, border[border > 0])

# Only pixels touching the outside background are anti-aliased against white; un-blend just those so
# the body stays opaque and the white eyes survive.
edge = ndimage.binary_dilation(background, iterations=3) & ~background
alpha = np.full(distance.shape, 255.0)
alpha[background] = 0
alpha[edge] = distance[edge]

color = rgb.copy()
blended = edge & (alpha > 0)
scale = 255 / alpha[blended]
for channel in range(3):
    color[..., channel][blended] = 255 - (255 - rgb[..., channel][blended]) * scale

rgba = np.dstack([np.clip(color, 0, 255), alpha]).astype(np.uint8)
image = Image.fromarray(rgba, 'RGBA')
cropped = image.crop(image.getbbox())
side = max(cropped.size)
pad = round(side * 0.04)
square = Image.new('RGBA', (side + 2 * pad, side + 2 * pad))
square.paste(cropped, (pad + (side - cropped.width) // 2, pad + (side - cropped.height) // 2))
square.resize((1024, 1024), Image.LANCZOS).save(sys.argv[2])
square.resize((256, 256), Image.LANCZOS).save(sys.argv[3])
