import sys, glob
from PIL import Image, ImageDraw
files = sorted(glob.glob(sys.argv[1] + '-*.jpg')); per = 4
for k in range(0, len(files), per):
    ims = [Image.open(f) for f in files[k:k+per]]
    w, h = ims[0].size; sheet = Image.new('RGB', (w*2 + 10, h*2 + 10), 'white')
    for i, im in enumerate(ims):
        sheet.paste(im, ((i % 2) * (w + 10), (i // 2) * (h + 10)))
        ImageDraw.Draw(sheet).text(((i % 2) * (w + 10) + 5, (i // 2) * (h + 10) + 5), str(k + i + 1), fill='red')
    sheet.save(f'{sys.argv[1]}_sheet{k//per + 1}.png'); print(f'{sys.argv[1]}_sheet{k//per + 1}.png')
