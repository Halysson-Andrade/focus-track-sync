# Focus Track Monitor — App Desktop

App Electron que registra quais aplicativos da sua máquina (Visual Studio Code, DBeaver, Chrome, Photoshop, etc.) você está usando ao longo do dia. Complementa a extensão do Chrome (que detalha a navegação dentro do navegador).

## O que ele faz

- Faz login com a mesma conta do app web (Lovable Cloud).
- A cada 5 segundos, identifica qual janela está em foco e qual o processo dono dela.
- Quando você troca de app, fecha o registro anterior e abre um novo na tabela `uso_aplicativos`.
- Detecta ociosidade (>60s sem mouse/teclado) e contabiliza como tempo inativo.
- Roda em background (system tray). Opção de iniciar com o sistema.
- Faz logout automático no shutdown/restart da máquina.

> **Privacidade:** registra apenas o **nome do processo** (ex.: `code.exe`, `dbeaver.exe`) e um rótulo amigável. **Não** salva título de janela, conteúdo de arquivos abertos, prints, teclas digitadas, nem URLs.

## Rodar em modo dev

```bash
cd desktop
npm install
npm start
```

## Gerar instalador localmente

```bash
npm run build:win    # gera .exe (NSIS) em desktop/dist/
npm run build:mac    # gera .dmg (precisa rodar em macOS)
```

## Build automatizado (GitHub Actions)

Ao publicar uma tag `desktop-v*` (ex.: `desktop-v1.0.0`), o workflow `.github/workflows/desktop-build.yml` compila Windows + macOS e anexa os instaladores como release. Veja o workflow para detalhes.

## Ícones

Antes do primeiro build, coloque os ícones em `desktop/assets/` — veja `assets/README.md`.
