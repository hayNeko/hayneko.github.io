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
