# md-render 详细用法

本文记录 CLI 参数和常用示例。实现架构、渲染链路与维护注意事项见 `architecture.md`。

## 命令格式

```
node render.js --in <input> --out <output> [options]
```

## 参数清单

### 常用参数

| 参数 | 说明 | 默认 |
|---|---|---|
| `--in <path>` | 输入 md 文件，`-` 读 stdin | 必填 |
| `--out <path>` | 输出文件 | 必填 |
| `--format html\|png\|avif\|jxl\|pdf` | 显式指定格式，否则按后缀推断 | 自动 |
| `--profile <name>` | 按场景注入默认参数；显式 CLI 参数优先。可选：`github-doc` / `wechat-long` / `juejin-article` / `academic-pdf` / `dark-slide` / `safe-standalone` / `retina-image` | 无 |
| `--theme <name>` | github / github-dark / juejin / wechat / academic | github |
| `--width <px>` | 位图/PDF 的视口宽度（也是 PDF 页宽，也是默认最终位图像素宽）。最小限制为 375 | 900 |
| `--safe` | 不可信输入安全模式：禁用 Markdown 原始 HTML、拦截 `javascript:` / `data:` 等高风险链接或图片协议、Mermaid 使用 `strict`，并强化 HTML CSP / referrer / 外链属性 | false |
| `--standalone` | **仅 HTML 输出生效**：把 KaTeX / Mermaid / Twemoji 等资源内联，可信模式下把本地图片转成 data URL，生成零依赖 HTML；位图/PDF 始终走内联，不需要传该参数 | false |
| `--check-env` | 仅检查 Node 包、Chrome、`pdftoppm`、`avifenc`、`cjxl`、`magick`、`oxipng` 和主题文件，不执行渲染；其中 `avifenc` 仅 AVIF 需要，`cjxl` 仅 JPEG XL 需要，`magick` / `oxipng` 默认流程不需要 | false |

### 位图/PDF 高级参数

| 参数 | 说明 | 默认 |
|---|---|---|
| `--supersample <n>` | 位图内部超采样倍数：`1` = 关闭超采样（无需 `magick`）；`>1` 时 `pdftoppm` 先以 `width × n` 像素栅格化为中间 PNG，再用 ImageMagick 文字锐化优先下采样回 `width`；AVIF/JPEG XL 会从最终 PNG 中间产物转码 | 1 |
| `--wrap-code-column <n\|auto\|0>` | 位图/PDF 长代码硬换行列宽。`auto` = 在浏览器里实测当前字体下的真实宽度；显式数字优先；`0` 关闭硬换行 | auto |
| `--optimize-png` | 仅 PNG 生效：显式启用可选的 `oxipng` 无损重压以减小体积 | false |

### 样式高级参数

| 参数 | 说明 | 默认 |
|---|---|---|
| `--title <str>` | 文档标题（HTML `<title>`） | 输入文件名，或 frontmatter `title` |
| `--font-cn` | 中文字体覆盖 | 系统中文字体链 |
| `--font-en` | 英文字体覆盖 | 系统西文字体链 |
| `--font-mono` | 等宽字体覆盖 | 系统等宽字体链 |
| `--shiki-theme` | 代码高亮主题（shiki 主题 id），通常不需要手动指定 | 自动按主题选 |

### 调试 / 兼容参数

| 参数 | 说明 | 默认 |
|---|---|---|
| `--chrome <path>` | Chrome 可执行路径 | 自动探测 |
| `--keep-tmp` | 保留位图/PDF 渲染中间 HTML/PDF/PNG，便于排查 | 关闭 |
| `--trusted` | 兼容逃生门：默认已经是可信模式；仅用于显式覆盖命令模板中的 `--safe` | 默认 |
| `--no-prerender-mermaid` | 关闭 Mermaid Node 端预渲染，改走运行时 Mermaid，仅排查问题时使用 | false |
| `--no-downsample` | 旧版位图逃生门：保留超采样中间态作为最终输出；新用法更推荐直接增大 `--width` | false |

## Profile 预设

`--profile` 只填默认值，不覆盖显式 CLI 参数。格式优先级为：

```text
--format > --out 后缀 > profile 默认格式 > html
```

例如 `--profile wechat-long --out article.html` 仍然输出 HTML，但会使用 wechat 主题；`--profile wechat-long --out article.png --width 900` 会使用 `width=900`，而不是 profile 默认的 `720`。

| profile | 场景 | 默认格式 | 默认主题 | 默认参数 |
|---|---|---:|---|---|
| `github-doc` | README / 技术文档 / API 笔记 | `html` | `github` | `--width 900` |
| `wechat-long` | 微信公众号 / 朋友圈长图 | `png` | `wechat` | `--width 720 --wrap-code-column auto` |
| `juejin-article` | 掘金 / 中文技术博客 | `png` | `juejin` | `--width 900` |
| `academic-pdf` | 研究笔记 / 报告 | `pdf` | `academic` | `--width 900` |
| `dark-slide` | 暗色演示截图 / 终端配图 | `png` | `github-dark` | `--width 1200` |
| `safe-standalone` | 不可信输入 / 离线 HTML | `html` | `github` | `--safe --standalone` |
| `retina-image` | 高清长图 | `png` | `github` | `--width 1200 --supersample 2` |

## 常用案例

### 0. 环境诊断

新机器首次使用、或位图/PDF 报缺依赖时先跑：

```bash
$NODE render.js --check-env
```

### 0.1 回归测试

修改主题、渲染逻辑或安全模式后，运行内置 smoke/regression 测试：

```bash
cd <skill-dir>/scripts
npm test
```

该测试会覆盖环境诊断、`--safe` / `--trusted` 行为、standalone Mermaid 预渲染和基础位图输出。

### 1. AI 输出 → 微信公众号长图

```bash
echo "$AI_MARKDOWN" > /tmp/article.md
$NODE render.js --in /tmp/article.md --out /tmp/article.png --profile wechat-long
```

### 2. 技术文档 → PDF（单页长图式 PDF）

```bash
$NODE render.js --in doc.md --out doc.pdf --theme github
```

> 注：本工具的 PDF 输出是单页连续 PDF（按 `--width` 为页宽、实际内容高度为页高），排版与位图输出保持一致，不走 A4 分页。

### 3. 暗色演示稿截图

```bash
$NODE render.js --in slides.md --out slides.png --profile dark-slide
```

### 3.1 AVIF 图片输出

```bash
$NODE render.js --in article.md --out article.avif --theme github --width 900
```

### 3.2 JPEG XL 图片输出

```bash
$NODE render.js --in article.md --out article.jxl --theme github --width 900
```

### 4. 学术报告（衬线长图式 PDF）

```bash
$NODE render.js --in report.md --out report.pdf --profile academic-pdf
```

### 5. 用 stdin 输入（Pipe 模式）

```bash
cat input.md | $NODE render.js --in - --out out.html --theme juejin
```

### 6. 渲染不可信 Markdown（`--safe`）

处理外部用户提交、网页抓取或来源不明的 Markdown 时建议启用安全模式：

```bash
$NODE render.js --in input.md --out out.html --theme github --safe
```

该模式会禁用 Markdown 原始 HTML，拦截 `javascript:` / `data:` 等高风险链接或图片协议，Mermaid 使用 `strict` 安全级别，并为 HTML 加入 CSP、`no-referrer` 与外链安全属性。

### 7. 离线 / 弱网环境分发的 HTML（`--standalone`）

在 Telegram / 微信内置浏览器、内网、无外网环境下打开的 HTML，需要所有资源自包含：

```bash
$NODE render.js --in input.md --out out.html --theme github --standalone
```

该模式下所有资源都本地化：
- **Mermaid 图** → Node 端预渲染为静态 SVG
- **数学公式** → MathJax 重新渲染为矢量 SVG（不依赖 KaTeX CSS / 字体）
- **Twemoji emoji** → 本地 SVG 内联
- **本地图片** → 可信模式下转成 `data:` URL；`--safe` 下不读取本地图片文件（默认 CDN HTML 模式仍保留原图片路径）
- **CSS** → 全部内联

体积从 CDN 模式的 ~80KB 上升到 ~190KB（含公式/图表的典型文档），可信模式下会额外增加图片体积，但零外部请求。

## 自定义容器示例

```markdown
:::tip 友情提示
内容内容
:::

:::warning 注意
有风险
:::

:::danger 危险
不可逆
:::
```

## GitHub Alert 语法

与 GitHub 原生一致的 `> [!XXX]` blockquote 语法会自动映射到对应配色的提示块：

```markdown
> [!NOTE]
> 一般信息，中性灰。

> [!TIP]
> 最佳实践。

> [!IMPORTANT]
> 必须知道的关键信息。

> [!WARNING]
> 可能导致问题的风险。

> [!CAUTION]
> 破坏性 / 不可逆操作。
```

5 种 alert 分别复用 `.note / .tip / .info / .warning / .danger` 配色，与 `:::xxx` 容器语法视觉一致。**该语法在 `--safe` 模式下也可用**（不依赖原始 HTML）。

## 目录 (TOC)

两种触发方式任选其一，生成嵌套 h2/h3 目录：

```markdown
---
toc: true
---
# 文档标题
正文...
```

或在任意位置用占位符：

```markdown
# 文档标题

[[toc]]

## 章节甲
...
```

锚点与 `markdown-it-anchor` 的 GitHub 兼容 slugify 对齐，中文标题原样作为 id（`## 章节甲` → `id="章节甲"`），可手写 `[返回](#章节甲)` 跳转。

## 折叠块

用容器语法 `:::details`，输出原生 `<details><summary>`，在 `--safe` 模式下也安全可用：

```markdown
:::details 点击查看完整日志
```log
2024-01-01 12:00:00 INFO started
```
:::
```

省略标题时默认 summary 为"详情"。

## Mermaid 用法
