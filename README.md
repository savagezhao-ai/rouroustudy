# 记词星 wordmemo

基于 **FSRS 间隔重复算法**的背单词 PWA（渐进式 Web 应用），完全兼容 **Anki 词库（.apkg）导入**，专为小孩背单词设计。

> 在线使用：https://savagezhao-ai.github.io/rouroustudy/

## 功能特性

- **FSRS 调度算法** — 与 Anki 26.x 内置的同一套算法（[ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)），科学计算每张卡片的最佳复习时机，目标记忆保持率 90%
- **Anki 词库直接导入** — 解析 .apkg 文件（zip + SQLite），自动识别单词/音标/释义字段，保留模板全部字段（牛津双解、简明、词根等），复习翻面后分区折叠显示
- **Anki 式翻卡复习** — 正面看单词 → 点击翻面查全部释义 → 忘记/困难/良好/简单四档自评，忘记的卡片自动追加队尾
- **多用户** — 只需用户名（无密码），每个用户独立 IndexedDB 数据库，学习进度完全隔离；默认用户 def 不可删除
- **多词库管理** — 可同时管理多个词库，单独学习某个词库，每库每天新词上限独立控制
- **内置牛津英汉双解词典** — 约 3 万词条（牛津高阶双解），保留词条原文：释义、例句、用法注记、习语、词形变化与考试级别（中考/高考/牛津 3000/柯林斯星级）一应俱全；全屏词典页面，复习中途点🔍直接查当前单词
- **整条自动朗读** — 查词后自动读单词三遍，再从上往下整条朗读原文：按中英文自动分段切换嗓音，语言切换处有停顿，中文括号处有 0.5 秒停顿；词典缩写（sb/sth/esp 等）朗读前自动展开成完整词，显示不受影响
- **发音设置** — 中英文音色**分开**选择、语速独立调节，即改即生效；支持试听
- **数据备份** — 一键导出全部学习进度（词库、单词、卡片状态、复习记录、设置）为 JSON 文件，换设备或清缓存后可完整恢复，支持覆盖与合并两种导入方式
- **PWA 离线可用** — 可安装到手机桌面；应用资源预缓存，词典数据下载一次后存 IndexedDB 完全离线可用
- **响应式布局** — 手机单列 / 宽屏双列，字典分区按需展开

## 技术栈

React 19 + TypeScript + Vite · ts-fsrs（FSRS 调度） · sql.js（解析 Anki 的 SQLite 数据） · fflate（解压 .apkg） · idb（IndexedDB 封装） · vite-plugin-pwa · Vitest（101 个测试）

## 快速开始

```bash
npm install
npm run dev        # 开发
npm run build      # 构建（产物在 dist/）
npm run preview    # 本地预览构建产物
npm test           # 运行测试
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

### 3. 查词典

- 首页点「📖 查词典」，或复习时点卡片上的 🔍 / 顶部「📖 查词」，直接查当前单词
- 词典是**全屏独立页面**（带返回箭头），不打断复习进度
- 首次使用需下载词典数据约 6.5MB，之后完全离线可用
- 词条原文完整保留（释义 + 例句 + 用法注记 + 习语），按义项分行显示；🔊 朗读整条，单词本身也可点击朗读
- 自动朗读顺序：单词三遍（间隔 1 秒）→ 整条原文，中文用中文嗓、英文用英文嗓，切换有停顿
- 支持查变形词：`dogs` → `dog`、`ran` → `run`、`went` → `go`

### 4. 发音设置

「词库管理」→「发音设置」：

- **英文语音** / **中文语音** 两个独立下拉，各自的音色互不干扰（保证中文一定用中文嗓朗读）
- **语速**滑杆独立调节（0.5x – 1.3x）
- 所有改动**即改即生效**（同时落盘与刷新内存），点「试听」/「试听中文」验证

### 5. 开始学习

- 首页选好词库，点「开始学习」，每天默认 10 个新词 + 全部到期复习词
- 复习采用 Anki 翻卡模式：先看单词想一想 → 点击卡片翻面查看释义 → 根据记忆情况自评四档（忘记/困难/良好/简单），算法会据此安排下次复习时间
- 翻面后各字典分区（牛津双解、朗文等）默认折叠，点击条目展开查看
- 点「忘记」的卡片会追加到队尾，本轮内还会再出现
- 全部完成后可「整库循环练一轮」巩固
- 电脑上支持键盘：空格翻面，1-4 键评分

### 6. 数据备份与恢复

学习进度只存在浏览器本地，建议定期备份：

1. 进入「词库管理」→「数据备份」→ 点击「⬇ 导出备份」，浏览器会下载一个 JSON 文件（含词库、单词、学习进度、复习记录和设置）
2. 换设备或清缓存后，在同一入口点「⬆ 从备份恢复」选择文件，再选导入方式：
   - **合并** — 保留现有词库，只把备份里的内容并进来
   - **覆盖** — 清空当前账号数据，完全按备份恢复（恢复到旧设备时选这个）

## 数据存储

全部数据存在浏览器本地 IndexedDB（按用户分库），不上传任何服务器。词库管理里可导入 Anki 官网下载的 .apkg 词库文件、JSON 词表，或手动添加单词。

词典数据单独存放在 `rouroustudy_dict` 库（所有用户共用，不随账号切换而变），按版本号自动更新——发新版词典后 App 会自动重新下载覆盖旧数据。

## 词典数据

词典数据来自 **牛津高阶英汉双解（stardict-oxford-gb，GPL）**，由转换脚本（`.dict-build/build_oxford.py`）生成到 `public/dict/`（约 6.5MB，3 万词条）：

- 解析 Stardict 格式（`.dict.dz` 多段 gzip + `.idx` 偏移切片，纯标准库实现）
- 最小清洗：剥 HTML 标签、去行首音标、词性头转中文（`indef det` → 限定词）、`*` 例句分隔符转换行、交叉引用 `=`/`Cf` 转「参见」、半角括号转全角、去重音反引号
- 释义、例句、用法注记、习语**全部保留**，不做结构化拆分
- 元数据（词形变化、柯林斯星级、牛津 3000、考试标签、词频）按词从 [ECDICT](https://github.com/skywind3000/ecdict)（MIT）合并
- 重复词头按小写词合并（如字母 `a` 与冠词 `a`），`manifest.count` 即真实入库数

> 旧的 ECDICT 生成脚本 `scripts/build-dict.mjs`（`npm run build:dict`）保留可用，但当前线上数据源为牛津版。

## 部署

GitHub Pages，构建后通过 git worktree 同步 `dist/` 到 `gh-pages` 分支：

```bash
git commit -m "..."      # 先提交（构建版本号取自 commit hash，确保 SW 注册 URL 变化）
npm run build            # 再构建
git worktree add -f /tmp/gh-pages-wt gh-pages
# 用 dist/* 覆盖 worktree 内容后提交推送 gh-pages
```

- Service Worker 对 `/dict/` 采用 **NetworkOnly**（词典数据只存 IndexedDB，不做 HTTP 缓存），避免「换了词典还读旧数据」的缓存陷阱
- 页脚显示当前构建版本 + 词典版本，并有「强制刷新」按钮（注销全部 SW + 清空词典库 + 重载）

## 致谢

- **牛津高阶英汉双解词典** Stardict 版（`stardict-oxford-gb`，GPL）— 词典数据
- [ECDICT](https://github.com/skywind3000/ecdict)（MIT）— 词形变化、柯林斯星级、考试标签等元数据
- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)（MIT）— FSRS 算法的 TypeScript 实现
- [sql.js](https://github.com/sql-js/sql.js)（MIT）— 浏览器端 SQLite
- [fflate](https://github.com/101arrowz/fflate)（MIT）— 高性能解压缩
- 灵感来自 [Anki](https://apps.ankiweb.net/)
