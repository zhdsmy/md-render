# md-render 架构与维护说明

本文记录 `md-render` 的实现链路和维护注意事项。Agent 日常调用优先读 `SKILL.md`；需要修改渲染逻辑、主题、安全策略或排查边界问题时再读本文。

## 总体定位

`md-render` 是高保真视觉渲染器，不是语义文档转换器。它的主线是：

```text
Markdown
  -> markdown-it token/html
  -> 图片/Twemoji/Shiki/Mermaid/数学公式处理
  -> 完整 HTML
  -> HTML / PDF / bitmap encoder
```

当前输出格式：

- `html`
- `png`
- `avif`
- `jxl`
- `pdf`，单页连续 PDF，不做 A4 分页。

## 主要依赖

- `markdown-it`：Markdown 主解析器。
- `markdown-it-*` 插件：GFM、脚注、定义列表、上下标、mark、attrs、container、task list。
- `shiki`：代码高亮。
- `katex` / `@vscode/markdown-it-katex`：默认数学公式渲染。
- `mathjax-full`：standalone HTML 中把 KaTeX 公式转 SVG。
- `mermaid`：图表渲染。
- `twemoji` / `@twemoji/svg`：emoji 检测与 SVG 资源。
- `puppeteer-core`：复用系统 Chrome/Chromium，不下载 Chromium。
- `pdftoppm`：PDF 栅格化为位图。
- `avifenc` / `cjxl`：AVIF / JPEG XL 编码。
- `magick`：可选超采样下采样。
- `oxipng`：可选 PNG 无损压缩。

## Markdown 管线

解析阶段由 `markdown-it` 负责，默认面向可信 Markdown；`--safe` 下关闭原始 HTML。

已启用扩展：

- GFM 表格、删除线、自动链接、任务列表。
- 脚注、定义列表、上标、下标、mark。
- `{#id}` 标题 id，限制 attrs 只允许 `id`。
- `:::tip` / `:::warning` / `:::danger` / `:::info` / `:::note`。
- `:::details` 输出原生 `<details><summary>`。
- GitHub Alert blockquote 自动改写为提示块。
- `[[toc]]` 或 frontmatter `toc: true` 生成 h2/h3 目录。

Frontmatter 当前是轻量解析，只识别最常见的 `--- ... ---`，并读取顶层 `title` / `toc`。如果未来要支持更多元数据，建议改成 `gray-matter` + `js-yaml`。

## Slug 与 TOC

标题锚点使用 GitHub 风格 `slugify`：

- Unicode NFKC 归一化。
- 保留字母、数字、空白、连字符、下划线。
- 去掉中英文标点和 emoji。
- 空白转 `-`，合并连续 `-`。

目录只收 `h2` / `h3`。`h1` 通常作为文档标题，不进入目录。

## 安全模式

默认模式保持历史兼容，按可信输入处理：

- 允许 Markdown 原始 HTML。
- 保留 data URL 图片。
- Mermaid 使用 `loose`。

`--safe` 用于外部用户提交、网页抓取或来源不明 Markdown：

- 禁用 Markdown 原始 HTML。
- 拦截 `javascript:`、`data:`、`file:` 等高风险协议。
- Mermaid 使用 `strict`。
- HTML 加 CSP、`no-referrer`、外链 `rel="noopener noreferrer"`。
- standalone 下不主动读取本地图片文件，避免泄露本机文件。

`--trusted` 只是兼容逃生门，用于显式覆盖命令模板中的 `--safe`。普通任务不要主动使用。

## 资源模式

HTML 输出有两种资源策略：

- 默认 CDN：KaTeX、Mermaid、Twemoji 走 jsdelivr，产物体积小。
- `--standalone`：CSS、Twemoji、Mermaid SVG、数学公式等内联，产物可离线打开。

位图和 PDF 输出始终按内联资源处理，避免 Puppeteer 等外部资源超时或字体异步导致渲染不稳定。

CDN 版本号来自本地 `node_modules/<pkg>/package.json`，升级依赖后无需同步硬编码版本。

## 数学公式

数学公式有两条路径：

- CDN HTML、位图、PDF：保留 KaTeX HTML，按需注入 KaTeX CSS。
- standalone HTML：从 KaTeX HTML 的 `<annotation encoding="application/x-tex">` 提取 LaTeX，用 `mathjax-full` 在 Node 端转 SVG。

standalone HTML 走 MathJax SVG 是为了避免内联 KaTeX CSS 和整套 woff2 字体导致体积膨胀。无公式时快速 no-op，不初始化 MathJax。

若 MathJax 重渲染失败并且 body 中仍有 `class="katex"`，会回退到内联 KaTeX CSS/字体。

## Mermaid

Mermaid 预渲染策略：

- `--standalone` / 位图 / PDF：默认预渲染，把图表转成静态 SVG。
- 默认 HTML CDN：不预渲染，浏览器侧加载 Mermaid runtime。
- `--no-prerender-mermaid`：强制关闭预渲染，用于排障。

预渲染通过 `puppeteer-core` 启动系统 Chrome，并复用进程级 browser singleton，避免一次渲染多次冷启动。

已知 Mermaid 修正：

- Gantt：Mermaid 10.x 没有 `bottomPadding`，X 轴 tick 可能与任务条重叠。预渲染后将 `g.tick` 和 `path.domain` 下移 28px，并扩展 viewBox/height。
- Journey：Mermaid 10.x SVG viewBox 上下留白过大。预渲染时用浏览器 `getBBox()` 量真实内容框，隐藏装饰性 `.task-line` 后收紧 viewBox。
- `.mermaid-svg svg { max-width:100%; height:auto; }` 是预渲染 SVG 高度自适应的关键样式。

若调整 Gantt 偏移常量，需同步 `fixGanttSvg` 和运行时兜底路径；代码里可搜索 `[gantt-tick-offset]`。

## Twemoji

Twemoji 处理分两种：

- CDN HTML：输出 `<img>` 指向 jsdelivr 上的 SVG。
- standalone / 位图 / PDF：读取本地 `@twemoji/svg` 并内联 `<svg>`。

Mermaid 代码块在 Twemoji 替换前会被临时保护，避免图表源码中的 emoji 被替换成 HTML，导致 Mermaid 解析失败。

## 代码高亮与换行

代码块先由 markdown-it 输出占位 HTML，再由 Shiki 异步高亮。多个代码块并发执行 `codeToHtml`，利用 Shiki 内部缓存减少总耗时。

HTML 输出保留宽代码块横向滚动，方便阅读和复制。

位图/PDF 输出会硬换行长代码：

- 默认 `--wrap-code-column auto`。
- 第一遍加载到 Puppeteer 后，DOM 实测 `pre` 内宽和当前等宽字体字符宽。
- 使用 94% 安全余量，重跑 Markdown/Shiki/Mermaid 管线，再生成最终输出。
- 换行处追加 `↩` 标识。
- `--wrap-code-column 0` 可关闭硬换行。

`findWrapIndex` 只在末尾窗口回溯断点，优先级为：空白 > `,;)]}` > `.:|>`，避免过早换行浪费右侧空间。

## 位图与 PDF

PDF 输出：

- 单页连续 PDF。
- 页宽等于 `--width`。
- 页高等于实际内容高度。
- 零页边距。

位图输出不走浏览器截图，而是：

```text
HTML -> Puppeteer single-page PDF -> pdftoppm PNG -> optional magick downsample -> PNG/AVIF/JXL
```

原因：

- 长页截图在 Chromium 高 DPR 下容易出现底部重复或裁切。
- PDF 栅格化链路更稳定。
- `pdftoppm -r 96` 可让输出像素宽匹配 CSS px 宽度。

默认 `--supersample 1`，无需 ImageMagick。`--supersample > 1` 时先高 DPI 栅格化，再用 ImageMagick `LanczosSharp + unsharp` 下采样，提升文字边缘质量。

AVIF 超过 AV1 单 cell 尺寸限制时会自动启用 `avifenc --grid`。

PNG 默认不跑 `oxipng`。显式 `--optimize-png` 后才做无损重压；失败只 warning，不阻断主流程。

## 字体

默认使用系统字体链，不主动内嵌字体文件：

- 中文：`PingFang SC`、`Microsoft YaHei`、`Hiragino Sans GB`、`Heiti SC`。
- 西文：`-apple-system`、`Segoe UI`、`Helvetica Neue`、`Arial`。
- 等宽：`SF Mono`、`Menlo`、`Consolas`、`Liberation Mono`、`Courier New`。

`--font-cn`、`--font-en`、`--font-mono` 只覆盖字体族，要求执行机器已安装对应字体。

Mermaid 预渲染 shell 和最终 HTML 共用同一套字体变量，避免 CJK 文本量宽高不一致导致裁切。

## 临时文件与 Chrome

`render.js` 会创建临时 HTML/PDF/PNG 文件，并在 `finally` 中统一清理。`--keep-tmp` 会保留中间文件用于排查。

Chrome 使用进程级 lazy singleton：

- HTML-only 且不需要 Mermaid 预渲染时不会启动 Chrome。
- Mermaid 预渲染、列宽实测、最终 PDF/位图输出复用同一个 browser。
- SIGINT/SIGTERM 时尝试关闭 browser，避免残留进程。

## 环境诊断

`node render.js --check-env` 检查：

- Node packages。
- Chrome / Chromium。
- `pdftoppm`。
- `magick`。
- `avifenc`。
- `cjxl`。
- `oxipng`。
- 主题 CSS 文件。

其中 `pdftoppm` 是位图必需；`avifenc` 仅 AVIF 必需；`cjxl` 仅 JPEG XL 必需；`magick` 仅超采样下采样必需；`oxipng` 仅 PNG 优化必需。

## 主题

主题拆分：

- `_base.css`：通用 Markdown、表格、代码、Mermaid、TOC、容器、details 样式。
- `github.css`：默认技术文档。
- `github-dark.css`：暗色演示/终端风格。
- `juejin.css`：中文技术博客。
- `wechat.css`：公众号/社交分享。
- `academic.css`：研究报告/论文风格。
- `animal-island.css`：温暖圆润的笔记和轻松分享风格。

主题修改后至少运行 `npm test`，并渲染 `sample.md` 的全部内置主题人工检查。

## 回归测试

`scripts/test-smoke.js` 覆盖：

- 环境诊断。
- 参数校验。
- `--safe` / `--trusted`。
- GitHub Alert。
- TOC。
- details。
- standalone Mermaid 预渲染。
- 本地/远程图片内联。
- 基础 PNG 输出。
- 可选 AVIF/JXL/超采样路径。

未来建议增加视觉回归：尺寸、空白比例、非空像素比例、主题截图 baseline。
