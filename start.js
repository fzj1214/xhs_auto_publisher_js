const { spawn } = require('child_process');
const path = require('path');

// 启动主服务器
function startMainServer() {
  console.log('启动主服务器...');
  const mainServer = spawn('node', ['server.js'], {
    cwd: __dirname,
    stdio: 'inherit'
  });

  mainServer.on('error', (error) => {
    console.error('主服务器启动失败:', error);
  });

  mainServer.on('exit', (code) => {
    console.log(`主服务器退出，退出码: ${code}`);
  });

  return mainServer;
}

// 启动 MCP 服务器
function startMCPServer() {
  console.log('启动 MCP 服务器...');
  const mcpServer = spawn('node', ['mcp-server.js'], {
    cwd: __dirname,
    stdio: 'inherit'
  });

  mcpServer.on('error', (error) => {
    console.error('MCP 服务器启动失败:', error);
  });

  mcpServer.on('exit', (code) => {
    console.log(`MCP 服务器退出，退出码: ${code}`);
  });

  return mcpServer;
}

// 主函数
function main() {
  console.log('=== 启动小红书自动发布系统 ===');
  
  const mainServer = startMainServer();
  
  // 延迟启动 MCP 服务器，避免端口冲突
  setTimeout(() => {
    const mcpServer = startMCPServer();
  }, 2000);

  // 优雅关闭
  process.on('SIGINT', () => {
    console.log('\n正在关闭服务器...');
    mainServer.kill('SIGINT');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n正在关闭服务器...');
    mainServer.kill('SIGTERM');
    process.exit(0);
  });
}

if (require.main === module) {
  main();
}

module.exports = { startMainServer, startMCPServer };