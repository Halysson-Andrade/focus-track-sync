# Ícones

Coloque aqui antes do primeiro build (o GitHub Actions falha se faltarem):

- `icon.png` — 512×512, usado pela janela e como fallback do tray.
- `tray.png` — 32×32 (Windows) ou 22×22 (macOS, monocromático).
- `icon.ico` — gerado a partir do PNG para o instalador Windows.
- `icon.icns` — gerado a partir do PNG para o .dmg do macOS.

Geração rápida a partir de um PNG 1024×1024:

```bash
# .ico (Windows)
nix run nixpkgs#imagemagick -- convert icon-1024.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico

# .icns (macOS) — precisa do iconutil (só macOS) ou png2icns (Linux):
nix run nixpkgs#libicns -- png2icns icon.icns icon-1024.png
```
