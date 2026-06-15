#!/bin/bash
# StoryForge Desktop 开发模式启动脚本

echo "=== StoryForge Desktop 开发环境启动 ==="
echo ""

# 1. 检查 Docker 是否运行
echo "1. 检查 Docker..."
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker 未运行，请先启动 Docker Desktop"
    exit 1
fi
echo "✓ Docker 正在运行"

# 2. 启动后端服务
echo ""
echo "2. 启动后端服务..."
cd ../..
docker-compose up -d

# 3. 等待 API 就绪
echo ""
echo "3. 等待 FastAPI 就绪..."
for i in {1..30}; do
    if curl -s http://localhost:8000/health/ready > /dev/null 2>&1; then
        echo "✓ FastAPI 已就绪"
        break
    fi
    echo "等待中... ($i/30)"
    sleep 2
done

# 4. 启动桌面前端
echo ""
echo "4. 启动桌面前端..."
cd apps/desktop/frontend
npm run dev &
FRONTEND_PID=$!

# 等待桌面前端就绪
echo ""
echo "5. 等待桌面前端就绪..."
for i in {1..30}; do
    if curl -s http://localhost:3007 > /dev/null 2>&1; then
        echo "✓ 桌面前端已就绪"
        break
    fi
    echo "等待中... ($i/30)"
    sleep 2
done

# 6. 启动 Tauri
echo ""
echo "6. 启动 Tauri 桌面应用..."
cd ../desktop
pnpm tauri dev

# 清理
echo ""
echo "正在关闭服务..."
kill $FRONTEND_PID 2>/dev/null
cd ../..
docker-compose down
