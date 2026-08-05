# PTNotes

Markdown notes + todo lists + AI assistant, organized by project. Electron + React + TypeScript.

## Commands

- `npm run dev` — development with HMR
- `npm run test` — service / AI tools / chat session / markdown tests
- `npm run typecheck` — TypeScript checks (main + renderer)
- `npm run lint` — ESLint
- `npm run build` — typecheck + electron-vite production build

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
# For windows
$ npm run build:win

# For macOS (arm64: DMG + zip)
$ npm run build:mac

# For Linux
$ npm run build:linux
```

Packaged artifacts are written to `dist/` (e.g. `dist/ptnotes-0.1.0.dmg`).
