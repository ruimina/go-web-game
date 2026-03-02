# 围棋水潭对弈（Go Web Game）

一个基于 `Node.js + Express + WebSocket + Canvas` 的网页版围棋项目。

## 功能

- 标准中国围棋规则（落子、提子、禁入点、自杀禁着、基础打劫、双停终局计分、认输）
- 本地自我对弈
- 网页房间对战（实时同步）
- 不可达点（水潭）机制：不可落子、不可提
- 开局随机生成连通不可达区域（可配置区域数量和区域大小）
- 地图编辑器：可配置棋盘大小、点击设置水潭点、保存/读取地图（浏览器本地存储）
- 黄木棋盘 + 连通水潭整体渲染

## 技术栈

- Node.js (ESM)
- Express
- ws (WebSocket)
- 原生前端 HTML/CSS/JS（Canvas 绘制）

## 本地启动

### 1) 环境要求

- Node.js 18+（建议 LTS）

### 2) 安装依赖

```bash
npm install
```

### 3) 启动服务

```bash
npm start
```

默认监听端口 `5173`，打开：

- [http://localhost:5173](http://localhost:5173)

健康检查接口：

- [http://localhost:5173/health](http://localhost:5173/health)

### 4) 自定义端口（可选）

```bash
PORT=8080 npm start
```

## 局域网访问

如果你的 Mac 与其他设备在同一局域网，可通过：

- `http://你的局域网IP:5173`

访问。联机 WebSocket 也会走同一服务地址的 `/ws`。

## 云服务器部署（概览）

1. 将代码上传到云主机
2. `npm ci`
3. `npm start`（建议配合 `pm2`/`systemd`）
4. 安全组放行端口（推荐用 `80/443` + Nginx 反代到本地 Node 端口）

## 项目结构

```text
.
├── public/
│   ├── index.html       # 页面结构与控制区
│   ├── styles.css       # 样式与棋盘视觉
│   └── main.js          # 前端状态、渲染、交互、联机客户端
├── shared/
│   └── go-rules.js      # 围棋规则与不可达区域生成
├── server.js            # Express + WebSocket 服务端
├── package.json
└── package-lock.json
```

## 说明

- 地图保存使用浏览器本地存储（`localStorage`），不同浏览器或设备间不自动同步。
- 当前实现为“基础打劫限制”，未实现“超级打劫（全局同形禁着）”。
