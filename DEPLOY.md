# 部署指南 (Deployment Guide)

本指南介绍如何在 Ubuntu 服务器上部署 Semi AI Chatbot。推荐使用 Docker 进行部署。

## 前置条件

1.  **Ubuntu 服务器** (推荐 20.04 LTS 或更高)
2.  **Docker & Docker Compose** 已安装
3.  **Ollama** (用于提供 LLM 服务) 已安装并运行

### 1. 安装 Docker (如果未安装)

```bash
# 更新 apt 包索引
sudo apt-get update
sudo apt-get install ca-certificates curl gnupg

# 添加 Docker 官方 GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# 设置仓库
echo \
  "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 安装 Docker Engine
sudo apt-get update
sudo apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### 2. 安装并配置 Ollama

如果服务器上还没有 Ollama：

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

启动 Ollama 服务（通常安装后会自动启动）。
拉取需要的模型（例如 `deepseek-r1:32b`，请确保服务器显存/内存足够）：

```bash
ollama pull deepseek-r1:32b
```

**注意**：为了让 Docker 容器能访问宿主机的 Ollama，我们在 `docker-compose.yml` 中配置了 `host.docker.internal`。确保 Ollama 监听 `127.0.0.1` 或 `0.0.0.0`。默认情况下，Linux 上的 Docker 可以通过 `host-gateway` 访问宿主机。

---

## 部署步骤

### 方式一：Docker Compose 部署 (推荐)

1.  **上传代码**
    将项目代码上传到服务器目录，例如 `/opt/semi-ai-chatbot`。

2.  **构建并启动**

    ```bash
    cd /opt/semi-ai-chatbot
    # 构建镜像并后台启动
    sudo docker compose up -d --build
    ```

3.  **查看日志**

    ```bash
    sudo docker compose logs -f
    ```

4.  **访问应用**
    应用默认运行在 `3000` 端口。
    访问：`http://<服务器IP>:3000`

### 方式二：手动部署 (Node.js + PM2)

如果不使用 Docker，可以直接在服务器运行 Node.js。

1.  **安装 Node.js (v18+)**

    ```bash
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    sudo apt-get install -y nodejs
    ```

2.  **安装 PM2 (进程管理器)**

    ```bash
    sudo npm install -g pm2
    ```

3.  **安装依赖并启动**

    ```bash
    cd /path/to/project
    npm install
    
    # 启动应用
    pm2 start server.js --name "chatbot"
    
    # 保存进程列表（开机自启）
    pm2 save
    pm2 startup
    ```

## 常见问题

1.  **LLM 连接失败**
    *   检查宿主机 Ollama 是否正常运行：`curl http://localhost:11434/api/tags`
    *   如果是 Docker 部署，检查 `docker-compose.yml` 中的 `LLM_API_URL` 是否正确指向了宿主机 IP 或 `host.docker.internal`。

2.  **数据库持久化**
    *   Docker 部署中，`kpi_chatbot.db` 通过 volume 挂载，重启容器数据不会丢失。
    *   如果需要备份，直接备份该文件即可。
