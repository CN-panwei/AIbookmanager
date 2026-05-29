# BookManager 项目开发规范

## 核心原则：用户数据神圣不可侵犯

本项目的所有个人数据都存储在本地文件中，一旦删除无法恢复。**任何情况下，修改代码时绝不能删除用户的数据文件。**

---

## 不可删除的用户数据

以下文件和目录包含用户的图书、笔记、配置等全部个人数据，**绝对禁止删除、覆盖或清空**：

```
bookmanager.db              # SQLite 数据库：分类、图书、笔记记录
.bookmanager_config.json    # 配置文件：DeepSeek API Key 等设置
books/                      # 图书原文件（PDF / EPUB）
static/covers/              # 图书封面图片
```

> ⚠️ **违规后果**：删除这些数据会导致用户所有上传的图书、写的笔记、保存的配置全部永久丢失。这是不可接受的事故。

---

## 测试规范

### 必须使用隔离的测试数据

测试时请使用**独立的数据库和目录**，绝不能使用生产环境的数据：

```bash
# ✅ 正确：使用临时数据库测试
TEST_DB=/tmp/test_bookmanager.db
TEST_BOOKS=/tmp/test_books

# ❌ 错误：绝对禁止的操作
rm -f bookmanager.db
rm -rf books/
rm -rf static/covers/
rm -f .bookmanager_config.json
```

### Python 测试示例

```python
import shutil
from pathlib import Path

# 测试前创建隔离环境
TEST_DIR = Path("/tmp/bookmanager_test")
TEST_DIR.mkdir(parents=True, exist_ok=True)

# 测试完成后只清理临时目录
def cleanup():
    shutil.rmtree(TEST_DIR, ignore_errors=True)
```

---

## 代码修改规范

### 允许修改的文件

仅限以下源代码文件可以修改：

```
*.py              # Python 后端代码
*.js              # JavaScript 前端代码
*.css             # 样式文件
*.html            # HTML 模板
requirements.txt  # Python 依赖
Dockerfile        # Docker 配置
docker-compose.yml
*.sh              # Shell 脚本
*.bat             # Windows 脚本
*.md              # 文档
```

### 禁止修改/删除的文件

```
bookmanager.db              # ❌ 禁止
.bookmanager_config.json    # ❌ 禁止
books/*                     # ❌ 禁止
static/covers/*             # ❌ 禁止
.backup/*                   # ❌ 禁止（自动备份目录）
backups/*                   # ❌ 禁止（手动备份目录）
```

---

## 数据库迁移规范

如果需要修改数据库结构：

1. **备份现有数据库**：
   ```bash
   cp bookmanager.db bookmanager.db.bak.$(date +%Y%m%d_%H%M%S)
   ```

2. **编写迁移脚本**：使用 `ALTER TABLE` 添加新字段，不要删除旧数据

3. **验证迁移成功**：确认原有数据完整保留

4. **绝对禁止**：直接删除旧数据库重新创建

---

## 启动脚本规范

### start.sh 的安全行为

`start.sh` 已经内置了自动备份逻辑，启动前会备份数据到 `.backup/`。修改启动脚本时：

- ✅ 可以添加新的启动选项
- ✅ 可以修改端口、日志级别等配置
- ❌ 禁止移除自动备份逻辑
- ❌ 禁止添加任何删除数据的命令

---

## Docker 相关

### docker-entrypoint.sh 的说明

`docker-entrypoint.sh` 中的 `rm -f` 命令**仅在 Docker 容器内部执行**，用于清理容器内的旧符号链接。这是 Docker 数据持久化方案的必要操作，不会触及宿主机数据。

修改 Docker 相关文件时：
- ✅ 可以调整端口映射
- ✅ 可以修改环境变量
- ❌ 禁止修改数据卷映射逻辑（`./data:/app/data`）
- ❌ 禁止移除符号链接创建逻辑

---

## 数据备份策略

### 自动备份

`start.sh` 每次启动会自动备份到 `.backup/` 目录。

### 手动备份

```bash
./backup.sh
# 备份会保存到 backups/YYYYMMDD_HHMMSS/
```

### 恢复数据

```bash
# 从自动备份恢复
cp .backup/bookmanager.db ./
cp .backup/.bookmanager_config.json ./
cp -r .backup/books ./
cp -r .backup/covers ./static/

# 从手动备份恢复
cp backups/20240101_120000/bookmanager.db ./
```

---

## 审查清单

提交代码前，确认：

- [ ] 没有 `rm -f bookmanager.db` 或类似命令
- [ ] 没有 `rm -rf books/` 或 `rm -rf static/covers/`
- [ ] 没有清空/重置数据库的操作
- [ ] 测试使用了隔离的临时数据
- [ ] 如果修改了数据库结构，已有迁移脚本且数据完整

---

## 违规处理

如果意外删除了用户数据：

1. 立即停止所有操作
2. 检查 `.backup/` 或 `backups/` 目录是否有备份
3. 尝试从备份恢复
4. 向用户诚恳道歉并解释原因
5. 修复导致数据丢失的代码，确保不再发生
