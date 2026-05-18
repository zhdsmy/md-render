#!/usr/bin/env node
/* md-render: Markdown -> HTML / bitmap images (PNG / AVIF / JPEG XL) / PDF
 *
 * Usage:
 *   node render.js --in input.md --out out.html
 *   node render.js --in input.md --out out.png --theme wechat --width 720
 *   node render.js --in input.md --out out.avif --theme github
 *   node render.js --in input.md --out out.jxl --theme github
 *   node render.js --in input.md --out out.pdf --theme github
 *
 * Common options:
 *   --in <path>          input markdown file (or '-' for stdin)
 *   --out <path>         output file
 *   --format <fmt>       html | png | avif | jxl | pdf  (default: inferred from --out extension)
 *   --profile <name>     preset defaults for common scenarios
 *   --theme <name>       github | github-dark | juejin | wechat | academic | animal-island  (default: github)
 *   --width <px>         viewport width for bitmap/pdf AND final bitmap pixel width (default: 900)
 *   --safe               disable raw HTML in Markdown and use stricter Mermaid security
 *   --standalone         (HTML only) inline assets for a zero-network HTML file
 *   --check-env          diagnose required local dependencies without rendering
 *
 * Bitmap/PDF advanced options:
 *   --supersample <n>    (bitmap only) internal oversampling factor
 *                        (default: 1; values >1 keep {filename}@Nx.<ext>)
 *   --wrap-code-column <n|auto|0>
 *                        hard-wrap long code lines for bitmap/pdf with a visible marker
 *                        (default: auto; 0 disables)
 *   --pdf-mode <mode>    single-page | paged (PDF only; default: single-page)
 *   --page-size <size>   A4 | Letter (paged PDF only; default: A4)
 *   --margin <length>    uniform paged PDF margin, e.g. 16mm, 0.75in (default: 16mm)
 *   --optimize-png       (PNG only) run optional oxipng lossless recompression
 *
 * Style advanced options:
 *   --title <str>        document title
 *   --font-cn <family>   override Chinese font family
 *   --font-en <family>   override English font family
 *   --font-mono <family> override monospace font family
 *   --shiki-theme <id>   override shiki theme (default: auto by theme)
 *
 * Debug / compatibility options:
 *   --chrome <path>      Chrome executable path (default: auto-detect)
 *   --keep-tmp           keep intermediate HTML/PDF/PNG files for debugging
 *   --trusted            compatibility escape hatch; default mode is already trusted
 *   --no-prerender-mermaid
 *                        disable Mermaid SVG prerender and use runtime Mermaid fallback
 *   --no-downsample      legacy bitmap escape hatch; prefer a larger --width for Retina bitmap
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const SKILL_DIR = path.resolve(__dirname, '..');
const THEME_DIR = path.join(__dirname, 'themes');

// Node 22+ 在用 require() 加载 ESM 模块（目前 shiki v1 / @vscode/markdown-it-katex 等）
// 时会打印 `ExperimentalWarning: CommonJS module ... is loading ES Module`。
// 这条警告只是 Node 提示实验通道被触发，不影响功能；但会污染 stderr，让上层脚本
// 的 `2>&1 | grep` 误判渲染失败。这里只过滤 ExperimentalWarning，其它 warning
// （DeprecationWarning 等）仍按默认行为打印，保留可观测性。
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w && w.name === 'ExperimentalWarning') return;
  console.warn(w && w.stack ? w.stack : w);
});

// -------- environment diagnostics --------
function commandExists(cmd) {
  const { spawnSync } = require('child_process');
  const result = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
  return !result.error;
}

function checkNodePackage(pkgName) {
  for (const target of [pkgName, `${pkgName}/package.json`]) {
    try {
      require.resolve(target);
      return { name: pkgName, ok: true };
    } catch {}
  }
  return { name: pkgName, ok: false, detail: `Cannot resolve ${pkgName}` };
}

function runEnvCheck() {
  const packages = [
    'markdown-it',
    'shiki',
    'puppeteer-core',
    'mermaid',
    'katex',
    'mathjax-full',
    '@twemoji/svg',
  ].map(checkNodePackage);
  const chrome = (() => {
    try {
      return { name: 'Chrome/Chromium', ok: true, path: detectChrome() };
    } catch (e) {
      return { name: 'Chrome/Chromium', ok: false, detail: e.message };
    }
  })();
  const binaries = [
    { name: 'pdftoppm', ok: commandExists('pdftoppm'), install: 'brew install poppler', requiredFor: 'bitmap output' },
    { name: 'magick', ok: commandExists('magick'), install: 'brew install imagemagick', requiredFor: 'bitmap supersample > 1', optional: true },
    { name: 'avifenc', ok: commandExists('avifenc'), install: 'brew install libavif', requiredFor: 'AVIF output', optional: true },
    { name: 'cjxl', ok: commandExists('cjxl'), install: 'brew install jpeg-xl', requiredFor: 'JPEG XL output', optional: true },
    { name: 'oxipng', ok: commandExists('oxipng'), install: 'brew install oxipng', requiredFor: 'optional PNG optimization', optional: true },
  ];
  const themeFiles = ['_base.css', 'github.css', 'github-dark.css', 'juejin.css', 'wechat.css', 'academic.css', 'animal-island.css'].map(file => ({
    name: file,
    ok: fs.existsSync(path.join(THEME_DIR, file)),
  }));

  const groups = [
    ['Node packages', packages],
    ['Browser', [chrome]],
    ['Native binaries', binaries],
    ['Theme files', themeFiles],
  ];
  let ok = true;
  for (const [title, items] of groups) {
    console.log(`\n[${title}]`);
    for (const item of items) {
      if (!item.ok && !item.optional) ok = false;
      const status = item.ok ? 'OK' : (item.optional ? 'WARN' : 'FAIL');
      const installHint = !item.ok && item.install ? ` - install: ${item.install}` : '';
      const extra = item.path ? ` (${item.path})` : item.detail ? ` - ${item.detail}` : installHint;
      const scope = item.requiredFor ? ` [${item.requiredFor}]` : '';
      console.log(`${status.padEnd(4)} ${item.name}${scope}${extra}`);
    }
  }
  console.log(`\n[md-render] environment ${ok ? 'OK' : 'FAILED'}`);
  return ok;
}

// -------- arg parsing (lightweight, no yargs to avoid esm issues) --------
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { out[key] = true; }
      else { out[key] = next; i++; }
    } else { out._.push(a); }
  }
  return out;
}

const args = parseArgs(process.argv);

if (args.help || args.h) {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').filter(l => l.startsWith(' *') || l.startsWith('/*')).join('\n'));
  process.exit(0);
}

const KNOWN_ARGS = new Set([
  '_', 'h', 'help', 'in', 'out', 'format', 'profile', 'theme', 'width', 'safe', 'standalone', 'check-env',
  'supersample', 'wrap-code-column', 'pdf-mode', 'page-size', 'margin', 'optimize-png',
  'title', 'font-cn', 'font-en', 'font-mono', 'shiki-theme',
  'chrome', 'keep-tmp', 'trusted', 'no-prerender-mermaid', 'no-downsample',
]);
const VALUE_ARGS = new Set([
  'in', 'out', 'format', 'profile', 'theme', 'width', 'supersample', 'wrap-code-column',
  'pdf-mode', 'page-size', 'margin',
  'title', 'font-cn', 'font-en', 'font-mono', 'shiki-theme', 'chrome',
]);
const SUPPORTED_FORMATS = new Set(['html', 'png', 'pdf', 'avif', 'jxl']);
const BITMAP_FORMATS = new Set(['png', 'avif', 'jxl']);
const AVIF_MAX_CELL_SIZE = 65536;
const AVIF_MIN_GRID_CELL_SIZE = 64;
const SUPPORTED_THEMES = new Set(['github', 'github-dark', 'juejin', 'wechat', 'academic', 'animal-island']);
const SUPPORTED_PDF_MODES = new Set(['single-page', 'paged']);
const SUPPORTED_PAGE_SIZES = new Set(['A4', 'Letter']);
const PAGE_SIZE_MM = Object.freeze({
  A4: { width: 210, height: 297 },
  Letter: { width: 215.9, height: 279.4 },
});
const PROFILES = Object.freeze({
  'github-doc': {
    format: 'html',
    theme: 'github',
    width: '900',
  },
  'wechat-long': {
    format: 'png',
    theme: 'wechat',
    width: '720',
    'wrap-code-column': 'auto',
  },
  'juejin-article': {
    format: 'png',
    theme: 'juejin',
    width: '900',
  },
  'academic-pdf': {
    format: 'pdf',
    theme: 'academic',
    width: '900',
  },
  'dark-slide': {
    format: 'png',
    theme: 'github-dark',
    width: '1200',
  },
  'safe-standalone': {
    format: 'html',
    theme: 'github',
    safe: true,
    standalone: true,
  },
  'retina-image': {
    format: 'png',
    theme: 'github',
    width: '1200',
    supersample: '2',
  },
  'cozy-note': {
    format: 'png',
    theme: 'animal-island',
    width: '900',
  },
});
const SUPPORTED_PROFILES = new Set(Object.keys(PROFILES));
let profileDefaultFormat = null;

function failUsage(message) {
  console.error(`Error: ${message}`);
  console.error('Use --help for details.');
  process.exit(1);
}

function requireValueArg(name) {
  if (args[name] === true) failUsage(`--${name} requires a value.`);
}

function readPositiveIntegerArg(name, defaultValue) {
  const raw = args[name];
  if (raw === undefined) return defaultValue;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) failUsage(`--${name} must be an integer >= 1.`);
  return n;
}

function cssLengthToPx(raw, argName) {
  const s = String(raw || '').trim();
  const m = s.match(/^(\d+(?:\.\d+)?)(px|mm|cm|in|pt)?$/i);
  if (!m) failUsage(`--${argName} must be a CSS length such as 16mm, 0.75in, 48px, or 0.`);
  const value = Number(m[1]);
  if (!Number.isFinite(value)) failUsage(`--${argName} must be a valid CSS length.`);
  const unit = (m[2] || 'px').toLowerCase();
  const factors = {
    px: 1,
    mm: 96 / 25.4,
    cm: 96 / 2.54,
    in: 96,
    pt: 96 / 72,
  };
  return value * factors[unit];
}

function validateArgs() {
  const unknown = Object.keys(args).filter(key => !KNOWN_ARGS.has(key));
  if (unknown.length) failUsage(`unknown option(s): ${unknown.map(key => `--${key}`).join(', ')}`);
  if (args._.length) failUsage(`unexpected positional argument(s): ${args._.join(', ')}`);
  for (const name of VALUE_ARGS) requireValueArg(name);
  if (args.profile !== undefined && !SUPPORTED_PROFILES.has(args.profile)) {
    failUsage(`--profile must be one of: ${Array.from(SUPPORTED_PROFILES).join(', ')}.`);
  }
  if (args.format !== undefined && !SUPPORTED_FORMATS.has(args.format)) {
    failUsage('--format must be one of: html, png, pdf, avif, jxl.');
  }
  if (args.theme !== undefined && !SUPPORTED_THEMES.has(args.theme)) {
    failUsage('--theme must be one of: github, github-dark, juejin, wechat, academic, animal-island.');
  }
  if (args['pdf-mode'] !== undefined && !SUPPORTED_PDF_MODES.has(args['pdf-mode'])) {
    failUsage('--pdf-mode must be single-page or paged.');
  }
  if (args['page-size'] !== undefined && !SUPPORTED_PAGE_SIZES.has(args['page-size'])) {
    failUsage('--page-size must be one of: A4, Letter.');
  }
  if (args.margin !== undefined) cssLengthToPx(args.margin, 'margin');
  const wrap = args['wrap-code-column'];
  if (wrap !== undefined && wrap !== 'auto') {
    const n = Number(wrap);
    if (!Number.isInteger(n) || n < 0) failUsage('--wrap-code-column must be auto, 0, or an integer >= 1.');
  }
}

validateArgs();

function applyProfileDefaults() {
  if (!args.profile) return;
  const defaults = PROFILES[args.profile];
  profileDefaultFormat = defaults.format || null;
  for (const [key, value] of Object.entries(defaults)) {
    if (key === 'format') continue;
    if (args[key] === undefined) args[key] = value;
  }
}

applyProfileDefaults();

if (args['check-env']) {
  process.exit(runEnvCheck() ? 0 : 1);
}

// 默认保持历史兼容：允许可信 Markdown 内的原始 HTML；处理外部输入时使用 --safe。
// --trusted 显式压过 --safe，便于脚本模板里统一追加安全参数后临时放开。
const safeMode = !!args.safe && !args.trusted;
const mermaidSecurityLevel = safeMode ? 'strict' : 'loose';

// -------- infer format --------
const inputPath  = args.in;
const outputPath = args.out;
if (!inputPath || !outputPath) {
  console.error('Error: --in and --out are required. Use --help for details.');
  process.exit(1);
}
let format = args.format;
if (!format) {
  const ext = path.extname(outputPath).toLowerCase().slice(1);
  format = SUPPORTED_FORMATS.has(ext) ? ext : (profileDefaultFormat || 'html');
}
const theme = args.theme || 'github';
if (format !== 'html' && args.standalone) {
  console.warn('[md-render] WARN: --standalone has no effect for bitmap/pdf; assets are always inlined.');
}
if (args['no-downsample']) {
  console.warn('[md-render] WARN: --no-downsample is a legacy bitmap escape hatch; prefer a larger --width for Retina bitmap output.');
}
const pdfMode = args['pdf-mode'] || 'single-page';
const pageSize = args['page-size'] || 'A4';
const pdfMargin = args.margin || '16mm';
if (format !== 'pdf' && (args['pdf-mode'] || args['page-size'] || args.margin)) {
  console.warn('[md-render] WARN: --pdf-mode, --page-size, and --margin only affect PDF output.');
}
// docTitle 优先级：--title CLI > frontmatter.title（若存在）> 输入文件名（不含扩展名）。
// 这里先按文件名兜底初始化，等下面剥离 frontmatter 后若能解析出 title 再按优先级覆盖。
let docTitle = args.title || path.basename(inputPath, path.extname(inputPath));

// 默认截图宽度 900；--width 显式覆盖，并在启动阶段校验，避免非法值拖到 Puppeteer 阶段才失败。最小宽度限制为 375。
const viewportWidth = Math.max(375, readPositiveIntegerArg('width', 900));
const pagedPdfContentWidth = (() => {
  if (format !== 'pdf' || pdfMode !== 'paged') return null;
  const page = PAGE_SIZE_MM[pageSize];
  const pageWidthPx = page.width * (96 / 25.4);
  const contentWidth = pageWidthPx - cssLengthToPx(pdfMargin, 'margin') * 2;
  return Math.max(375, Math.round(contentWidth));
})();
const layoutViewportWidth = pagedPdfContentWidth || viewportWidth;

// 计算动态左右留白：≥900px 时为 64px，≤375px 时为 16px，中间线性插值。推荐 375px 作为标准移动端最小宽度基准。
const minResponsiveWidth = 375;
const paddingScale = Math.max(0, Math.min(1, (layoutViewportWidth - minResponsiveWidth) / (900 - minResponsiveWidth)));
const bodyPadX = (format === 'pdf' && pdfMode === 'paged')
  ? 0
  : Math.round(16 + paddingScale * (64 - 16));

// 默认关闭超采样，避免普通 PNG/AVIF/JXL 输出额外依赖 ImageMagick；需要高清中间产物时显式传 --supersample > 1。
const pngSupersample = readPositiveIntegerArg('supersample', 1);

// -------- asset mode (cdn vs inline) --------
// HTML 默认走 CDN（体积小，依赖网络）；--standalone 切到内联模式（零依赖，体积大）。
// 位图/PDF 必须走内联：Puppeteer 等外部资源会引入不稳定性（弱网超时、字体异步），
// 且渲染产物是单机一次性使用，CDN 没意义。
const assetMode = (format !== 'html' || args.standalone) ? 'inline' : 'cdn';

// CDN 版本号与本地包锁定一致：从 node_modules/<pkg>/package.json 读取。
// 这样升级本地包时 CDN 自动跟进，避免版本漂移造成的渲染差异。
function readPkgVersion(pkgName) {
  try {
    return require(pkgName + '/package.json').version;
  } catch {
    return null;
  }
}
const KATEX_VERSION   = readPkgVersion('katex')        || '0.16.45';
const MERMAID_VERSION = readPkgVersion('mermaid')      || '10.9.0';
const TWEMOJI_SVG_VER = readPkgVersion('@twemoji/svg') || '15.0.0';
const CDN = {
  katex:   `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css`,
  mermaid: `https://cdn.jsdelivr.net/npm/mermaid@${MERMAID_VERSION}/dist/mermaid.min.js`,
  // twemoji.parse 的 base 需要以 / 结尾，callback 返回 `<hex>` 会被拼成 `<base><hex>.svg`
  twemojiBase: `https://cdn.jsdelivr.net/npm/@twemoji/svg@${TWEMOJI_SVG_VER}/`,
};

// 系统字体 fallback 链（西文优先 + 中文回落 + 等宽 + emoji）
// 用户可通过 --font-cn / --font-en / --font-mono 覆盖。提升到模块顶层让 buildHtml 与
// prerenderMermaid 都能引用，保证 shell html 与最终 html 使用同一套字体栈——否则 mermaid
// 预渲染时用 fallback sans-serif 量文字宽高，会和最终 CJK 字体（如 PingFang）实际行高
// 不匹配，多行 foreignObject 的第二行就会被"下方裁切"。
const SYS_FONT_EN   = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif';
const SYS_FONT_CN   = '"PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", "Heiti SC", sans-serif';
const SYS_FONT_MONO = '"SF Mono", Menlo, Consolas, "Liberation Mono", "Courier New", monospace';

// -------- load markdown --------
let md_src;
if (inputPath === '-') {
  md_src = fs.readFileSync(0, 'utf8');
} else {
  md_src = fs.readFileSync(inputPath, 'utf8');
}
const inputBaseDir = inputPath === '-' ? process.cwd() : path.dirname(path.resolve(inputPath));

// -------- strip YAML frontmatter --------
// markdown-it 默认不识别 YAML frontmatter（开头的 ---…--- 块），会把 `---` 当作 <hr>、
// 中间的 key: value 行当作段落渲染出来，导致产物顶部出现一大坨 `title: "…" author: "…"`
// 原文，既难看又挤占正文首屏。这里在进入 markdown-it 之前手动剥掉 frontmatter。
//
// 仅识别最常见的形态：文件首行就是 `---`，之后若干行 YAML，再以单独一行 `---` 收尾；
// 不做完整 YAML 解析，只用正则抓取顶层 `title:` 用作 docTitle 兜底。其它字段（author /
// date / tags 等）一律丢弃，不渲染、不展示。
function stripFrontmatter(src) {
  // 开头必须是 --- 紧接换行；允许 BOM 前缀。
  const m = src.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { body: src, meta: {} };
  const meta = {};
  // 极简解析：只抓顶层 `key: value` 行，value 为引号包裹或裸字符串都去掉首尾引号。
  const lines = m[1].split(/\r?\n/);
  for (const line of lines) {
    const mm = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!mm) continue;
    let v = mm[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    meta[mm[1]] = v;
  }
  return { body: src.slice(m[0].length), meta };
}
const { body: _mdBody, meta: _fmMeta } = stripFrontmatter(md_src);
md_src = _mdBody;
// 仅当用户未显式 --title 时，才用 frontmatter.title 覆盖文件名兜底。
if (!args.title && _fmMeta.title) docTitle = _fmMeta.title;

// -------- markdown-it pipeline --------
const MarkdownIt = require('markdown-it');
const { full: emojiPlugin } = require('markdown-it-emoji');
const taskLists = require('markdown-it-task-lists');
const footnote = require('markdown-it-footnote');
const anchor = require('markdown-it-anchor');
// @vscode/markdown-it-katex 是社区主流的 katex 插件（KaTeX 0.16+），
// 替代已多年未更新的 markdown-it-katex@2.x（KaTeX 0.6）；
// 包可能以 ES module 默认导出发布，这里兼容两种导出形式。
const katexPluginModule = require('@vscode/markdown-it-katex');
const katex = katexPluginModule.default || katexPluginModule;
const mark = require('markdown-it-mark');
const sub = require('markdown-it-sub');
const sup = require('markdown-it-sup');
const deflist = require('markdown-it-deflist');
const container = require('markdown-it-container');
// markdown-it-attrs：支持 Pandoc/PHP Markdown Extra 风格的 `{#id .class}` 后缀语法，
// 主要目的是让标题能通过 `### 标题 {#custom-id}` 显式指定锚点 id（便于目录链接稳定、
// 跨语言 slug 对齐）。限制 allowedAttributes 为 ['id']：
//   1) 避免用户在 markdown 里注入任意 class/onclick 之类带来 XSS 或样式破坏；
//   2) 也阻止了普通段落里字面量 `{xxx}` 被误当作属性解析。
const attrs = require('markdown-it-attrs');
const twemoji = require('twemoji');

const mdit = new MarkdownIt({
  html: !safeMode,
  linkify: true,
  typographer: false,
  breaks: false,
  // 让 mermaid 代码块有特殊渲染
  highlight: function (str, lang) {
    if (lang === 'mermaid') {
      return `<pre class="mermaid">${escapeHtml(str)}</pre>`;
    }
    // 其他语言留给 shiki 后处理：先用占位符
    return `<pre><code class="language-${escapeHtml(lang || 'plaintext')}">${escapeHtml(str)}</code></pre>`;
  },
});

const defaultValidateLink = mdit.validateLink.bind(mdit);
function isSafeMarkdownUrl(url) {
  const normalized = String(url || '').trim().replace(/[\u0000-\u001F\u007F\s]+/g, '').toLowerCase();
  if (!normalized) return true;
  if (normalized.startsWith('#') || normalized.startsWith('/') || normalized.startsWith('./') || normalized.startsWith('../')) return true;
  if (/^(https?:|mailto:|tel:)/.test(normalized)) return true;
  // safe 模式只允许明确的常用协议与相对路径；拒绝 javascript/vbscript/data/file 等高风险协议。
  return !/^[a-z][a-z0-9+.-]*:/.test(normalized);
}

mdit.validateLink = function validateLink(url) {
  if (!defaultValidateLink(url)) return false;
  return !safeMode || isSafeMarkdownUrl(url);
};

// GitHub 兼容的 slugify，用于 markdown-it-anchor：
//   1. 去除 HTML 标签（heading 内可能被 twemoji 替换过 <img>，但此处 renderInline 传入的是
//      heading 的 raw text，通常不会有标签；兜底处理以防万一）。
//   2. 转小写。
//   3. 使用 Unicode 属性类 \p{L}/\p{N} 作为白名单，只保留：
//        - 字母（含中/日/韩等 Unicode letter）
//        - 数字
//        - 空白（后续会转 `-`）
//        - 中划线与下划线
//      其余一律删除，这样 ASCII 标点（`.` `:` `,` ...）、中文标点（`：` `，` `。` ...）
//      以及 emoji（如 :triangular_ruler: 被展开后的 `📐`）都会被一并剥离。
//   4. 合并所有空白为单个 `-`，合并连续 `-`，去首尾 `-`。
// 这样可以让 `## 1. 背景与目标` → `1-背景与目标`，
//          `## 3. 调度算法与数学建模 :triangular_ruler:` → `3-调度算法与数学建模`，
//          `## 4. 实现细节：多语言代码实战 :keyboard:` → `4-实现细节多语言代码实战`，
// 恰好与常见手写目录 `#3-调度算法与数学建模`、`#4-实现细节多语言代码实战` 对齐。
function githubSlugify(text) {
  return String(text)
    .replace(/<[^>]+>/g, '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s\-_]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

mdit.use(emojiPlugin)
    .use(taskLists, { enabled: true, label: true })
    .use(footnote)
    // attrs 必须在 anchor 之前：attrs 把 `{#id}` 解析并写到 heading token 的 attrs 里，
    // 随后 anchor 发现 token 已带 id 就不再用 slugify 覆盖，最终产出期望的稳定锚点。
    .use(attrs, { allowedAttributes: ['id'] })
    // anchor 的默认 slugify 对中文会整体 encodeURIComponent，且会保留 `.` `:` 等标点，
    // 这与用户在 markdown 里手写目录链接时惯用的 GitHub 风格（kebab-case、去标点、中文原文）
    // 对不上，导致 `[xxx](#1-背景与目标)` 跳不到 `## 1. 背景与目标`。
    // 这里改用一个 GitHub 兼容的 slugify：小写化 → 去首尾空白 → 去标点（保留字母/数字/
    // CJK/连字符）→ 空白转 `-` → 合并多连字符 → 去首尾 `-`。
    // 这样 `## 1. 背景与目标` 会得到 id="1-背景与目标"，与目录链接精确对齐。
    .use(anchor, {
      permalink: false,
      slugify: githubSlugify,
    })
    .use(katex)
    .use(mark)
    .use(sub)
    .use(sup)
    .use(deflist);

// :::tip / :::warning / :::danger / :::info / :::note 容器
['tip', 'warning', 'danger', 'info', 'note'].forEach(name => {
  mdit.use(container, name, {
    render(tokens, idx) {
      const token = tokens[idx];
      const info = token.info.trim().slice(name.length).trim();
      if (token.nesting === 1) {
        return `<div class="${name}">` + (info ? `<p class="custom-block-title"><strong>${mdit.utils.escapeHtml(info)}</strong></p>\n` : '');
      }
      return '</div>\n';
    }
  });
});

// :::details [summary] / ::: 折叠块容器
// 渲染为原生 <details><summary>...</summary>...</details>，safe 模式下也能安全启用——
// 这两个标签由 markdown-it 的 block renderer 直接输出，不走原始 HTML 通道，
// 因此不受 `html: !safeMode` 的禁用影响，外部不可信输入也无法借此注入任意标签。
mdit.use(container, 'details', {
  render(tokens, idx) {
    const token = tokens[idx];
    // `:::details 我是标题` → info = "我是标题"；缺省标题时用 "详情"。
    const info = token.info.trim().slice('details'.length).trim();
    if (token.nesting === 1) {
      const summary = info ? mdit.utils.escapeHtml(info) : '详情';
      return `<details class="md-details"><summary>${summary}</summary>\n`;
    }
    return '</details>\n';
  },
});

// -------- GitHub Alert 语法 --------
// GitHub 原生扩展：`> [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION]` 开头的 blockquote
// 会渲染为带标题与配色的提示块。这里用一个 core ruler 在 block 解析后扫 token 流，
// 把首行匹配的 blockquote 改写成对应的 :::tip/:::warning/:::danger/:::info/:::note 容器，
// 复用现有 5 套容器样式，视觉与 container 语法保持一致。
// 映射选择：
//   NOTE      → note    （中性灰）
//   TIP       → tip     （蓝/绿，按主题）
//   IMPORTANT → info    （蓝色，强调但非警示）
//   WARNING   → warning （黄色）
//   CAUTION   → danger  （红色）
const GH_ALERT_MAP = {
  NOTE: { cls: 'note', title: 'Note' },
  TIP: { cls: 'tip', title: 'Tip' },
  IMPORTANT: { cls: 'info', title: 'Important' },
  WARNING: { cls: 'warning', title: 'Warning' },
  CAUTION: { cls: 'danger', title: 'Caution' },
};
const GH_ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\r?\n?/;
mdit.core.ruler.after('block', 'github_alert', function (state) {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== 'blockquote_open') continue;
    // 找到对应 blockquote_close；blockquote 内首个非空段落用于判定。
    let depth = 0;
    let closeIdx = -1;
    for (let j = i; j < tokens.length; j++) {
      if (tokens[j].type === 'blockquote_open') depth++;
      else if (tokens[j].type === 'blockquote_close') {
        depth--;
        if (depth === 0) { closeIdx = j; break; }
      }
    }
    if (closeIdx < 0) continue;
    // 首个 inline token 的 content 是 blockquote 的首段文本。
    let firstInlineIdx = -1;
    for (let j = i + 1; j < closeIdx; j++) {
      if (tokens[j].type === 'inline') { firstInlineIdx = j; break; }
    }
    if (firstInlineIdx < 0) continue;
    const content = tokens[firstInlineIdx].content || '';
    const m = content.match(GH_ALERT_RE);
    if (!m) continue;
    const info = GH_ALERT_MAP[m[1]];

    // 去掉首段的 `[!XXX]\n` 前缀，剩余部分保留为正文。
    const rest = content.slice(m[0].length);
    if (rest.trim().length === 0) {
      // 标记整段（段落 open/inline/close）待删除
      tokens[firstInlineIdx - 1]._ghAlertDrop = true;
      tokens[firstInlineIdx]._ghAlertDrop = true;
      tokens[firstInlineIdx + 1]._ghAlertDrop = true;
    } else {
      // 就地改写，保留该段作为正文首段
      tokens[firstInlineIdx].content = rest;
      if (tokens[firstInlineIdx].children && tokens[firstInlineIdx].children.length) {
        // 重新解析子 token 以去掉 [!XXX] 文本；简单方案：清空 children 交给渲染器用 content 兜底。
        // markdown-it 的 inline renderer 会优先走 children；这里用 state.md 重新 tokenize。
        const env = {};
        tokens[firstInlineIdx].children = state.md.parseInline(rest, env)[0].children;
      }
    }

    // 把 blockquote_open / blockquote_close 改写成自定义 html_block，保留内部 token。
    const openHtml = `<div class="${info.cls} github-alert github-alert-${m[1].toLowerCase()}"><p class="custom-block-title"><strong>${info.title}</strong></p>\n`;
    tokens[i] = Object.assign(new state.Token('html_block', '', 0), { content: openHtml, block: true });
    tokens[closeIdx] = Object.assign(new state.Token('html_block', '', 0), { content: '</div>\n', block: true });
  }
  // 清理被标记删除的 token（空正文的场景）
  state.tokens = tokens.filter(t => !t._ghAlertDrop);
});

// -------- TOC 目录 --------
// 支持两种触发方式：
//   1) 正文任意位置写 `[[toc]]`（独占一段）。
//   2) frontmatter `toc: true`，自动在正文开头（首个 h1 后、或最前）插入目录。
// 只收 h2/h3（h1 通常是文档标题），按 markdown-it-anchor 生成的 id 建锚点。
// 用 core ruler 扫 heading token 收集目录、替换 `[[toc]]` 段落为占位 html_block。
const TOC_PLACEHOLDER_RE = /^\[\[toc\]\]\s*$/i;
const tocAutoInsert = String(_fmMeta.toc || '').toLowerCase() === 'true';
mdit.core.ruler.push('md_toc', function (state) {
  const tokens = state.tokens;

  // Pass 1：收集 h2/h3。id 由 anchor 插件后置 ruler 设置，所以等 pass 2 用闭包再读。
  // 这里只记录位置与 level，等 anchor ruler 运行后（core ruler 按注册顺序执行）再取 id。
  // anchor 是 plugin 内部用 core ruler 注册的，我们在 push 时已经排在它之后。
  const toc = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'heading_open') continue;
    if (t.tag !== 'h2' && t.tag !== 'h3') continue;
    const inline = tokens[i + 1];
    if (!inline || inline.type !== 'inline') continue;
    const id = t.attrGet('id') || '';
    if (!id) continue;
    // 标题文本：去掉内联 HTML/表情图等，留纯文本
    const text = (inline.children || [])
      .filter(c => c.type === 'text' || c.type === 'code_inline' || c.type === 'emoji')
      .map(c => c.content || '')
      .join('')
      .trim();
    if (!text) continue;
    toc.push({ level: t.tag === 'h2' ? 2 : 3, id, text });
  }

  if (toc.length === 0) return;

  // 渲染目录 HTML：嵌套 ul。h2 是顶层，h3 嵌在最近的 h2 下。
  function renderToc(entries) {
    let html = '<nav class="md-toc"><p class="md-toc-title">目录</p><ul>';
    let inner = false;
    for (const e of entries) {
      const label = mdit.utils.escapeHtml(e.text);
      // href 保持原文（与 GitHub 一致）：id 属性存的就是中文原字符串，
      // 浏览器导航时会自行 percent-encode；直接 encodeURI 反而会和用户在 md 里手写
      // `[xxx](#中文)` 的写法不一致。
      const href = `#${e.id.replace(/"/g, '%22')}`;
      if (e.level === 2) {
        if (inner) { html += '</ul></li>'; inner = false; }
        html += `<li><a href="${href}">${label}</a>`;
      } else {
        if (!inner) { html += '<ul>'; inner = true; }
        html += `<li><a href="${href}">${label}</a></li>`;
      }
    }
    if (inner) html += '</ul></li>';
    html += '</ul></nav>\n';
    return html;
  }
  const tocHtml = renderToc(toc);

  // Pass 2：查找 `[[toc]]` 占位段落，替换为 html_block。
  let replaced = false;
  for (let i = 0; i + 2 < tokens.length; i++) {
    if (tokens[i].type !== 'paragraph_open') continue;
    const inline = tokens[i + 1];
    const close = tokens[i + 2];
    if (!inline || inline.type !== 'inline' || !close || close.type !== 'paragraph_close') continue;
    if (!TOC_PLACEHOLDER_RE.test((inline.content || '').trim())) continue;
    const block = new state.Token('html_block', '', 0);
    block.content = tocHtml;
    block.block = true;
    tokens.splice(i, 3, block);
    replaced = true;
  }

  // frontmatter toc: true 且没显式 `[[toc]]`，在第一个 h1 之后插入；若无 h1，则放最前。
  if (!replaced && tocAutoInsert) {
    let insertAt = 0;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type === 'heading_close' && tokens[i].tag === 'h1') {
        insertAt = i + 1;
        break;
      }
    }
    const block = new state.Token('html_block', '', 0);
    block.content = tocHtml;
    block.block = true;
    tokens.splice(insertAt, 0, block);
  }
});

// 外链统一加 rel 防 tabnabbing；safe 模式下再加 target，避免导出的 HTML 被外链接管当前页面。
// 内部锚点和相对链接保持原样，便于目录、脚注与本地资源继续工作。
const defaultLinkOpen = mdit.renderer.rules.link_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
mdit.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const href = token.attrGet('href') || '';
  if (/^(https?:)?\/\//i.test(href)) {
    token.attrSet('rel', 'noopener noreferrer');
    if (safeMode) token.attrSet('target', '_blank');
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

// 覆盖 HTML 文本内容与属性值两种上下文：
// - 除了 &/</>，还必须转义引号，避免用户输入出现在 class="..." / title="..." 等
//   属性位置时发生 HTML 注入或属性截断；
// - 同时转义单引号，兼容属性用单引号包裹的场景。
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 还原 markdown-it/ KaTeX / escapeHtml 产出的基础 HTML entities，
// 让下游拿到真实字符（例如 <img src> 查询串中的 &amp; → &、代码块里的 &lt; → <）。
//
// 替换顺序：`&amp;` 必须放在最前。否则若原文字面量是 `&amp;lt;`（表示想保留 `&lt;`），
// 会被先解成 `&lt;` 再二次解成 `<`，产生双重解码。当前所有调用方喂进来的都是
// markdown-it 正常 escape 产物，不会出现这种对抗性输入，但严格顺序让函数面对未来
// 场景更鲁棒。
function unescapeHtmlEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

const CODE_WRAP_MARKER = '⏎';

// 自动估算代码硬换行列数（Node 端粗估，仅作为 HTML 兜底；
// 位图/PDF 流程会在 Puppeteer 里实测后用真实列数重渲染）。
function computeAutoWrapColumn() {
  const rootPx = 16;
  const codeFontPx = rootPx * 0.9 * 0.82;
  const charPx = codeFontPx * 0.58;
  const preInnerPad = 16 * 2;
  const usablePx = Math.max(120, layoutViewportWidth - bodyPadX * 2 - preInnerPad);
  const col = Math.floor(usablePx / charPx) - 2;
  return Math.max(40, col);
}

let runtimeWrapColumn = null;                 // Puppeteer 实测后写入

function resolveWrapColumn() {
  const raw = args['wrap-code-column'];
  if (raw === '0' || raw === 0) return 0;
  if (runtimeWrapColumn && runtimeWrapColumn > 0) return runtimeWrapColumn;
  if (raw === undefined || raw === 'auto') return computeAutoWrapColumn();
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : computeAutoWrapColumn();
}

function shouldHardWrapCode() {
  const column = resolveWrapColumn();
  return (BITMAP_FORMATS.has(format) || format === 'pdf') && Number.isFinite(column) && column > 0;
}

function findWrapIndex(line, column) {
  if (line.length <= column) return line.length;
  // 仅在最后 12 字符内找断点，避免在更早的位置（如 `.` `:`）就提前换行而浪费右侧空间。
  // 如果该窗口内找不到断点，就硬切在 column 处。
  const lookback = Math.min(12, Math.floor(column * 0.2));
  const min = Math.max(1, column - lookback);
  // 优先级：空格 > 标点（,;) ] } > .:|>）
  const primary = new Set([' ', '\t']);
  const secondary = new Set([',', ';', ')', ']', '}']);
  const tertiary = new Set(['.', ':', '|', '>']);
  const tryFind = (set) => {
    for (let i = Math.min(column, line.length - 1); i >= min; i--) {
      if (set.has(line[i])) return i + 1;
    }
    return -1;
  };
  for (const set of [primary, secondary, tertiary]) {
    const idx = tryFind(set);
    if (idx > 0) return idx;
  }
  return column;
}

function hardWrapCode(code) {
  const column = resolveWrapColumn();
  if (!shouldHardWrapCode()) return code;

  return code.split('\n').map(line => {
    if (line.length <= column) return line;
    const indent = (line.match(/^\s*/) || [''])[0];
    const continuationIndent = indent + '  ';
    const chunks = [];
    let rest = line;

    while (rest.length > column) {
      const idx = findWrapIndex(rest, column);
      const head = rest.slice(0, idx).replace(/\s+$/, '');
      chunks.push(`${head} ${CODE_WRAP_MARKER}`);
      rest = continuationIndent + rest.slice(idx).replace(/^\s+/, '');
    }
    chunks.push(rest);
    return chunks.join('\n');
  }).join('\n');
}

function decorateCodeWrapMarkers(html) {
  return html.replaceAll(CODE_WRAP_MARKER, '<span class="soft-wrap-marker">↩</span>');
}

// -------- render markdown --------
// Twemoji 资产本地化：依赖 @twemoji/svg 包（约 3700 个 SVG），直接把 SVG 源码
// 内联进 HTML。相比以前输出 <img src="CDN…"> 的方式，好处：
//   1) 完全零网络依赖，离线 / 弱网 / 内网环境渲染结果一致；
//   2) Puppeteer 截图不需要等待外部图片返回，位图/PDF 稳定性更高；
//   3) HTML 高度自包含，跨机器传递无问题。
// 唯一代价是同一 emoji 每次出现都会内联一份 SVG（单个 ~0.5KB），对大量
// 重复 emoji 的文档会轻微增加体积，在可接受范围内。
const TWEMOJI_SVG_DIR = (() => {
  try {
    // @twemoji/svg 的包入口指向 package.json，资产文件与 package.json 同级
    const pkgPath = require.resolve('@twemoji/svg/package.json');
    return path.dirname(pkgPath);
  } catch (e) {
    return null;
  }
})();

// 同一 emoji 在文档中往往重复出现（如 ✅ ❌⭐），缓存防止重复读盘。
const twemojiSvgCache = new Map();

function loadTwemojiSvg(icon) {
  if (!TWEMOJI_SVG_DIR) return null;
  if (twemojiSvgCache.has(icon)) return twemojiSvgCache.get(icon);
  const file = path.join(TWEMOJI_SVG_DIR, icon + '.svg');
  let svg = null;
  try {
    svg = fs.readFileSync(file, 'utf8').trim();
    // 给 <svg> 根节点加 class + 显式尺寸 + 行内对齐样式。
    // 说明：
    //   1) Twemoji 官方 SVG 只有 viewBox="0 0 36 36"，不带 width/height。
    //      <img> 元素可以用 intrinsic size 兜底（自动按 36x36），但内联 <svg>
    //      作为替换元素在没有 width/height 也没有 CSS 约束时，Chromium 会按
    //      CSS 默认替换元素尺寸（~300x150）渲染，导致 emoji 被撑到巨大。
    //   2) 这里直接把 width/height 写成 1em，使 emoji 跟随周围字号缩放，
    //      与"文字行内小图标"的视觉预期一致。
    //   3) vertical-align: -0.125em 让 emoji 基线与西文字形对齐，避免看起来浮在行顶。
    //   4) 这些属性写在 SVG 根节点 attribute 上（而非依赖主题 CSS），
    //      确保任何 theme 都有正确尺寸，不需要各主题单独加 .emoji 规则。
    svg = svg.replace(
      /^<svg\b/,
      '<svg class="emoji" aria-hidden="true" width="1em" height="1em" style="vertical-align:-0.125em;display:inline-block"'
    );
  } catch {
    svg = null;
  }
  twemojiSvgCache.set(icon, svg);
  return svg;
}

// Twemoji 处理：两种模式
//   inline（--standalone / 位图 / PDF）：本地 SVG 内联成 <svg>...</svg>
//   cdn（HTML 默认）：输出 <img src="jsdelivr/.../<hex>.svg">，每个 emoji ~60 字节，比内联 SVG 省 ~10x
// 实现上两种模式都复用 twemoji.parse 的 emoji 检测（含 ZWJ / skin-tone / variation selector 等复杂序列）。
// inline 模式通过占位符 URL + 二次正则替换绕过 twemoji 只生成 <img> 的限制；
// cdn 模式直接让 twemoji 产出 <img src>。
//
// ⚠️ mermaid 代码块保护：twemoji.parse 会扫描整段 HTML 的 text node，
// 如果 <pre class="mermaid"> 里的源码（例如 journey 图的 `: 3: 💻`）带 emoji，
// 会被替换成 <img>/<svg> 标签，导致 mermaid 解析器拿到 `vertical-align:...` 这类
// 乱码字符而 Parse error。这里在 twemoji 流程前后用 token 暂存 mermaid 代码块，
// 让 emoji 在图表里保持原样，由 mermaid 自己在 SVG 里渲染（或保留 Unicode 字符）。
function guessImageMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  };
  return map[ext] || null;
}

function shouldInlineImageMime(mime) {
  if (!mime) return false;
  return ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'].includes(mime);
}

function resolveLocalImagePath(src) {
  if (!src || src.startsWith('#')) return null;
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(src)) return null;
  if (/^(?:data|mailto|tel|javascript|vbscript|file):/i.test(src)) return null;
  const rawPath = src.split('#')[0].split('?')[0];
  let clean = rawPath;
  try {
    clean = decodeURIComponent(rawPath);
  } catch {
    // 非法百分号编码不应中断整篇渲染；保留原始路径继续尝试读取。
    clean = rawPath;
  }
  if (!clean) return null;
  return path.isAbsolute(clean) ? clean : path.resolve(inputBaseDir, clean);
}

function resolveRemoteImageUrl(src) {
  const raw = unescapeHtmlEntities(src).trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    return new URL(raw).toString();
  } catch {
    return null;
  }
}

async function fetchRemoteImageDataUrl(url) {
  if (typeof fetch !== 'function') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'md-render/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!shouldInlineImageMime(contentType)) throw new Error(`unsupported image type: ${contentType || 'unknown'}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    return `data:${contentType};base64,${bytes.toString('base64')}`;
  } catch (e) {
    console.warn(`[md-render] WARN: remote image inline failed: ${url} (${e.message})`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// inline 模式（standalone HTML / 位图 / PDF）把图片转成 data URL：
//   1) standalone HTML 可脱离原图片文件或远程图片服务分发；
//   2) 位图/PDF 截图不受相对路径、工作目录、文件移动、CSP 或弱网影响；
//   3) CDN 模式保持原链接，避免普通 HTML 体积意外膨胀；
//   4) --safe 不读取本地文件、也不主动请求远程图片，避免外部 Markdown 泄露本机文件或触发 SSRF。
async function inlineImages(html) {
  const canInlineImages = assetMode === 'inline' && !safeMode;
  if (!canInlineImages) return html;

  const imageRe = /<img\b([^>]*?)\bsrc="([^"]+)"([^>]*)>/gi;
  const replacements = [];
  let match;
  while ((match = imageRe.exec(html)) !== null) {
    const [full, before, src, after] = match;
    if (/^data:/i.test(src)) continue;

    const localPath = resolveLocalImagePath(src);
    if (localPath) {
      const mime = guessImageMime(localPath);
      if (!shouldInlineImageMime(mime)) continue;
      try {
        const data = fs.readFileSync(localPath).toString('base64');
        replacements.push({ start: match.index, end: match.index + full.length, html: `<img${before}src="data:${mime};base64,${data}"${after}>` });
      } catch {}
      continue;
    }

    const remoteUrl = resolveRemoteImageUrl(src);
    if (!remoteUrl) continue;
    const dataUrl = await fetchRemoteImageDataUrl(remoteUrl);
    if (dataUrl) {
      replacements.push({ start: match.index, end: match.index + full.length, html: `<img${before}src="${dataUrl}"${after}>` });
    }
  }

  let result = html;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    result = result.slice(0, r.start) + r.html + result.slice(r.end);
  }
  return result;
}

function inlineTwemoji(html) {
  // 把 <pre class="mermaid">...</pre> 暂存为不含 emoji 的占位符，避免被 twemoji.parse 动到
  const stash = [];
  const MERMAID_TOKEN_PREFIX = '\u0000MERMAID_BLOCK_';
  const MERMAID_TOKEN_SUFFIX = '\u0000';
  const protectedHtml = html.replace(
    /<pre class="mermaid">[\s\S]*?<\/pre>/g,
    (block) => {
      const idx = stash.push(block) - 1;
      return `${MERMAID_TOKEN_PREFIX}${idx}${MERMAID_TOKEN_SUFFIX}`;
    }
  );
  const restore = (s) =>
    s.replace(
      /\u0000MERMAID_BLOCK_(\d+)\u0000/g,
      (_, i) => stash[Number(i)]
    );

  if (assetMode === 'cdn') {
    // CDN 模式：直接用 twemoji.parse 产出 <img src="jsdelivr/.../<hex>.svg">
    // 给 <img> 加内联 style 对齐尺寸与基线（与 inline 模式的 <svg> 属性等价，
    // 避免主题 CSS 未约束 .emoji 时 <img> 按原始 36x36 显示过大）。
    //
    // 注意：@twemoji/svg 包把 SVG 直接放在根目录（例如 1f680.svg），没有 svg/ 子目录。
    // twemoji.parse 默认会按 `base + folder + '/' + hex + ext` 拼接，folder 默认是 'svg'，
    // 会生成 .../svg/1f680.svg 这种 404 路径。这里用 callback 完全接管 src 绕过该拼接。
    const parsed = twemoji.parse(protectedHtml, {
      className: 'emoji',
      callback: (icon) => `${CDN.twemojiBase}${icon}.svg`,
      attributes: () => ({
        style: 'width:1em;height:1em;vertical-align:-0.125em;display:inline-block',
      }),
    });
    return restore(parsed);
  }

  // inline 模式：callback 返回占位符 URL，二次正则把 <img> 替换为内联 <svg>。
  // 本地包缺失 → 直接返回原 html（twemoji 不 parse，保留 emoji 字符让系统字体渲染）
  if (!TWEMOJI_SVG_DIR) return html;
  const PLACEHOLDER_PREFIX = 'twemoji-inline://';
  const wrapped = twemoji.parse(protectedHtml, {
    className: 'emoji',
    folder: 'svg',
    ext: '.svg',
    callback: (icon) => {
      // 预加载：本地没有 SVG 时返回 false，twemoji 会保留原 emoji 字符
      if (!loadTwemojiSvg(icon)) return false;
      return `${PLACEHOLDER_PREFIX}${icon}`;
    },
  });
  // twemoji 会输出类似：<img class="emoji" draggable="false" alt="😀" src="twemoji-inline://1f600"/>
  // 用正则把整个 <img> 替换为内联 <svg>。alt 文本被丢弃（SVG 本身就是该 emoji 的视觉内容，
  // 屏幕阅读器遇到 role=img / aria-hidden 的 SVG 会跳过，对可访问性影响可接受）。
  const inlined = wrapped.replace(
    /<img\s+[^>]*class="emoji"[^>]*src="twemoji-inline:\/\/([0-9a-f-]+)"[^>]*\/?>/gi,
    (full, icon) => {
      const svg = loadTwemojiSvg(icon);
      return svg || full; // 理论上不会走到 fallback；兜底
    }
  );
  return restore(inlined);
}
// 统一的 markdown -> html 管线：markdown-it → 图片内联 → twemoji(内联 SVG) → shiki。
// 位图/PDF 流程需要在探测到真实列宽后重跑一遍，抽成函数避免重复代码漂移。
async function renderMarkdown(shikiThemeId) {
  const html = inlineTwemoji(await inlineImages(mdit.render(md_src)));
  return applyShiki(html, shikiThemeId);
}

// -------- shiki 高亮（异步）--------
async function applyShiki(html, shikiThemeId) {
  const { codeToHtml } = require('shiki');
  // 提取 <pre><code class="language-xxx">...</code></pre> 占位符
  const codeRe = /<pre><code class="language-([^"]+)">([\s\S]*?)<\/code><\/pre>/g;
  // 记录每个匹配的绝对位置（index / end），后面按位置从后往前切片替换，
  // 避免出现两个代码块内容完全一致时 String.replace 只命中第一个的竞态。
  const replacements = [];
  let m;
  while ((m = codeRe.exec(html)) !== null) {
    const [whole, lang, escaped] = m;
    if (lang === 'mermaid') continue; // 已经被前面处理
    const code = unescapeHtmlEntities(escaped);
    replacements.push({
      start: m.index,
      end: m.index + whole.length,
      lang,
      code: hardWrapCode(code),
      replacement: null,
    });
  }
  // 先并发算出每个块的高亮 HTML，再按位置倒序一次性拼接，
  // 这样不受同内容代码块的影响，也避免 O(N²) 的 replace 扫描。
  //
  // 并发策略：shiki 的 codeToHtml 使用进程内共享的 singleton highlighter（内部自带
  // 语法/主题 load 缓存），并发调用是线程安全的，且首个未缓存 lang 的加载耗时可被其他
  // 已缓存 lang 的渲染重叠覆盖。对多代码块文档（AI 输出常见情形：Python + Bash + JSON 混排），
  // 总耗时由 O(Σ t_i) 收敛到 O(max t_i)，单文档通常省 30-60%；对位图/PDF 二次高亮的收益叠加。
  await Promise.all(replacements.map(async (r) => {
    try {
      const out = await codeToHtml(r.code, {
        lang: r.lang,
        theme: shikiThemeId,
      });
      r.replacement = decorateCodeWrapMarkers(out);
    } catch (e) {
      // 不支持的语言：保持原样
      r.replacement = null;
    }
  }));
  for (let i = replacements.length - 1; i >= 0; i--) {
    const r = replacements[i];
    if (r.replacement == null) continue;
    html = html.slice(0, r.start) + r.replacement + html.slice(r.end);
  }
  return html;
}

// KaTeX CSS 内联处理：
// 原实现将 url(fonts/xxx.woff2) 改写为 file:// 绝对路径，依赖本机文件系统，导致
// HTML 离开当前机器后数学字体丢失。这里改为把 woff2 字体直接 base64 内联到
// @font-face src中，并删除后续的 woff/ttf fallback（现代浏览器均支持 woff2，
// 且 Chromium 不会再请求）。woff2 文件全集约 300KB，base64 后约 400KB，换取
// HTML 真正的自包含 / 跨机器可搬运。
function inlineKatexCss(cssPath) {
  const fontsDir = path.join(path.dirname(cssPath), 'fonts');
  const raw = fs.readFileSync(cssPath, 'utf8');
  const fontCache = new Map();
  // 匹配每个 @font-face 规则整体，只处理 src 声明中的第一个 woff2，丢弃其它 fallback。
  // 格式示例：src:url(fonts/KaTeX_AMS-Regular.woff2) format("woff2"),url(fonts/...woff) format("woff"),url(fonts/...ttf) format("truetype")
  return raw.replace(/@font-face\{([^}]*)\}/g, (whole, body) => {
    const srcMatch = body.match(/src:([^;]+);?/);
    if (!srcMatch) return whole;
    const srcValue = srcMatch[1];
    const woff2Match = srcValue.match(/url\(fonts\/([^)]+\.woff2)\)/);
    if (!woff2Match) return whole;
    const fontFile = woff2Match[1];
    let dataUri = fontCache.get(fontFile);
    if (!dataUri) {
      try {
        const buf = fs.readFileSync(path.join(fontsDir, fontFile));
        dataUri = `data:font/woff2;base64,${buf.toString('base64')}`;
        fontCache.set(fontFile, dataUri);
      } catch {
        return whole; // 读不到就保持原样，避免崩
      }
    }
    const newSrc = `src:url(${dataUri}) format("woff2")`;
    const newBody = body.replace(/src:[^;]+;?/, newSrc);
    return `@font-face{${newBody}}`;
  });
}

// MathJax SVG 渲染（仅 standalone 模式）：
// 把 KaTeX 已生成的 <span class="katex"> 用户内容（里面有 <annotation encoding="application/x-tex">LaTeX原文</annotation>）
// 重新用 MathJax 渲染成纯 SVG，返回 { html, styleSheet }：
//   html:       替换后的 body（每个公式是内联 <mjx-container><svg>）
//   styleSheet: MathJax 容器的必要 CSS（~2KB，缺之会丢基线对齐与 block 居中）
// 相比内联 KaTeX CSS + 20 个 woff2 字体（~400KB），此方案将数学内容成本压到 ~15KB/5 公式的量级。
function renderKatexToMathjaxSvg(bodyHtml) {
  // 快速跳过：没有 katex 产物直接返回
  if (!/class="katex/.test(bodyHtml)) {
    return { html: bodyHtml, styleSheet: '' };
  }

  const { mathjax } = require('mathjax-full/js/mathjax.js');
  const { TeX } = require('mathjax-full/js/input/tex.js');
  const { SVG } = require('mathjax-full/js/output/svg.js');
  const { liteAdaptor } = require('mathjax-full/js/adaptors/liteAdaptor.js');
  const { RegisterHTMLHandler } = require('mathjax-full/js/handlers/html.js');
  const { AllPackages } = require('mathjax-full/js/input/tex/AllPackages.js');

  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  // fontCache:
  //   'local' → 每个公式自己的 <defs>。弱分享但集成简单（内联 <svg> 直接能用），适合本场景。
  //   'global' → 全文档 defs 集中放到一个外部 <svg>。体积更小，但需要把该 SVG 插到 body 某处，
  //              且任意全局 ID 空间有冲突风险。这里采用 local。
  const tex = new TeX({ packages: AllPackages });
  const svgOut = new SVG({ fontCache: 'local' });
  const mjDoc = mathjax.document('', { InputJax: tex, OutputJax: svgOut });

  // 工具：把 HTML 实体解回 LaTeX 源字符（<annotation> 内容被 mdit 过了 escapeHtml）
  const unescape = unescapeHtmlEntities;

  // 分两种容器处理：
  //   1) block 公式：markdown-it-katex 会把它包在 <p class="katex-block"><span class="katex-display"><span class="katex">...
  //      这里抽取整块 <p class="katex-block">，整个替换为 <mjx-container display="true">（自带居中 CSS）。
  //   2) inline 公式：直接是 <span class="katex">...<\/span>，替换为 <mjx-container>。
  // 顺序很重要：必须先处理 block 再处理 inline，否则外层 <span class="katex"> 会被
  // inline 正则先把 block 的内层 katex 替掉，导致后续 block 正则丢失母体。

  // 提取 <annotation encoding="application/x-tex">LaTeX</annotation> 内容的正则
  const ANNOTATION_RE = /<annotation[^>]*encoding="application\/x-tex"[^>]*>([\s\S]*?)<\/annotation>/;

  function renderOne(innerHtml, display) {
    const m = innerHtml.match(ANNOTATION_RE);
    if (!m) return null; // 理论上不应出现；KaTeX 始终注入 annotation
    const latex = unescape(m[1]);
    try {
      const node = mjDoc.convert(latex, { display });
      return adaptor.outerHTML(node);
    } catch (e) {
      console.warn(`[md-render] WARN: MathJax 渲染失败（${e.message}），公式：${latex.slice(0, 60)}`);
      return null;
    }
  }

  let html = bodyHtml;
  let blockCount = 0;
  let inlineCount = 0;

  // 1) block 级：<p class="katex-block">...<\/p> 整块替换
  //    markdown-it-katex 会把 block 公式包在 <p class="katex-block"> 里（其内是 <span class="katex-display"><span class="katex">）。
  html = html.replace(/<p class="katex-block">([\s\S]*?)<\/p>/g, (whole, inner) => {
    const svg = renderOne(inner, true);
    if (!svg) return whole;
    blockCount++;
    return svg;
  });

  // 2) inline 级：<span class="katex">...<\/span>（剩下的都是 inline）
  //    注意：<span class="katex"> 内部也可能嵌套其他 <span>，正则用贪婪匹配无法正确匹配对称标签。
  //    这里用手工批配法：扫 <span class="katex"> 的起点，从该位置开始计数 <span>/<\/span> 肽送到归零。
  const KATEX_OPEN = /<span class="katex">/g;
  const SPAN_TOKEN = /<\/?span\b[^>]*>/g;
  let result = '';
  let cursor = 0;
  let openMatch;
  KATEX_OPEN.lastIndex = 0;
  while ((openMatch = KATEX_OPEN.exec(html)) !== null) {
    const openStart = openMatch.index;
    // 从 <span class="katex"> 的开头处开始数 span。遇到第一个深度归零的 </span> 即是闭合位置。
    SPAN_TOKEN.lastIndex = openStart;
    let depth = 0;
    let closeEnd = -1;
    let tok;
    while ((tok = SPAN_TOKEN.exec(html)) !== null) {
      if (tok[0].startsWith('</')) {
        depth--;
        if (depth === 0) { closeEnd = tok.index + tok[0].length; break; }
      } else {
        depth++;
      }
    }
    if (closeEnd < 0) break; // 标签不平衡，放弃
    const inner = html.slice(openStart, closeEnd);
    const svg = renderOne(inner, false);
    if (svg) {
      result += html.slice(cursor, openStart) + svg;
      inlineCount++;
    } else {
      result += html.slice(cursor, closeEnd); // 渲染失败保留原 KaTeX HTML（后续会引入 KaTeX CSS 兜底）
    }
    cursor = closeEnd;
    KATEX_OPEN.lastIndex = closeEnd;
  }
  result += html.slice(cursor);

  // 拿样式表（包含 mjx-container 的内联块布局、block 的居中等）
  const styleSheet = adaptor.innerHTML(svgOut.styleSheet(mjDoc));

  if (process.env.MD_RENDER_DEBUG) {
    console.log(`[md-render] MathJax SVG: block=${blockCount}, inline=${inlineCount}`);
  }

  return { html: result, styleSheet };
}

// -------- 组装 HTML --------
// opts.injectMermaidRuntime:
//   true  → 注入 mermaid 运行时（<script>）+ mermaid.initialize，页面打开时动态渲染 <pre class="mermaid">
//           inline 模式：内联 mermaid.min.js（~3MB）
//           cdn 模式：<script src="jsdelivr/.../mermaid.min.js">（几十字节）
//   false → 完全不注入。要求调用方已经把 <pre class="mermaid"> 预渲染成静态 SVG
// opts.mathjaxStyleSheet:
//   非空字串 → body 已经被 renderKatexToMathjaxSvg 转换为 MathJax SVG，这个是 MathJax 容器的 CSS
//                 (~2KB，包含 <mjx-container> 居中 / 垂直对齐等)，此时不再注入 KaTeX CSS
function buildHtml(bodyHtml, opts = {}) {
  const injectMermaidRuntime = opts.injectMermaidRuntime !== false;
  const mathjaxStyleSheet = opts.mathjaxStyleSheet || '';
  const baseCss  = fs.readFileSync(path.join(THEME_DIR, '_base.css'), 'utf8');
  const themeCss = fs.readFileSync(path.join(THEME_DIR, theme + '.css'), 'utf8');

  // 数学样式注入策略：
  //   - 如果 body 已转为 MathJax SVG → 注入 MathJax 的 ~2KB stylesheet，不使用 KaTeX CSS
  //   - 否则按需注入 KaTeX CSS：
  //       - CDN 模式→ <link> 到 jsdelivr
  //       - inline 模式→ <style> 内联 CSS + base64 字体（~400KB）
  //     纯 Markdown（无公式）则一小片都不加。
  let mathCssTag = '';
  if (mathjaxStyleSheet) {
    mathCssTag = `<style>${mathjaxStyleSheet}</style>`;
  } else if (/class="katex/.test(bodyHtml)) {
    if (assetMode === 'cdn') {
      mathCssTag = `<link rel="stylesheet" href="${CDN.katex}" crossorigin="anonymous">`;
    } else {
      const katexCssPath = require.resolve('katex/dist/katex.min.css');
      mathCssTag = `<style>${inlineKatexCss(katexCssPath)}</style>`;
    }
  }

  // 系统字体 fallback 链从模块顶层 SYS_FONT_* 读取，预渲染与最终渲染共用同一套字体栈。
  const overrides = [
    `--md-font-en: ${args['font-en'] ? args['font-en'] + ', ' + SYS_FONT_EN : SYS_FONT_EN};`,
    `--md-font-cn: ${args['font-cn'] ? args['font-cn'] + ', ' + SYS_FONT_CN : SYS_FONT_CN};`,
    `--md-font-mono: ${args['font-mono'] ? args['font-mono'] + ', ' + SYS_FONT_MONO : SYS_FONT_MONO};`,
  ];
  const explicitBodyFontOverride = (args['font-en'] || args['font-cn'])
    ? '.markdown-body{font-family:var(--md-font-en),var(--md-font-cn),var(--md-font-emoji);}'
    : '';
  const overrideCss = `:root{${overrides.join('')}}${explicitBodyFontOverride}`;

  const isDark = theme.includes('dark');
  const mermaidTheme = isDark ? 'dark' : 'default';
  const outputClass = `format-${format}`;
  const csp = assetMode === 'cdn'
    ? "default-src 'none'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; font-src 'self' data: https://cdn.jsdelivr.net; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; connect-src 'none'; base-uri 'none'; form-action 'none'"
    : "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self' 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'";

  // Mermaid 运行时脚本注入：
  //   CDN 模式：<script src="jsdelivr/.../mermaid.min.js">，浏览器打开时动态渲染 <pre class="mermaid">
  //   inline 模式：把 ~3MB 的 mermaid.min.js 内联进 HTML（零网络）。main 流程通常会在 inline 模式下
  //               先走预渲染 → 直接塞 SVG，这里 injectMermaidRuntime=false 就不走这一支了
  //   当预渲染成功时 injectMermaidRuntime=false，完全不注入脚本
  let mermaidScript = '';
  let mermaidInitScript = '';
  if (injectMermaidRuntime) {
    if (assetMode === 'cdn') {
      mermaidScript = `<script src="${CDN.mermaid}"></script>`;
    } else {
      try {
        const mermaidPath = require.resolve('mermaid/dist/mermaid.min.js');
        mermaidScript = `<script>${fs.readFileSync(mermaidPath, 'utf8')}</script>`;
      } catch (e) {
        // 兜底：本地未安装 mermaid 时退回 CDN，保证老环境不会崩。
        console.warn(`[md-render] WARN: mermaid 本地包缺失，已回退到 CDN（HTML 不再自包含）。请在 scripts/ 下运行: npm install mermaid@${MERMAID_VERSION}`);
        mermaidScript = `<script src="${CDN.mermaid}"></script>`;
      }
    }
    mermaidInitScript = `<script>
  mermaid.initialize({
    startOnLoad: true,
    theme: '${mermaidTheme}',
    securityLevel: '${mermaidSecurityLevel}',
    gantt: {
      axisFormat: '%m/%d',
      barHeight: 18,
      barGap: 4,
      topPadding: 40,
      leftPadding: 85,
      rightPadding: 20,
    },
    themeVariables: {
      fontFamily: 'var(--md-font-en), var(--md-font-cn), sans-serif',
      fontSize: '13px'
    }
  });
</script>`;
  }
  // HTML 输出面向浏览器阅读：保留代码块/宽表横向滚动，收窄小屏留白并降低标题、表格、代码字号，
  // 避免手机端 64px 固定左右 padding 挤压正文。
  const htmlResponsiveCss = format === 'html' ? `
body.${outputClass} {
  min-width: 0;
}
body.${outputClass} .markdown-body {
  width: 100%;
  max-width: 100%;
  padding-left: clamp(16px, 5vw, 64px);
  padding-right: clamp(16px, 5vw, 64px);
  overflow-wrap: break-word;
}
body.${outputClass} .markdown-body a,
body.${outputClass} .markdown-body :not(pre) > code {
  overflow-wrap: anywhere;
}
body.${outputClass} table,
body.${outputClass} pre,
body.${outputClass} .shiki,
body.${outputClass} .katex-display,
body.${outputClass} .mermaid,
body.${outputClass} .mermaid-svg {
  max-width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
@media (max-width: 640px) {
  body.${outputClass} {
    font-size: 15px;
  }
  body.${outputClass} .markdown-body {
    padding: 20px 16px;
  }
  body.${outputClass} h1 {
    font-size: 1.65em;
  }
  body.${outputClass} h2 {
    font-size: 1.35em;
  }
  body.${outputClass} h3 {
    font-size: 1.15em;
  }
  body.${outputClass} h1,
  body.${outputClass} h2,
  body.${outputClass} h3 {
    line-height: 1.25;
  }
  body.${outputClass} ul,
  body.${outputClass} ol {
    padding-left: 1.4em;
  }
  body.${outputClass} blockquote {
    padding: .35em .85em;
  }
  body.${outputClass} pre,
  body.${outputClass} .shiki {
    padding: 12px;
    border-radius: 6px;
    font-size: .82em;
  }
  body.${outputClass} table {
    font-size: .78em;
  }
  body.${outputClass} th,
  body.${outputClass} td {
    padding: 5px 8px;
  }
  body.${outputClass} .tip,
  body.${outputClass} .warning,
  body.${outputClass} .danger,
  body.${outputClass} .info,
  body.${outputClass} .note {
    padding: 10px 12px;
  }
}
` : '';

  // 位图/PDF 下统一对 pre/code/.shiki 启用软换行，避免长代码块横向溢出或被裁剪。
  // pre 容器需要额外禁止横向滚动（overflow-x: hidden）并设置字号；
  // 其余 white-space / word-break / overflow-wrap 规则对外层与内层一致，合并到同一组选择器。
  //
  // 顶部/底部安全区：单页 PDF 页纸张 margin=0（见 renderSinglePagePdf），若仅依赖 _base.css 里
  // `.markdown-body { padding: 32px 64px }` 的 32px 顶距，首页首个元素（如 frontmatter 被解析
  // 出的 `<hr>` 或一级标题）视觉上会紧贴纸张边缘，观感上像"被截断"。这里把位图/pdf 下
  // `.markdown-body` 的上下 padding 提升到 64px，让正文四周呼吸更一致。分页 PDF 由 page
  // margin 提供安全区，因此正文 padding 归零。横向 padding 则应用动态计算的 bodyPadX。
  const capturePadTop = (format === 'pdf' && pdfMode === 'paged') ? 0 : 64;
  const capturePadBottom = capturePadTop;
  const captureCss = (BITMAP_FORMATS.has(format) || format === 'pdf') ? `
body.${outputClass} .markdown-body {
  padding-top: ${capturePadTop}px;
  padding-bottom: ${capturePadBottom}px;
  padding-left: ${bodyPadX}px;
  padding-right: ${bodyPadX}px;
}
body.${outputClass} pre,
body.${outputClass} .shiki,
body.${outputClass} pre code,
body.${outputClass} .shiki code,
body.${outputClass} .shiki .line {
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}
body.${outputClass} pre,
body.${outputClass} .shiki {
  font-size: .82em;
  overflow-x: hidden;
}
` : '';
  const pagedPdfCss = (format === 'pdf' && pdfMode === 'paged') ? `
body.${outputClass} {
  background: transparent;
}
body.${outputClass} h1,
body.${outputClass} h2,
body.${outputClass} h3,
body.${outputClass} h4,
body.${outputClass} h5,
body.${outputClass} h6 {
  break-after: avoid-page;
}
body.${outputClass} pre,
body.${outputClass} .shiki,
body.${outputClass} blockquote,
body.${outputClass} img,
body.${outputClass} .katex-display,
body.${outputClass} .mermaid,
body.${outputClass} .mermaid-svg,
body.${outputClass} .tip,
body.${outputClass} .warning,
body.${outputClass} .danger,
body.${outputClass} .info,
body.${outputClass} .note,
body.${outputClass} .md-toc,
body.${outputClass} .md-details {
  break-inside: avoid-page;
}
` : '';
  const formatCss = `${htmlResponsiveCss}${captureCss}${pagedPdfCss}`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">
<title>${escapeHtml(docTitle)}</title>
${mathCssTag}
<style>${baseCss}</style>
<style>${themeCss}</style>
<style>${overrideCss}</style>
<style>${formatCss}</style>
</head>
<body class="${outputClass}">
<article class="markdown-body">
${bodyHtml}
</article>
${mermaidScript}
${mermaidInitScript}
</body>
</html>`;
}

// -------- chrome 自动探测 --------
function detectChrome() {
  if (args.chrome) return args.chrome;
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('Chrome/Chromium 未找到，请通过 --chrome <path> 指定可执行路径');
}

// -------- puppeteer browser 单例 --------
// 整个进程的位图/PDF 流水线会串行经历：mermaid 预渲染 → 最终渲染 → 字符宽实测 →
// （如需要）mermaid 二次预渲染 → 最终输出。每个阶段过去都各自 puppeteer.launch()，
// 一次位图输出实际触发 2~3 次 Chrome 冷启动（每次约 500-1200ms）。
//
// 这里把 browser 收敛成模块级 lazy singleton：
//   - getSharedBrowser() 惰性启动，后续调用直接复用
//   - 各阶段只创建/关闭自己的 page，不再 launch/close browser
//   - 进程退出（正常、异常、SIGINT/SIGTERM）统一 close，避免残留 Chrome 进程
//
// 注：puppeteer-core 仅在位图/PDF 路径用到，HTML-only 路径完全不会触发 launch，
// 因此惰性模式对纯 HTML 输出零开销。
let _sharedBrowser = null;
let _sharedBrowserPromise = null;
async function getSharedBrowser() {
  if (_sharedBrowser) return _sharedBrowser;
  if (_sharedBrowserPromise) return _sharedBrowserPromise;
  const puppeteer = require('puppeteer-core');
  const chromePath = detectChrome();
  if (process.env.MD_RENDER_DEBUG) {
    console.log('[md-render] launching shared Chrome (puppeteer-core)');
  }
  _sharedBrowserPromise = puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    // font-render-hinting / allow-file-access-from-files 原先只在最终渲染 launch 时指定；
    // 合并后两者都生效，不影响 mermaid 预渲染（mermaid shell 不依赖这些参数），
    // 但能让最终截图仍保持一致的字体渲染行为。
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none', '--allow-file-access-from-files'],
  }).then(b => { _sharedBrowser = b; return b; });
  return _sharedBrowserPromise;
}
async function closeSharedBrowser() {
  const b = _sharedBrowser;
  _sharedBrowser = null;
  _sharedBrowserPromise = null;
  if (b) { try { await b.close(); } catch {} }
}
// 信号兜底：Ctrl+C / kill 时避免 Chrome 僵尸进程。只注册一次即可，重复注册不影响功能但无意义。
// 注意用 process.once + 标记避免多重触发（exit 事件里不能 await，只能同步尝试关闭）。
let _signalHandlerInstalled = false;
function installBrowserSignalCleanup() {
  if (_signalHandlerInstalled) return;
  _signalHandlerInstalled = true;
  const handler = async (signal) => {
    try { await closeSharedBrowser(); } catch {}
    // 默认退出码：SIGINT=130, SIGTERM=143
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.once('SIGINT', () => handler('SIGINT'));
  process.once('SIGTERM', () => handler('SIGTERM'));
}

// -------- mermaid 预渲染 --------
// 扫描 bodyHtml 里所有 <pre class="mermaid">...</pre>，启 puppeteer 调用 mermaid.render()
// 把每个图预渲染成 SVG 字符串，再替换回去。成功后最终 HTML 不再需要内联 3.17MB 的
// mermaid.min.js，总体积从 ~3.82MB 降到 ~640KB + 每张图 10-30KB 的静态 SVG。
//
// 冒烟测试已验证 mermaid 10.9 生成的 SVG 内联 <style> 选择器都带 #mermaid-<id> 前缀，
// 多张图同页共存不会样式污染。
//
// 兜底策略：
//   - 没有 mermaid 图 → 直接返回原 html，ok=true，什么都不做
//   - puppeteer / Chrome / mermaid 包任一缺失 → 返回 ok=false，调用方回退到「注入 mermaid.min.js」
//   - 部分图渲染失败 → 失败的保留原 <pre class="mermaid"> 源码，成功的替换为 SVG，仍返回 ok=true，
//     但 hasLiveMermaid=true 通知调用方注入运行时作为兜底
async function prerenderMermaid(bodyHtml) {
  // 匹配 markdown-it highlight 产出的 <pre class="mermaid">...</pre>；内部是已 escapeHtml 的源码
  const re = /<pre class="mermaid">([\s\S]*?)<\/pre>/g;
  const matches = [];
  let m;
  while ((m = re.exec(bodyHtml)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length, escaped: m[1] });
  }
  if (matches.length === 0) {
    return { html: bodyHtml, ok: true, hasLiveMermaid: false };
  }

  // 把转义字符还原成 mermaid 源码
  const unescape = unescapeHtmlEntities;
  const sources = matches.map((m, i) => ({ id: `md-mermaid-${i + 1}`, code: unescape(m.escaped) }));

  // 准备 mermaid.min.js（Chrome/puppeteer 由 getSharedBrowser 统一管理）
  let mermaidJs;
  try {
    mermaidJs = fs.readFileSync(require.resolve('mermaid/dist/mermaid.min.js'), 'utf8');
    // 触发一次 detectChrome 失败检测：如果本机没 Chrome，早退回到运行时兜底，避免在
    // getSharedBrowser 里再抛错（抛错路径会打乱 finally）。
    detectChrome();
    require('puppeteer-core');
  } catch (e) {
    console.warn(`[md-render] WARN: mermaid 预渲染依赖缺失（${e.message}），回退到运行时注入 mermaid.min.js`);
    return { html: bodyHtml, ok: false, hasLiveMermaid: true };
  }

  const isDark = theme.includes('dark');
  const mermaidTheme = isDark ? 'dark' : 'default';

  // 不再 launch/close 独立 browser：复用进程级共享 browser，只创建/关闭自己的 page，
  // 这样位图/PDF 流水线里 3 次预渲染 + 输出阶段合并成 1 次 Chrome 启动。
  let page;
  try {
    const browser = await getSharedBrowser();
    page = await browser.newPage();
    // 视口宽度对 gantt / flowchart 自适应宽度没有实质影响（mermaid 内部按 SVG 内在布局），
    // 但设一个接近最终输出的宽度有助于 wrap 决策保持一致
    await page.setViewport({ width: layoutViewportWidth, height: 800, deviceScaleFactor: 1 });

    // 空壳页：仅加载 mermaid + initialize，暴露 __renderAll 把所有源码批量渲染为 SVG
    // 复用与最终输出一致的 mermaidTheme / themeVariables / CSS 字体变量，
    // 保证 mermaid 内部用 DOM 量文字宽高时使用的字体与最终渲染完全一致——否则 CJK 行高偏差
    // 会让多行 foreignObject 的第二行被"下方裁切"。
    const shellFontCn = args['font-cn'] || SYS_FONT_CN;
    const shellFontEn = args['font-en'] || SYS_FONT_EN;
    const shellHtml = `<!doctype html><html><head><meta charset="utf-8">
<style>
:root { --md-font-en: ${shellFontEn}; --md-font-cn: ${shellFontCn}; }
html, body { margin: 0; padding: 0; font-family: var(--md-font-en), var(--md-font-cn), sans-serif; font-size: 13px; line-height: 1.5; }
/* 与最终输出 _base.css 中的 mermaid label 规则保持一致：
 * 显式 line-height: 1.6，让 mermaid 量出的 foreignObject height 足以放下
 * CJK 字形的 descender，多行节点底部不会被裁。 */
foreignObject > div, .nodeLabel, .edgeLabel { line-height: 1.6 !important; }
</style>
</head><body>
<script>${mermaidJs}</script>
<script>
mermaid.initialize({
  startOnLoad: false,
  theme: ${JSON.stringify(mermaidTheme)},
  securityLevel: ${JSON.stringify(mermaidSecurityLevel)},
  gantt: { axisFormat: '%m/%d', barHeight: 18, barGap: 4, topPadding: 40, leftPadding: 85, rightPadding: 20 },
  themeVariables: { fontFamily: 'var(--md-font-en), var(--md-font-cn), sans-serif', fontSize: '13px' }
});
window.__renderAll = async (list) => {
  const out = [];
  for (const d of list) {
    try {
      const { svg } = await mermaid.render(d.id, d.code);
      // 对 journey 图再挂一次 DOM 以调用 getBBox() 测量真实内容范围。
      // mermaid 10.x 的 journey SVG viewBox 上下预留大段空白（顶 25px + 底 200+ px）：
      //   - 顶部空白是 mermaid 的装饰 padding
      //   - 底部空白主要来自装饰性的 .task-line 虚线（延伸到 y≈450，但实际没信息）
      // 这里把 .task-line 临时隐藏后再 getBBox，得到"只包裹 sections/tasks/face/title/arrow"的
      // 紧凑内容框，Node 侧据此把 viewBox 收紧，彻底消除位图/PDF/standalone 中的大段留白。
      let bbox = null;
      if (/aria-roledescription="journey"/.test(svg)) {
        const host = document.createElement('div');
        // 让 SVG 能正确量到尺寸：不可见但参与布局
        host.style.cssText = 'position:absolute;left:-99999px;top:0;width:2500px;height:auto;visibility:hidden;';
        host.innerHTML = svg;
        document.body.appendChild(host);
        try {
          const svgEl = host.querySelector('svg');
          // 临时隐藏装饰性虚线，避免把无信息的 y 延伸区计进 bbox
          const hidden = [];
          svgEl.querySelectorAll('.task-line').forEach(el => {
            hidden.push([el, el.getAttribute('display')]);
            el.setAttribute('display', 'none');
          });
          // getBBox 返回 SVG 用户坐标系下所有可见图形的并集包围盒
          const b = svgEl.getBBox ? svgEl.getBBox() : null;
          // 恢复虚线（虽然 host 马上会被 remove，但为了以后扩展放心还原）
          hidden.forEach(([el, prev]) => {
            if (prev == null) el.removeAttribute('display'); else el.setAttribute('display', prev);
          });
          if (b && Number.isFinite(b.x) && Number.isFinite(b.y) && b.width > 0 && b.height > 0) {
            bbox = { x: b.x, y: b.y, width: b.width, height: b.height };
          }
        } catch {}
        host.remove();
      }
      out.push({ id: d.id, svg, bbox, ok: true });
    } catch (e) { out.push({ id: d.id, error: String(e && e.message || e), ok: false }); }
  }
  return out;
};
</script>
</body></html>`;

    const shellPath = path.join(os.tmpdir(), `md-render-mermaid-shell-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.html`);
    fs.writeFileSync(shellPath, shellHtml);
    try {
      await page.goto('file://' + shellPath, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const results = await page.evaluate(async (list) => await window.__renderAll(list), sources);

      // 把 gantt / journey 的 SVG 修正在 Node 端统一做一遍，避免把脏活带到位图/PDF 后处理里。
      //   - gantt：X 轴 tick / domain 下移 28px，viewBox / height 扩高（与旧 loadHtml 后处理一致）
      //   - journey：根据浏览器侧实测 bbox，把上下大段空白收紧到 12px padding
      const fixedResults = results.map(r => {
        if (!r.ok) return r;
        let svg = fixGanttSvg(r.svg);
        if (r.bbox) svg = fixJourneySvg(svg, r.bbox);
        return { ...r, svg };
      });

      // 倒序替换，避免位置偏移
      let result = bodyHtml;
      let okCount = 0;
      let failCount = 0;
      for (let i = matches.length - 1; i >= 0; i--) {
        const { start, end } = matches[i];
        const r = fixedResults[i];
        if (r && r.ok) {
          // 外层包一个 div.mermaid-svg，供主题 CSS 统一做居中 / 间距处理（如有需要）
          result = result.slice(0, start) + `<div class="mermaid-svg">${r.svg}</div>` + result.slice(end);
          okCount++;
        } else {
          failCount++;
          if (r) console.warn(`[md-render] WARN: mermaid 图 #${i + 1} 预渲染失败：${r.error}`);
        }
      }

      if (failCount > 0) {
        // 有失败 → 保留原 <pre class="mermaid">，通知调用方注入运行时兜底
        console.warn(`[md-render] mermaid 预渲染：${okCount} 成功 / ${failCount} 失败，失败部分将使用运行时渲染`);
        return { html: result, ok: true, hasLiveMermaid: true };
      }
      if (process.env.MD_RENDER_DEBUG) {
        console.log(`[md-render] mermaid 预渲染完成：${okCount} 张图 → SVG`);
      }
      return { html: result, ok: true, hasLiveMermaid: false };
    } finally {
      if (!args['keep-tmp']) { try { fs.unlinkSync(shellPath); } catch {} }
      else { console.log(`[md-render] mermaid shell html kept: ${shellPath}`); }
    }
  } catch (e) {
    console.warn(`[md-render] WARN: mermaid 预渲染异常（${e.message}），回退到运行时注入`);
    return { html: bodyHtml, ok: false, hasLiveMermaid: true };
  } finally {
    // 只关闭本函数创建的 page；browser 交给进程级 closeSharedBrowser 统一收尾。
    if (page) { try { await page.close(); } catch {} }
  }
}

// mermaid 10.x gantt 图的 X 轴 tick 文字会和最后一行任务条重叠，官方没有 bottomPadding 选项。
// 这里对 gantt SVG 字符串做「X 轴整体下移 + viewBox/height 扩高」的修正，逻辑与旧 loadHtml
// 里的 puppeteer 后处理等价，但提前到预渲染阶段完成，最终 HTML / 位图 / PDF 都不再需要额外后处理。
//
// [gantt-tick-offset] 预渲染路径的 gantt 偏移常量。另一份实现在 loadHtml 的运行时兜底分支
// （page.evaluate 内，grep `[gantt-tick-offset]` 可同时拉到）。mermaid 升级时必须同步。
function fixGanttSvg(svg) {
  // 仅处理甘特图：存在 .section 类元素是 mermaid gantt 的稳定标记
  if (!/class="[^"]*\bsection(?:Title|\d)\b[^"]*"|<rect[^>]*class="[^"]*\bsection\b/.test(svg)) {
    return svg;
  }
  const offset = 28;

  // 1) <g class="tick"> 整体 translate(0, offset)
  let fixed = svg.replace(/<g\b([^>]*?)class="([^"]*\btick\b[^"]*)"([^>]*?)>/g, (whole, pre, cls, post) => {
    const all = pre + post;
    const tm = all.match(/transform="([^"]*)"/);
    const base = tm ? tm[1] : '';
    const newTransform = `${base} translate(0, ${offset})`.trim();
    // 先剥掉旧 transform，再统一拼
    const stripped = all.replace(/\s*transform="[^"]*"/, '');
    return `<g${stripped} class="${cls}" transform="${newTransform}">`;
  });

  // 2) X 轴主线 <path class="domain"> 同步下移
  fixed = fixed.replace(/<path\b([^>]*?)class="([^"]*\bdomain\b[^"]*)"([^>]*?)\/?>/g, (whole, pre, cls, post) => {
    const all = pre + post;
    const tm = all.match(/transform="([^"]*)"/);
    const base = tm ? tm[1] : '';
    const newTransform = `${base} translate(0, ${offset})`.trim();
    const stripped = all.replace(/\s*transform="[^"]*"/, '');
    // 注意保留自闭合语义
    return `<path${stripped} class="${cls}" transform="${newTransform}">`;
  });

  // 3) 扩展 viewBox 的 height 维度
  fixed = fixed.replace(/\bviewBox="([\-\d\.\s]+)"/, (whole, vb) => {
    const nums = vb.trim().split(/\s+/).map(Number);
    if (nums.length === 4 && Number.isFinite(nums[3])) {
      nums[3] = nums[3] + offset;
      return `viewBox="${nums.join(' ')}"`;
    }
    return whole;
  });

  // 4) 扩展顶层 <svg> 的 height 属性（若存在数字）与 style 内的 max-width 等保持不变
  fixed = fixed.replace(/<svg\b([^>]*?)\bheight="([0-9.]+)"([^>]*)>/, (whole, pre, h, post) => {
    const nh = parseFloat(h) + offset;
    return `<svg${pre}height="${nh}"${post}>`;
  });
  fixed = fixed.replace(/<svg\b([^>]*?)\bstyle="([^"]*?)"([^>]*)>/, (whole, pre, style, post) => {
    const nStyle = style.replace(/height:\s*([0-9.]+)px/i, (m, h) => `height: ${parseFloat(h) + offset}px`);
    return `<svg${pre}style="${nStyle}"${post}>`;
  });

  return fixed;
}

// mermaid 10.x journey 图的 SVG viewBox 会上下各留 25px 与 200+ px 的空白（用于早期版本的 section 分隔线），
// 导致位图/PDF/standalone HTML 中 journey 图上下出现大段留白。这里根据浏览器侧 getBBox() 实测的
// 内容包围盒，把 viewBox 收紧到仅包裹真实可见元素 + 12px 内边距，同时等比缩放 <svg height> 属性与
// 行内 style 的 height，使缩放后的渲染高度随之缩小。
function fixJourneySvg(svg, bbox) {
  // 只认 journey 专用 role，避免误伤其它图
  if (!/aria-roledescription="journey"/.test(svg)) return svg;
  if (!bbox || !(bbox.width > 0) || !(bbox.height > 0)) return svg;

  const pad = 12;
  const nx = bbox.x - pad;
  const ny = bbox.y - pad;
  const nw = bbox.width + pad * 2;
  const nh = bbox.height + pad * 2;

  // 旧 viewBox，用于计算高度缩放比例
  const vbMatch = svg.match(/\bviewBox="([\-\d\.\s]+)"/);
  if (!vbMatch) return svg;
  const oldVb = vbMatch[1].trim().split(/\s+/).map(Number);
  if (oldVb.length !== 4 || !oldVb.every(Number.isFinite)) return svg;
  const oldVbH = oldVb[3];
  if (!(oldVbH > 0)) return svg;
  const ratio = nh / oldVbH;

  // 1) 替换 viewBox
  let fixed = svg.replace(/\bviewBox="([\-\d\.\s]+)"/, `viewBox="${nx} ${ny} ${nw} ${nh}"`);

  // 2) 按比例缩小 <svg height="..."> 属性
  fixed = fixed.replace(/<svg\b([^>]*?)\bheight="([0-9.]+)"([^>]*)>/, (whole, pre, h, post) => {
    const newH = parseFloat(h) * ratio;
    return `<svg${pre}height="${newH.toFixed(2)}"${post}>`;
  });

  // 3) 若 style 里有 height: *px，同步按比例缩小（mermaid 10.x journey 常见为 max-width: N px，无需动）
  fixed = fixed.replace(/<svg\b([^>]*?)\bstyle="([^"]*?)"([^>]*)>/, (whole, pre, style, post) => {
    const nStyle = style.replace(/height:\s*([0-9.]+)px/i, (m, h) => `height: ${(parseFloat(h) * ratio).toFixed(2)}px`);
    return `<svg${pre}style="${nStyle}"${post}>`;
  });

  return fixed;
}


// -------- main --------
(async () => {
  // shiki 主题：每个主题手挑搭配，可被 --shiki-theme 覆盖
  const SHIKI_THEME_MAP = {
    'github':       'github-light',
    'github-dark':  'github-dark',
    'juejin':       'github-light',
    'wechat':       'github-light',  // 高对比浅色，配 wechat 米色代码块
    'academic':     'github-light',
    'animal-island':'github-light',
  };
  const shikiTheme = args['shiki-theme'] || SHIKI_THEME_MAP[theme] || 'github-light';

  // 第一遍：不带硬换行（runtimeWrapColumn 为 null + 用户没强制列数 → resolveWrapColumn fallback 到 auto，
  // 但位图/PDF 流程会先以「禁用硬换行」探测真实列数，所以这里临时把列数置 0）。
  const userColumn = args['wrap-code-column'];
  const probing = (BITMAP_FORMATS.has(format) || format === 'pdf') && userColumn !== '0';
  if (probing) args['wrap-code-column'] = '0';
  let body = await renderMarkdown(shikiTheme);
  if (probing) args['wrap-code-column'] = userColumn;  // 恢复

  // Mermaid 预渲染策略：
  //   inline 模式（--standalone / 位图 / PDF）：默认开预渲染，得到零 JS / 零网络的最终 HTML
  //   cdn 模式（HTML 默认）：默认关预渲染（省去 Puppeteer 启动），让 CDN runtime 在浏览器侧渲染
  //   --no-prerender-mermaid：显式强制关，作为所有模式的最终转义门（排障用）
  // 无 mermaid 图时 prerenderMermaid 直接 no-op，不启动 puppeteer。
  const shouldPrerenderMermaid = assetMode === 'inline' && !args['no-prerender-mermaid'];
  let hasLiveMermaid = false;
  if (shouldPrerenderMermaid) {
    const pre = await prerenderMermaid(body);
    body = pre.html;
    hasLiveMermaid = pre.hasLiveMermaid;
  } else {
    // 不走预渲染 → 保留 <pre class="mermaid">，若存在则注入运行时（CDN 或 inline）
    hasLiveMermaid = /<pre class="mermaid">/.test(body);
  }

  // 数学公式渲染策略：
  //   standalone + HTML：把 KaTeX HTML 转成 MathJax SVG（~400KB 字体 → ~15KB 矢量 SVG）
  //   CDN：保持 KaTeX（打开快、浏览器会缓存 katex CSS）
  //   位图/PDF：保持 KaTeX（Puppeteer 渲染 KaTeX 产物已成熟稳定；切 MathJax 会牵扯额外截图验证）
  // 只在 HTML + standalone 时切 MathJax。
  let mathjaxStyleSheet = '';
  if (format === 'html' && args.standalone) {
    const mj = renderKatexToMathjaxSvg(body);
    body = mj.html;
    mathjaxStyleSheet = mj.styleSheet;
  }

  let html = buildHtml(body, { injectMermaidRuntime: hasLiveMermaid, mathjaxStyleSheet });

  if (format === 'html') {
    fs.writeFileSync(outputPath, html, 'utf8');
    console.log(`[md-render] HTML written: ${outputPath}`);
    // HTML 路径里若 standalone 触发过 mermaid 预渲染，shared browser 依旧在跑；
    // 进程退出前必须显式关掉，否则 Puppeteer IPC pipe 会把 Node 事件循环撑住卡死。
    await closeSharedBrowser();
    return;
  }

  // png / pdf 走 puppeteer；browser 从进程级共享单例获取，与 mermaid 预渲染阶段复用同一个 Chrome。
  installBrowserSignalCleanup();
  const browser = await getSharedBrowser();

  // 跟踪所有创建过的临时 html/pdf 文件，finally 里统一清理，避免中途抛错时泄漏到 /tmp。
  // 定义在 try 之外，保证 finally 一定能访问到。
  const tmpFiles = new Set();
  const safeUnlink = (p) => { try { if (p) fs.unlinkSync(p); } catch {} };

  try {
    const page = await browser.newPage();
    // Chromium 里 deviceScaleFactor 保持 1（避免超长页底部重复渲染 bug）；
    // 位图通过「先生成 PDF → 再用 pdftoppm 栅格化」来获得高清输出，不再走浏览器直接截图。
    await page.setViewport({ width: layoutViewportWidth, height: 1200, deviceScaleFactor: 1 });

    async function loadHtml(htmlContent) {
      const tmpFile = path.join(os.tmpdir(), `md-render-${Date.now()}-${Math.random().toString(36).slice(2,7)}.html`);
      fs.writeFileSync(tmpFile, htmlContent, 'utf8');
      tmpFiles.add(tmpFile);
      if (args['keep-tmp']) console.log(`[md-render] tmp html kept: ${tmpFile}`);
      // 本地化 mermaid 后不再强依赖网络，放宽到 domcontentloaded + 后续的 mermaid 处理等待，
      // 可显著加速离线 / 弱网环境；仍保留 60s 超时兜底。
      await page.goto('file://' + tmpFile, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.evaluate(async () => { if (document.fonts && document.fonts.ready) await document.fonts.ready; });

      // 仅当页面内仍存在「待动态渲染的 mermaid 源码块」（即预渲染被跳过或回退了）时，
      // 才需要等 mermaid 运行时完成绘制；默认流程走预渲染，这里可以直接跳过 ~400ms 轮询。
      const hasPendingMermaid = await page.evaluate(() =>
        document.querySelectorAll('pre.mermaid:not([data-processed])').length > 0
      );
      if (hasPendingMermaid) {
        await page.evaluate(() => new Promise(resolve => {
          const check = () => {
            const pending = document.querySelectorAll('pre.mermaid:not([data-processed])');
            if (pending.length === 0) resolve();
            else setTimeout(check, 100);
          };
          check();
        })).catch(() => {});
        await new Promise(r => setTimeout(r, 300));

        // 走运行时渲染分支时，gantt 图还需要 X 轴下移修正（预渲染路径已在 fixGanttSvg 内做过）。
        // [gantt-tick-offset] 运行时兜底路径的 gantt 偏移常量。与 fixGanttSvg 中的 28 必须保持一致；
        // mermaid 升级时 grep `[gantt-tick-offset]` 能同时拉到两处。
        await page.evaluate(() => {
          const offset = 28;
          document.querySelectorAll('pre.mermaid svg').forEach(svg => {
            const ticks = svg.querySelectorAll('g.tick');
            if (!ticks.length) return;
            if (!svg.querySelector('rect.section, .section0, .sectionTitle')) return;
            ticks.forEach(t => {
              const cur = t.getAttribute('transform') || '';
              t.setAttribute('transform', `${cur} translate(0, ${offset})`);
            });
            const domain = svg.querySelector('path.domain');
            if (domain) {
              const cur = domain.getAttribute('transform') || '';
              domain.setAttribute('transform', `${cur} translate(0, ${offset})`);
            }
            const vb = svg.getAttribute('viewBox');
            if (vb) {
              const [x, y, w, h] = vb.split(/\s+/).map(Number);
              svg.setAttribute('viewBox', `${x} ${y} ${w} ${h + offset}`);
            }
            const styleH = svg.style.height;
            if (styleH && styleH.endsWith('px')) svg.style.height = (parseFloat(styleH) + offset) + 'px';
            const attrH = svg.getAttribute('height');
            if (attrH && /^\d/.test(attrH)) svg.setAttribute('height', String(parseFloat(attrH) + offset));
          });
        });
        await new Promise(r => setTimeout(r, 100));
      }

      return tmpFile;
    }

    let tmpFile = await loadHtml(html);

    // ===== 实测代码块列数 =====
    if (probing) {
      const probed = await page.evaluate(() => {
        const pre = document.querySelector('.markdown-body pre');
        if (!pre) return null;
        const cs = getComputedStyle(pre);
        const padL = parseFloat(cs.paddingLeft) || 0;
        const padR = parseFloat(cs.paddingRight) || 0;
        const inner = pre.clientWidth - padL - padR;
        // 在 pre 内部插入临时探针，使用相同字体环境。
        // 用 50 个混合字符（接近真实代码的字符分布），等宽字体下每字符宽度相同；
        // 即便误用了非等宽 fallback，混合采样也比单 'M' 更接近平均值。
        const probe = document.createElement('span');
        probe.textContent = 'abcdefghij1234567890_-=+()[]{}<>:.,/?abcdefghij1234'.slice(0, 50);
        probe.style.visibility = 'hidden';
        probe.style.whiteSpace = 'pre';
        const code = pre.querySelector('code') || pre;
        code.appendChild(probe);
        const charPx = probe.getBoundingClientRect().width / 50;
        probe.remove();
        return { inner, charPx };
      });
      if (probed && probed.charPx > 0) {
        // 留 ~6% 余量，避免 PDF 子集嵌入字体时实际字宽轻微大于浏览器测得值，
        // 触发 CSS 二次软换行，把已经被硬换行的行又切一次。
        const safetyFactor = 0.94;
        const raw = (probed.inner * safetyFactor) / probed.charPx;
        runtimeWrapColumn = Math.max(40, Math.floor(raw) - 1);
        if (process.env.MD_RENDER_DEBUG) {
          console.log(`[md-render] probed wrap column: ${runtimeWrapColumn} (inner=${probed.inner.toFixed(1)}px, charPx=${probed.charPx.toFixed(2)}, safety=${safetyFactor})`);
        }
        // 重新做一遍 markdown-it + twemoji + Shiki，这次带上实测列数；
        // 复用 renderMarkdown() 与首次渲染共用同一套管线，避免重复代码漂移。
        let body2 = await renderMarkdown(shikiTheme);
        // 二次渲染的 body 同样需要 mermaid 预渲染（否则最终 HTML 又会出现原始 <pre class="mermaid">）。
        // 这里复用与首次相同的开关；首次若走了运行时兜底，二次也同样兜底。
        let hasLiveMermaid2 = hasLiveMermaid;
        if (shouldPrerenderMermaid) {
          const pre2 = await prerenderMermaid(body2);
          body2 = pre2.html;
          hasLiveMermaid2 = pre2.hasLiveMermaid;
        }
        const html2 = buildHtml(body2, { injectMermaidRuntime: hasLiveMermaid2 });
        // 清掉旧 tmp 文件（留到 finally 里统一处理前，先从集合移除 + 删文件，避免重复路径占用）
        if (!args['keep-tmp']) { tmpFiles.delete(tmpFile); safeUnlink(tmpFile); }
        tmpFile = await loadHtml(html2);
      }
    }

    // 统一先构造单页连续 PDF：页宽 = viewportWidth，页高 = 实际内容高度
    async function renderSinglePagePdf(pdfPath) {
      fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
      const contentHeight = await page.evaluate(() => Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight
      ));
      await page.pdf({
        path: pdfPath,
        width: `${viewportWidth}px`,
        height: `${contentHeight}px`,
        printBackground: true,
        margin: { top: '0', bottom: '0', left: '0', right: '0' },
        pageRanges: '1',
      });
      return contentHeight;
    }

    async function renderPagedPdf(pdfPath) {
      fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
      await page.emulateMediaType('print');
      await page.pdf({
        path: pdfPath,
        format: pageSize,
        printBackground: true,
        margin: {
          top: pdfMargin,
          bottom: pdfMargin,
          left: pdfMargin,
          right: pdfMargin,
        },
      });
      await page.emulateMediaType('screen');
    }

    if (BITMAP_FORMATS.has(format)) {
      // 位图输出共用同一条流水线：
      //   1) Puppeteer 生成宽度 = viewportWidth 的单页 PDF（临时文件）；
      //   2) pdftoppm 以「96 × supersample」DPI 栅格化成超采样 PNG，
      //      像素宽 = viewportWidth × supersample；
      //   3) ImageMagick 文字锐化下采样到目标像素宽 viewportWidth，得到最终尺寸 PNG；
      //   4) PNG 直接输出；AVIF/JPEG XL 再从 PNG 中间产物转码，并保留同格式 @Nx 产物；
      //      其中 AVIF 超过 AV1 单 cell 尺寸限制时，会自动切换为 avifenc grid。
      //
      // 为什么保留「超采样 + 下采样」选项？
      //   - 默认 `--supersample 1` 直接按 96 DPI 栅格化，速度更快且无需 magick；
      //   - 显式设置 `--supersample > 1` 时，会先出高 DPI 大图、再用 Lanczos 过滤器下采样，
      //     等效于印刷行业的「supersample anti-aliasing」，边缘与细线的视觉质量显著更高；
      //   - `--no-downsample` 保留超采样中间态作为最终输出（Retina 高清场景）。
      const tmpPdf = path.join(os.tmpdir(), `md-render-${Date.now()}.pdf`);
      tmpFiles.add(tmpPdf);
      await renderSinglePagePdf(tmpPdf);

      // Puppeteer 在 `page.pdf({width:'900px'})` 下会把 CSS px 转成 pt（1px ≈ 0.75pt），
      // 因此 PDF 页宽实际是 viewportWidth × 0.75 pt。要让栅格化后的像素宽 = viewportWidth × supersample，
      // DPI 需要 = 72 / 0.75 × supersample = 96 × supersample。
      const supersample = pngSupersample;
      const dpi = 96 * supersample;
      const skipDownsample = !!args['no-downsample'] || supersample === 1;
      const { execFileSync } = require('child_process');
      const isPngOutput = format === 'png';
      const bitmapLabel = format === 'avif' ? 'AVIF' : format === 'jxl' ? 'JPEG XL' : 'PNG';

      const makeSupersampleOutputPath = (targetPath, targetExt) => {
        const parsed = path.parse(targetPath);
        const stem = parsed.ext ? path.join(parsed.dir, parsed.name) : targetPath;
        return `${stem}@${supersample}x.${targetExt}`;
      };
      const stripPngExt = (filePath) => filePath.replace(/\.png$/i, '');
      const makeTempPng = (label) => {
        const filePath = path.join(os.tmpdir(), `md-render-${process.pid}-${Date.now()}-${label}.png`);
        tmpFiles.add(filePath);
        return filePath;
      };
      const readPngSize = (filePath) => {
        const header = Buffer.alloc(24);
        const fd = fs.openSync(filePath, 'r');
        try {
          const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
          const signature = '89504e470d0a1a0a';
          if (bytesRead < header.length || header.subarray(0, 8).toString('hex') !== signature) {
            throw new Error('不是有效的 PNG 文件');
          }
          return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
        } finally {
          fs.closeSync(fd);
        }
      };
      const buildAvifArgs = (sourcePng, targetPath) => {
        const { width, height } = readPngSize(sourcePng);
        const cols = Math.ceil(width / AVIF_MAX_CELL_SIZE);
        const rows = Math.ceil(height / AVIF_MAX_CELL_SIZE);
        if (cols === 1 && rows === 1) return [sourcePng, targetPath];

        const cellWidth = Math.ceil(width / cols);
        const cellHeight = Math.ceil(height / rows);
        if (cellWidth < AVIF_MIN_GRID_CELL_SIZE || cellHeight < AVIF_MIN_GRID_CELL_SIZE) {
          throw new Error(`AVIF grid cell 过小：${cellWidth}x${cellHeight}，avifenc 要求每个 cell 宽高都 >= ${AVIF_MIN_GRID_CELL_SIZE}px。`);
        }
        console.log(`[md-render] AVIF grid enabled: ${width}x${height} -> ${cols}x${rows} cells`);
        return ['--grid', `${cols}x${rows}`, sourcePng, targetPath];
      };
      const encodeBitmap = (sourcePng, targetPath) => {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        safeUnlink(targetPath);
        try {
          if (format === 'avif') {
            execFileSync('avifenc', buildAvifArgs(sourcePng, targetPath), { stdio: ['ignore', 'inherit', 'inherit'] });
          } else if (format === 'jxl') {
            execFileSync('cjxl', [sourcePng, targetPath], { stdio: ['ignore', 'inherit', 'inherit'] });
          }
        } catch (e) {
          const isMissing = e && (e.code === 'ENOENT' || /ENOENT/.test(e.message || ''));
          if (isMissing) {
            const install = format === 'avif' ? 'brew install libavif' : 'brew install jpeg-xl';
            throw new Error(`${bitmapLabel} 编码器未安装。请 \`${install}\` 后重试。`);
          }
          throw new Error(`${bitmapLabel} 编码失败：${e.message}`);
        }
      };

      // 提前创建输出父目录：位图流水线里最终写入可能延后到 magick 或编码器阶段发生，
      // 此时如果父目录不存在，错误信息容易被误解成输入文件问题。
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });

      // PNG 目标格式保留既有行为：最终尺寸写到 outputPath，超采样 PNG 写到同目录 @Nx.png。
      // AVIF/JXL 使用 PNG 作为临时中间产物，最终只保留 outputPath 和同格式 @Nx 产物。
      const finalPng = isPngOutput ? outputPath : makeTempPng('final');
      const hiResPng = skipDownsample
        ? finalPng
        : (isPngOutput ? makeSupersampleOutputPath(outputPath, 'png') : makeTempPng('hires'));
      const rasterPng = skipDownsample ? finalPng : hiResPng;
      const outPrefix = stripPngExt(rasterPng);

      try {
        execFileSync('pdftoppm', [
          '-png',
          '-r', String(dpi),
          '-aa', 'yes',
          '-aaVector', 'yes',
          '-f', '1', '-l', '1',
          '-singlefile',
          tmpPdf,
          outPrefix,
        ], { stdio: 'inherit' });
      } catch (e) {
        throw new Error(`pdftoppm 调用失败（请安装 poppler：brew install poppler）：${e.message}`);
      }
      // pdftoppm 接收的是输出 prefix，会自动追加 `.png`。当用户显式传
      // `--format png --out out` 或 profile 默认推断为 PNG 但输出路径没有 `.png`
      // 后缀时，需要把实际产物移动回用户指定的精确路径。
      const producedRasterPng = `${outPrefix}.png`;
      if (producedRasterPng !== rasterPng && fs.existsSync(producedRasterPng)) {
        safeUnlink(rasterPng);
        fs.renameSync(producedRasterPng, rasterPng);
      }
      // tmpPdf 和非目标格式的 PNG 中间产物交给 finally 清理；用户可用的 @Nx 目标产物默认保留。

      // 步骤 3：文字锐化优先下采样到目标像素宽。
      // Markdown 长图主要由中文、代码和细线组成，主观清晰度比照片色彩保真更重要：
      //   - `LanczosSharp` 比普通 Lanczos 更适合文字/截图类内容，边缘更利落；
      //   - 轻微 `unsharp` 抵消 3x -> 1x 缩小时的抗锯齿发灰，但强度刻意保守，避免描边感。
      // `-strip` 去掉色彩配置之外的元数据；PNG 输出可再由 oxipng 做更彻底的清理。
      if (!skipDownsample) {
        try {
          execFileSync('magick', [
            hiResPng,
            '-filter', 'LanczosSharp',
            '-resize', `${viewportWidth}x`,
            '-unsharp', '0x0.35+0.35+0.02',
            '-strip',
            finalPng,
          ], { stdio: ['ignore', 'inherit', 'inherit'] });
        } catch (e) {
          const isMissing = e && (e.code === 'ENOENT' || /ENOENT/.test(e.message || ''));
          if (isMissing) {
            throw new Error('magick 未安装，无法执行文字锐化下采样。请 `brew install imagemagick`，或使用 --supersample 1 / --no-downsample 跳过下采样步骤。');
          }
          throw new Error(`magick 文字锐化下采样失败：${e.message}`);
        }
      }

      if (isPngOutput) {
        // 可选步骤：oxipng 严格无损重压。默认关闭，避免普通 PNG 输出依赖额外二进制；
        // 需要更小体积时显式传 --optimize-png。oxipng 只重排 IDAT/删冗余元数据，不改动任何像素。
        //
        // 与 pdftoppm 不同，oxipng 是"锦上添花"的可选依赖：显式启用后若未安装或执行失败，也只打
        // warning 降级跳过，不阻断主流程。理由：此时 PNG 已经成功生成，用户通常更关心"能拿到结果"
        // 而非"体积最优"。想强制要求优化的场景，可在外层 CI 里自行校验体积。
        if (args['optimize-png']) {
          try {
            const beforeBytes = fs.statSync(finalPng).size;
            execFileSync('oxipng', [
              '-o', 'max',           // 最高压缩级别，尝试所有过滤器/策略组合
              '--strip', 'safe',      // 删除非关键元数据（时间戳、gAMA 等），但保留 sRGB/色彩信息
              '--quiet',
              finalPng,
            ], { stdio: ['ignore', 'inherit', 'inherit'] });
            const afterBytes = fs.statSync(finalPng).size;
            const savedPct = ((1 - afterBytes / beforeBytes) * 100).toFixed(1);
            console.log(`[md-render] oxipng: ${(beforeBytes / 1024).toFixed(1)} KB -> ${(afterBytes / 1024).toFixed(1)} KB (-${savedPct}%)`);
          } catch (e) {
            // ENOENT：oxipng 没装；其它错误：oxipng 处理失败（极少见）。统一 warning 降级。
            const isMissing = e && (e.code === 'ENOENT' || /ENOENT/.test(e.message || ''));
            if (isMissing) {
              console.warn('[md-render] WARN: oxipng not installed, skipping lossless PNG optimization. Install via `brew install oxipng` to enable.');
            } else {
              console.warn(`[md-render] WARN: oxipng optimization failed, keeping unoptimized PNG: ${e.message}`);
            }
          }
        }
      } else {
        encodeBitmap(finalPng, outputPath);
        if (supersample > 1) {
          encodeBitmap(hiResPng, makeSupersampleOutputPath(outputPath, format));
        }
      }

      console.log(`[md-render] ${bitmapLabel} written: ${outputPath}`);
    } else if (format === 'pdf') {
      if (pdfMode === 'paged') await renderPagedPdf(outputPath);
      else await renderSinglePagePdf(outputPath);
      console.log(`[md-render] PDF written: ${outputPath}`);
    }

  } finally {
    // 统一清理所有临时文件：即便中途抛异常，也不会在 /tmp 留下 md-render-*.html/pdf。
    if (!args['keep-tmp']) {
      for (const f of tmpFiles) safeUnlink(f);
    }
    // 关闭共享 browser：若已被 SIGINT 钩子提前关过，closeSharedBrowser 内部会空操作。
    await closeSharedBrowser();
  }
})().catch(err => {
  console.error('[md-render] FAILED:', err.message);
  console.error(err.stack);
  process.exit(2);
});
