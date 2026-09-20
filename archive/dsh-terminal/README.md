> **已归档** —— 这是 Hayneko 站之前的那版站点原型，入口已不再是仓库根目录的
> `index.html`。所有绝对路径（`/styles/`、`/scripts/`、`/i18n/`、`/pages/`）
> 都已改成相对路径，所以整个文件夹可以独立打开：
> `python -m http.server 8125 --directory archive/dsh-terminal`
> 下面这份说明记录的是它当时的形态，里面的"两个站点"布局已经变了。

# dsh://terminal

科技风 / Linux Terminal 风格的单页站点。黑 + 白为主色, 红绿蓝三色点缀, 少量渐变;
动态几何背景由 Canvas 实时绘制; 页面切换无刷新; 顶栏悬停展开时, 导航链接带
**运动模糊 (smear) 拖影** 依次落下。

---

## 这个工作目录里有两个站点

| 目录 | 说明 |
| --- | --- |
| `./`（本目录） | **dsh://terminal** —— 新做的站点，也就是本 README 描述的这个 |
| `hayneko.github.io/` | **Hayneko's blog** —— 旧站，已用同一套风格重写；见它自己的 README |

两个站点各自独立：各有自己的 `index.html`、`styles/`、`scripts/`、`i18n/` 和
`scripts/check-i18n.mjs`，部署时互不依赖。根站的 checker 会跳过 `hayneko.github.io/`，
两个 checker 都跳过以 `.` 开头的临时目录。

`hayneko.github.io/pages/physics-sim/` 下的物理学学习页面保持原样未改动，
`hayneko.github.io/medias/` 里的旧样式与资源也保留（那些页面还在引用它们）。

### 一个值得记住的坑

两个站点原先都用 `document.documentElement.setAttribute('data-route', id)` 记录当前路由，
而点击拦截写的是 `closest('[data-route]')` —— 于是页面上**任何**一次点击都会向上命中
`<html>`，被误判成站内链接 `preventDefault()`，导致外链打不开、按钮跳转失效。
现在属性改名为 `data-route-current`，拦截器收紧为 `a[data-route]`。

---

## 运行

必须通过 HTTP 服务器打开(路由与语言包都依赖 `fetch`, `file://` 会被浏览器拦截):

```bash
# 任选一种
python -m http.server 8123
npx serve .
```

然后访问 <http://127.0.0.1:8123/index.html>。

---

## 目录结构

```
index.html                 单页外壳: 背景层 + 顶栏 + 路由容器 + 启动屏
style-gallery.html         旧地址, 自动重定向到 /index.html#/gallery

pages/                     路由片段(由 router.js 通过 fetch 注入 #page)
  home.html                首页
  tools.html               工具页(含可交互终端)
  contact.html             联络页(含表单校验)
  gallery.html             组件与配色一览

styles/
  root.css                 设计令牌(颜色 / 字体 / 动效 / 层级) + 重置
  layout.css               背景层、页面切换、启动屏、页脚、Toast
  header.css               顶栏 + 悬停展开导航 + smear 残影层
  general-components.css   按钮 / 卡片 / 徽章 / 表单 / 表格 / 终端窗
  pages.css                各页面专属布局

scripts/
  Internationalization.js  轻量 i18n 引擎(既有, 未改动)
  smear.js                 DOM 运动模糊引擎
  geometry-bg.js           Canvas 几何动态背景
  router.js                hash 路由 + 页面转场
  header-nav.js            顶栏展开 / 收起的动效编排
  terminal.js              工具页的可交互终端
  TitleChange.js           切到后台标签页时轮播提示文案
  app.js                   引导: 启动屏、强调色、语言、Toast、快捷键、表单
  check-i18n.mjs           语言包校验(已加强, 见下)

i18n/                      zh-CN / zh-TW / en-US, 三份 key 集合完全一致
```

---

## 三个核心机制

### 1. smear 运动模糊 (`scripts/smear.js`)

参照 `deepseek_html_20260920_db87c4_smear_motion_demo.html` 的思路, 把 canvas 版本
搬到 DOM 上:

1. 主元素沿轨迹运动(Web Animations API);
2. 按目标元素的**未变换布局位置**克隆出 N 个残影, 套用**同一组 keyframes**,
   但每个残影的 `delay` 依次 +lag 毫秒 —— 于是残影天然沿着轨迹滞后;
3. 越靠后的残影透明度按 `fade^i` 衰减、模糊半径按 `blur*i` 增长;
4. 残影统一 `mix-blend-mode: screen`(等价于 canvas 的 `'lighter'`), 叠加处更亮。

残影放在 `#smear-host`(`position: fixed`)里, 因此**不会被父级 `overflow: hidden` 裁掉**,
拖影可以飞出导航面板; 也统一使用视口坐标, 不需要处理 `offsetParent` 链。

调参入口: `Smear.play(el, keyframes, { duration, easing, delay, ghosts, lag, blur, fade, blend })`,
或直接用 `Smear.dropIn / liftOut / slideIn / popIn`。

`@media (prefers-reduced-motion: reduce)` 下自动不生成残影, 只保留主动画。

### 2. 几何动态背景 (`scripts/geometry-bg.js`)

全部由 canvas 逐帧绘制: 游走的 RGB 辉光团 → 透视网格与消失点 → 邻近图形连线 →
漂浮的线框多边形(自转 + 漂移, 顶点带小方块, 偶尔外扩脉冲)。图形数量随视口面积自适应,
DPR 上限 2, 页面不可见时暂停。路由切换时会 `GeometryBG.pulse()` 打一个扩散环。

### 3. 无刷新路由 (`scripts/router.js`)

hash 路由 + 片段缓存预取。切换时: 旧页面 `blur + 上移` 淡出 → 注入新片段 →
`i18n.apply()` 翻译 → 新页面淡入, 并对片段内所有 `[data-smear]` 元素按顺序播放 smear 入场。
顶栏路径、`<title>`、导航高亮、顶部 RGB 进度条同步更新。

---

## 交互

| 操作 | 效果 |
| --- | --- |
| 鼠标移到顶栏 / 点击顶栏 | 展开导航, 链接自上方带拖影依次落下 |
| `Esc` | 收起导航 |
| `Ctrl`/`Cmd` + `K` | 开关导航 |
| `g` 然后 `h` / `t` / `c` / `g` | 跳转到 主页 / 工具 / 联络 / 画廊 |
| 导航底部色点 | 切换强调色(红 / 绿 / 蓝), 记忆在 localStorage |
| 导航底部语言按钮 | 切换 zh-CN / zh-TW / en-US |
| 切到其它标签页 | 标题轮播提示文案, 回到页面后恢复 |

工具页的终端支持 `help`、`ls`、`cat <file>`、`whoami`、`date`、`echo`、`clear`、
`open <page>`、`b64`/`b64d`、`uuid [n]`、`json`、`sha256`、`accent <c>`、`neofetch`,
以及 ↑/↓ 历史与 Tab 补全。

---

## 语言包维护

```bash
node scripts/check-i18n.mjs
```

检查项:

1. HTML 用到但语言包缺少的 key;
2. 各语言包之间 key 是否一致;
3. **key 里是否出现字面量点号** —— `{ "a.b": "x" }` 会被拍平成 `a.b` 骗过第 1 项,
   但运行时的 `lookup()` 是按点号逐层下钻的, 实际取不到值。必须写成 `{ "a": { "b": "x" } }`;
4. 按运行时规则逐条解析, 结果必须是字符串;
5. 未使用的 key(提示)。

---

## 降级

- 关闭 JavaScript: 显示 `<noscript>` 说明。
- `prefers-reduced-motion: reduce`: 关闭 smear 残影与 Canvas 背景动画, CSS 过渡压缩到近 0。
- 片段加载失败: 在页面内渲染 `[ ENOENT ]` 提示并说明需要用本地服务器打开。
