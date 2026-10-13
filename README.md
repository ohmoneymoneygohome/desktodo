# desktodo

> Languages: [中文](#中文) | [English](#english) | [日本語](#日本語) | [한국어](#한국어)

## 中文

desktodo 是一个基于 AI 接口的 Windows 桌面快速启动工具。它把应用启动器、AI 应用整理和 Todo 任务面板放在一个简洁干净的桌面侧边栏里，适合希望快速打开常用软件、快速记录任务，并让 AI 辅助整理工作流的用户。

和传统启动器相比，desktodo 不只是列出应用。它可以扫描开始菜单和桌面快捷方式，通过 AI 根据应用名称、路径、发布者等信息自动整理分类；右侧同时提供 Todo List，可以快速创建、编辑、完成任务，并让 AI 帮你分析待办事项、规划今天可以执行的任务。

### 核心特点

- 桌面右侧常驻：默认收起为小图标，鼠标悬停即可展开。
- 快速应用启动：扫描 Windows 开始菜单和桌面快捷方式，点击即可启动应用。
- AI 应用整理：接入 OpenAI 兼容接口后，可自动分析应用用途并生成分类。
- Todo List：快速新增、编辑、完成、删除任务，本地持久化保存。
- AI 任务规划：基于当前 Todo，让 AI 帮你分析任务并生成可执行计划。
- 历史记录：已完成任务可进入历史窗口查看。
- 托盘控制：支持显示、隐藏、退出和开机启动开关。
- 简洁干净：没有复杂附属项，目标是做一个轻量、直接、可修改的桌面效率工具。

### AI 接口说明

应用支持 OpenAI 兼容接口。你可以在应用内填写：

- API Key
- Base URL
- Model

默认配置偏向 OpenAI API，也可以根据自己的服务商修改为兼容接口。API Key 会通过 Electron 的 `safeStorage` 加密后保存到本机用户数据目录。

### 开发运行

```powershell
npm install
npm start
```

### 生成 Windows 目录版

```powershell
npm run dist
```

生成目录：

```text
release\win-unpacked\桌面效率面板.exe
```

### 项目结构

```text
main.js                     Electron 主进程、窗口、托盘、应用扫描、AI 调用
preload.js                  渲染进程安全桥接
desktop-utility-panel.html  主界面
todo-history.html           Todo 历史窗口
build.js                    Windows 打包脚本
package.json                项目脚本和 Electron Builder 配置
```

### 欢迎修改优化

这个项目保持了比较直接的结构，方便继续改造。欢迎大家根据自己的桌面习惯优化交互、分类逻辑、任务规划方式、UI 细节、打包方式，或者接入更多 AI 服务。

---

## English

desktodo is an AI-powered Windows desktop launcher and Todo panel. It stays on the right side of your desktop, collapses into a small icon, and expands on hover so you can quickly launch apps, create tasks, and let AI help organize your workflow.

Unlike traditional launchers, desktodo can scan Start Menu and desktop shortcuts, then use an OpenAI-compatible API to classify applications by their purpose. It also includes a clean Todo List where you can quickly create, edit, complete, and review tasks. AI can analyze your current tasks and generate an actionable plan for the day.

### Features

- Right-side desktop panel with collapsed and expanded states.
- Fast Windows app launching from Start Menu and desktop shortcuts.
- AI-assisted app classification through an OpenAI-compatible API.
- Local Todo creation, editing, completion, deletion, and persistence.
- AI task analysis and daily planning based on your current Todo list.
- Completed task history window.
- Tray menu for show, hide, quit, and startup control.
- Clean and lightweight design with no unnecessary extras.

### Development

```powershell
npm install
npm start
```

### Build for Windows

```powershell
npm run dist
```

Output:

```text
release\win-unpacked\桌面效率面板.exe
```

Contributions and custom modifications are welcome.

---

## 日本語

desktodo は、AI インターフェースを利用した Windows 向けのデスクトップ高速ランチャー兼 Todo パネルです。画面右側に常駐し、通常は小さなアイコンとして折りたたまれ、マウスを近づけると展開してアプリ起動やタスク管理をすばやく行えます。

従来のランチャーと違い、desktodo はスタートメニューやデスクトップのショートカットをスキャンし、OpenAI 互換 API を使ってアプリを自動分類できます。右側の Todo List ではタスクを素早く作成でき、AI にタスクの分析や実行計画の作成を任せることもできます。

### 主な機能

- 右側に常駐する折りたたみ式デスクトップパネル。
- Windows アプリの高速起動。
- AI によるアプリ分類。
- Todo の作成、編集、完了、削除、ローカル保存。
- AI によるタスク分析と計画作成。
- 完了済みタスクの履歴表示。
- トレイメニューによる表示、非表示、終了、スタートアップ設定。
- 余計な機能を入れないシンプルな設計。

---

## 한국어

desktodo는 AI 인터페이스를 기반으로 한 Windows 데스크톱 빠른 실행 도구이자 Todo 패널입니다. 화면 오른쪽에 작은 아이콘으로 접혀 있다가 마우스를 올리면 펼쳐져 앱 실행, 작업 생성, AI 기반 작업 분석을 빠르게 사용할 수 있습니다.

일반적인 런처와 달리 desktodo는 시작 메뉴와 바탕화면 바로가기를 스캔하고, OpenAI 호환 API를 통해 앱의 용도를 분석해 자동으로 분류할 수 있습니다. 오른쪽 Todo List에서는 작업을 빠르게 만들고 수정하며, AI가 현재 작업을 분석해 실행 계획을 제안할 수 있습니다.

### 주요 기능

- 오른쪽에 고정되는 접이식 데스크톱 패널.
- Windows 앱 빠른 실행.
- AI 기반 앱 분류.
- Todo 생성, 편집, 완료, 삭제 및 로컬 저장.
- AI 기반 작업 분석과 실행 계획 생성.
- 완료된 작업 기록 보기.
- 트레이 메뉴를 통한 표시, 숨김, 종료, 시작 프로그램 설정.
- 불필요한 부가 기능을 줄인 깔끔한 구조.
