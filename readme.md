# Java Tools (Acode)

All-in-one Java plugin for Acode: **runner**, **input chips**, **javac linter**, **problems panel**, **optional JDTLS**, **auto-import**, **Maven jars** (planned).

## Layout

Modular folders (same idea as Python Debugger plugin):

- `core/` — init, settings hub
- `runner/` — javac → java modes
- `input/` — Scanner chips (next)
- `linter/` — javac diagnostics
- `problems/` — side button + store
- `intel/` — JDTLS, go-to-def, references
- `autoImport/`, `snippets/`, `formatter/`, `deps/`, `ui/`

## LSP

Settings → **LSP (JDTLS)**:

- `off` (default, low RAM)
- `builtin` — Acode LSP registry
- `external` — Language Client plugin

## Status

Phase 0 scaffold: settings, tools menu, problems UI, LSP registration hooks, runner stub.

See `plan-java.md` in the project for the full roadmap.
