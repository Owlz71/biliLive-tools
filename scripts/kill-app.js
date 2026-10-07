// 打包前关闭正在运行的程序，避免 electron-builder 因文件被占用（Windows 上的 EBUSY）而失败
import { execSync } from "node:child_process";

const appName = "biliLive-tools";

const commands = {
  win32: `taskkill /F /IM ${appName}.exe`,
  darwin: `pkill -f ${appName}`,
  linux: `pkill -f ${appName}`,
};

const command = commands[process.platform];
if (!command) {
  process.exit(0);
}

try {
  execSync(command, { stdio: "ignore" });
  console.log(`已关闭正在运行的 ${appName}`);
} catch {
  console.log(`${appName} 未在运行`);
}
