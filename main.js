const {
    app,
    BrowserWindow,
    Tray,
    Menu,
    ipcMain,
    screen,
    shell,
    dialog,
    safeStorage
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const OpenAI = require("openai");
const execFileAsync = promisify(execFile);
const COLLAPSED_WIDTH = 64;
const EXPANDED_WIDTH = 760;
const WINDOW_HEIGHT = 650;
const RIGHT_GAP = 18;
const TODO_HISTORY_FILE = "todo-history.json";
const PANEL_POSITION_FILE = "panel-position.json";
const MIN_EXPANDED_WIDTH = 620;
const MIN_EXPANDED_HEIGHT = 460;

let mainWindow;
let tray;
let isExpanded = false;
let isQuitting = false;
let expandedBounds;
let collapsedPosition;
let historyWindow;
const AI_CONFIG_FILE = "ai-config.json";

function getPanelPositionPath() {
    return path.join(app.getPath("userData"), PANEL_POSITION_FILE);
}

function readCollapsedPosition() {
    try {
        const value = JSON.parse(fs.readFileSync(getPanelPositionPath(), "utf8"));
        if (Number.isFinite(value?.x) && Number.isFinite(value?.y)) {
            return { x: value.x, y: value.y };
        }
    } catch {
        // Use the right-side default when no position has been saved.
    }
    return null;
}

function saveCollapsedPosition(position) {
    try {
        fs.mkdirSync(path.dirname(getPanelPositionPath()), { recursive: true });
        fs.writeFileSync(getPanelPositionPath(), JSON.stringify(position), "utf8");
    } catch (error) {
        log(`panel position save failed ${error.message || error}`);
    }
}

function getTodoHistoryPath() {
    return path.join(app.getPath("userData"), TODO_HISTORY_FILE);
}

function readTodoHistoryFile() {
    const filePath = getTodoHistoryPath();
    try {
        if (!fs.existsSync(filePath)) {
            return { path: filePath, exists: false, todos: [], nextSerial: 1 };
        }
        const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
        const todos = Array.isArray(payload) ? payload : payload?.todos;
        const normalizedTodos = (Array.isArray(todos) ? todos : [])
            .filter(todo => todo && todo.done === true);
        const usedSerials = new Set();
        let highestSerial = 0;
        normalizedTodos.forEach(todo => {
            const serial = Number(todo?.serial);
            if (Number.isInteger(serial) && serial > 0 && !usedSerials.has(serial)) {
                todo.serial = serial;
                usedSerials.add(serial);
                highestSerial = Math.max(highestSerial, serial);
            } else {
                todo.serial = null;
            }
        });
        normalizedTodos
            .filter(todo => !todo.serial)
            .sort((a, b) => (Number(a?.completedAt) || Number(a?.createdAt) || 0) - (Number(b?.completedAt) || Number(b?.createdAt) || 0))
            .forEach(todo => {
                todo.serial = ++highestSerial;
            });
        normalizedTodos.sort((a, b) => (Number(a?.serial) || 0) - (Number(b?.serial) || 0));
        const storedNextSerial = Number(Array.isArray(payload) ? 0 : payload?.nextSerial) || 0;
        return {
            path: filePath,
            exists: true,
            todos: normalizedTodos,
            nextSerial: Math.max(highestSerial + 1, storedNextSerial || 1)
        };
    } catch (error) {
        log(`todo history read failed ${error.message || error}`);
        return { path: filePath, exists: false, todos: [], nextSerial: 1 };
    }
}

function saveTodoHistoryFile(input) {
    const filePath = getTodoHistoryPath();
    const directory = path.dirname(filePath);
    const temporaryPath = `${filePath}.tmp`;
    const existing = readTodoHistoryFile();
    const todos = Array.isArray(input) ? input : input?.todos;
    const mergedByKey = new Map();
    for (const todo of existing.todos) {
        const key = String(todo?.id || `serial:${todo?.serial || ""}`);
        if (key !== "serial:") mergedByKey.set(key, { ...todo });
    }
    let nextSerial = Math.max(
        Number(existing.nextSerial) || 1,
        Number(input?.nextSerial) || 1,
        ...existing.todos.map(todo => Number(todo?.serial) || 0)
    );
    for (const todo of (Array.isArray(todos) ? todos : []).filter(todo => todo && todo.done === true)) {
        const key = String(todo?.id || `serial:${todo?.serial || ""}`);
        if (key === "serial:") continue;
        const previous = mergedByKey.get(key);
        const merged = previous ? { ...previous, ...todo } : { ...todo };
        if (!previous || !Number.isInteger(Number(merged.serial)) || Number(merged.serial) <= 0) {
            merged.serial = nextSerial++;
        } else {
            merged.serial = Number(merged.serial);
            nextSerial = Math.max(nextSerial, merged.serial + 1);
        }
        mergedByKey.set(key, merged);
    }

    const mergedTodos = Array.from(mergedByKey.values())
        .sort((a, b) => (Number(a?.serial) || 0) - (Number(b?.serial) || 0));
    const payload = {
        version: 2,
        updatedAt: Date.now(),
        nextSerial,
        todos: mergedTodos
    };

    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(temporaryPath, JSON.stringify(payload, null, 2), "utf8");
    fs.renameSync(temporaryPath, filePath);
    return { ok: true, path: filePath, nextSerial: payload.nextSerial, count: mergedTodos.length };
}

async function openTodoHistoryFile() {
    const filePath = getTodoHistoryPath();
    if (!fs.existsSync(filePath)) {
        saveTodoHistoryFile([]);
    }
    const error = await shell.openPath(filePath);
    return error ? { ok: false, error, path: filePath } : { ok: true, path: filePath };
}

function getAIConfigPath() {
    return path.join(app.getPath("userData"), AI_CONFIG_FILE);
}

function readAIConfigFile() {
    try {
        const filePath = getAIConfigPath();
        if (!fs.existsSync(filePath)) {
            return { model: "gpt-4o-mini", baseURL: "https://api.openai.com/v1", apiKeyEncrypted: "" };
        }
        return {
            model: "gpt-4o-mini",
            baseURL: "https://api.openai.com/v1",
            ...JSON.parse(fs.readFileSync(filePath, "utf8"))
        };
    } catch (error) {
        log(`ai config read failed ${error.message || error}`);
        return { model: "gpt-4o-mini", baseURL: "https://api.openai.com/v1", apiKeyEncrypted: "" };
    }
}

function getAIConfig() {
    const config = readAIConfigFile();
    return {
        model: config.model || "gpt-4o-mini",
        baseURL: config.baseURL || "https://api.openai.com/v1",
        hasApiKey: Boolean(config.apiKeyEncrypted)
    };
}

function saveAIConfig(config = {}) {
    const current = readAIConfigFile();
    const next = {
        model: String(config.model || current.model || "gpt-4o-mini").trim(),
        baseURL: String(config.baseURL || current.baseURL || "https://api.openai.com/v1").trim().replace(/\/+$/, ""),
        apiKeyEncrypted: current.apiKeyEncrypted || ""
    };

    if (config.clearApiKey) {
        next.apiKeyEncrypted = "";
    } else if (typeof config.apiKey === "string" && config.apiKey.trim()) {
        if (!safeStorage.isEncryptionAvailable()) {
            return { ok: false, error: "Windows 安全存储不可用，无法安全保存 API Key" };
        }
        next.apiKeyEncrypted = safeStorage.encryptString(config.apiKey.trim()).toString("base64");
    }

    fs.mkdirSync(path.dirname(getAIConfigPath()), { recursive: true });
    fs.writeFileSync(getAIConfigPath(), JSON.stringify(next, null, 2), "utf8");
    return { ok: true, ...getAIConfig() };
}

function getStoredApiKey() {
    const encrypted = readAIConfigFile().apiKeyEncrypted;
    if (!encrypted || !safeStorage.isEncryptionAvailable()) return "";
    try {
        return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    } catch (error) {
        log(`ai key decrypt failed ${error.message || error}`);
        return "";
    }
}

function getAIClient(overrides = {}) {
    const config = readAIConfigFile();
    const apiKey = String(overrides.apiKey || getStoredApiKey()).trim();
    if (!apiKey) {
        throw new Error("请先在 AI 设置中填写 API Key");
    }
    return {
        client: new OpenAI({
            apiKey,
            baseURL: String(overrides.baseURL || config.baseURL || "https://api.openai.com/v1").replace(/\/+$/, "")
        }),
        model: String(overrides.model || config.model || "gpt-4o-mini").trim()
    };
}

async function runAI(input, instructions, overrides = {}) {
    const { client, model } = getAIClient(overrides);
    try {
        const response = await client.responses.create({
            model,
            instructions,
            input
        });
        return response.output_text || "";
    } catch (error) {
        if (!/not found|unsupported|unknown|404/i.test(String(error.message || ""))) {
            throw error;
        }
        const messages = [
            { role: "system", content: instructions },
            { role: "user", content: typeof input === "string" ? input : JSON.stringify(input) }
        ];
        const completion = await client.chat.completions.create({ model, messages, temperature: 0.2 });
        return completion.choices?.[0]?.message?.content || "";
    }
}

function parseAIJson(text) {
    const raw = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    try {
        return JSON.parse(raw);
    } catch {
        const start = Math.min(...["[", "{"].map(mark => {
            const index = raw.indexOf(mark);
            return index < 0 ? Number.MAX_SAFE_INTEGER : index;
        }));
        const end = Math.max(raw.lastIndexOf("]"), raw.lastIndexOf("}"));
        if (start === Number.MAX_SAFE_INTEGER || end < start) {
            throw new Error("AI 返回的不是有效 JSON");
        }
        return JSON.parse(raw.slice(start, end + 1));
    }
}

async function testAIConfig(config) {
    const text = await runAI("只回复 OK", "你是连接测试助手。只输出 OK。", config);
    return { ok: text.trim().toLowerCase().includes("ok"), reply: text.trim() };
}

async function classifyApps(apps) {
    const safeApps = (Array.isArray(apps) ? apps : [])
        .filter(item => String(item?.name || "").trim())
        .map((item, index) => {
            const target = String(item?.launchPath || item?.path || "");
            return {
                index,
                name: String(item?.name || "").trim().slice(0, 120),
                executable: path.basename(target, path.extname(target)).slice(0, 120),
                path: target.slice(0, 500),
                publisher: String(item?.publisher || "").slice(0, 160),
                installLocation: String(item?.installLocation || "").slice(0, 300),
                currentCategory: String(item?.category || "待 AI 分类")
            };
        });
    const text = await runAI(
        JSON.stringify(safeApps),
        "你是 Windows 应用用途分析和整理助手。根据每个应用的名称、可执行文件名、发布者和安装路径，判断它的主要用途并自行设计分类。分类数量、分类名称和分类边界完全由你决定，不要使用固定分类白名单。应尽量形成少量但有区分度的类别，通常为 3 到 12 类；只有确有必要时才创建更细的类别。相近用途应归为同一类，无法判断的应用可以归入你自行命名的“其他”或“待确认”类。必须为输入中的每个 index 返回一项，不能遗漏、合并或创建不存在的应用。返回严格 JSON 数组，不要 Markdown，格式为 [{\"index\":0,\"category\":\"你决定的分类名称\",\"reason\":\"不超过 80 字的判断依据\"}]。",
    );
    const result = parseAIJson(text);
    if (!Array.isArray(result)) return [];
    const validIndexes = new Set(safeApps.map(item => item.index));
    const usedIndexes = new Set();
    return result.map(item => {
        const index = Number(item?.index);
        const category = String(item?.category || "").trim().replace(/\s+/g, " ").slice(0, 40);
        const reason = String(item?.reason || "").trim().slice(0, 300);
        if (!Number.isInteger(index) || !validIndexes.has(index) || usedIndexes.has(index) || !category) {
            return null;
        }
        usedIndexes.add(index);
        return { index, category, reason };
    }).filter(Boolean);
}

async function planTodos(todos) {
    const safeTodos = (Array.isArray(todos) ? todos : []).map(todo => ({
        serial: todo?.serial,
        text: String(todo?.text || "").slice(0, 300),
        note: String(todo?.note || "").slice(0, 1000),
        createdAt: todo?.createdAt
    }));
    const text = await runAI(
        JSON.stringify(safeTodos),
        "你是个人效率助手。基于用户的未完成 Todo，规划今天可以执行的任务。必须返回严格 JSON 对象，不要 Markdown，不要解释。格式为：{\"summary\":\"一句话规划摘要\",\"tasks\":[{\"text\":\"任务标题\",\"note\":\"执行说明，可为空\",\"estimatedMinutes\":30}]}。tasks 只允许返回真实、具体、可执行的任务；如果没有未完成 Todo，tasks 可以为空数组。estimatedMinutes 必须是 5 到 480 的整数。",
    );
    const parsed = parseAIJson(text);
    const source = Array.isArray(parsed) ? { summary: "", tasks: parsed } : parsed;
    const tasks = (Array.isArray(source?.tasks) ? source.tasks : [])
        .map(item => ({
            text: String(item?.text || item?.title || "").trim().slice(0, 200),
            note: String(item?.note || item?.nextStep || "").trim().slice(0, 1000),
            estimatedMinutes: Math.max(5, Math.min(480, Math.round(Number(item?.estimatedMinutes) || 30)))
        }))
        .filter(item => item.text);
    return {
        summary: String(source?.summary || "").trim().slice(0, 500),
        tasks
    };
}

async function chatWithTodos(payload = {}) {
    const safeTodos = (Array.isArray(payload.todos) ? payload.todos : []).map(todo => ({
        serial: todo?.serial,
        text: String(todo?.text || "").slice(0, 300),
        note: String(todo?.note || "").slice(0, 1000),
        done: Boolean(todo?.done),
        createdAt: todo?.createdAt,
        completedAt: todo?.completedAt
    }));
    const messages = (Array.isArray(payload.messages) ? payload.messages : [])
        .slice(-12)
        .map(message => ({
            role: message?.role === "assistant" ? "assistant" : "user",
            content: String(message?.content || "").slice(0, 2000)
        }));
    const text = await runAI(
        [
            { role: "user", content: `当前 Todo 数据：${JSON.stringify(safeTodos)}` },
            ...messages
        ],
        "你是桌面效率面板里的 Todo 助手。围绕用户当前 Todo 回答，帮助拆解、排序、估时和复盘。必须返回严格 JSON 对象，不要 Markdown，格式为：{\"reply\":\"给用户看的中文回答\",\"addTasks\":[]}。只有当用户明确要求把建议、这些任务或指定任务加入 Todo 时，才在 addTasks 中返回任务对象；否则 addTasks 必须为空数组。任务对象格式为 {\"text\":\"任务标题\",\"note\":\"备注，可为空\",\"estimatedMinutes\":30}。中文回答，简洁但具体。",
    );
    try {
        const parsed = parseAIJson(text);
        const tasks = (Array.isArray(parsed?.addTasks) ? parsed.addTasks : [])
            .map(item => ({
                text: String(item?.text || item?.title || "").trim().slice(0, 200),
                note: String(item?.note || item?.nextStep || "").trim().slice(0, 1000),
                estimatedMinutes: Math.max(5, Math.min(480, Math.round(Number(item?.estimatedMinutes) || 30)))
            }))
            .filter(item => item.text);
        return {
            reply: String(parsed?.reply || "").trim().slice(0, 3000),
            addTasks: tasks
        };
    } catch {
        return { reply: text.trim(), addTasks: [] };
    }
}

function openTodoHistoryViewer() {
    if (historyWindow && !historyWindow.isDestroyed()) {
        historyWindow.show();
        historyWindow.focus();
        return;
    }
    historyWindow = new BrowserWindow({
        width: 980,
        height: 720,
        minWidth: 720,
        minHeight: 500,
        title: "Todo 完成历史",
        backgroundColor: "#edf3f2",
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, "preload.js")
        }
    });
    historyWindow.loadFile(path.join(__dirname, "todo-history.html"));
    historyWindow.on("closed", () => {
        historyWindow = null;
    });
}

function log(message) {
    try {
        fs.appendFileSync(path.join(__dirname, "desktop-utility-panel.log"), `${new Date().toISOString()} ${message}\n`);
    } catch {
        // Logging must never prevent the panel from starting.
    }
    console.error(message);
}

function getPanelBounds(width) {
    const display = screen.getPrimaryDisplay();
    const workArea = display.workArea;
    const safeWidth = Math.max(COLLAPSED_WIDTH, Math.min(Number(width) || EXPANDED_WIDTH, workArea.width - RIGHT_GAP - 12));
    const safeHeight = Math.min(WINDOW_HEIGHT, workArea.height - 48);
    return {
        width: safeWidth,
        height: safeHeight,
        x: workArea.x + workArea.width - safeWidth - RIGHT_GAP,
        y: workArea.y + Math.round((workArea.height - safeHeight) / 2)
    };
}

function getSafeExpandedBounds() {
    const display = screen.getPrimaryDisplay();
    const workArea = display.workArea;
    const fallback = getPanelBounds(EXPANDED_WIDTH);
    const saved = expandedBounds || fallback;
    const width = Math.max(MIN_EXPANDED_WIDTH, Math.min(Number(saved.width) || fallback.width, workArea.width - RIGHT_GAP - 12));
    const height = Math.max(MIN_EXPANDED_HEIGHT, Math.min(Number(saved.height) || fallback.height, workArea.height - 24));
    const x = Math.max(workArea.x, Math.min(Number(saved.x) || fallback.x, workArea.x + workArea.width - width));
    const y = Math.max(workArea.y, Math.min(Number(saved.y) || fallback.y, workArea.y + workArea.height - height));
    return { x, y, width, height };
}

function getCollapsedBounds() {
    const defaults = getPanelBounds(COLLAPSED_WIDTH);
    if (!collapsedPosition) return defaults;
    return {
        ...defaults,
        x: collapsedPosition.x,
        y: collapsedPosition.y
    };
}

function createWindow() {
    collapsedPosition = readCollapsedPosition();
    mainWindow = new BrowserWindow({
        ...getCollapsedBounds(),
        frame: false,
        transparent: true,
        resizable: false,
        movable: true,
        minWidth: COLLAPSED_WIDTH,
        minHeight: 180,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        hasShadow: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: path.join(__dirname, "preload.js")
        }
    });

    mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
        log(`did-fail-load ${errorCode} ${errorDescription}`);
    });
    mainWindow.webContents.on("render-process-gone", (_event, details) => {
        log(`render-process-gone ${details.reason}`);
    });
    mainWindow.webContents.on("console-message", (_event, _level, message) => {
        log(`console ${message}`);
    });

    mainWindow.loadFile(path.join(__dirname, "desktop-utility-panel.html"));
    mainWindow.setAlwaysOnTop(true, "floating");
    mainWindow.showInactive();
    log("window created");

    mainWindow.on("resize", () => {
        if (isExpanded) {
            expandedBounds = mainWindow.getBounds();
        }
    });
    mainWindow.on("move", () => {
        if (isExpanded) {
            expandedBounds = mainWindow.getBounds();
        } else {
            const [x, y] = mainWindow.getPosition();
            collapsedPosition = { x, y };
            saveCollapsedPosition(collapsedPosition);
        }
    });

    mainWindow.on("closed", () => {
        mainWindow = null;
    });
    mainWindow.webContents.on("did-finish-load", () => {
        mainWindow.webContents.send("panel:state", { expanded: isExpanded });
    });
}

function resizePanel(expanded) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const wasExpanded = isExpanded;
    isExpanded = expanded;

    if (expanded) {
        mainWindow.setMinimumSize(MIN_EXPANDED_WIDTH, MIN_EXPANDED_HEIGHT);
        mainWindow.setResizable(true);
        if (!wasExpanded) {
            mainWindow.setBounds(getSafeExpandedBounds(), false);
        }
    } else {
        if (wasExpanded) {
            expandedBounds = mainWindow.getBounds();
        }
        mainWindow.setMinimumSize(COLLAPSED_WIDTH, 180);
        mainWindow.setResizable(false);
        mainWindow.setBounds(getCollapsedBounds(), false);
    }

    mainWindow.webContents.send("panel:state", { expanded });
}

function resizeExpandedWindowBy(delta = {}) {
    if (!mainWindow || mainWindow.isDestroyed() || !isExpanded) return;
    const current = mainWindow.getBounds();
    const display = screen.getDisplayMatching(current);
    const workArea = display.workArea;
    const width = Math.max(MIN_EXPANDED_WIDTH, Math.min(current.width + (Number(delta.dx) || 0), workArea.width - 24));
    const height = Math.max(MIN_EXPANDED_HEIGHT, Math.min(current.height + (Number(delta.dy) || 0), workArea.height - 24));
    const x = Math.max(workArea.x, Math.min(current.x, workArea.x + workArea.width - width));
    const y = Math.max(workArea.y, Math.min(current.y, workArea.y + workArea.height - height));
    mainWindow.setBounds({ x, y, width, height }, false);
    expandedBounds = mainWindow.getBounds();
    mainWindow.webContents.send("panel:state", { expanded: true, bounds: expandedBounds });
}

function createTray() {
    tray = new Tray(createTrayIcon());
    tray.setToolTip("桌面效率面板");
    tray.setContextMenu(Menu.buildFromTemplate([
        {
            label: "显示面板",
            click: () => {
                mainWindow?.showInactive();
            }
        },
        {
            label: "固定展开",
            type: "checkbox",
            checked: false,
            click: (menuItem) => {
                if (!mainWindow) return;
                resizePanel(menuItem.checked);
                if (menuItem.checked) {
                    mainWindow.showInactive();
                }
            }
        },
        { type: "separator" },
        {
            label: "开机启动",
            type: "checkbox",
            checked: app.getLoginItemSettings().openAtLogin,
            click: (menuItem) => {
                app.setLoginItemSettings({ openAtLogin: menuItem.checked });
            }
        },
        {
            label: "退出",
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]));

    tray.on("click", () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) {
            mainWindow.hide();
        } else {
            mainWindow.showInactive();
        }
    });
}

function showPanelContextMenu() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const menu = Menu.buildFromTemplate([
        {
            label: "显示面板",
            click: () => mainWindow.showInactive()
        },
        {
            label: "固定展开",
            type: "checkbox",
            checked: isExpanded,
            click: (item) => {
                resizePanel(item.checked);
                if (item.checked) mainWindow.showInactive();
            }
        },
        { type: "separator" },
        {
            label: "退出桌面效率面板",
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);
    menu.popup({ window: mainWindow });
}

function createTrayIcon() {
    const iconPath = path.join(__dirname, "tray.ico");
    if (fs.existsSync(iconPath)) return iconPath;

    const nativeImage = require("electron").nativeImage;
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
            <rect x="2" y="2" width="28" height="28" rx="8" fill="#2f7e82"/>
            <circle cx="11" cy="11" r="3" fill="#fff"/>
            <circle cx="21" cy="21" r="3" fill="#fff"/>
        </svg>
    `;
    return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}

function getScanRoots() {
    return [
        path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs"),
        path.join(process.env.ProgramData || "", "Microsoft", "Windows", "Start Menu", "Programs"),
        path.join(process.env.USERPROFILE || "", "Desktop")
    ].filter(Boolean);
}

function walkShortcuts(root, results = []) {
    if (!root || !fs.existsSync(root)) return results;

    let entries;
    try {
        entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
        return results;
    }

    for (const entry of entries) {
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            walkShortcuts(fullPath, results);
            continue;
        }
        if (/\.lnk$/i.test(entry.name)) {
            results.push({ path: fullPath, relativePath: path.relative(root, fullPath) });
        }
    }
    return results;
}

function cleanWindowsPath(value) {
    if (!value || typeof value !== "string") return "";
    const trimmed = value.trim();
    const quoted = trimmed.match(/^"([^"]+)"(?:,\s*-?\d+)?$/);
    if (quoted) return quoted[1];
    const commaIndex = trimmed.lastIndexOf(",");
    if (commaIndex > trimmed.lastIndexOf("\\")) {
        const suffix = trimmed.slice(commaIndex + 1).trim();
        if (/^-?\d+$/.test(suffix)) {
            return trimmed.slice(0, commaIndex).trim().replace(/^"|"$/g, "");
        }
    }
    return trimmed.replace(/^"|"$/g, "");
}

function isLaunchableFile(filePath) {
    return Boolean(filePath)
        && fs.existsSync(filePath)
        && /\.(exe|com|bat|cmd)$/i.test(filePath);
}

function findExecutableInDirectory(root, displayName) {
    if (!root || !fs.existsSync(root)) return "";

    const nameHint = String(displayName || "")
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
    const candidates = [];
    const ignored = /(^|\\)(unins|uninstall|setup|update|updater|crash|helper|vc_redist|vcredist)/i;

    function walk(current, depth) {
        if (depth > 3 || candidates.length >= 80) return;
        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                walk(fullPath, depth + 1);
                continue;
            }
            if (!/\.exe$/i.test(entry.name) || ignored.test(fullPath)) continue;
            const normalizedName = entry.name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
            const score = nameHint && normalizedName.includes(nameHint) ? 0 : 1;
            candidates.push({ path: fullPath, score });
        }
    }

    walk(root, 0);
    candidates.sort((a, b) => a.score - b.score || a.path.length - b.path.length);
    return candidates[0]?.path || "";
}

async function readRegistryApps() {
    if (process.platform !== "win32") return [];

    const script = [
        "$paths = @(",
        "  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
        "  'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
        "  'HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'",
        ")",
        "Get-ItemProperty -Path $paths -ErrorAction SilentlyContinue",
        "  | Where-Object { $_.DisplayName -and -not $_.SystemComponent -and -not $_.NoDisplay -and -not $_.ParentKeyName -and $_.ReleaseType -notin @('Update', 'Hotfix', 'Security Update') }",
        "  | Select-Object DisplayName, DisplayIcon, InstallLocation, Publisher, DisplayVersion",
        "  | ConvertTo-Json -Compress -Depth 3"
    ].join("\n");

    try {
        const { stdout } = await execFileAsync("powershell.exe", [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script
        ], {
            windowsHide: true,
            maxBuffer: 12 * 1024 * 1024
        });
        if (!stdout.trim()) return [];
        const parsed = JSON.parse(stdout.trim().replace(/^\uFEFF/, ""));
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch (error) {
        log(`registry scan failed ${error.message || error}`);
        return [];
    }
}

async function readStartMenuApps() {
    if (process.platform !== "win32") return [];

    const script = [
        "$apps = Get-StartApps | Where-Object { $_.Name -and $_.AppID } |",
        "    Select-Object Name, AppID",
        "$apps | ConvertTo-Json -Compress -Depth 3"
    ].join("\n");

    try {
        const { stdout } = await execFileAsync("powershell.exe", [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script
        ], {
            windowsHide: true,
            maxBuffer: 12 * 1024 * 1024
        });
        if (!stdout.trim()) return [];
        const parsed = JSON.parse(stdout.trim().replace(/^\uFEFF/, ""));
        return Array.isArray(parsed) ? parsed : [parsed];
    } catch (error) {
        log(`start menu app scan failed ${error.message || error}`);
        return [];
    }
}

function normalizeStartMenuApp(entry) {
    const name = String(entry?.Name || "").trim();
    const appId = String(entry?.AppID || "").trim();
    if (!name || !appId) return null;
    if (/^(uninstall|卸载|help|帮助|readme|说明|documentation|文档)$/i.test(name)) return null;
    const launchPath = `shell:AppsFolder\\${appId}`;
    const category = "待 AI 分类";
    return {
        id: `apps-folder:${appId.toLowerCase()}`,
        name,
        path: launchPath,
        launchPath,
        iconPath: launchPath,
        appId,
        category,
        publisher: "",
        installLocation: "",
        icon: name.slice(0, 1).toUpperCase() || "·",
        color: colorForCategory(category),
        iconData: ""
    };
}

function normalizeRegistryApp(entry) {
    const name = String(entry.DisplayName || "").trim();
    if (/(redistributable|runtime|sdk|software development kit|driver|驱动|update|更新|hotfix|language pack|webview2|directx|visual c\+\+|vc_redist|uninstall|卸载|service|服务|plugin|plug-in|library|库)/i.test(name)) {
        return null;
    }
    const installLocation = cleanWindowsPath(String(entry.InstallLocation || ""));
    const displayIcon = cleanWindowsPath(String(entry.DisplayIcon || ""));
    if (/\\(Google\\Chrome|Microsoft\\Edge)\\.*(User Data|Web Applications)/i.test(`${displayIcon} ${installLocation}`)) {
        return null;
    }
    const iconPath = fs.existsSync(displayIcon) ? displayIcon : "";
    const searchRoot = installLocation || (displayIcon ? path.dirname(displayIcon) : "");
    const launchPath = isLaunchableFile(displayIcon)
        ? displayIcon
        : findExecutableInDirectory(searchRoot, name);

    if (!name || !launchPath) return null;
    const relativePath = `${entry.Publisher || ""} ${installLocation}`;
    const category = "待 AI 分类";
    return {
        id: launchPath.toLowerCase(),
        name,
        path: launchPath,
        iconPath: iconPath || launchPath,
        category,
        publisher: String(entry.Publisher || "").trim(),
        installLocation,
        icon: name.slice(0, 1).toUpperCase() || "·",
        color: colorForCategory(category),
        iconData: ""
    };
}

function inferCategory(item) {
    const value = `${item.name} ${item.relativePath}`.toLowerCase();
    if (/(code|studio|git|postman|terminal|node|python|docker|dev|idea|sublime)/.test(value)) return "开发";
    if (/(word|excel|powerpoint|office|outlook|mail|calendar|notion|钉钉|飞书|企业微信)/.test(value)) return "办公";
    if (/(photoshop|illustrator|figma|blender|premiere|design|canva)/.test(value)) return "设计";
    if (/(steam|game|spotify|music|网易云|腾讯视频|bilibili|哔哩)/.test(value)) return "娱乐";
    if (/(settings|control|task|snipping|截图|管理|工具)/.test(value)) return "系统工具";
    return "其他";
}

function colorForCategory(category) {
    return {
        "办公": "#3c74b9",
        "开发": "#2e8ec2",
        "设计": "#a16f9e",
        "娱乐": "#bf744f",
        "系统工具": "#68777d",
        "其他": "#688f8c"
    }[category] || "#688f8c";
}

function normalizeShortcut(shortcut) {
    const baseName = path.basename(shortcut.path, path.extname(shortcut.path))
        .replace(/\s*-\s*(快捷方式|Shortcut)$/i, "")
        .trim();
    if (/(uninstall|卸载|setup|安装|update|更新|helper|crash|driver|驱动|readme|说明)/i.test(`${baseName} ${shortcut.relativePath}`)) {
        return null;
    }
    let shortcutInfo;
    try {
        shortcutInfo = shell.readShortcutLink(shortcut.path);
    } catch {
        return null;
    }
    const target = String(shortcutInfo.target || "").trim();
    if (!target || !/\.exe$/i.test(target) || !fs.existsSync(target)) {
        return null;
    }
    const shortcutIcon = cleanWindowsPath(String(shortcutInfo.icon || shortcutInfo.iconLocation || ""));
    const displayName = baseName || path.basename(target, path.extname(target));
    const category = "待 AI 分类";
    return {
        id: shortcut.path.toLowerCase(),
        name: displayName || "未命名应用",
        path: shortcut.path,
        launchPath: target,
        iconPath: fs.existsSync(shortcutIcon) ? shortcutIcon : target,
        category,
        publisher: "",
        installLocation: path.dirname(target),
        icon: displayName.slice(0, 1).toUpperCase() || "·",
        color: colorForCategory(category),
        iconData: ""
    };
}

async function scanApps() {
    const shortcuts = getScanRoots().flatMap(root => walkShortcuts(root));
    const unique = new Map();

    const candidates = shortcuts.map(normalizeShortcut).filter(Boolean);
    const registryEntries = await readRegistryApps();
    candidates.push(...registryEntries.map(normalizeRegistryApp).filter(Boolean));
    const startMenuEntries = await readStartMenuApps();
    candidates.push(...startMenuEntries.map(normalizeStartMenuApp).filter(Boolean));

    for (const appInfo of candidates) {
        try {
            const icon = await app.getFileIcon(appInfo.iconPath || appInfo.launchPath || appInfo.path, { size: "large" });
            appInfo.iconData = icon.toDataURL();
        } catch {
            // Some URL shortcuts and registry entries do not expose a readable icon.
        }
        if (appInfo.name && !unique.has(appInfo.name.toLowerCase())) {
            unique.set(appInfo.name.toLowerCase(), appInfo);
        }
    }

    return Array.from(unique.values())
        .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
}

async function chooseDocument() {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: "选择 Todo 文档",
        properties: ["openFile"],
        filters: [
            { name: "常用文档", extensions: ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "pdf", "txt", "md"] },
            { name: "所有文件", extensions: ["*"] }
        ]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    return {
        path: filePath,
        name: path.basename(filePath)
    };
}

async function openDocument(filePath) {
    if (!filePath || typeof filePath !== "string") {
        return { ok: false, error: "文档路径为空" };
    }
    const error = await shell.openPath(filePath);
    return error ? { ok: false, error } : { ok: true };
}

function launchShortcut(target) {
    return new Promise((resolve) => {
        if (!target || typeof target !== "string") {
            resolve({ ok: false, error: "无效应用路径" });
            return;
        }

        const openTask = /^shell:AppsFolder\\/i.test(target)
            ? shell.openExternal(target)
            : shell.openPath(target);
        openTask.then((error) => {
            resolve(error ? { ok: false, error } : { ok: true });
        }).catch((error) => {
            resolve({ ok: false, error: error?.message || String(error) });
        });
    });
}

function setStartup(enabled) {
    app.setLoginItemSettings({
        openAtLogin: Boolean(enabled),
        path: process.execPath,
        args: ["--hidden"]
    });
    return app.getLoginItemSettings().openAtLogin;
}

function registerIpc() {
    ipcMain.on("panel:expand", () => resizePanel(true));
    ipcMain.on("panel:collapse", () => resizePanel(false));
    ipcMain.on("panel:resize-by", (_event, delta = {}) => resizeExpandedWindowBy(delta));
    ipcMain.on("panel:move-by", (_event, delta = {}) => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const dx = Number(delta.dx) || 0;
        const dy = Number(delta.dy) || 0;
        const [x, y] = mainWindow.getPosition();
        mainWindow.setPosition(Math.round(x + dx), Math.round(y + dy), false);
    });
    ipcMain.on("panel:context-menu", showPanelContextMenu);
    ipcMain.on("panel:show", () => mainWindow?.showInactive());
    ipcMain.on("panel:hide", () => mainWindow?.hide());
    ipcMain.handle("apps:scan", scanApps);
    ipcMain.handle("apps:launch", (_event, target) => launchShortcut(target));
    ipcMain.handle("document:choose", chooseDocument);
    ipcMain.handle("document:open", (_event, filePath) => openDocument(filePath));
    ipcMain.handle("todos:load-file", () => readTodoHistoryFile());
    ipcMain.handle("todos:save-file", (_event, todos) => saveTodoHistoryFile(todos));
    ipcMain.handle("todos:open-file", openTodoHistoryFile);
    ipcMain.on("todos:open-viewer", openTodoHistoryViewer);
    ipcMain.handle("ai:get-config", () => getAIConfig());
    ipcMain.handle("ai:save-config", (_event, config) => saveAIConfig(config));
    ipcMain.handle("ai:test-config", (_event, config) => testAIConfig(config));
    ipcMain.handle("ai:classify-apps", (_event, apps) => classifyApps(apps));
    ipcMain.handle("ai:plan-todos", (_event, todos) => planTodos(todos));
    ipcMain.handle("ai:todo-chat", (_event, payload) => chatWithTodos(payload));
    ipcMain.on("panel:quit", () => {
        isQuitting = true;
        app.quit();
    });
    ipcMain.handle("startup:get", () => app.getLoginItemSettings().openAtLogin);
    ipcMain.handle("startup:set", (_event, enabled) => setStartup(enabled));
    ipcMain.handle("startup:open", () => shell.openPath(app.getPath("appData")));
}

app.whenReady().then(() => {
    log("app ready");
    registerIpc();
    createWindow();
    createTray();
    log("tray created");

    if (process.argv.includes("--hidden")) {
        mainWindow.hide();
    }
}).catch(error => {
    log(`startup error ${error.stack || error}`);
});

app.on("window-all-closed", (event) => {
    if (!isQuitting) {
        event.preventDefault();
    }
});

app.on("before-quit", () => {
    isQuitting = true;
});

app.on("activate", () => {
    if (!mainWindow) createWindow();
    mainWindow.showInactive();
});
