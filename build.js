const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = __dirname;
const env = {
    ...process.env,
    ELECTRON_CACHE: path.join(projectRoot, ".electron-cache"),
    ELECTRON_BUILDER_CACHE: path.join(projectRoot, ".builder-cache"),
    ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/"
};

const builderCli = require.resolve("electron-builder/cli");
const result = spawnSync(process.execPath, [builderCli, "--win", "dir"], {
    cwd: projectRoot,
    env,
    stdio: "inherit"
});

process.exit(result.status ?? 1);
