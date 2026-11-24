# Fork instructions

Read `.codex/instructions.md` and `.codex/CONTEXT.md` before implementation when available. Follow `.codex/about.md` and `.codex/coding-style.md` for collaboration and engineering preferences.

## Priority

1. Do not introduce breaking changes to the core application.
2. Add new features through small, compatible changes that remain practical to maintain alongside upstream.

Preserve existing project JSON, browser autosave, geometry scale, editor behavior, and Home Assistant SVG/CSS/YAML contracts. Keep existing defaults unless the requested feature explicitly requires a change. Validate affected core workflows as well as new behavior. Do not claim compatibility based only on syntax checks.

The `.codex` directory is locally ignored. If it is absent in another checkout, these compatibility requirements still apply; inspect the README and current code before work.

## Spelling

Correct clear prose typos automatically. Ask before interpreting ambiguous spelling or renaming an established code identifier, schema key, configuration key, or path that could break references.
