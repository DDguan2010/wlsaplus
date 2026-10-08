import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';

function startMacVpn() {
  // 1. 获取打进 DMG 包里的资源路径与解压目标路径
  const tarPath = path.join(process.resourcesPath, 'bin/mac-vpn.tar.gz');
  const targetDir = path.join(app.getPath('userData'), 'vpn-bin');
  const execPath = path.join(targetDir, 'vpn-core'); // 解压出来的二进制执行文件名

  // 2. 如果尚未解压，解压到应用支持目录
  if (!fs.existsSync(execPath)) {
    exec(`mkdir -p "${targetDir}" && tar -xzf "${tarPath}" -C "${targetDir}"`);
  }

  // 3. 通过 macOS 原生弹窗请求 Sudo 权限并启动 TUN 虚拟网卡
  const script = `chmod +x "${execPath}" && "${execPath}" --config your-config.json`;
  const sudoCommand = `osascript -e 'do shell script "${script}" with administrator privileges'`;

  exec(sudoCommand, (error, stdout, stderr) => {
    if (error) {
      console.error('Mac VPN 启动失败或用户拒绝授权:', error);
    } else {
      console.log('Mac 虚拟网卡与 VPN 已成功启动:', stdout);
    }
  });
}
