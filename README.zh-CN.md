## md-render

[English](README.md) | **简体中文**

`md-render` 是一个 Markdown 渲染 skill 和 CLI 工具，可将 Markdown 文档转换为 **HTML**、**位图图片** 或 **单页 PDF**。

图片输出支持 **PNG**、**AVIF** 和 **JPEG XL**。

它面向 AI 生成的 Markdown 和技术文档，适合渲染表格、任务列表、代码块、Mermaid 图表、数学公式、提示块、自定义容器、脚注和 emoji 等内容。

## 功能特性

- **多种输出格式**：HTML、PNG、AVIF、JPEG XL 和 PDF。
- **五套内置主题**：`github`、`github-dark`、`juejin`、`wechat` 和 `academic`。
- **扩展 Markdown 支持**：
  - GFM 表格、任务列表、删除线和自动链接
  - Shiki 代码高亮
  - Mermaid 图表
  - KaTeX / MathJax 数学公式渲染
  - 脚注和定义列表
  - 上标、下标和高亮文本
  - GitHub 风格 Alert
  - `tip`、`warning`、`danger`、`info`、`note`、`details` 等自定义容器
  - 基于 Twemoji 的 emoji 渲染
- **安全渲染模式**，适合处理不可信 Markdown。
- **Standalone HTML 模式**，适合离线或跨设备分发。
- **基于系统 Chrome / Chromium 的位图图片和 PDF 渲染**，通过 `puppeteer-core` 实现。

## 目录结构

```text
.
├── SKILL.md                 # Agent 使用的 skill 指令
├── README.md                # 英文说明
├── README.zh-CN.md          # 中文说明
├── LICENSE                  # 个人使用、禁止商用的自定义协议
├── references/
│   └── usage.md             # 详细 CLI 用法和示例
└── scripts/
    ├── render.js            # 主渲染 CLI
    ├── sample.md            # 用于冒烟测试的虚构样例文档
    ├── test-smoke.js        # 冒烟 / 回归测试
    ├── package.json         # Node.js 依赖和 npm scripts
    └── themes/              # 内置 CSS 主题
```

## 环境要求

- Node.js
- npm
- 系统中可用的 Chrome 或 Chromium
- Poppler 提供的 `pdftoppm`，用于生成位图图片
- 可选：libavif 提供的 `avifenc`，用于 AVIF 输出
- 可选：JPEG XL 工具提供的 `cjxl`，用于 JPEG XL 输出
- 可选：ImageMagick，用于位图超采样工作流
- 可选：`oxipng`，用于 PNG 无损优化

> 本项目使用 `puppeteer-core`，不会自动下载 Chromium。如果无法自动检测 Chrome 或 Chromium，可通过 `--chrome` 指定浏览器可执行文件路径。

## 快速开始

安装依赖：

```bash
cd scripts
npm ci
```

检查本地渲染环境：

```bash
npm run check-env
```

将样例文档渲染为 HTML：

```bash
node render.js --in sample.md --out output.html --theme github
```

将样例文档渲染为 PNG 长图：

```bash
node render.js --in sample.md --out output.png --theme github --width 900
```

将样例文档渲染为 AVIF：

```bash
node render.js --in sample.md --out output.avif --theme github --width 900
```

将样例文档渲染为 JPEG XL：

```bash
node render.js --in sample.md --out output.jxl --theme github --width 900
```

将样例文档渲染为单页 PDF：

```bash
node render.js --in sample.md --out output.pdf --theme academic
```

## CLI 用法

```bash
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

默认会根据 `--out` 的文件后缀推断输出格式；显式传入 `--format` 时，以 `--format` 为准。

也可以从 stdin 读取 Markdown：

```bash
cat input.md | node render.js --in - --out output.html --theme juejin
```

## 常用示例

安全渲染不可信 Markdown：

```bash
node render.js --in input.md --out output.html --theme github --safe
```

生成适合离线分发的自包含 HTML：

```bash
node render.js --in input.md --out output.html --theme github --standalone
```

生成暗色主题图片：

```bash
node render.js --in input.md --out output.png --theme github-dark --width 1200
```

生成 AVIF 图片：

```bash
node render.js --in input.md --out output.avif --theme github --width 900
```

生成 JPEG XL 图片：

```bash
node render.js --in input.md --out output.jxl --theme github --width 900
```

生成文档风格 PDF：

```bash
node render.js --in input.md --out output.pdf --theme academic
```

## 主题

| 主题 | 推荐场景 |
|---|---|
| `github` | 技术文档、README、API 说明 |
| `github-dark` | 暗色截图或演示素材 |
| `juejin` | 中文技术文章 |
| `wechat` | 社交分享或文章风格长图 |
| `academic` | 研究笔记、报告和正式文档 |

## 安全说明

默认情况下，渲染器会将 Markdown 视为可信输入，以兼容更丰富的内容。

当 Markdown 来自外部用户、网页抓取结果或未知来源时，请使用 `--safe`。安全模式会禁用 Markdown 原始 HTML，拦截 `javascript:`、`data:` 等高风险 URL 协议，使用更严格的 Mermaid 渲染模式，并为 HTML 增加额外的安全属性。

当 HTML 输出需要跨设备分发、离线打开或避免依赖外部网络时，请使用 `--standalone`。Standalone 模式会将 Mermaid 图表、数学公式、Twemoji 资源和 CSS 等内容嵌入到生成的 HTML 中。

## 测试

运行冒烟 / 回归测试：

```bash
cd scripts
npm test
```

测试会覆盖环境检查、安全与可信渲染行为、Standalone Mermaid 预渲染、本地图片处理和基础位图输出。

## 更多文档

完整命令参数、高级渲染选项和更多示例见 `references/usage.md`。

## 隐私

仓库中的样例内容应保持虚构和非个人化。请避免提交生成物、本地依赖、日志、临时文件、密钥、凭据或机器相关路径。

## License

本项目使用自定义的个人使用、禁止商用协议。详见 `LICENSE`。
