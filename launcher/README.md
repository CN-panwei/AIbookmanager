# macOS 启动方式

## 方式一：Dock 图标双击启动（推荐）

适合不想开终端、想像普通 App 一样使用的用户。

### 安装步骤

1. 将 `launcher/BookManager.app` **复制**到项目根目录（与 `start.sh` 同级）
2. 右键点击 `BookManager.app` → 「显示简介」→ 可以拖一个图标到左上角替换默认图标
3. 将 `BookManager.app` **拖到 Dock** 栏上
4. 以后点击 Dock 图标即可启动，服务在后台运行，浏览器自动打开

> ⚠️ 注意：macOS 可能会提示「无法打开，因为无法验证开发者」，右键点击 → 「打开」即可。

---

## 方式二：终端命令 `bm` 启动

适合习惯用终端的用户，输入 `bm` 就能启动。

### 安装步骤

```bash
# 创建全局命令（只需执行一次）
ln -s "$(pwd)/launcher/bm" /usr/local/bin/bm

# 以后在任意目录输入
bm
```

如果不想创建全局命令，也可以添加到 `.zshrc` 别名：

```bash
echo 'alias bm="cd $(pwd) && ./start.sh"' >> ~/.zshrc
source ~/.zshrc

# 以后在终端输入
bm
```

---

## 方式三：双击 `.command` 文件启动

适合想看到终端输出、方便排查问题的用户。

### 安装步骤

1. 将 `launcher/BookManager.command` **复制**到项目根目录
2. 右键点击 → 「显示简介」→ 勾选「以终端方式打开」（如果未勾选）
3. 以后双击该文件，会自动打开 Terminal 并启动服务

---

## 方式四：键盘快捷键启动

适合喜欢快捷键的高级用户。

### 用 Raycast（推荐）

如果你已安装 [Raycast](https://www.raycast.com/)：

1. 打开 Raycast → 搜索 "Create Script Command"
2. 选择 Bash，输入：
   ```bash
   #!/bin/bash
   cd /你的项目路径/BookManager
   ./start.sh
   ```
3. 设置标题为 "BookManager"，保存
4. 以后按 `Option + Space` 打开 Raycast，输入 `BookManager` 回车即可

### 用 macOS 自带快捷键

1. 打开「自动操作」(Automator) → 新建「快速操作」
2. 左侧选择「运行 Shell 脚本」，输入：
   ```bash
   cd /你的项目路径/BookManager && ./start.sh
   ```
3. 保存为 "启动 BookManager"
4. 打开「系统设置」→ 「键盘」→ 「键盘快捷键」→ 「服务」
5. 找到「启动 BookManager」，绑定一个快捷键（如 `Ctrl + Option + B`）
6. 以后按该快捷键即可启动
