# Hayneko

个人站点。**terminal / 科技风**：黑 + 白为主色、红绿蓝点缀，动态几何 Canvas 背景，
无刷新页面切换，底部 macOS 风格的 Dock，还有一个真的能用的终端。

> 本站原先是 `hayneko.github.io/` 子目录，现在整个搬到了仓库根目录，
> `index.html` 就是入口。原先放在根目录的那版 `dsh://terminal` 原型已归档到
> `archive/dsh-terminal/`（见 `archive/README.md`），没有删除。

---

## 运行

必须通过 HTTP 服务器打开 —— 路由与语言包都依赖 `fetch`，直接双击 `index.html`
（`file://`）会被浏览器拦住。

**最省事的方式：双击仓库根目录的 `serve.cmd`**，它会起一个服务并自动打开浏览器：

```
http://127.0.0.1:8123/
```

手动起也可以：

```bash
python -m http.server 8123 --bind 127.0.0.1
```

> ⚠️ **服务器不能关。** 关掉之后页面因为浏览器缓存看着还在，
> 但点任何**新**链接（物理实验室、资源下载）都会报 `ERR_CONNECTION_REFUSED` ——
> 因为它们要真的去请求服务器。

旧站原型仍可单独打开：

```bash
python -m http.server 8125 --directory archive/dsh-terminal
```

---

## 目录结构

```
index.html              单页外壳: 背景层 + 顶栏 + 路由容器 + 启动屏
archive/                不参与部署的历史文件
  README.md               归档说明
  dsh-terminal/           旧的 dsh://terminal 原型(路径已改成相对, 可独立打开)
styles/                 设计层
  tokens.css              设计令牌 + Dock 令牌 + 浅色主题
  base.css                背景层、页面转场、启动屏、页脚、Toast
  header.css              顶栏 + 悬停展开导航 + smear 残影层
  components.css          按钮 / 卡片 / 徽章 / 表单 / 表格 / 终端窗
  dock.css                Dock 与弹出菜单
  pages.css               各页面布局 + 交互终端样式
  motion.css              滚动入场 / 涟漪 / 卡片高光 / 主题擦除 / 路由扫描带
scripts/
  i18n.js                 轻量 i18n 引擎
  smear.js                DOM 运动模糊引擎(含 ghostsOnly 模式)
  geometry-bg.js          Canvas 几何动态背景(支持深浅主题)
  motion.js               入场编排 + 交互反馈动效
  router.js               hash 路由 + 页面转场
  header-nav.js           顶栏展开/收起编排
  terminal.js             交互终端
  dock.js                 Dock: 图标、菜单、粒子、主题、搜索
  app.js                  引导
  check-i18n.mjs          语言包校验(含 JS 引用扫描与运行时解析校验)
views/                  NEW  路由片段
  home.html  terminal.html  storage.html  lab.html  links.html
i18n/                   NEW  en / zh-CN / zh-TW / ja / ko (key 集合完全一致)

pages/physics-sim/      未改动 —— 三个物理学学习页面, 样式保持原样
pages/selfpag/          未改动
medias/                 未改动 —— 图片 / 字体 / 文件 / 旧 CSS 与脚本
```

> `medias/css/root.css`、`index.css`、`dock.css`、`main-page.css` 等旧样式文件
> **刻意保留未动**：`pages/physics-sim/phy-default` 与 `phy-lens` 仍在引用它们。
> 新站使用 `styles/` 下的新样式层，二者互不影响。

---

## 页面

| 路由 | 内容 |
| --- | --- |
| `#/home` | 头像、邮箱、兴趣、游戏、项目 |
| `#/terminal` | 交互终端（见下） |
| `#/storage` | 资源下载（含失效条目标注） |
| `#/lab` | 三个物理模拟的入口 + 参考文档 |
| `#/links` | 友情链接（目前为空） |

`pages/storage-list.html` 保留为旧地址的重定向，老链接不会失效。

---

## 终端

`scripts/terminal.js` + `views/terminal.html`。命令：

`help`、`ls`、`cat <file>`、`whoami`、`date`、`echo`、`clear`、`open <page>`、
`sim [n]`（打开物理模拟）、`theme dark|light`、`accent red|green|blue`、
`b64` / `b64d`、`uuid [n]`、`json`、`sha256`、`neofetch`。

支持 ↑/↓ 历史与 Tab 补全；虚拟文件系统内容在 `VFS` 里（about.md / contact.txt / sims.txt）。

---

## Dock

| 位置 | 项 | 行为 |
| --- | --- | --- |
| 左 | 头像 | 点击迸发粒子并回到首页 |
| | 首页 / 终端 / 资源下载 / 物理实验室 / 友情链接 | 站内路由 |
| | 搜索 | 打开搜索菜单（索引覆盖页面与模拟）|
| | 联系 | GitHub / Instagram / 邮箱 |
| | 语言 | en / zh-CN / zh-TW / ja / ko |
| | 主题 | 深色 ⇄ 浅色（整屏渐变擦除，记忆在 localStorage，兼容旧的 `preferredTheme`）|
| | 项目 | 打开 GitHub |
| | 相册 | 占位（提示尚未开放）|
| 右 | 状态 | 等宽的 `online <locale>` |

菜单从 Dock 上方展开，菜单项用 `--i` 依次错位入场。

---

## 动效

### 入场编排（`Motion.entrance`）

页面注入后，`[data-smear]` 元素分两类处理：

- **在视口里的** —— 立刻按顺序播 smear 入场（`drop` / `slide` / `pop`）；
- **在视口外的** —— 交给 `IntersectionObserver`，**滚动到眼前时才播**。

这一条很关键：以前所有元素都在注入那一刻一起播完，首屏之外的等于白播，
所以页面越长越显得"没有动画"。现在往下滚，内容才会一个个到位。

配套的 `html.fx-ready [data-smear]:not(.is-revealed) { opacity: 0 }` 只在
JS 可用且非降级时生效；另有 8 秒兜底，避免任何元素卡在隐藏状态。

### 其它

- **标题逐字入场**：`[data-fx-split]` 的标题会拆成单字，按 34ms 依次带模糊落下；
  切语言时会重新拆一次，不会重复；
- **标题下划线**：`.section__title` / `.page-head__title` 入场时一道 RGB 细线扫开；
- **卡片跟随高光**：`.card` / `.sim-card` / `.profile-card` 等的高光跟着指针走；
- **按钮扫光**：hover 时一道高光横扫过按钮；
- **悬停放大 / 按下缩小**（统一规则，**不带位移**）：
  `.btn` 1.05 / 0.93，卡片 1.022 / 0.99，`.dock__item` 1.14 / 0.88，
  徽章与终端 chip 1.08，列表行 1.006；曲线用 `--ease-pop` 带一点回弹。
  > **坑 1**：入场用的是 `fill:'both'` 的 WAAPI 动画，跑完后它会一直占着
  > `transform`，CSS 的 `:hover` 根本盖不过去 —— 卡片悬停不放大就是这个原因。
  > 所以 `motion.js` 在动画结束后会立刻 `dispose()` 把控制权还给 CSS。
  >
  > **坑 2**：`.card:hover` 原来会换成另一个 `linear-gradient` 背景。
  > 渐变**不能插值**，所以鼠标一上去底色是"啪"地跳一下。现在卡片悬停不再换背景，
  > 变亮改由 `::after` 叠一层可过渡的 `--tint-hover` 承担。
- **悬停描边（画一圈，再原路退回）**：`.btn` / `.badge` / 终端 chip / `.dock__item`
  悬停时，一圈 2px 高光**从 12 点方向顺时针逐渐画出来**，移开鼠标后**沿同一条路径退回去**，
  不是一直转圈。做法是把画笔长度注册成可插值的自定义属性：

  ```css
  @property --fx-draw { syntax: '<percentage>'; initial-value: 0%; inherits: false; }
  /* 悬停 → --fx-draw: 100%，靠 transition 在 680ms 内插值 */
  ```

  实测（每帧读 `--fx-draw`）：画 `39ms:0.1% → 139ms:9.1% → 305ms:64.6% → 522ms:95.4%`，
  退回 `605ms:97.6% → 706ms:88.3% → 823ms:48.6% → 1055ms:5.9%`。
  不支持 `@property` 时降级为"直接出现一整圈"；
- **位移时的运动模糊**：任何涉及 `transform` / `padding-left` / `top` / `left` 的过渡一开始，
  `motion.js` 就给元素挂上 `.is-moving`（约 0.45–0.9px 的模糊），过渡结束再摘掉。
  悬停放大、按下缩小、列表行缩进因此都带上拖影感；
- **Dock 底部滑动光点**：坞底部只有一个光点，鼠标划到哪个图标就跟到哪个，
  移出坞后回到当前页面对应的图标下面。移动时它横向拉长到 **5.5 倍**、加 1.3px 模糊，
  并用 9 层 `box-shadow` 甩出一条 **约 180px 长**的拖影（`--dir` 决定方向），
  停下后再花约 340ms 淡回一个圆点；
- **按下涟漪**：`.btn` / `.card` / `.file-row` / `.dock-menu__item` 等按下时从指针位置扩散一圈；
- **主题擦除**：切换主题时整屏渐变擦过，前沿有一条 RGB 亮边；
- **主题图标交叉淡入**：月亮 ⇄ 太阳 旋转缩放切换；
- **路由扫描带**：切页面时一道很淡的扫描带自上而下掠过；
- **Dock 激活弹跳 / 语言球旋转**；
- 终端输出行逐行淡入，终端表面叠了一层极淡扫描线。

---

## 动效偏好（减少动态效果）

系统 / 浏览器开了「减少动态效果」时，`scripts/motion-pref.js` 会给 `<html>` 挂上
`reduce-motion` 与 `data-motion`，CSS 与各动效模块（smear / geometry-bg / motion）都读它。

> **踩过一个很深的坑，记在这里。** 原先写的是
>
> ```css
> @media (prefers-reduced-motion: reduce) {
>   *, *::before, *::after {
>     transition-duration: 0.001ms !important;
>     animation-duration: 0.001ms !important;
>     animation-iteration-count: 1 !important;
>   }
> }
> ```
>
> 这条规则把**所有**过渡和循环动画一刀切了。实测（headless 里模拟 reduce）：
> `btn transition-duration` 变成 `1e-06s`，描边高光的 `animation-name` 变成 `none`。
> 于是悬停放大是"啪"地跳、描边高光定在原地不动 —— 看起来完全像"没有动画"。
> 开着「减少动态效果」的人看到的正是这个样子。

现在只关掉真正可能引起不适的**大幅 / 长时间**动效：

| 保留 | 关闭 |
| --- | --- |
| 悬停放大、按下缩小 | 页面切换的整屏位移 + 模糊 |
| 颜色 / 边框 / 阴影过渡 | 入场 smear 拖影、逐字标题 |
| 描边高光绕圈 | 主题整屏擦除、路由扫描带 |
| 卡片跟随高光、涟漪 | Canvas 背景漂移、CRT 扫描线、粒子 |

想要全部打开：

```
index.html?motion=full    # 打开全部动效并记住
index.html?motion=reduce  # 强制减弱
index.html?motion=auto    # 恢复跟随系统
```

系统处于 reduce 时首次打开会弹一条提示，里面直接带「开启完整动效」按钮。

---

## 顶栏的收放同步

```css
--nav-dur: 480ms;
--nav-ease: cubic-bezier(0.15, 1, 0, 1);
```

### 时长约定

所有动效**单个不超过 0.5s**：`--dur-4` = 500ms（顶栏箭头 / 卡片 / 进度条），
整屏转场 `page-in` = 500ms，描边画圈 = 500ms，光点移动 = 500ms，
涟漪 / 扫描带 / 图标旋转 = 500ms，悬停与按下 220–300ms。
入场 smear 的 drop / slide / pop 也统一到 500ms。

### 交互式终端

`views/terminal.html` + `scripts/terminal.js`，**43 个命令**，Tab 补全、上下键翻历史、
支持单/双引号（引号里的空格不会被拆开）。

| 分组 | 命令 |
| --- | --- |
| 文件 / 导航 | `help` `man <cmd>` `ls` `tree` `cat <file>` `open <page>` `sim [n]` `clear` |
| 编码 / 哈希 | `b64` `b64d` `hex` `unhex` `url` `urldecode` `hash [sha1\|sha256\|sha384\|sha512]` `json` |
| 数字 / 时间 | `calc` `base` `ts` `uuid` `pass` `color` `cron` |
| 文本 | `text <op>` `count` `lorem` |
| 系统 | `whoami` `date` `history` `env` `theme` `accent` `neofetch` |
| 彩蛋 | `matrix` `sudo` `vim` |

几个值得一试的：

```
calc (1+2)*3^2          27          base 0xff      dec 255 / 0xFF / 0o377 / 0b1111 1111
calc sqrt(2)            1.414213562373             color #3ce07b  带色块预览
calc 0.1+0.2            0.3         ts 0           1970-01-01T00:00:00.000Z
hash sha256 abc         ba7816bf...                cron "*/15 9-17 * * 1-5"  含接下来 3 次运行时间
pass 20 -s              用 crypto 取无偏随机
```

`calc` 是手写的递归下降求值器（**不用 `eval`**），支持 `+ - * / % ^`、括号、
`sqrt/abs/round/floor/ceil/sin/cos/tan/log/exp`、`pow/min/max`、`pi`/`e` 和 `0x` 字面量。

> `help` 的分组表是唯一事实来源，`man` 也读它，加命令时改一处即可。

> **修掉的一个老 bug**：下面的快捷 chip（`.term-suggest`）以前**点了没反应**。
> 原因是 `mountAll()` 用 `root.querySelectorAll('[data-cmd]')` 找按钮，
> 而 `root` 是 `[data-terminal]`（即 `.term` 本身），chip 是它的**兄弟节点**，
> 根本不在里面 —— 查出来永远是空的。现在从外层 `.section` 里找再传给 `create()`。

### 路径

站内所有资源都写成**相对路径**（`styles/…`、`views/…`、`pages/…`、`medias/…`），
所以整个目录挂到任何位置（域名根目录、子目录）都能用。
只有 `pages/physics-sim/` 与 `pages/selfpag/` 里的旧页面仍是绝对路径，
它们是**刻意不改动**的，必须从站点根目录提供服务。

- 面板底（`scaleY`）与导航项（`opacity` + `translateY`）时长、曲线完全一致；
- 错位（`transition-delay`）只写在 `.is-open` 里 —— CSS 过渡取"变化后"的 delay，
  所以**只有展开会依次落下，收起时所有内容同一时刻消失**；
- 展开时额外叠一层 smear 拖影（`smear.js` 的 `ghostsOnly` 模式），
  主元素交给 CSS，拖影由 JS 生成；收起时立即 `dispose`，屏幕上不留残留。

---

## 两个容易踩的坑（已修，留个记录）

1. **`data-route` 不要挂到 `<html>` 上。**
   曾经用 `document.documentElement.setAttribute('data-route', id)` 记录当前路由，
   而点击拦截写的是 `e.target.closest('[data-route]')` —— 于是**页面上任何一次点击**
   都会向上找到 `<html>`，被当成站内链接 `preventDefault()` 掉，
   结果 dock 按钮切不动页面、所有外链/下载都点不开。
   现在属性叫 `data-route-current`，拦截器也收紧成 `a[data-route]`。

2. **同一套 `.is-moving` 不要被两个地方抢。**
   光点的 `.is-moving` 本来由 dock.js 管（它还要设 `--dir` / `--ind-stretch`），
   而 motion.js 的通用运动模糊又按 `transitionrun` 给它加同一个类。
   `--ind-stretch` 一变 transform 就变 → 又触发一次 `transitionrun` → 再加类……
   两边互相触发成了死循环，光点会一直抖。现在 `MOVE_SELECTOR` 明确排除 `.dock__indicator`。

3. **`i18n.apply()` 会派发 `i18n:applied`。**
   如果监听 `i18n:applied` 的回调里又调用 `i18n.apply()`，就会无限递归爆栈。
   现在 `renderSearch()` 不再调用 `apply`，并且加了再入保护。

---

## 语言包维护

```bash
node scripts/check-i18n.mjs
```

检查：HTML 缺 key / 语言包不一致 / key 里出现字面量点号 /
运行时能否解析成字符串 / **JS 里以字符串引用的 key 是否存在** / 未使用的 key。

---

## 降级

- 关闭 JavaScript：显示 `<noscript>` 说明。
- `prefers-reduced-motion: reduce`：关闭 smear、涟漪、扫描带与主题擦除。
- 片段加载失败：页面内渲染 `[ ENOENT ]` 提示。
- Service Worker：旧站注册过、缓存的是旧文件列表，新 `index.html` 会主动注销它。
