# Build Resources

Place the following icon files here before running `npm run dist`:

- `icon.icns` — macOS app icon (1024x1024 PNG → .icns)
- `icon.ico` — Windows app icon (256x256 PNG → .ico)

Generate with:
```bash
# macOS .icns — requires an iconset directory
mkdir -p /tmp/icon.iconset
sips -z 16 16   icon.png --out /tmp/icon.iconset/icon_16x16.png
sips -z 32 32   icon.png --out /tmp/icon.iconset/icon_16x16@2x.png
sips -z 32 32   icon.png --out /tmp/icon.iconset/icon_32x32.png
sips -z 64 64   icon.png --out /tmp/icon.iconset/icon_32x32@2x.png
sips -z 128 128 icon.png --out /tmp/icon.iconset/icon_128x128.png
sips -z 256 256 icon.png --out /tmp/icon.iconset/icon_128x128@2x.png
sips -z 256 256 icon.png --out /tmp/icon.iconset/icon_256x256.png
sips -z 512 512 icon.png --out /tmp/icon.iconset/icon_256x256@2x.png
sips -z 512 512 icon.png --out /tmp/icon.iconset/icon_512x512.png
sips -z 1024 1024 icon.png --out /tmp/icon.iconset/icon_512x512@2x.png
iconutil -c icns /tmp/icon.iconset -o icon.icns

# Windows .ico (requires Python PIL)
python3 -c "
from PIL import Image
img = Image.open('icon.png')
img.save('icon.ico', format='ICO', sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
"
```
