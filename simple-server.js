const express = require('express');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const schedule = require('node-schedule');
const { MCPServer } = require('./mcp-server');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'your-secret-key-change-in-production';

// 内存数据存储（替代数据库）
const users = new Map();
const scheduledPosts = new Map();
let userIdCounter = 1;
let postIdCounter = 1;

// 中间件
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 确保上传目录存在
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// 文件上传配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('只允许上传图片和视频文件'));
    }
  }
});

// JWT 验证中间件
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: '访问令牌缺失' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, message: '访问令牌无效' });
    }
    req.user = user;
    next();
  });
}

// 基础路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: '小红书自动发布系统运行正常',
    timestamp: new Date().toISOString(),
    users: users.size,
    posts: scheduledPosts.size
  });
});

// 用户认证路由
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: '用户名、邮箱和密码都是必填项' 
      });
    }

    // 检查用户是否已存在
    for (const user of users.values()) {
      if (user.username === username || user.email === email) {
        return res.status(400).json({ 
          success: false, 
          message: '用户名或邮箱已存在' 
        });
      }
    }

    // 创建新用户
    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = userIdCounter++;
    const newUser = {
      id: userId,
      username,
      email,
      password: hashedPassword,
      createdAt: new Date().toISOString()
    };
    
    users.set(userId, newUser);
    
    res.status(201).json({ 
      success: true, 
      message: '用户注册成功',
      user: { id: userId, username, email }
    });
  } catch (error) {
    console.error('注册错误:', error);
    res.status(500).json({ success: false, message: '注册失败' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: '用户名和密码都是必填项' 
      });
    }

    // 查找用户
    let user = null;
    for (const u of users.values()) {
      if (u.username === username || u.email === username) {
        user = u;
        break;
      }
    }

    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: '用户名或密码错误' 
      });
    }

    // 验证密码
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ 
        success: false, 
        message: '用户名或密码错误' 
      });
    }

    // 生成 JWT
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ 
      success: true, 
      message: '登录成功',
      token,
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (error) {
    console.error('登录错误:', error);
    res.status(500).json({ success: false, message: '登录失败' });
  }
});

// 文件上传路由
app.post('/api/upload', authenticateToken, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: '没有上传文件' });
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({ 
      success: true, 
      message: '文件上传成功',
      fileUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size
    });
  } catch (error) {
    console.error('文件上传错误:', error);
    res.status(500).json({ success: false, message: '文件上传失败' });
  }
});

// 定时发布管理路由
app.get('/api/scheduled-posts', authenticateToken, (req, res) => {
  try {
    const userPosts = Array.from(scheduledPosts.values())
      .filter(post => post.userId === req.user.userId);
    
    res.json({ 
      success: true, 
      posts: userPosts 
    });
  } catch (error) {
    console.error('获取定时发布列表错误:', error);
    res.status(500).json({ success: false, message: '获取列表失败' });
  }
});

app.post('/api/scheduled-posts', authenticateToken, (req, res) => {
  try {
    const { title, content, images, scheduledTime, platform } = req.body;
    
    if (!title || !content || !scheduledTime) {
      return res.status(400).json({ 
        success: false, 
        message: '标题、内容和发布时间都是必填项' 
      });
    }

    const postId = postIdCounter++;
    const newPost = {
      id: postId,
      userId: req.user.userId,
      title,
      content,
      images: images || [],
      scheduledTime,
      platform: platform || 'xiaohongshu',
      status: 'scheduled',
      createdAt: new Date().toISOString()
    };
    
    scheduledPosts.set(postId, newPost);
    
    // 安排定时任务
    const scheduleDate = new Date(scheduledTime);
    if (scheduleDate > new Date()) {
      schedule.scheduleJob(scheduleDate, async () => {
        console.log(`执行定时发布任务: ${title}`);
        // 这里可以调用小红书发布逻辑
        newPost.status = 'published';
        newPost.publishedAt = new Date().toISOString();
      });
    }
    
    res.status(201).json({ 
      success: true, 
      message: '定时发布创建成功',
      post: newPost
    });
  } catch (error) {
    console.error('创建定时发布错误:', error);
    res.status(500).json({ success: false, message: '创建失败' });
  }
});

app.put('/api/scheduled-posts/:id', authenticateToken, (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const post = scheduledPosts.get(postId);
    
    if (!post || post.userId !== req.user.userId) {
      return res.status(404).json({ 
        success: false, 
        message: '定时发布不存在' 
      });
    }

    const { title, content, images, scheduledTime, platform } = req.body;
    
    // 更新字段
    if (title) post.title = title;
    if (content) post.content = content;
    if (images) post.images = images;
    if (scheduledTime) post.scheduledTime = scheduledTime;
    if (platform) post.platform = platform;
    post.updatedAt = new Date().toISOString();
    
    res.json({ 
      success: true, 
      message: '定时发布更新成功',
      post
    });
  } catch (error) {
    console.error('更新定时发布错误:', error);
    res.status(500).json({ success: false, message: '更新失败' });
  }
});

app.delete('/api/scheduled-posts/:id', authenticateToken, (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    const post = scheduledPosts.get(postId);
    
    if (!post || post.userId !== req.user.userId) {
      return res.status(404).json({ 
        success: false, 
        message: '定时发布不存在' 
      });
    }

    scheduledPosts.delete(postId);
    
    res.json({ 
      success: true, 
      message: '定时发布删除成功'
    });
  } catch (error) {
    console.error('删除定时发布错误:', error);
    res.status(500).json({ success: false, message: '删除失败' });
  }
});

// 小红书发布相关路由
const mcpServer = new MCPServer(3001);

// 启动 MCP 服务器
mcpServer.start().catch(error => {
  console.error('启动 MCP Server 失败:', error);
});

app.post('/api/publish-xiaohongshu', authenticateToken, async (req, res) => {
  try {
    const { title, content, images } = req.body;
    
    if (!title || !content) {
      return res.status(400).json({ 
        success: false, 
        message: '标题和内容不能为空' 
      });
    }

    // 调用 MCP 服务器发布笔记
    const axios = require('axios');
    const response = await axios.post('http://localhost:3001/publish', {
      title,
      content,
      images
    });
    
    res.json(response.data);
  } catch (error) {
    console.error('小红书发布错误:', error);
    res.status(500).json({ 
      success: false, 
      message: error.response?.data?.message || '发布失败' 
    });
  }
});

// 小红书登录相关路由
app.post('/api/xiaohongshu-login', authenticateToken, async (req, res) => {
  try {
    const { phone } = req.body;
    
    if (!phone) {
      return res.status(400).json({ 
        success: false, 
        message: '手机号不能为空' 
      });
    }

    const axios = require('axios');
    const response = await axios.post('http://localhost:3001/login', { phone });
    
    res.json(response.data);
  } catch (error) {
    console.error('小红书登录错误:', error);
    res.status(500).json({ 
      success: false, 
      message: error.response?.data?.message || '登录失败' 
    });
  }
});

// 发送验证码
app.post('/api/xiaohongshu-send-code', authenticateToken, async (req, res) => {
  try {
    const { phone } = req.body;
    
    const axios = require('axios');
    const response = await axios.post('http://localhost:3001/send-code', { phone });
    
    res.json(response.data);
  } catch (error) {
    console.error('发送验证码错误:', error);
    res.status(500).json({ 
      success: false, 
      message: error.response?.data?.message || '发送验证码失败' 
    });
  }
});

// 验证码登录
app.post('/api/xiaohongshu-login-code', authenticateToken, async (req, res) => {
  try {
    const { code } = req.body;
    
    const axios = require('axios');
    const response = await axios.post('http://localhost:3001/login-with-code', { code });
    
    res.json(response.data);
  } catch (error) {
    console.error('验证码登录错误:', error);
    res.status(500).json({ 
      success: false, 
      message: error.response?.data?.message || '验证码登录失败' 
    });
  }
});

// 错误处理中间件
app.use((error, req, res, next) => {
  console.error('服务器错误:', error);
  res.status(500).json({ 
    success: false, 
    message: '服务器内部错误' 
  });
});

// 404 处理
app.use('*', (req, res) => {
  res.status(404).json({ 
    success: false, 
    message: '接口不存在' 
  });
});

// 启动服务器
function startServer() {
  const server = app.listen(PORT, () => {
    console.log(`=== 小红书自动发布系统启动成功 ===`);
    console.log(`主服务器运行在: http://localhost:${PORT}`);
    console.log(`MCP 服务器运行在: http://localhost:3001`);
    console.log(`健康检查: http://localhost:${PORT}/health`);
    console.log(`当前用户数: ${users.size}`);
    console.log(`定时发布数: ${scheduledPosts.size}`);
    console.log('=====================================');
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`端口 ${PORT} 已被占用，请尝试其他端口`);
    } else {
      console.error('服务器启动失败:', error);
    }
    process.exit(1);
  });

  return server;
}

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('\n正在关闭服务器...');
  await mcpServer.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n正在关闭服务器...');
  await mcpServer.stop();
  process.exit(0);
});

if (require.main === module) {
  startServer();
}

module.exports = app;