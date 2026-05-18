## md-render

**English** | [简体中文](README.zh-CN.md)

`md-render` is a Markdown rendering skill and CLI tool for converting Markdown documents into **HTML**, **bitmap images**, or **single-page / paged PDF** files.

It supports **PNG**, **AVIF**, and **JPEG XL** image output.

It is designed for AI-generated Markdown and technical documents that may contain tables, task lists, code blocks, Mermaid diagrams, math formulas, alerts, custom containers, footnotes, and emoji.

## Features

- **Multiple output formats**: HTML, PNG, AVIF, JPEG XL, and PDF.
- **Six built-in themes**: `github`, `github-dark`, `juejin`, `wechat`, `academic`, and `animal-island`.
- **YAML frontmatter defaults** for title, metadata, TOC, theme/profile, fonts, and PDF options.
- **Extended Markdown support**:
  - GFM tables, task lists, strikethrough, and autolinks
  - Shiki code highlighting
  - Mermaid diagrams
  - KaTeX / MathJax math rendering
  - Footnotes and definition lists
  - Superscript, subscript, and marked text
  - GitHub-style alerts
  - Custom containers such as `tip`, `warning`, `danger`, `info`, `note`, and `details`
  - Twemoji-based emoji rendering
- **Safe rendering mode** for untrusted Markdown.
- **Standalone HTML mode** for offline or cross-device sharing.
- **Bitmap image and PDF rendering via system Chrome or Chromium** using `puppeteer-core`.

## Repository layout

```text
.
├── SKILL.md                 # Agent-facing skill instructions
├── README.md                # English documentation
├── README.zh-CN.md          # Simplified Chinese documentation
├── LICENSE                  # Custom personal-use, non-commercial license
├── references/
│   ├── usage.md             # Detailed CLI usage and examples
│   └── architecture.md      # Rendering pipeline and maintenance notes
└── scripts/
    ├── render.js            # Main renderer CLI
    ├── sample.md            # Synthetic sample document for smoke testing
    ├── test-smoke.js        # Smoke / regression tests
    ├── package.json         # Node.js dependencies and npm scripts
    └── themes/              # Built-in CSS themes
```

## Requirements

- Node.js
- npm
- Chrome or Chromium available on the system
- `pdftoppm` from Poppler for bitmap image generation
- Optional: `avifenc` from libavif for AVIF output
- Optional: `cjxl` from JPEG XL tools for JPEG XL output
- Optional: ImageMagick for bitmap supersampling workflows
- Optional: `oxipng` for lossless PNG optimization

> `puppeteer-core` is used, so Chromium is not downloaded automatically. If Chrome or Chromium cannot be detected, pass its executable path with `--chrome`.

## Quick start

Install dependencies:

```bash
cd scripts
npm ci
```

Check the local rendering environment:

```bash
npm run check-env
```

Render the sample document to HTML:

```bash
node render.js --in sample.md --out output.html --theme github
```

Render the sample document to a PNG long screenshot:

```bash
node render.js --in sample.md --out output.png --theme github --width 900
```

Render the sample document to AVIF:

```bash
node render.js --in sample.md --out output.avif --theme github --width 900
```

Render the sample document to JPEG XL:

```bash
node render.js --in sample.md --out output.jxl --theme github --width 900
```

Render the sample document to a single-page PDF:

```bash
node render.js --in sample.md --out output.pdf --theme academic
```

## CLI usage

```bash
node render.js \
  --in <input.md> \
  --out <output.{html,png,avif,jxl,pdf}> \
  [--format html|png|avif|jxl|pdf] \
  [--profile github-doc|wechat-long|juejin-article|academic-pdf|dark-slide|safe-standalone|retina-image|cozy-note] \
  [--theme github|github-dark|juejin|wechat|academic|animal-island] \
  [--width 900] \
  [--pdf-mode single-page|paged] \
  [--page-size A4|Letter] \
  [--margin 16mm] \
  [--safe] \
  [--standalone] \
  [--check-env]
```

The output format is inferred from the `--out` file extension unless `--format` is provided.

`--profile` applies scenario defaults without overriding explicit CLI options. Available profiles are `github-doc`, `wechat-long`, `juejin-article`, `academic-pdf`, `dark-slide`, `safe-standalone`, `retina-image`, and `cozy-note`.

You can also read Markdown from stdin:

```bash
cat input.md | node render.js --in - --out output.html --theme juejin
```

## Common examples

Render untrusted Markdown safely:

```bash
node render.js --in input.md --out output.html --theme github --safe
```

Generate a self-contained HTML file for offline sharing:

```bash
node render.js --in input.md --out output.html --theme github --standalone
```

Generate a dark themed image:

```bash
node render.js --in input.md --out output.png --profile dark-slide
```

Generate an AVIF image:

```bash
node render.js --in input.md --out output.avif --theme github --width 900
```

Generate a JPEG XL image:

```bash
node render.js --in input.md --out output.jxl --theme github --width 900
```

Generate a document-style PDF:

```bash
node render.js --in input.md --out output.pdf --profile academic-pdf
```

Generate a paged A4 PDF:

```bash
node render.js --in input.md --out output.pdf --profile academic-pdf --pdf-mode paged --page-size A4 --margin 16mm
```

## Themes

| Theme | Suggested use |
|---|---|
| `github` | Technical documentation, README files, API notes |
| `github-dark` | Dark themed screenshots or presentation assets |
| `juejin` | Chinese technical articles |
| `wechat` | Social sharing or article-style long screenshots |
| `academic` | Research notes, reports, and formal documents |
| `animal-island` | Warm, rounded, cozy notes or friendly share images |

## Security notes

By default, the renderer assumes trusted Markdown for compatibility with rich content.

Use `--safe` when rendering Markdown from external users, scraped web pages, or any unknown source. Safe mode disables raw Markdown HTML, blocks high-risk URL protocols such as `javascript:` and `data:`, uses strict Mermaid rendering, and adds extra HTML security headers and link attributes.

Use `--standalone` when HTML output must be portable or usable without external network access. In standalone mode, resources such as Mermaid diagrams, math formulas, Twemoji assets, and CSS are embedded into the generated HTML.

## Testing

Run the smoke / regression test suite:

```bash
cd scripts
npm test
```

The tests cover environment checks, safe and trusted rendering behavior, standalone Mermaid prerendering, local image handling, and basic bitmap output.

## More documentation

See `references/usage.md` for the full command reference, advanced rendering options, and additional examples.

See `references/architecture.md` for the rendering pipeline, security model, Mermaid/math/image internals, and maintenance notes.

## Privacy

The included sample content is intended to be synthetic and non-personal. Avoid committing generated outputs, local dependencies, logs, temporary files, credentials, or machine-specific paths.

## License

This project is released under a custom personal-use, non-commercial license. See `LICENSE` for details.
