# 阶段 1：自动启动服务 - 实现报告

## 📋 概述

**目标**：实现 Tauri 桌面应用在启动时自动管理所有依赖服务

**完成时间**：2026-06-15

**状态**：✅ 代码实现完成，等待编译测试

---

## 🎯 实现的功能

### 1. 自动服务管理

```rust
// main.rs 核心流程
1. 查找项目根目录（智能向上搜索 + 环境变量回退）
2. 启动 Docker Compose（postgres、redis、minio）
3. TCP 健康检查（PostgreSQL:55432、Redis:6379）
4. 执行数据库迁移（alembic upgrade head）
5. 启动 FastAPI（uvicorn :8000）
6. HTTP 健康检查（/health/ready）
7. 启动 Next.js（pnpm dev :3006）
8. HTTP 健康检查（/ide 页面）
9. 打开 Tauri 桌面窗口
10. Ctrl+C 优雅退出（自动停止所有子进程）
```

### 2. 核心组件

#### ServiceManager（进程管理器）
- 全局管理所有子进程
- 退出时自动清理
- 防止僵尸进程

#### 健康检查机制
- **TCP 检查**：`check_port(host, port, timeout)` - 确保端口可达
- **HTTP 检查**：`reqwest::blocking::get()` - 确保服务真正响应

#### 错误处理
- 使用 `anyhow::Result` 提供清晰的错误上下文
- 每个步骤都有超时机制（30s-60s）
- 失败时自动清理已启动的进程

### 3. 依赖更新

```toml
# Cargo.toml
tokio = { version = "1", features = ["full"] }      # 异步运行时（备用）
reqwest = { version = "0.11", features = ["blocking"] }  # HTTP 客户端
anyhow = "1.0"                                      # 错误处理
ctrlc = "3.4"                                       # Ctrl+C 信号处理
```

### 4. 用户体验提升

**之前**：
```bash
# 终端 1
pnpm dev:api

# 终端 2
cd apps/web && pnpm dev

# 终端 3
cd apps/desktop && pnpm tauri dev
```

**现在**：
```bash
pnpm desktop:dev  # 一键搞定！
```

---

## 📁 修改的文件

### 核心实现
- `apps/desktop/src-tauri/src/main.rs` - 完全重写，实现自动启动逻辑
- `apps/desktop/src-tauri/Cargo.toml` - 添加新依赖，移除 `[lib]` 配置

### 文档更新
- `apps/desktop/README.md` - 更新为一键启动说明
- `apps/desktop/USAGE.md` - 完整的使用指南和故障排查
- `apps/desktop/STATUS.md` - 记录进度和技术细节

### 工具脚本
- `apps/desktop/generate-icons.cjs` - 图标占位符生成器
- `apps/desktop/src-tauri/icons/*` - 生成的图标文件（占位符）

---

## 🔧 技术亮点

### 1. 智能项目根目录查找
```rust
fn find_project_root() -> Result<String> {
    // 1. 从可执行文件向上查找（最多 10 层）
    // 2. 查找同时包含 package.json 和 docker-compose.yml 的目录
    // 3. 回退到 STORYFORGE_ROOT 环境变量
}
```

### 2. 健康检查超时机制
- PostgreSQL/Redis: 30 秒超时
- FastAPI: 60 秒超时（需要加载 Python 环境）
- Next.js: 60 秒超时（需要编译页面）

### 3. 进程生命周期管理
- 使用 `Arc<Mutex<ServiceManager>>` 跨线程共享状态
- `ctrlc::set_handler()` 捕获 Ctrl+C 信号
- 应用退出时自动调用 `shutdown()`

### 4. 日志输出
- 每个步骤都有清晰的进度提示
- 错误信息包含详细的上下文
- 子进程输出直接继承到终端（`Stdio::inherit()`）

---

## ✅ 测试清单

### 编译测试
- [x] 生成图标占位符
- [ ] Rust 编译通过（进行中）
- [ ] 首次运行（完整编译，5-10 分钟）
- [ ] 二次运行（秒开）

### 功能测试
- [ ] Docker 自动启动
- [ ] 数据库迁移自动执行
- [ ] API 服务自动启动
- [ ] Web 服务自动启动
- [ ] 桌面窗口自动打开
- [ ] 窗口显示正确内容（/ide 页面）

### 错误处理测试
- [ ] Docker 未启动时的错误提示
- [ ] 端口被占用时的错误提示
- [ ] 数据库迁移失败的处理
- [ ] API 启动失败的处理
- [ ] Web 启动失败的处理

### 退出测试
- [ ] Ctrl+C 优雅退出
- [ ] 关闭窗口时自动停止服务
- [ ] 子进程全部清理干净（无僵尸进程）

---

## 📊 性能指标

### 启动时间（预估）
- **首次运行**：5-10 分钟（Rust 编译）
- **后续运行**：
  - Docker 启动：~5 秒（如已运行则跳过）
  - 数据库迁移：~2 秒
  - API 启动：~5 秒
  - Web 启动：~3 秒
  - **总计**：~15 秒（冷启动）/ ~3 秒（热启动）

### 资源占用（预估）
- Rust 进程：~10 MB
- 子进程（API + Web）：~500 MB
- Docker 容器：~200 MB
- **总计**：~710 MB

---

## 🐛 已知问题

### 1. 图标为占位符
- 当前使用的是最小化的占位图标
- 需要设计师提供正式的 StoryForge 图标
- 可使用 https://icon.kitchen 快速生成

### 2. macOS .icns 为空
- 当前 icon.icns 是空文件
- macOS 构建时需要真实的 .icns 文件
- 可使用 `iconutil` 或在线工具生成

### 3. 项目根目录查找可能失败
- 开发模式下从 `target/debug/` 向上查找
- 生产模式（打包后）路径可能不同
- 需要测试打包后的行为

---

## 🚀 下一步

### 立即待办
1. ✅ 等待 Rust 编译完成
2. 🔄 运行 `pnpm desktop:dev` 测试
3. 📝 记录测试结果和遇到的问题
4. 🔧 根据测试结果修复 bug

### 后续阶段
- **阶段 2**：本地文件系统集成
- **阶段 3**：替换前端（纯 Monaco Editor）
- **阶段 4**：原生菜单栏

---

## 💡 经验总结

### 做得好的地方
1. **分步实现**：先健康检查，再进程管理，最后集成
2. **错误处理**：每个步骤都有清晰的错误信息和回退机制
3. **文档先行**：在实现前就明确了架构和流程
4. **工具脚本**：自动生成图标占位符，避免手动操作

### 可以改进的地方
1. **异步 vs 同步**：当前使用同步 API（`blocking`），可考虑异步版本
2. **配置化**：端口号、超时时间等硬编码，可改为配置文件
3. **日志系统**：当前使用 `println!`，可集成 `tracing` 或 `log`
4. **测试覆盖**：缺少单元测试和集成测试

---

## 📚 参考资料

- [Tauri 文档](https://v2.tauri.app/)
- [Rust 进程管理](https://doc.rust-lang.org/std/process/)
- [reqwest 文档](https://docs.rs/reqwest/)
- [anyhow 文档](https://docs.rs/anyhow/)

---

**报告生成时间**：2026-06-15 03:40
**作者**：Claude Code
**版本**：v1.0
