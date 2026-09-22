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
  games.css               小游戏页: 卡片架 + 俄罗斯方块机台
  motion.css              滚动入场 / 涟漪 / 卡片高光 / 主题擦除 / 路由扫描带
scripts/
  i18n.js                 轻量 i18n 引擎
  smear.js                DOM 运动模糊引擎(含 ghostsOnly 模式)
  geometry-bg.js          Canvas 几何动态背景(支持深浅主题)
  motion.js               入场编排 + 交互反馈动效
  router.js               hash 路由 + 页面转场
  header-nav.js           顶栏展开/收起编排
  terminal.js             交互终端
  games.js                小游戏引擎(俄罗斯方块) + 机台挂载
  dock.js                 Dock: 图标、菜单、粒子、主题、搜索
  app.js                  引导
  check-i18n.mjs          语言包校验(含 JS 引用扫描与运行时解析校验)
views/                  NEW  路由片段
  home.html  terminal.html  storage.html  lab.html  games.html  links.html
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
| `#/games` | 小游戏（目前只有俄罗斯方块, 见下） |
| `#/links` | 友情链接（目前为空） |

`pages/storage-list.html` 保留为旧地址的重定向，老链接不会失效。

---

## 终端

`scripts/terminal.js` + `views/terminal.html`。命令：

`help`、`ls`、`cat <file>`、`whoami`、`date`、`echo`、`clear`、`open <page>`、
`sim [n]`（打开物理模拟）、`theme dark|light`、`accent red|green|blue`、
`b64` / `b64d`、`uuid [n]`、`json`、`sha256`、`neofetch`。

支持 ↑/↓ 历史与 Tab 补全；虚拟文件系统内容在 `VFS` 里（about.md / contact.txt / sims.txt / games.txt）。

> **显示区域调大了。** `.term` 的高度从 `clamp(340px, 52vh, 480px)` 提到
> `clamp(430px, 68vh, 780px)` —— 1280×950 实测窗口高 **646px**、输出区 **555px**（原来封顶 480px）。
> 手机上换成 `clamp(360px, 62dvh, 620px)`：用 `dvh` 是因为地址栏收起/展开时 `vh` 会跳。
> 另外手机端 `.term__input` 给到 **16px** —— iOS 上输入框小于 16px 时，一聚焦就把整页放大。

---

## 小游戏

`views/games.html` + `scripts/games.js` + `styles/games.css`，路由 `#/games`。
目前只有俄罗斯方块，但页面是按"多款"搭的：上面是卡片架，下面是机台，
`games.js` 里的 `GAMES` 是唯一事实来源（卡片、dock 搜索、终端 `games` 命令都读它）。

三个入口走的是同一个引擎：

| 入口 | 行为 |
| --- | --- |
| dock 的「小游戏」按钮 / 顶栏 `05 Games` / `g` `g` | 进 `#/games`，机台停在 ready，等你按开始 |
| 卡片上的 `Play` | 进页面并把机台滚到眼前，直接开局 |
| 终端 `play tetris`（`games` 只列清单） | 同上，而且能带标志位（见下）—— 命令行也能开局 |

### 命令行标志位

`play tetris` 支持两个开关，**只对这一次开局有效**：

| 标志位 | 效果 |
| --- | --- |
| `--easy-mode` | **不加速**：等级固定 1，下落间隔恒为 800ms（`EASY_GRAVITY_MS`） |
| `--with-roll-back` | 多一个**撤回**按钮（触屏多一个 ↶ 键，键盘 `U`）：退回上一块落子之前 |

```
play tetris --easy-mode --with-roll-back
```

开了标志位的机台，标题栏会挂上 `EASY` / `UNDO` 小牌子，免得忘了自己在什么模式下玩。
不认识标志位会直接报错并列出可用的两个（`play: unknown flag …`）。

**机台下方就是这两个开关**（`.flag-panel`，卡片架里那两张卡片的下面）：点一下等价于命令行加参数，
`aria-pressed` / 绿色指示灯表示当前状态 —— 不用记命令，也不用回终端。它是**热切换**：
`Games.controller.setFlags()` 直接改 opt，不重挂机台、不重开这一局（`--easy-mode` 会立刻把等级
拉回 1 并改回恒速，`--with-roll-back` 立刻放出撤回按钮）。

> **`hidden` 属性会被作者样式盖掉。** components.css 的 `.btn { display: inline-flex }` 与
> games.css 的 `.cabinet__key { display: inline-flex }` 优先级都高于浏览器默认的
> `[hidden] { display: none }` —— 于是"藏起来"的撤回按钮照样画在屏幕上（只是灰着）。
> 这正是最初的 bug：不开 roll-back 也能看见撤回按钮与 `U 撤回` 图例。
> 现在 games.css 里有一条 `.cabinet [hidden], .flag-panel [hidden] { display: none !important }` 兜底。

> **撤回按钮的可用状态跟着栈走**（`updateUndoBtn()`），不能只在 `sync()` 里刷 ——
> 只在 sync 里刷会晚一步：第一块落地时栈里已经有东西了，按钮却还是灰的，
> 得先按一次 `U` 才会"亮"起来。这是第二个修掉的 bug。

> **撤回撤的是什么。** 每次落子前拍一张快照（板面 / 队列 / 暂存 / 分数 / 正在下的那一块），
> 撤回时把**这一块的软降硬降加分也一起退掉** —— 不然撤了再放一次就是白赚分。
> 栈最多 30 步（`HISTORY_MAX`）；撤到"游戏结束"之前也能接着玩。

> **离开页面就没了。** 标志位与撤回记录只活在这一次挂载里：`route:changed` 一离开 `#/games`
> 就把控制器、`pendingOpts` 与整个撤回栈丢掉，下次进来还是默认机台
> （实测：回去后 `Games.controller.debug()` 的 `easy/rollback` 都是 `false`，撤回按钮重新隐藏）。

### 重新游玩要长按

`Restart` 不是点一下就走：按住 **700ms**（`HOLD_RESTART_MS`）才生效，按住时按钮上一条红色填充
从左扫到右，松手就缩回去。键盘 `R` 同理（按住填满才重开）。指针路径全走 `pointerdown/pointerup`，
`click` 只在 `detail === 0`（键盘触发）时才认，所以不会"点一下 + 长按"重开两次。

> 长按在触屏上会选中文字 / 弹系统菜单，所以机台里的按钮都加了 `user-select: none` +
> `-webkit-touch-callout: none`，并在 `contextmenu` 上 `preventDefault()`。

引擎要点：

- **7-bag 随机**：每七个方块里七种形状各出现一次，不会连着来五个 S；
- **旋转 + 踢墙**：`KICKS` 依次试「原地 → 左/右各两格 → 上抬一格」，贴地也转得动；
- **幽灵落点**只描一圈边；**暂存**（`C`）一回合只能用一次；
- 落地有 **430ms 宽限**，期间挪动会重新计时（最多重置 12 次，防止原地无限转）；
- **消行闪光** 150ms；计分 `100 / 300 / 500 / 800` × 等级，软降 1 分/格、硬降 2 分/格；
- 等级 = 消行数 / 10 + 1，下落间隔 `max(70, 800 × 0.85^(level-1))` ms，最高分写在
  `localStorage` 的 `hayneko.game.tetris.best`。

操作：`←` `→` 移动、`↑` / `X` / `Z` 旋转、`↓` 软降、`Space` 硬降、`C` 暂存、`P` / `Esc` 暂停。
屏幕下面还有一排按钮，触屏也能玩。

长按连发是引擎自己排的（浏览器自带的方向键重复节奏对不上），手感参数就这四个，在 `games.js` 顶部：

```js
var DAS_MS = 250;      // 按住多久才开始连发
var ARR_MS = 75;       // 连发的间隔
var SOFT_DAS_MS = 250; // 软降起步
var SOFT_ARR_MS = 50;  // 软降连发（往下滑过头不心疼）
```

> **这几个值别往回缩。** 一开始写的是 170 / 55，按住一秒能横移 **17 格** ——
> 想挪一两格时手一抖就滑到墙上。现在按标称值算一秒走 **11 格**左右，
> 无头 Edge 里采样实测：起步 `229ms`、连发间隔 `81ms`（rAF 采样有约 16ms 量化）。
> 松手也不会补跳：120ms 的点按只走 **1 格**。
> 浏览器长按时每 30ms 左右会补发一次 `keydown`，这些重复事件由 `held` 挡掉
> （实测连发 36 次 `keydown` 也只按上面的节奏走）。

> **画布尺寸量的是 `clientWidth`，不是 `getBoundingClientRect()`。**
> 入场动画会给 `.page` 挂 `transform`，量矩形拿到的是缩放后的尺寸，
> 画布就会按错的宽度建，画面发糊 —— 而且不会自愈，要等下一次 resize。

> **离开页面要收干净。** `route:changed` 里销毁控制器（摘掉 keydown / ResizeObserver /
> 监听器并停掉 rAF），主循环里还有一道 `canvas.isConnected` 兜底；
> 切走标签页（`visibilitychange`）自动暂停。不然旧机台会在后台一直空转。

> **机台正在跑时，`g` 前缀快捷键不抢按键**（`app.js` 里一问 `Games.active()` 就退出），
> 否则玩着玩着按到 `g` `h` 就跳页了。

### 移动端

手机上不用竖着堆（那样要滑很久才够得着按钮，手指还得在两个屏幕高度之间来回跑），
≤720px 直接换成**横向**布局：**井在左**，`Next/Hold`、数据、开始/暂停/撤回/重开在右，手指区在最下面。

| 区域 | 摆法 |
| --- | --- |
| 井 | 左；高度 `clamp(240px, 86vw, 330px)`，宽度按 1:2 反推（390px 实测 165×330，比竖排矮了约 90px） |
| 侧栏 | 右；`grid-template-columns: auto minmax(0, 260px)` + `justify-content: space-between`，井贴左、侧栏贴右 |
| 手指区 | 底部；左边十字键，右边两个大键 |

十字键与右手键：

| 位置 | 键 | 作用 |
| --- | --- | --- |
| 十字键 · 上 | ⟳ | 旋转 |
| 十字键 · 左 / 右 | ← / → | 左右横移 |
| 十字键 · 下 | ↓ | 软降 |
| 右手 · 左 | ⤓ | 硬降 |
| 右手 · 右 | H | 暂存 |
| 右手 · 下（仅 `--with-roll-back`） | ↶ | 撤回，横跨两列 |

摆位用的是 `grid-template-areas`（`. 表示空位`），桌面端（>720px）不受影响，仍是原来那一排小按钮。

- 动作按钮带 `.btn--block`（`width: 100%`），横向排布里会各占一行 —— 手机上排成 **2×2**；
- `.cabinet__pad` 设 `touch-action: none`，按住方向键时手指滑动不会带着页面滚；
- 触屏设备（`@media (hover: none) and (pointer: coarse)`）隐藏键位说明，并去掉 hover 位移
  —— 触摸屏的 `:hover` 会"粘"在最后点过的按钮上；
- 标志位面板在手机上每个开关占满一行（390px 实测 325×74）；
- 实测 390px：机台总高 **591px**（竖排时 ~700+），滚到机台后手指区底部 598px 仍在固定坞顶部 774px 之上，不会被 Dock 压住；
- 320 / 360 / 390 / 430 / 600px 逐档实测均无横向溢出。

---

## Dock

| 位置 | 项 | 行为 |
| --- | --- | --- |
| 左 | 头像 | 点击迸发粒子并回到首页 |
| | 首页 / 终端 / 资源下载 / 物理实验室 / 小游戏 / 友情链接 | 站内路由 |
| | 搜索 | 全局搜索：页面 / 小游戏 / 物理模拟 / 终端命令 / 资源下载 / 外链 |
| | 联系 | GitHub / Instagram / 邮箱 |
| | 语言 | en / zh-CN / zh-TW / ja / ko |
| | 主题 | 深色 ⇄ 浅色（整屏渐变擦除，记忆在 localStorage，兼容旧的 `preferredTheme`）|
| | 项目 | 打开 GitHub |
| | 相册 | 占位（提示尚未开放）|
| 右 | 状态 | 等宽的 `online <locale>` |

> **窄屏的坞。** 坞的满量宽度约 **575px**（12 个按钮 × 38px + 头像 + 分隔线），
> 以前没有任何收窄规则，窗口一窄过 575px，整条坞就被屏幕两边裁掉 ——
> 实测 420px 下坞宽 **495px**，左右各溢出 37px；加了「小游戏」之后还要再多 40px。
>
> 现在的做法是**先减项、再按屏宽均分**：600px 以下先**藏掉头像**
> （手机上它只是装饰，却占掉一个图标的宽度），再藏 `links` / `album` / `projects`
> 三个 `data-compact-hide` 项（顶栏导航、联系菜单与页脚里都有入口），
> 剩下 9 个图标铺满可用宽度：
>
> ```css
> --dock-item: min(46px, calc((100vw - 22px) / 9));
> ```
>
> 390px 下每个 **41px**、320px 下 **33px**（之前是 32 / 27px），图标同时放大到 20px，
> 窄屏没有意义的 tooltip 一并关掉。
> 逐档实测 320 / 360 / 375 / 390 / 414 / 430 / 600px 均不溢出，601px 以上外观与之前完全一致。

> **搜索是全局的，空查询就把全部列出来。** 索引在 `dock.js` 里现取现拼（`globalIndex()`）：
> 页面 6 条、小游戏（问 `Games.list()`）、物理模拟 3 条、终端命令（问 `Terminal.commands()`，
> 35 条有文档的命令）、资源下载 4 条、外链与联系 3 条 —— 实测空查询列出 **52 条 / 6 组**。
> 打分是 `精确 > 前缀 > 包含 > 说明或 key 里出现`，组内按分数、组间按固定顺序，
> 每组标题后面跟命中数；点小游戏直接开局，点终端命令会跳到 `#/terminal` 并把它跑起来
> （`Terminal.run()`：终端页还没挂载就先记下来，挂载完补跑）。
> 搜索菜单比其他菜单宽（`min(620px, 92vw)`），因为每条结果有"名称 + 用法"两行。

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

  > **每个字都不该永久带着一层滤镜 / 一个合成层。** 这里原来有两处，
  > 都会让"放大/位移之后文字发虚"：
  >
  > 1. `.fx-char` 上写着常驻的 `will-change: transform, opacity, filter` ——
  >    等于把**每一个标题字**永久提升成一个合成层（层里的纹理按固定比例栅格化，
  >    缩放时就是糊的），而且 `filter` 的模糊动画本来也交不给合成器做，
  >    这条 `will-change` 什么也换不来。现在整条删掉；
  > 2. 动画写的是 `animation: ... both`，于是跑完之后末尾关键帧一直挂着 ——
  >    而只要 `filter` 不是 `none`（哪怕只是 `blur(0px)`），元素就还是个滤镜层。
  >    改成 `backwards`：只保留"延迟期间先别显示"，跑完就把元素交还给 CSS 自身状态
  >    （末尾关键帧和默认状态本来就完全一致，所以收尾不会有跳变）。
  >
  > 实测（首页 + 小游戏页 + 实验室页）：稳定后整页"计算出的 filter 不是 none"的元素
  > 从 **7 个**（全是标题的单字）降到 **0 个**；逐字动画本身没变，
  > 仍是从 `blur(4px)` 一路收敛到 0（采样：`1ms 4px → 40ms 0.46px → 151ms 0.022px`）。
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
- **入场的运动模糊（零副本）**：入场**不生成克隆残影**（`ghosts: 0`），
  而是把 `filter: blur()` 直接写进关键帧，模糊量跟着速度走 ——
  `dropIn` 从 `blur(9px)` 收到 `blur(0)`，`slideIn` 从 `5.5px`，`popIn` 从 `4.5px`。
  实测入场全程 `#smear-host` 子节点数 = **0**，元素自身 `blur(5.5px) → 2.27px → 0.21px → none`。

  > **为什么入场不能用克隆残影。** 克隆残影本质就是"同一份内容的另一个 DOM 节点"。
  > 把残影和**它自己的**主体对比实测：最近的那层也会从 0 拉到 **22px** ——
  > 屏幕上就是"复制了一份元素 / 有虚影"。调 `lag` / `blur` / `opacity` 只能减轻，治不了根：
  > 只要它和主体拉开几像素，人眼就读成两份，而不是糊。
  >
  > 克隆拖影现在只留给**顶栏菜单**（一瞬间的残影，不会读成"复制"）。

- **位移时的运动模糊**：任何涉及 `transform` / `padding-left` / `top` / `left` 的过渡一开始，
  `motion.js` 就给元素挂上 `.is-moving`，**这些属性全部跑完**才摘掉。
  模糊量不是定值，而是**每帧按元素真实的位移速度算**（`模糊 = 速度 × 3.2`，上限由
  `--fx-move-max` 给：图标 0.45px / 卡片 0.8px）。悬停放大、按下缩小、列表行缩进因此都带上拖影感，
  但位移一停下来模糊立刻回到 0；

  > **模糊必须和动画同长 —— 长一头短一头都看得出来，这里两头都修过。**
  >
  > 1. **模糊比动画长（入场）。** 入场动画用 `fill: 'both'` 挂着 `filter`，而释放写的是
  >    `setTimeout(total + 90)`。动画其实早就跑完了（关键帧最后一帧就是 `blur(0)`），
  >    但只要动画还挂着，元素就一直是**带滤镜的合成层**：真机上先栅格化成纹理再缩放，
  >    于是"动画结束后还糊一小会"。实测那段尾巴：动画 `766ms` 结束、`filter` 拖到 `878ms` 才变 `none`
  >    （**多挂 110ms**）。现在直接在动画自己的 `finished` 上释放（兜底计时器才 +120ms），
  >    实测 `filter: none` 与"动画消失"同一时刻（`785ms == 785ms`）。
  > 2. **模糊比动画短（多属性过渡）。** `.file-row` 是"缩放 `transform 240ms` + 左移 `padding-left 420ms`"，
  >    而摘模糊写的是"谁先 `transitionend` 就摘" —— 实测 `397ms` 就变清晰，位移却一直到 `591ms` 才停
  >    （**早了 194ms**，那段位移是"没有拖影感的裸平移"）。现在按属性各自计数，
  >    全部结束才摘；顺带忽略**伪元素**的过渡（按钮扫光 `::after`、卡片高光 `::before`
  >    只是装饰性扫过，不该把模糊拖长）。实测改成 `514ms` 摘、位移 `566ms` 停，
  >    差的 52ms 正好是 rAF 采样间隔的量级。
  > 3. **模糊不该比"位移量"还大（会糊到文字）。** 原来 `.is-moving` 是三个定值
  >    （0.45 / 0.7 / 0.9px），只要一悬停就糊满整段过渡 —— 可卡片只放大 **2.2%**，
  >    坞图标是 **14%**，两者用同一个量级本来就说不通：小位移元素的文字先糊了，
  >    看着就像"字突然变虚"，而不是"元素在动"。
  >    现在模糊跟着**每帧实测到的位移速度**走（`模糊 = 速度(px/ms) × 3.2`，再按元素的
  >    `--fx-move-max` 封顶），停下来自然回到 0。实测卡片悬停：峰值 **0.37px**（原先恒定 0.9px），
  >    约 290ms 后回到 0，之后整段悬停状态文字都是清晰的；坞图标因为又快又大，
  >    峰值仍有 **0.42px**，拖影感没丢。
  >    慢于 `0.02px/ms` 直接当没动（免得挂一层噪声级的模糊）。
  >
  > **剩下的那点"放大后有点软"，是合成器的事，不是这里的模糊。** 元素一旦被提升成
  > 合成层，它的纹理是按某个固定比例栅格化的，动画期间由 GPU 缩放这张纹理 ——
  > 那一下字会略软，Chrome 在过渡结束后会按最终比例重新栅格化。
  > 无头（软件光栅化）测不出来，所以这条只能靠上面"把模糊降到 0"来尽量减少叠加效应。
- **当前页面高亮**：坞里当前页面对应的图标会变成强调色（`.dock__item.is-active`），
  其余是灰的。原本还有一条"滑动指示条"，已经删掉了 —— 试过三种做法都不理想：

  | 做法 | 问题 |
  | --- | --- |
  | 圆点 + 克隆残影 | 拖影会被看成"复制了一份元素" |
  | 圆点 + 按实际位移限制拖尾长度 | 尾巴相对光点当前位置往后甩，刚起步时光点还在起点上，会甩到起点后面 → "某个时刻超长拖影" |
  | 小横条 + 两段式伸缩 | 动画本身没问题，但坞里腾不出空间，横条总和图标那圈 1px 边框打架 |

  被删掉的东西：`dock.js` 里的 `moveIndicator` / `placeBar` / `wireIndicator` 与所有
  `--ind-*` / `--bar-squash` 内联属性、`dock.css` 里的 `.dock__indicator`、
  `motion.css` 里的 `.dock__indicator.is-moving` 拖尾块。坞高也从临时加的 68px 回到 60px。
- **按下涟漪**：`.btn` / `.card` / `.file-row` / `.dock-menu__item` 等按下时从指针位置扩散一圈；
- **主题擦除**：切换主题时整屏渐变擦过，前沿有一条 RGB 亮边；
- **主题图标交叉淡入**：月亮 ⇄ 太阳 旋转缩放切换；
- **路由扫描带**：切页面时一道很淡的扫描带自上而下掠过；
- **主题图标旋转**：切换主题时月亮/太阳转一圈（`is-spinning`）。

  > Dock 的五个路由按钮（主页 / 终端 / 资源下载 / 物理实验室 / 友情链接）以前点一下会"弹跳"
  > （`fx-pop`：上移 9px + 放大到 1.2）。其它坞按钮都只有悬停放大 / 按下缩小，就这五个会弹，
  > 看着不统一，已经去掉 —— 现在全坞一致：悬停 `scale(1.14)`，按下 `scale(0.88)`，无位移。
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

### 字体

正文默认 = **英文等宽 + 中日韩衬线**（`tokens.css` 的 `--font`）。

```css
--font-cjk-serif: "Noto Serif CJK SC", "Source Han Serif SC", "Source Han Serif CN",
    "Songti SC", "STSong", "SimSun", "Noto Serif JP", "Yu Mincho", "Hiragino Mincho ProN",
    "Noto Serif KR", "Nanum Myeongjo", "Batang", serif;
--font-latin-mono: "JetBrains Mono", "Cascadia Mono", "SFMono-Regular", "SF Mono", Menlo,
    Consolas, "Liberation Mono", "Courier New", ui-monospace;
--font: var(--font-latin-mono), var(--font-cjk-serif);
```

**不是字体混排，就是字体回退本身**：等宽字体基本不含 CJK 字形，浏览器排到中文时
会自动继续往下找，于是落到后面那串衬线（宋体 / 明朝体）。

> ⚠️ 顺序不能反，拉丁那段也**不能带末尾的泛型 `monospace`** ——
> 泛型会先被解析成一个具体字体，一旦它带 CJK 字形，中文就轮不到后面的衬线了。
> 所以拉丁部分单独拆成 `--font-latin-mono`。

实测（无头 Edge，同一台机器）：

| | 判定方式 | 结果 |
| --- | --- | --- |
| 英文 | 量 `Hayneko 1234` 的宽度 | **281.25 == Cascadia Mono**（Consolas 263.91、Arial 257.97 都对不上） |
| 中文 | 与参考字体并排渲染对比 | 与**泛型 `serif`** 逐像素一致 → 宋体 ✓ |

`code` / `kbd` / `pre` / 终端仍然用 `--font-mono`（连中文也是等宽），因为那里要对齐。

### 时长约定

所有动效**单个不超过 0.5s**：`--dur-4` = 500ms（顶栏箭头 / 卡片 / 进度条），
整屏转场 `page-in` = 500ms，描边画圈 = 500ms，
涟漪 / 扫描带 / 图标旋转 = 500ms，悬停与按下 220–300ms。
入场 smear 的 drop / slide / pop 也统一到 500ms。

> 唯一超过 0.5s 的是「重新游玩」按钮那条 **700ms** 的填充（见「小游戏 · 重新游玩要长按」）：
> 它画的是"你要按多久"，属于进度指示而不是装饰动画，所以没有并进上面的约定。

### 交互式终端

`views/terminal.html` + `scripts/terminal.js`，**45 个命令**，Tab 补全、上下键翻历史、
支持单/双引号（引号里的空格不会被拆开）。

| 分组 | 命令 |
| --- | --- |
| 文件 / 导航 | `help` `man <cmd>` `ls` `tree` `cat <file>` `open <page>` `sim [n]` `clear` |
| 编码 / 哈希 | `b64` `b64d` `hex` `unhex` `url` `urldecode` `hash [sha1\|sha256\|sha384\|sha512]` `json` |
| 数字 / 时间 | `calc` `base` `ts` `uuid` `pass` `color` `cron` |
| 文本 | `text <op>` `count` `lorem` |
| 系统 | `whoami` `date` `history` `env` `theme` `accent` `neofetch` |
| 小游戏 | `games` `play <game>` |
| 彩蛋 | `matrix` `sudo` `vim`（`sudo rm -rf /*` 有完整演出：假删除 → KERNEL PANIC → "just kidding"）|

几个值得一试的：

```
calc (1+2)*3^2          27          base 0xff      dec 255 / 0xFF / 0o377 / 0b1111 1111
calc sqrt(2)            1.414213562373             color #3ce07b  带色块预览
calc 0.1+0.2            0.3         ts 0           1970-01-01T00:00:00.000Z
calc cbrt(27)           3           sinh(1)         1.175201193644
calc 12 AND 10        8           calc 2 < 3      TRUE
calc 3 xnor 4           -8          calc (1+2       note: auto-closed 1 unclosed "("  →  3
hash sha256 abc         ba7816bf...                cron "*/15 9-17 * * 1-5"  含接下来 3 次运行时间
pass 20 -s              用 crypto 取无偏随机
```

`calc` 是手写的**词法分析 + 递归下降**求值器（**不用 `eval`**）：

| 类别 | 内容 |
| --- | --- |
| 运算 | `+ - * / % ^`（`^` 右结合）、一元 `±`、括号、`0x` 字面量、`pi` / `e` / `true` / `false` |
| 函数 | **原有** `sqrt abs round floor ceil sin cos tan log log10 exp pow min max`；**新增** `sinh cosh tanh asin acos atan asinh acosh atanh cbrt` |
| 位运算（7 种） | `NOT x`、`x AND y`、`x NAND y`、`x OR y`、`x NOR y`、`x XOR y`、`x XNOR y` —— 按 **32 位有符号整数**算，输出十进制结果 |
| 判断 | `=` `<>` `>` `<` `>=` `<=` `~=`（也认 `==` `!=`）→ 输出 **TRUE / FALSE** |

优先级（低 → 高）：`OR/NOR < XOR/XNOR < AND/NAND < NOT < 比较 < + - < * / % < 一元± < ^`。

> **比较运算符和位运算符的输出不是一回事，别记混。**
> 只有比较（`=` `<` `>=` …）在"判断条件是否成立"，输出 `TRUE` / `FALSE`；
> `AND` / `OR` / `XOR` / `NAND` / `NOR` / `XNOR` / `NOT` 是**位运算**，
> 结果是按位算完的 **32 位有符号整数**，照样打印十进制数字：
>
> ```
> calc 1=2          FALSE     比较: 成不成立
> calc 3 xnor 4     -8        位运算: ~(3 ^ 4) = ~7
> calc 12 AND 10    8         1100 & 1010 = 1000
> calc 3 NAND 4     -1        ~(3 & 4) = ~0
> calc NOT 0        -1        ~0
> ```
>
> 布尔值只有在进入位运算 / 算术时才当 1 / 0 用（`calc (1<2) AND 3` 得 `1`，`calc (1<2)+1` 得 `2`）。

几条特意做成这样的：

- **括号没闭合会自动补齐，而且补在哪儿很有讲究。** 括号里若出现**同层的位运算 / 比较运算**，
  右括号补在那个运算符**前面**（把它留在括号外）；没有这类运算符才补在最末尾：

  ```
  calc 1+2*3-sin(1 and 1   →  1+2*3-sin(1) and 1     ← 补在 and 前, 不是 sin(1 and 1)
  calc (1+2*3 and 4        →  (1+2*3) and 4
  calc 1+2*3-sin(1         →  1+2*3-sin(1)            ← 没有这类运算符, 照样补在末尾
  ```

  结果行里显示的就是补完之后的表达式，另有一条灰色 note 说明补了几个；
- **只在真的容易读错时才警告**（结果照给，按上面的次序算）。`3+2*3-4` 这种"先乘除后加减"是常识，
  **不提醒** —— 每次都念一遍等于没念。会提醒的是这四类，而且消息里用的都是**你输入的那条式子**，
  直接给出两种写法与各自的取值：

  | 例子 | 提示 |
  | --- | --- |
  | `1 xor 2 + 3 and 4` | 位运算与算术混在一起 |
  | `2^3^4` | `write 2^(3^4) = 2.417851639229e+24 or (2^3)^4 = 4096` |
  | `-3^3` | `write -(3^3) = -27 or (-3)^3 = -27` |
  | `1 < 2 < 3` | 连着写比较，按 `(1 < 2) < 3` 算 |

  写清括号就都不提醒：`(1+2)*3`、`2^(3^4)`、`(-3)^2`、`5 >= 5 AND 1 <> 2`（后者是两个独立比较）；
- **不支持 `2x` / `2(3)` 这种省略乘号**，报错时直接告诉你该写成 `2 * x`；
- 比较沿用显示的精度（12 位小数）：`calc 0.1+0.2 = 0.3` → **TRUE**，不会出现"显示 0.3 却判 FALSE"。

#### 终端输出的等级配色

| 等级 | 颜色 | class |
| --- | --- | --- |
| note / log / 次要信息 | 灰 | `t-dim` |
| warn（容易读错、有坑） | 黄 | `t-warn` |
| error / fatal | 红 | `t-err` |
| 正常结果 | 绿 | `t-ok` |

> 黄是专为"警告"加的令牌（`--yellow`：深色 `#ffd24d`、浅色 `#8a5a00`，保证对比度），不参与强调色。
>
> **踩过的坑：这些等级色其实一直没生效。** `print(text, cls)` 把 class 加在**同一个**元素上
> （`<div class="term__out t-err">`），而 CSS 写的是后代选择器 `.term__out .t-err` ——
> 只有 `printHTML()` 拼出来的 `<span class="t-ok">` 才在子级。于是除少数几行外，终端输出一直是白的。
> 现在选择器两种形式并存（`.term__out .t-err, .term__out.t-err { … }`）；
> 顺带把灰从 `--fg-ghost`（近黑底上只有 1.9:1，基本看不清）换成 `--fg-faint`。

> `help` 的分组表是唯一事实来源，`man` 也读它，加命令时改一处即可。

> **输入行别被底部那条固定坞压住。** 浏览器把聚焦的元素滚进视口时并不认识 `position: fixed`
> 的坞，输入行正好会停在坞下面。两侧一起修：
> CSS 给 `.term__input` / `.term__prompt-line` 加上
> `scroll-margin-bottom: calc(var(--dock-h) + 34px)`（浏览器自己滚的时候就知道要留位置），
> `terminal.js` 的 `keepPromptClear()` 在聚焦后 60ms 再兜一次底 ——
> 只要输入行底边落进坞里，就把页面往上滚这一点点距离。

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

## 几个容易踩的坑（已修，留个记录）

1. **`data-route` 不要挂到 `<html>` 上。**
   曾经用 `document.documentElement.setAttribute('data-route', id)` 记录当前路由，
   而点击拦截写的是 `e.target.closest('[data-route]')` —— 于是**页面上任何一次点击**
   都会向上找到 `<html>`，被当成站内链接 `preventDefault()` 掉，
   结果 dock 按钮切不动页面、所有外链/下载都点不开。
   现在属性叫 `data-route-current`，拦截器也收紧成 `a[data-route]`。

2. **块注释里的星号加斜杠会提前结束注释，反过来漏写 `*/` 更糟。**
   两者都踩过：一次是注释里写了 cron 表达式，把后面的代码当成注释外的内容（语法错误）；
   一次是删代码时留下一个**没闭合**的 `*` + `/`，于是整个文件后半段的 CSS 全被吞掉 ——
   坞里的图标突然都不见了。现在 `README` 的检查里会比对 `/*` 与 `*/` 的数量。

   > **同一个文件里，特异性相同就完全靠先后顺序决胜。**
   > 这条把"点一下按钮变得超级大"这个 bug 拖了很久。`.fx-ripple`（涟漪）本来写在
   > `.card > * , .btn > * { position: relative; z-index: 1; }` **前面**，
   > 两者特异性都是 0,1,0 —— 于是后者赢，涟漪被设成 `position: relative`。
   > 它的大小是按钮的 2.1 倍，一旦参与布局就把按钮撑到 2.1 倍，点一下"超级大再缩回去"。
   > 实测按钮矩形从 **160×47 直接变成 492×355**。
   >
   > 修法是把涟漪规则挪到 `.btn > *` 之后（`motion.css` 整体又排在 `components.css` 之后，
   > 所以那边同名的 `.btn > *` 也不构成威胁）。实测改完后同样的点击只会经过
   > 悬停 1.05 / 按下 0.94 的正常缩放，最大宽度 168px（= 160 × 1.05）。
   > 现在 `.fx-ripple` 上方留了警示注释，别再往前挪。

3. **`i18n.apply()` 会派发 `i18n:applied`。**
   如果监听 `i18n:applied` 的回调里又调用 `i18n.apply()`，就会无限递归爆栈。
   现在 `renderSearch()` 不再调用 `apply`，并且加了再入保护。

4. **触摸设备上顶栏"点一下展开、立刻又收回"。**
   顶栏那条 `<div role="button" tabindex="0">` 一旦拿到焦点就展开面板；手机上点它的事件顺序是
   `pointerdown → mousedown → focus → click` —— focus 先把面板展开，紧接着**同一个手势**的
   `click` 又 `toggle()` 一次，于是"弹一下马上收回"。第二次点却正常，因为焦点已经在顶栏上，
   不会再触发 focus。无头 Edge 里实测的时间线：

   ```
   245ms  mousedown / focus   active=header-bar  :focus-visible=false  → is-open=true
   259ms  click                                                     → is-open=false
   ```

   修法是 `header-nav.js` 里的 `focusOpens()`：触摸设备（`hover: none`）**只有
   `:focus-visible` 来的焦点**（键盘 Tab）才展开，鼠标/手指点出来的焦点交给 click 去 toggle；
   桌面端行为不变（实测：程序化 focus 仍展开、hover 展开、hover 中点击收起、Esc 收起）。
   修复后手机上连点两次是干净的开 → 关。

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
