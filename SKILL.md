---
name: md-render
description: "当用户需要将 Markdown 渲染或转换为 HTML、位图图片（PNG、AVIF、JPEG XL）或单页 PDF 时使用本 Skill。适合 AI 生成内容、技术文档、长图分享、微信公众号文章、研究笔记、代码块、Mermaid 图表、KaTeX 数学公式、GitHub Alert、目录、emoji 和自定义提示块。内置 github、github-dark、juejin、wechat、academic、animal-island 主题，支持安全模式、standalone HTML、自定义字体和位图/PDF 调优。"
version: 1.0.0
agent_created: true
---

# md-render

把 Markdown 渲染成 **HTML / PNG / AVIF / JPEG XL / 单页 PDF**。优先用于高保真视觉输出、长图、离线 HTML 和技术文档截图。

## 何时使用

- 用户要求把 Markdown 转成 HTML、图片、长图、截图、PDF。
- 用户要求保存或分享 AI 输出，且内容包含代码、表格、公式、Mermaid、emoji、提示块。
- 用户要求微信公众号、知识星球、社交媒体长图。
- 用户要求断网可打开的自包含 HTML。

## 何时不用

- 仅需纯文本：直接写文件。
- 需要可编辑 Word、PPT、EPUB、ODT、LaTeX：优先使用对应文档/演示/通用转换工具。
- 需要多页 A4 排版：当前 PDF 是单页连续 PDF，不是分页打印 PDF。

## 快速决策

| 用户说法 | 输出 | 推荐主题 | 常用参数 |
|---|---:|---|---|
| 网页 / HTML / 预览 | `html` | `github` | `--profile github-doc` |
| 离线 HTML / 跨设备分发 | `html` | `github` | `--profile safe-standalone` |
| 图片 / 长图 / 截图 | `png` | 按内容选 | `--profile retina-image` 或按场景选 |
| 微信 / 公众号 | `png` | `wechat` | `--profile wechat-long` |
| 中文技术博客 | `png`/`html` | `juejin` | `--profile juejin-article` |
| 暗色演示图 | `png` | `github-dark` | `--profile dark-slide` |
| 论文 / 研究报告 | `pdf` | `academic` | `--profile academic-pdf` |
| 温暖圆润笔记 / 轻松分享 | `png`/`html` | `animal-island` | `--profile cozy-note` |
| AVIF / JPEG XL | `avif`/`jxl` | `github` | 需要对应编码器 |
| 不可信输入 | 任意 | 按内容选 | 加 `--safe` |

## 核心命令

```bash
cd <skill-dir>/scripts
node render.js \
  --in <input.md> \
  --out <output.{html,png,avif,jxl,pdf}> \
  [--format html|png|avif|jxl|pdf] \
  [--profile github-doc|wechat-long|juejin-article|academic-pdf|dark-slide|safe-standalone|retina-image|cozy-note] \
  [--theme github|github-dark|juejin|wechat|academic|animal-island] \
  [--width 900] \
  [--safe] \
  [--standalone] \
  [--check-env]
```

格式默认由 `--out` 后缀推断，显式 `--format` 优先。stdin 输入可用：

```bash
cat input.md | node render.js --in - --out out.png --theme wechat
```

## Profile 预设

`--profile` 用于常见场景的默认参数。优先级是：`--format` > `--out` 后缀 > profile 默认格式 > `html`；其它显式 CLI 参数也会覆盖 profile 默认值。

| profile | 场景 | 默认格式 | 默认主题 | 默认参数 |
|---|---|---:|---|---|
| `github-doc` | README / 技术文档 / API 笔记 | `html` | `github` | `--width 900` |
| `wechat-long` | 微信公众号 / 朋友圈长图 | `png` | `wechat` | `--width 720 --wrap-code-column auto` |
| `juejin-article` | 掘金 / 中文技术博客 | `png` | `juejin` | `--width 900` |
| `academic-pdf` | 研究笔记 / 报告 | `pdf` | `academic` | `--width 900` |
| `dark-slide` | 暗色演示截图 / 终端配图 | `png` | `github-dark` | `--width 1200` |
| `safe-standalone` | 不可信输入 / 离线 HTML | `html` | `github` | `--safe --standalone` |
| `retina-image` | 高清长图 | `png` | `github` | `--width 1200 --supersample 2` |
| `cozy-note` | 温暖圆润笔记 / 轻松分享 | `png` | `animal-island` | `--width 900` |

示例：

```bash
node render.js --in input.md --out article.png --profile wechat-long
node render.js --in input.md --out report.pdf --profile academic-pdf
node render.js --in input.md --out share.html --profile safe-standalone
node render.js --in input.md --out note.png --profile cozy-note
```

## 常用参数

- `--profile <name>`：按场景注入默认参数；显式 CLI 参数始终优先。
- `--safe`：处理外部用户提交、网页抓取、来源不明 Markdown 时使用。禁用原始 HTML，拦截高风险协议，Mermaid 使用 strict，并强化 CSP/referrer/link 属性。
- `--standalone`：仅 HTML 输出有意义。内联 CSS、Twemoji、Mermaid SVG、数学公式资源；适合离线和跨机器分发。
- `--width <px>`：位图/PDF 视口宽度，也是最终位图宽度；最小 375，默认 900。
- `--supersample <n>`：位图超采样，默认 1；大于 1 需要 ImageMagick。
- `--wrap-code-column auto|0|<n>`：位图/PDF 长代码硬换行；默认 auto，`0` 关闭。
- `--optimize-png`：用 `oxipng` 做可选无损压缩。
- `--title`、`--font-cn`、`--font-en`、`--font-mono`、`--shiki-theme`：样式覆盖。
- `--chrome`、`--keep-tmp`、`--trusted`、`--no-prerender-mermaid`、`--no-downsample`：调试/兼容参数，普通任务少用。

## 输出模式

| 模式 | 资源策略 | 场景 |
|---|---|---|
| 默认 HTML | KaTeX / Mermaid / Twemoji 走 jsdelivr CDN | 有网络的轻量预览 |
| `--standalone` HTML | CSS、Mermaid、Twemoji、数学公式等内联 | 离线、微信内置浏览器、跨设备分发 |
| 位图 / PDF | 始终使用内联资源 | 稳定截图，避免外部资源超时 |

## 支持语法

- GFM：表格、删除线、自动链接、任务列表。
- 代码高亮：Shiki。
- 图表：Mermaid fenced code block。
- 数学公式：`$inline$` 和 `$$block$$`。
- 脚注、定义列表、上标、下标、高亮。
- 自定义容器：`:::tip` / `:::warning` / `:::danger` / `:::info` / `:::note` / `:::details`。
- GitHub Alert：`> [!NOTE]`、`> [!TIP]`、`> [!IMPORTANT]`、`> [!WARNING]`、`> [!CAUTION]`。
- 目录：frontmatter `toc: true` 或正文 `[[toc]]`。
- Emoji：`:smile:` 简码和 Unicode emoji，使用 Twemoji 保持跨平台一致。

## 执行流程

1. 接收 Markdown：来自用户消息、文件、上一轮 AI 输出或 stdin。
2. 判断输入可信度：外部/未知来源一律加 `--safe`。
3. 选择输出格式：图片默认 `png`，PDF 默认 `pdf`，网页默认 `html`。
4. 选择主题：微信用 `wechat`，中文技术博客用 `juejin`，论文报告用 `academic`，暗色演示用 `github-dark`，温暖圆润笔记用 `animal-island`，其他用 `github`。
5. 首次运行或失败时执行 `node render.js --check-env`。
6. 渲染后确认输出文件存在且非空，再把路径或附件返回给用户。

## 失败恢复

- 缺 Chrome/Chromium：传 `--chrome <path>`，不要让 Puppeteer 下载新 Chromium。
- PNG/位图失败且提示 `pdftoppm`：安装 Poppler 后重试。
- AVIF/JXL 失败：分别需要 `avifenc` / `cjxl`。
- `--supersample > 1` 失败：需要 ImageMagick；或改回 `--supersample 1`。
- Mermaid 预渲染失败：可临时加 `--no-prerender-mermaid` 排查。
- 输出包含不可信来源内容：优先保留 `--safe`，不要用 `--trusted` 放宽。

## 引用文件

- `scripts/render.js`：主 CLI。
- `scripts/sample.md`：综合自检样例。
- `scripts/themes/_base.css`：通用样式。
- `scripts/themes/<theme>.css`：主题样式。
- `references/usage.md`：完整参数与示例。
- `references/architecture.md`：实现架构、渲染链路和维护注意事项。

## 自检

```bash
cd <skill-dir>/scripts
npm test
```

需要人工检查主题视觉效果时：

```bash
for t in github github-dark juejin wechat academic animal-island; do
  node render.js --in sample.md --out ./md-$t.png --theme $t
done
```
