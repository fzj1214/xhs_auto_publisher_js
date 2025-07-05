const { XiaohongshuPoster } = require('./xiaohongshu-poster');
const express = require('express');
const cors = require('cors');
const path = require('path');

class MCPServer {
  constructor(port = 3001) {
    this.app = express();
    this.port = port;
    this.poster = new XiaohongshuPoster({ path: __dirname });
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));
  }

  setupRoutes() {
    // 健康检查
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', message: 'MCP Server is running' });
    });

    // 初始化小红书发布器
    this.app.post('/init', async (req, res) => {
      try {
        await this.poster.init();
        res.json({ success: true, message: '小红书发布器初始化成功' });
      } catch (error) {
        console.error('初始化失败:', error);
        res.status(500).json({ success: false, message: `初始化失败: ${error.message}` });
      }
    });

    // 登录小红书
    this.app.post('/login', async (req, res) => {
      try {
        const { phone } = req.body;
        if (!phone) {
          return res.status(400).json({ success: false, message: '手机号不能为空' });
        }

        const result = await this.poster.login(phone);
        res.json({ success: result, message: result ? '登录成功' : '登录失败' });
      } catch (error) {
        console.error('登录失败:', error);
        res.status(500).json({ success: false, message: `登录失败: ${error.message}` });
      }
    });

    // 发送验证码
    this.app.post('/send-code', async (req, res) => {
      try {
        const { phone } = req.body;
        if (!phone) {
          return res.status(400).json({ success: false, message: '手机号不能为空' });
        }

        const result = await this.poster.sendLoginCode(phone);
        res.json({ success: result, message: result ? '验证码发送成功' : '验证码发送失败' });
      } catch (error) {
        console.error('发送验证码失败:', error);
        res.status(500).json({ success: false, message: `发送验证码失败: ${error.message}` });
      }
    });

    // 使用验证码登录
    this.app.post('/login-with-code', async (req, res) => {
      try {
        const { code } = req.body;
        if (!code) {
          return res.status(400).json({ success: false, message: '验证码不能为空' });
        }

        const result = await this.poster.loginWithCode(code);
        res.json({ success: result, message: result ? '登录成功' : '登录失败' });
      } catch (error) {
        console.error('验证码登录失败:', error);
        res.status(500).json({ success: false, message: `验证码登录失败: ${error.message}` });
      }
    });

    // 发布笔记
    this.app.post('/publish', async (req, res) => {
      try {
        const { title, content, images } = req.body;
        
        if (!title || !content) {
          return res.status(400).json({ 
            success: false, 
            message: '标题和内容不能为空' 
          });
        }

        // 处理图片路径
        let imagePaths = [];
        if (images && Array.isArray(images)) {
          imagePaths = images.map(img => {
            if (typeof img === 'string') {
              // 如果是URL，先下载
              if (img.startsWith('http')) {
                return this.poster.downloadImage(img);
              }
              // 如果是本地路径，直接使用
              return img;
            }
            return null;
          }).filter(Boolean);

          // 等待所有图片下载完成
          imagePaths = await Promise.all(imagePaths);
        }

        const result = await this.poster.postArticle(title, content, imagePaths);
        res.json(result);
      } catch (error) {
        console.error('发布笔记失败:', error);
        res.status(500).json({ 
          success: false, 
          message: `发布笔记失败: ${error.message}` 
        });
      }
    });

    // 发布视频笔记
    this.app.post('/publish-video', async (req, res) => {
      try {
        const { title, content, video_path, cover_image } = req.body;
        
        if (!title || !content || !video_path) {
          return res.status(400).json({ 
            success: false, 
            message: '标题、内容和视频路径不能为空' 
          });
        }

        // 视频发布功能需要根据小红书的具体接口实现
        // 这里先返回一个占位符响应
        res.json({ 
          success: false, 
          message: '视频发布功能暂未实现，请使用图文发布' 
        });
      } catch (error) {
        console.error('发布视频笔记失败:', error);
        res.status(500).json({ 
          success: false, 
          message: `发布视频笔记失败: ${error.message}` 
        });
      }
    });

    // 关闭浏览器
    this.app.post('/close', async (req, res) => {
      try {
        await this.poster.close();
        res.json({ success: true, message: '浏览器已关闭' });
      } catch (error) {
        console.error('关闭浏览器失败:', error);
        res.status(500).json({ success: false, message: `关闭浏览器失败: ${error.message}` });
      }
    });

    // 错误处理中间件
    this.app.use((error, req, res, next) => {
      console.error('服务器错误:', error);
      res.status(500).json({ 
        success: false, 
        message: '服务器内部错误' 
      });
    });

    // 404 处理
    this.app.use('*', (req, res) => {
      res.status(404).json({ 
        success: false, 
        message: '接口不存在' 
      });
    });
  }

  start() {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, () => {
          console.log(`MCP Server 启动成功，监听端口: ${this.port}`);
          console.log(`健康检查: http://localhost:${this.port}/health`);
          resolve(this.server);
        });

        this.server.on('error', (error) => {
          console.error('服务器启动失败:', error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('MCP Server 已停止');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

// 如果直接运行此文件，启动服务器
if (require.main === module) {
  const server = new MCPServer();
  
  server.start().catch(error => {
    console.error('启动 MCP Server 失败:', error);
    process.exit(1);
  });

  // 优雅关闭
  process.on('SIGINT', async () => {
    console.log('\n收到 SIGINT 信号，正在关闭服务器...');
    await server.poster.close();
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n收到 SIGTERM 信号，正在关闭服务器...');
    await server.poster.close();
    await server.stop();
    process.exit(0);
  });
}

module.exports = { MCPServer };