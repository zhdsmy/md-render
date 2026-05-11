---
name: md-render
description: "当用户需要将 Markdown 渲染或转换为 HTML、位图图片（PNG、AVIF、JPEG XL）或单页 PDF 时使用本 Skill。它针对 AI 生成的 Markdown 内容做了优化，支持 GFM 表格、任务列表、脚注、定义列表、代码高亮（Shiki）、Mermaid 图表、KaTeX 数学公式、自定义容器（tip/warning/danger/info/note/details）、GitHub 风格提示块、目录和 emoji（Twemoji）。内置五套主题（github、github-dark、juejin、wechat、academic），默认使用系统字体，也支持自定义字体族。触发语包括“把 Markdown 转成 HTML/图片/PDF”、“渲染 markdown”、“导出长图”、“生成微信公众号文章”、“Markdown to PNG/AVIF/JXL”等类似需求。"
version: 1.0.0
agent_created: true
---

# md-render — Markdown 渲染器

把任意 Markdown（包括 AI 直接吐出的非规范片段）渲染成 **HTML / 位图图片（PNG、AVIF、JPEG XL）/ 单页 PDF**，五套主题可选，默认使用系统字体，可按需指定字体。

## 何时使用

- 用户给一段 Markdown，要求出 HTML / 图片 / PDF。
- 用户要求把 AI 输出"漂亮地保存下来"。
- 需要长图分享（微信、知识星球、社交媒体）。
- 需要把研究笔记导出成 PDF。
- 涉及代码块、Mermaid、数学公式、emoji 的渲染。

## 何时不使用

- 仅需纯文本 → 直接写文件即可。
- 需要 PPT / Word → 用 pptx / docx 技能。

## 核心命令

```bash
cd <skill-dir>/scripts
node render.js \
  --in <input.md> \
  --out <output.{html,png,avif,jxl,pdf}> \
  [--format html|png|avif|jxl|pdf] \
  [--theme github|github-dark|juejin|wechat|academic] \
  [--width 900] \
  [--safe] \
  [--standalone] \
  [--check-env]
```

格式由 `--out` 后缀自动推断；显式 `--format` 优先。`--standalone` 仅对 HTML 输出有意义，位图/PDF 始终强制内联资源。

stdin 也可作为输入：`cat foo.md | node render.js --in - --out out.png`

首次在新机器运行或位图/PDF 失败时，先执行环境诊断：`node render.js --check-env`。

高级参数按用途分层：位图/PDF 调优用 `--supersample`、`--wrap-code-column auto|0|<n>`；PNG 体积优化用 `--optimize-png`；样式覆盖用 `--title`、`--font-cn`、`--font-en`、`--font-mono`、`--shiki-theme`；调试/兼容才使用 `--chrome`、`--keep-tmp`、`--trusted`、`--no-prerender-mermaid`、`--no-downsample`。

## 安全模式

默认保持历史兼容，按**可信 Markdown**处理：允许原始 HTML，Mermaid 使用 `loose` 安全级别。处理外部用户提交、网页抓取或来源不明的 Markdown 时，应追加 `--safe`：禁用 Markdown 原始 HTML、拦截 `javascript:` / `data:` 等高风险链接或图片协议、Mermaid 切到 `strict`，并给导出 HTML 加 CSP / no-referrer / 外链 `rel="noopener noreferrer"`。`--trusted` 只是兼容逃生门，用于显式覆盖命令模板中的 `--safe`，普通命令不需要传。

## CDN vs Standalone（仅 HTML 输出有差异）

| 模式 | 资源 | 体积（有公式） | 体积（无公式） | 场景 |
|---|---|---|---|---|
| **默认（CDN）** | KaTeX / Mermaid / Twemoji 全走 jsdelivr | ~80KB | ~6KB | 有网络的普通分享 / 预览 |
| **`--standalone`** | 数学公式 MathJax 转 SVG，Mermaid 预渲染 SVG，Twemoji 内联 SVG，CSS 全内联；可信模式下本地图片转 data URL，`--safe` 下不读取本地图片文件 | ~190KB+图片 | ~10KB+图片 | Telegram / 微信内置浏览器 / 断网环境 / 跨机器分发 |

位图 / PDF 输出不受 `--standalone` 影响，始终等同内联（避免 Puppeteer 等外部资源超时），位图/PDF 仍用 KaTeX+HTML 渲染数学公式。

## 主题选择指南

| theme | 适用场景 |
|---|---|
| `github` | 默认，技术文档、README、API 说明 |
| `github-dark` | 暗色背景的演示 / 终端配图 |
| `juejin` | 中文技术博客（蓝色主色） |
| `wechat` | 微信公众号、社交分享长图（绿色） |
| `academic` | 论文、研究报告、严谨场合（衬线） |

## 支持的 Markdown 扩展

- **GFM**：表格、删除线、自动链接、任务列表 `- [x]`
- **代码高亮**：Shiki（VSCode 同款引擎），自动按主题切深浅
- **Mermaid**：``` ```mermaid ``` 代码块自动渲染
- **KaTeX**：`$inline$` 和 `$$block$$`
- **脚注**：`[^1]`
- **定义列表**：`term\n:   definition`
- **上标 / 下标**：`H~2~O`、`E=mc^2^`
- **高亮**：`==marked==`
- **容器**：`:::tip` / `:::warning` / `:::danger` / `:::info` / `:::note` / `:::details`
- **GitHub Alert**：`> [!NOTE/TIP/IMPORTANT/WARNING/CAUTION]` blockquote 自动映射为对应提示块（`--safe` 下也可用）
- **目录 (TOC)**：frontmatter `toc: true` 或正文 `[[toc]]` 占位符，自动生成 h2/h3 嵌套目录，锚点与 GitHub 兼容 slugify 对齐
- **Emoji**：`:smile:` 简码 + 直接的 Unicode emoji，全部用 Twemoji SVG 替换以保证跨平台一致

## 字体

默认使用系统字体链，不内嵌字体文件，避免 HTML 体积过大。

- 中文默认：`PingFang SC` → `Microsoft YaHei` → `Hiragino Sans GB` → `Heiti SC`
- 西文默认：`-apple-system` → `Segoe UI` → `Helvetica Neue` → `Arial`
- 等宽默认：`SF Mono` → `Menlo` → `Consolas` → `Liberation Mono` → `Courier New`

通过 `--font-cn / --font-en / --font-mono` 可覆盖字体族；字体需已安装在执行机器上。

## 工作流程（执行步骤）

1. **接收 Markdown 输入**：从用户消息、文件、或 AI 上一轮输出获取 md 文本，存入临时文件（如 `/tmp/render-input.md`）或用 stdin。
2. **选择主题**：根据用户语境选默认值
   - 微信 / 朋友圈 / 公众号 → `wechat`
   - 中文技术博客 → `juejin`
   - 论文 / 报告 → `academic`
   - 暗色演示 → `github-dark`
   - 其他默认 → `github`
3. **选择输出格式**：
   - 用户明确要求 `AVIF` 或 `JXL` / `JPEG XL` → `avif` 或 `jxl`
   - 用户说"图片 / 长图 / 截图"且未指定格式 → `png`
   - 用户说"PDF / 打印" → `pdf`
   - 其他 / 网页 → `html`
4. **执行渲染命令**（见上文 Core Command）。
5. **回传结果**：用附件或 HTML 预览把生成文件给用户。

## 实现要点（避免重复踩坑）

- `puppeteer-core` 已安装，**复用系统 Chrome / Chromium**，不要重新下载 Chromium；如自动探测失败，可通过 `--chrome` 指定浏览器可执行文件。
- 新环境或依赖报错时优先跑 `--check-env`：它会检查 Node 包、Chrome、`pdftoppm`、`avifenc`、`cjxl`、`magick`、`oxipng` 和主题文件；其中 `avifenc` 仅 AVIF 输出需要，`cjxl` 仅 JPEG XL 输出需要，`magick` 仅在 `--supersample > 1` 时需要，`oxipng` 仅在 `--optimize-png` 时需要，后两者都不影响默认位图流程。
- `shiki` 是 ESM-only，在 CJS 里通过 `require()` 加载会有 ExperimentalWarning，可忽略。
- **安全模式双轨**：默认兼容可信输入，保留 Markdown 原始 HTML、data URL 图片与 Mermaid `loose`；处理不可信输入时使用 `--safe`，会禁用原始 HTML、拦截 `javascript:` / `data:` 等高风险链接或图片协议、把 Mermaid 切到 `strict`，并在 HTML 里加入 CSP / no-referrer / 外链安全属性。`--trusted` 仅作为兼容逃生门，用于显式覆盖脚本模板中的 `--safe`。
- **资源模式双轨**：HTML 输出默认走 CDN（KaTeX / Mermaid / Twemoji 都从 jsdelivr 加载，本地图片保留原路径）让产物瘦到 ~6-80KB；`--standalone` 切到全内联 + Mermaid 预渲染 SVG + **数学公式转 MathJax SVG** 的零依赖模式，可信模式下本地图片也会转为 data URL（~10-190KB，另加图片体积），`--safe` 下不读取本地图片文件以避免本机文件泄露。CDN 版本号自动跟 `scripts/node_modules/<pkg>/package.json` 保持一致（`readPkgVersion` 读取），升级本地包时不需要同步改硬编码的 CDN URL。位图 / PDF 由于走 Puppeteer，**强制走内联**（`assetMode === 'inline'`）以避免弱网超时 / 字体异步导致渲染不稳定。
- **数学公式双路径**：
  - Standalone + HTML：利用 KaTeX HTML 产物里自带的 `<annotation encoding="application/x-tex">` 提取原始 LaTeX，用 `mathjax-full` 的 liteAdaptor 在 Node 端转成矢量 SVG（`fontCache: 'local'`，每个公式自带 defs），再把整块 `<span class="katex">` 替换掉。block 级公式包在 `<p class="katex-block">` 里，用正则整块替换；inline 级因为 `<span>` 嵌套，用 `SPAN_TOKEN` 深度计数才能找到对应 `</span>`。体积从之前 standalone 内联 KaTeX CSS + 20 个 woff2 字体的 ~400KB 降到 ~50KB（每个公式 4-6KB），同时注入 MathJax 的 ~2KB stylesheet。
  - CDN + HTML 或位图/PDF：保持 KaTeX。KaTeX 的 CDN CSS 能够被浏览器缓存，位图/PDF 的 KaTeX 渲染流程也已经成熟稳定。
  - 无公式时 `renderKatexToMathjaxSvg` 会直接 no-op（按 `class="katex` 正则快速跳出），不会初始化 MathJax，无额外开销。
- **KaTeX 按需注入**：仅当 body 真的出现 `class="katex` （且未被 MathJax 流程替换掉）时才插 `<link>` / 内联 CSS。纯 Markdown 文档（无公式）能在 standalone 下降到 ~7KB。
- **Mermaid 预渲染策略**：
  - `--standalone` / 位图 / PDF：默认开，Node 端启 puppeteer 调 `mermaid.render()` 把每张图预渲染成 SVG，HTML 中不再出现 `mermaid.min.js`。
  - HTML 默认 CDN 模式：默认关预渲染，让浏览器侧的 CDN runtime 渲染（省掉 Puppeteer 启动，产物更小更快）。
  - `--no-prerender-mermaid` 是所有模式下强制关闭的转义门（排障用）。
- KaTeX 字体在 standalone 模式下已不再内联（上述第 3 条）；仅当多步回退后 body 仍含 `class="katex` （极端例如 MathJax 重渲染全部失败）才退回到与以前一致的 base64 woff2 内联。
- HTML / 位图 / PDF 都默认使用系统字体链；若指定字体，确认执行机器已安装该字体。
- 表格使用紧凑字号与较小单元格 padding，适合宽表格压力场景。
- 位图/PDF 的代码块会按 `--wrap-code-column` 进行硬换行，并在换行位置追加 `↩` 标识；同时保留 CSS 自动换行兜底，优先保证长代码不被截断。HTML 保留横向滚动，便于复制阅读。
- 公式显示区域保留垂直 padding，避免 KaTeX 下沿被裁切。
- Mermaid Gantt 默认压缩日期格式为 `%m/%d`；样例中使用 `tickInterval 1week` 避免时间轴重叠。Mermaid 10.x 没有 `bottomPadding` 选项，X 轴 tick 文字会与最后一个 section 任务条垂直重叠：预渲染阶段会在 SVG 字符串上把 `g.tick` 与 `path.domain` 整体下移 28px，并扩展 viewBox/height 防裁剪（见 `fixGanttSvg`）。走 `--no-prerender-mermaid` 运行时路径时在 puppeteer 里做同样修正。
- Mermaid Journey 图的 SVG viewBox 上下预留大段空白（mermaid 10.x 默认顶 25px + 底 ~200px）；更关键的是它自带 `height="N"` 属性 + `preserveAspectRatio="xMinYMin meet"`，在预渲染后 SVG 被包进 `div.mermaid-svg`（外层选择器不再是 `.mermaid`），`.mermaid svg { height:auto }` 匹配失效 → SVG 盒子按固定 height 占位，而实际图形按 viewBox aspect 居中绘制，导致盒子内残留大段留白。修复分两层：
  - `_base.css` 补了 `.mermaid-svg svg { max-width:100%; height:auto; }`，让容器高度随 viewBox aspect 自适应——这是**根本修复**（所有 mermaid 图受益）。
  - 预渲染阶段把 SVG 临时挂到 puppeteer DOM、隐藏 `.task-line` 装饰虚线后调 `getBBox()` 量紧凑 bbox，再用 `fixJourneySvg()` 把 viewBox 收紧到 content + 12px padding，并按比例同步 `<svg height>` / `style height`——进一步消除 viewBox 两侧 + 底部 task-line 延伸带来的冗余空间。
- 位图/PDF 输出前会等待 `document.fonts.ready` + Mermaid `[data-processed]` + 300ms buffer，三重保障。
- 默认渲染视口宽度 900px；Chromium 的 `deviceScaleFactor` 保持 1（避免超长页 + 2x 时的底部重复 bug）。
- 位图高清输出**不走浏览器截图**，而是先生成单页连续 PDF，再用 `pdftoppm` 以 `96 * supersample` DPI 栅格化为中间 PNG。默认 `--supersample 1` 直接输出目标像素宽、无需 ImageMagick；显式 `--supersample > 1` 时才生成高清中间图，并通过 ImageMagick `LanczosSharp + unsharp` 文字锐化优先下采样回 `--width` 指定的最终像素宽。PNG 直接输出；AVIF/JPEG XL 会从最终 PNG 中间产物转码。默认位图流程只依赖 Poppler（`brew install poppler`），AVIF 额外依赖 libavif（`brew install libavif`），JPEG XL 额外依赖 `jpeg-xl`（`brew install jpeg-xl`），高清超采样才依赖 ImageMagick（`brew install imagemagick`）。
- PNG 默认不再运行 `oxipng`，避免普通流程依赖额外二进制。需要更小 PNG 体积时显式传 `--optimize-png`，会执行 `oxipng -o max --strip safe` 做**严格无损**重压（仅重排 IDAT + 删冗余元数据，不改动任何像素），通常再省 10%-30% 体积；`oxipng` 未安装或执行失败都只打 warning 跳过，不影响主流程。
- PDF 不使用 A4 分页，而是以 `--width` 作为页宽、按实际内容高度生成**单页 PDF**（类似长图），零边距；这样可以与位图输出保持一致的版面和硬换行位置，避免 A4 窄页导致代码/表格出现额外的软换行。
- `.markdown-body` 默认上下 32px、左右 16px 的窄留白（位图/PDF 全宽布局）。
- 位图/PDF 的代码硬换行**不再静态估算字符宽度**：第一遍渲染加载到 Puppeteer 后，会通过 DOM 实测 `pre` 内宽和当前等宽字体下一个字符的真实宽度（取实测内宽的 94%作为安全余量，避免 PDF 子集嵌入字体时实际字宽轻微偏大触发 CSS 二次软换行），得到列数后重做 Shiki 高亮 + buildHtml 并 reload，再生成 PDF/位图。这样切换 `--font-mono` 不会让换行位置失准。`--wrap-code-column` 显式数字仍然优先；`0` 或保留默认 `auto` 触发实测。
- `findWrapIndex` 仅在最后 12 字符内回溯断点，断点优先级分三档（空格/制表 > `,;)]}` > `.:|>`），避免在更早的弱断点处提前换行而浪费右侧空间。

## 引用文件

- `scripts/render.js` — 主脚本
- `scripts/themes/_base.css` — 通用基础样式
- `scripts/themes/<theme>.css` — 各主题样式
- `scripts/sample.md` — 自检样例（包含全部扩展语法，调试主题时直接渲染它）
- `references/usage.md` — 详细参数与样例

## 自检命令（调试主题或新加扩展时用）

```bash
cd <skill-dir>/scripts
npm test
```

`npm test` 会覆盖环境诊断、`--safe` / `--trusted` 行为、standalone Mermaid 预渲染、本地图片内联和基础位图输出。需要人工检查主题视觉效果时，再批量渲染五套主题：

```bash
for t in github github-dark juejin wechat academic; do
  node render.js --in sample.md --out ./md-$t.png --theme $t
done
```
