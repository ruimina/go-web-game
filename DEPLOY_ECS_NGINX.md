# 阿里云 ECS 使用 Nginx 反向代理部署说明

本文目标：让你通过 `http://<ECS公网IP>/games/go/` 访问项目，不再手动输入 `:3001`。

## 1. 架构说明

- Node 服务监听：`127.0.0.1:3001`
- 对外入口：`80` 端口（Nginx）
- Nginx 将 `/games/go/` 反代到 `http://127.0.0.1:3001/games/go/`
- WebSocket 同样走 Nginx 转发（联机功能必须）

## 2. 前置要求

- 一台可 SSH 登录的阿里云 ECS（Linux）
- 项目代码已上传到 ECS（例如 `/opt/go_web_game`）
- 已安装 Node.js 18+

## 3. 在 ECS 启动 Node 服务

```bash
cd /opt/go_web_game
npm ci
PORT=3001 BASE_PATH=/games/go npm start
```

建议后续用 `pm2` 或 `systemd` 托管，避免 SSH 断开后进程退出。

## 4. 安装 Nginx

### Ubuntu/Debian

```bash
sudo apt update
sudo apt install -y nginx
```

### CentOS/RHEL/Alibaba Cloud Linux

```bash
sudo yum install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

## 5. 写 Nginx 反代配置

创建文件（路径二选一，按系统来）：

- Ubuntu/Debian：`/etc/nginx/sites-available/go_game.conf`
- CentOS 系：`/etc/nginx/conf.d/go_game.conf`

配置内容：

```nginx
server {
    listen 80;
    server_name _;

    # 统一带斜杠，避免相对路径资源出错
    location = /games/go {
        return 301 /games/go/;
    }

    # HTTP 页面与静态资源反代
    location /games/go/ {
        proxy_pass http://127.0.0.1:3001/games/go/;
        proxy_http_version 1.1;

        # WebSocket 必需头
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

如果是 Ubuntu/Debian，还需要启用站点：

```bash
sudo ln -sf /etc/nginx/sites-available/go_game.conf /etc/nginx/sites-enabled/go_game.conf
sudo rm -f /etc/nginx/sites-enabled/default
```

## 6. 检查并重载 Nginx

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 7. 阿里云安全组与防火墙放行

至少放行：

- `TCP 80`（必须，对外访问入口）

可选：

- `TCP 443`（后续上 HTTPS）
- `TCP 22`（SSH 管理）

建议：

- 不对公网开放 `3001`，仅本机回环访问即可（更安全）。

如果系统本机防火墙开启，也要同步放行 `80`。

## 8. 验证

在 ECS 上先测本机：

```bash
curl -i http://127.0.0.1:3001/games/go/health
curl -i http://127.0.0.1/games/go/health
```

在你自己的电脑浏览器访问：

- `http://<ECS公网IP>/games/go/`

联机测试时，打开两个浏览器标签页创建/加入房间，确认走子能同步（验证 WebSocket）。

## 9. 常见问题排查

1. 页面 502 Bad Gateway
- Node 服务没启动，或没监听在 `127.0.0.1:3001`。
- 先执行：`ss -lntp | rg 3001`

2. 页面能开，联机不通
- Nginx 漏掉了 WebSocket 头：`Upgrade` 和 `Connection`。
- 或访问路径不是 `/games/go/`，导致 WS 路径不一致。

3. 外网无法访问
- 阿里云安全组未放行 `80`。
- ECS 本机防火墙未放行 `80`。

4. 资源 404
- `location = /games/go` 没有重定向到 `/games/go/`，导致相对路径基准错误。

## 10. 生产建议（可选）

- 配置域名并接入 HTTPS（Let's Encrypt 或阿里云证书）。
- 使用 `systemd`/`pm2` 让 Node 服务开机自启。
- 在 Nginx 增加访问日志与基础限流。
