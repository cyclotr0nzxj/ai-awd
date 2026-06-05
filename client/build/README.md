# Build Resources

Place the following icon files here before running `npm run dist`:

- `icon.icns` — macOS app icon (1024x1024 PNG → .icns)
- `icon.ico` — Windows app icon (256x256 PNG → .ico)

Generate with:
```bash
# macOS
sips -s format icns icon.png --out icon.icns

# Windows (requires ImageMagick)
convert icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
```
