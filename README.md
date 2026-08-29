# 记词星 wordmemo

基于 **FSRS 间隔重复算法**的背单词 PWA（渐进式 Web 应用），完全兼容 **Anki 词库（.apkg）导入**，专为小孩背单词和语文课文背诵设计。

> 在线使用：https://savagezhao-ai.github.io/rouroustudy/

## 功能特性

- **FSRS 调度算法** — 与 Anki 26.x 内置的同一套算法（[ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)），科学计算每张卡片的最佳复习时机，目标记忆保持率 90%
- **Anki 词库直接导入** — 解析 .apkg 文件（zip + SQLite），自动识别单词/音标/释义字段，保留模板全部字段（牛津双解、简明、词根等），复习翻面后分区折叠显示
- **Anki 式翻卡复习** — 正面看单词 → 点击翻面查全部释义 → 忘记/困难/良好/简单四档自评，忘记的卡片自动追加队尾
- **多用户** — 只需用户名（无密码），每个用户独立 IndexedDB 数据库，学习进度完全隔离；默认用户 def 不可删除
- **多词库管理** — 可同时管理多个词库，单独学习某个词库，每库每天新词上限独立控制
- **发音设置** — Web Speech API，支持音色选择和语速调节
- **PWA 离线可用** — 可安装到手机桌面，Service Worker 预缓存全部资源，无网络也能复习
- **响应式布局** — 手机单列 / 宽屏双列，字典分区按需展开

## 技术栈

React 19 + TypeScript + Vite · ts-fsrs（FSRS 调度） · sql.js（解析 Anki 的 SQLite 数据） · fflate（解压 .apkg） · idb（IndexedDB 封装） · vite-plugin-pwa

## 快速开始

```bash
npm install
npm run dev        # 开发
npm run build      # 构建（产物在 dist/）
npm run preview    # 本地预览构建产物
```

## 在线使用指南

打开 [在线应用](https://savagezhao-ai.github.io/rouroustudy/) 即可使用，无需注册。数据保存在浏览器本地，换设备/换浏览器数据不互通。

### 1. 新建学习账号

首页左上角「＋新建账号」→ 输入名字（如小孩的名字）→ 确认。每个账号的学习进度完全独立，点击首页顶部的用户名即可切换。默认用户 def 不可删除。

### 2. 导入 Anki 词库

1. 进入「词库管理」→ 点击「📥 导入 Anki 词库（.apkg）」
2. 选择下载好的 .apkg 文件，导入会自动创建同名词库，并保留模板全部字段（牛津双解、简明、词根等）
3. 示例词库（小学英语词汇）可直接下载体验：

   https://github.com/andylee1890/AnkiShare/releases/download/primary-school-vocabulary-v1.0.0/Primary-School-English-Vocabulary.apkg

### 3. 开始学习

- 首页选好词库，点「开始学习」，每天默认 10 个新词 + 全部到期复习词
- 复习采用 Anki 翻卡模式：先看单词想一想 → 点击卡片翻面查看释义 → 根据记忆情况自评四档（忘记/困难/良好/简单），算法会据此安排下次复习时间
- 翻面后各字典分区（牛津双解、朗文等）默认折叠，点击条目展开查看
- 点「忘记」的卡片会追加到队尾，本轮内还会再出现
- 全部完成后可「整库循环练一轮」巩固
- 电脑上支持键盘：空格翻面，1-4 键评分

## 数据存储

全部数据存在浏览器本地 IndexedDB（按用户分库），不上传任何服务器。词库管理里可导入 Anki 官网下载的 .apkg 词库文件、JSON 词表，或手动添加单词。

## 致谢

- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)（MIT）— FSRS 算法的 TypeScript 实现
- [sql.js](https://github.com/sql-js/sql.js)（MIT）— 浏览器端 SQLite
- [fflate](https://github.com/101arrowz/fflate)（MIT）— 高性能解压缩
- 灵感来自 [Anki](https://apps.ankiweb.net/)
