# archive

这里存放**不参与部署**的历史文件。

## dsh-terminal

`dsh://terminal` —— 在 Hayneko 站之前做的那版本人站点原型。
科技风 / 终端风格、Canvas 几何背景、smear 运动模糊，四个页面（首页 / 工具 / 联络 / 风格画廊）。

保留原因：里面的交互终端、smear 引擎和 canvas 背景是现在 Hayneko 站的基础，
需要时可以回来对照。

**它已不再是站点入口**：所有绝对路径（`/styles/`、`/scripts/`、`/i18n/`、`/pages/`）
都已经改成相对路径，所以这一整个文件夹可以独立打开：

```bash
python -m http.server 8125 --directory archive/dsh-terminal
```

放在 `archive/` 下意味着它不会被根站的构建 / 校验脚本扫到，也不会被部署。

## web-v5-terminal-20260128-01

2026 改版(日式编辑排版 x 瑞士国际主义网格)**之前**的那一版完整快照:
终端 / 科技风, 黑底白字 + 红绿蓝三原色, 背景是 Canvas 画的 **ASCII 字符网格**
(3D 星球 + `MIKU ICHINOSE` 字形 + CRT 扫描线), 底部是 macOS 风格的玻璃 Dock。

包含:

| 路径 | 内容 |
| --- | --- |
| `index.html` | 旧版单页外壳(含 `#bg-canvas` 与注入 `geometry-bg.js` 的三行) |
| `styles/` | 旧版 10 张样式表(tokens / base / header / components / dock / pages / games / motion / lab / labs-vm) |
| `views/` | 旧版全部页面片段 |
| `i18n/` | 改版前的五个语言包 |
| `scripts/` | 改版时动过的五个脚本(`smear.js` / `motion.js` / `header-nav.js` / `app.js` / `router.js`)的改前版本 |
| `README-VISUAL-ascii-background.md` | 旧版 README 里"视觉：三色 + ASCII 背景"整节(四段式动画的完整说明) |

> 注意: 根站的 `scripts/geometry-bg.js` **没有被删掉**, 它还在原地, 只是新版 `index.html`
> 不再加载它。要恢复旧背景, 恢复 `index.html` 里的 `#bg-canvas` 与那段动态注入即可。
