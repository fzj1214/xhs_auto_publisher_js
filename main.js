const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow = null;
let serverProcess = null;
const SERVER_PORT = 5000;

// 创建主窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webSecurity: true
    },
    icon: path.join(__dirname, 'assets', 'icon.png'), // 可选：添加应用图标
    show: false // 先不显示，等加载完成后再显示
  });

  // 等待服务器启动后加载页面
  setTimeout(() => {
    mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);
  }, 3000);

  // 窗口准备好后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // 开发环境下打开开发者工具
    if (process.env.NODE_ENV === 'development') {
      mainWindow.webContents.openDevTools();
    }
  });

  // 处理窗口关闭
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 处理外部链接
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });
}

// 启动Node.js服务器
function startServer() {
  return new Promise((resolve, reject) => {
    console.log(`正在启动服务器，端口: ${SERVER_PORT}...`);
    
    serverProcess = spawn('node', ['server.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: __dirname,
      env: { ...process.env, PORT: SERVER_PORT }
    });

    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`服务器输出: ${output}`);
      
      // 检查服务器是否启动成功
      if (output.includes(`Server running on port ${SERVER_PORT}`) || 
          output.includes('服务器运行在端口')) {
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`服务器错误: ${data}`);
    });

    serverProcess.on('close', (code) => {
      console.log(`服务器进程退出，代码: ${code}`);
      serverProcess = null;
    });

    serverProcess.on('error', (err) => {
      console.error('启动服务器失败:', err);
      reject(err);
    });

    // 超时处理
    setTimeout(() => {
      if (serverProcess) {
        resolve(); // 即使没有收到确认消息也继续
      }
    }, 5000);
  });
}

// 应用准备就绪
app.whenReady().then(async () => {
  try {
    console.log('正在启动应用...');
    
    // 启动服务器
    await startServer();
    
    // 创建窗口
    createWindow();

    console.log('应用启动完成');
  } catch (error) {
    console.error('应用启动失败:', error);
    app.quit();
  }
});

// 所有窗口关闭时的处理
app.on('window-all-closed', () => {
  // 在 macOS 上，除非用户用 Cmd + Q 确定地退出，
  // 否则绝大部分应用及其菜单栏会保持激活。
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// macOS 上点击 dock 图标时重新创建窗口
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 应用退出前的清理工作
app.on('before-quit', () => {
  console.log('正在关闭应用...');
  
  // 关闭服务器进程
  if (serverProcess) {
    console.log('正在关闭服务器进程...');
    serverProcess.kill('SIGTERM');
    
    // 如果进程没有正常关闭，强制杀死
    setTimeout(() => {
      if (serverProcess) {
        serverProcess.kill('SIGKILL');
      }
    }, 3000);
  }
});

// IPC 通信处理（可选，用于渲染进程与主进程通信）
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-server-port', () => {
  return SERVER_PORT;
});

// 错误处理
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的 Promise 拒绝:', reason);
});