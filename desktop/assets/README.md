# Ícones

Os ícones necessários para o build do Electron já estão presentes nesta pasta:

- `icon.png` — 1024×1024, usado pela janela e como fallback do tray.
- `tray.png` — 512×512 com fundo transparente, usado na bandeja do sistema.
- `icon.ico` — gerado a partir do PNG para o instalador Windows (NSIS).
- `icon.icns` — gerado a partir do PNG para o .dmg do macOS.

> Não é necessário gerar novamente — o GitHub Actions já possui todos os arquivos para compilar os instaladores.
