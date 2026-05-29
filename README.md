# BookManager - 本地图书管理

一款轻量级的本地图书管理 Web 应用，支持 PDF/EPUB 导入、AI 生成书籍简介与笔记、Markdown 笔记编辑。

## 功能特性

- 📚 **图书管理**：上传 PDF / EPUB，自动提取封面、标题、作者、页数等元数据
- 📁 **分类管理**：手动创建分类，图书自动按分类存入对应文件夹
- 🤖 **DeepSeek AI 集成**：一键生成书籍简介；根据提示词生成结构化笔记
- 📝 **Markdown 笔记**：每本书支持多篇笔记，AI 生成后可手动编辑，支持格式工具栏
- 🔍 **搜索**：按书名、作者实时搜索
- 🎨 **现代 UI**：响应式卡片布局，优雅的交互体验

## 快速启动

### macOS（推荐）

把 `launcher/BookManager.app` 拖到 **Dock** 栏，以后像普通 App 一样点击图标即可启动。

或者输入命令一键启动：

```bash
./start.sh
```

详细启动方式见 [`launcher/README.md`](launcher/README.md)，包括：
- **Dock 图标双击**（像普通 App）
- **终端命令 `bm`**（全局快捷命令）
- **键盘快捷键**（Raycast 或系统快捷键）
- **双击 `.command` 文件**（在 Terminal 中启动）

### Windows

双击 `start.bat`，或在命令行中运行：

```cmd
start.bat
```

### 手动启动

如果你更喜欢手动控制：

```bash
# 1. 创建虚拟环境
python3 -m venv venv

# 2. 激活虚拟环境
source venv/bin/activate      # macOS/Linux
venv\Scripts\activate.bat     # Windows

# 3. 安装依赖
pip install -r requirements.txt

# 4. 启动
python main.py
```

浏览器打开：http://localhost:8000

## 使用说明

1. **创建分类**：左侧边栏点击「新建分类」，输入分类名称
2. **上传图书**：点击顶部 📤 按钮，选择分类和 PDF/EPUB 文件（支持拖拽上传）
3. **生成简介**：打开图书详情，点击「✨ 生成简介」按钮（需先配置 DeepSeek API Key）
4. **创建笔记**：在图书详情右侧笔记区域点击「+ 新建笔记」
5. **AI 生成笔记**：在笔记编辑器中点击「🤖 AI 生成」，输入提示词（如"总结核心观点"）
6. **配置 API**：点击顶部 ⚙️ 设置按钮，输入 DeepSeek API Key

## 项目结构

```
├── main.py              # FastAPI 入口
├── database.py          # SQLite 数据库操作
├── config.py            # 配置管理
├── start.sh             # macOS/Linux 一键启动脚本
├── start.bat            # Windows 一键启动脚本
├── requirements.txt     # Python 依赖
├── services/
│   ├── book_parser.py   # PDF/EPUB 解析与封面提取
│   ├── ai_service.py    # DeepSeek API 调用
│   └── file_service.py  # 文件分类存储
├── static/              # 前端静态资源
├── templates/           # HTML 模板
├── books/               # 图书原文件存储目录
└── bookmanager.db       # SQLite 数据库文件
```

## 技术栈

- **后端**：FastAPI + SQLite + PyMuPDF + ebooklib
- **前端**：原生 HTML/CSS/JS + Toast UI Editor
- **AI**：DeepSeek API（兼容 OpenAI 格式）

## 注意事项

- 图书文件按分类存储在 `books/` 目录下，删除分类时可选择是否同时删除图书文件
- 封面图片存储在 `static/covers/`，与数据库记录关联
- API Key 保存在本地 `.bookmanager_config.json` 文件中，请勿上传至公开仓库
