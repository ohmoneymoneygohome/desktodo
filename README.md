# 桌面效率面板

Windows 桌面常驻应用：右侧小图标收起，鼠标悬停展开应用启动器和 Todo 清单。

## 开发运行

```powershell
npm install
npm start
```

## 生成 Windows 目录版

```powershell
npm run dist
```

生成目录：

`release\win-unpacked\桌面效率面板.exe`

## 当前能力

- 无边框透明窗口
- 桌面右侧收起与悬停展开
- 托盘显示、隐藏、退出
- 扫描开始菜单和桌面快捷方式
- 按应用名称自动分类
- 点击快捷方式启动 Windows 应用
- Todo 新增、编辑、完成、删除
- Todo 本地持久化
- 托盘菜单开机启动开关
