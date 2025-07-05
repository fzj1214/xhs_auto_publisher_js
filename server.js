const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const schedule = require('node-schedule');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 5000;

// DeepSeek API 配置
const DEEPSEEK_API_KEY = "sk-0263473cb18e4d66a0634f71cfe884fc";
const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";

// 内存存储
let scheduledPosts = [];
let postIdCounter = 1;

// 创建定时发布任务的数据结构
function batchScheduledPost(title, content, images, publishTime) {
  return {
    id: postIdCounter++,
    title,
    content,
    images: images || [],
    publishTime,
    createdAt: new Date(),
    status: 'scheduled'
  };
}

// DeepSeek API 调用函数
async function generateNoteWithDeepSeek(theme, style, persona) {
  const prompt = `请以${persona}的身份，写一篇小红书风格的笔记，主题是"${theme}"，风格为"${style}"。请给出合适的标题和正文，标题不超过20个字符，正文不超过1000个字符，正文不少于200字。输出格式：\n标题：xxx\n正文：yyy`;
  
  const headers = {
    "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
    "Content-Type": "application/json"
  };
  
  const payload = {
    "model": "deepseek-chat",
    "messages": [
      {"role": "user", "content": prompt}
    ],
    "temperature": 1.0
  };
  
  try {
    const response = await axios.post(DEEPSEEK_API_URL, payload, {
      headers: headers,
      timeout: 60000
    });
    
    const content = response.data.choices[0].message.content;
    
    // 解析标题和正文
    let title = "";
    let body = content;
    
    if (content.includes("标题：") && content.includes("正文：")) {
      // 标准格式：标题：xxx\n正文：yyy
      const titleMatch = content.match(/标题：(.+?)(?=\n|$)/);
      const bodyMatch = content.match(/正文：([\s\S]+)/);
      
      if (titleMatch) title = titleMatch[1].trim();
      if (bodyMatch) body = bodyMatch[1].trim();
    } else if (content.includes("标题：")) {
      // 只有标题格式
      const parts = content.split("\n");
      const titleLine = parts.find(line => line.includes("标题："));
      if (titleLine) {
        title = titleLine.replace("标题：", "").trim();
        body = parts.filter(line => !line.includes("标题：")).join("\n").trim();
      }
    } else {
      // 无格式，尝试智能分割
      const lines = content.split("\n").filter(line => line.trim());
      if (lines.length > 0) {
        title = lines[0].trim();
        body = lines.slice(1).join("\n").trim();
      }
    }
    
    // 如果正文为空，使用完整内容作为正文
    if (!body || body.length < 10) {
      body = content;
      if (!title) title = `${theme}相关内容`;
    }
    
    // 强制截断，防止AI超长
    title = title.substring(0, 20);
    body = body.substring(0, 1000);
    
    return { title: title, content: body };
  } catch (error) {
    console.error(`DeepSeek API 调用失败: ${error.message}`);
    // 回退到占位内容
    return {
      title: `${theme} - ${style}风格笔记`.substring(0, 20),
      content: `作为一名${persona}，我想分享一下关于"${theme}"的一些心得。\n\n这是一篇${style}风格的笔记，希望对你有所帮助。\n\n#小红书 #${theme} #${style}`.substring(0, 1000)
    };
  }
}

// 中间件配置
app.use(cors({
  origin: 'http://127.0.0.1:8080',
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 临时session存储 (内存中)
const sessions = new Map();

// 简单的session中间件
app.use((req, res, next) => {
  const sessionId = req.headers['x-session-id'] || req.query.sessionId || 'default';
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {});
  }
  req.session = sessions.get(sessionId);
  req.sessionId = sessionId;
  next();
});

// 静态文件服务
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 文件上传配置
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const ext = path.extname(file.originalname);
    cb(null, `${timestamp}_${Math.random().toString(36).substr(2, 9)}${ext}`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 16 * 1024 * 1024 } // 16MB
});



// 发布状态
let publishStatus = {
  status: 'idle', // idle, pending, success, failed
  message: ''
};

// 小红书登录状态
let xhsPoster = null;
let scheduledTasks = {};

// 路由
app.get('/', (req, res) => {
  console.log('访问了首页 / 路由');
  res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

app.get('/home', (req, res) => {
  res.json({ message: 'JavaScript backend is running!' });
});

app.get('/api/data', (req, res) => {
  res.json({ data: 'Some data from JavaScript backend' });
});







// 获取发布状态
app.get('/api/publish-status', (req, res) => {
  res.json(publishStatus);
});

// 小红书登录
app.post('/api/xiaohongshu-login', async (req, res) => {
  try {
    const { phone } = req.body;
    
    if (!phone) {
      return res.status(400).json({ success: false, message: '请提供手机号' });
    }
    
    const { XiaohongshuPoster } = require('./xiaohongshu-poster');
    
    // 如果已有实例，先关闭
    if (xhsPoster) {
      await xhsPoster.close();
    }
    
    xhsPoster = new XiaohongshuPoster();
    await xhsPoster.init();
    
    // 删除已保存的cookies文件，强制重新登录
    const cookiesPath = path.join(__dirname, 'xiaohongshu_cookies.json');
    if (fs.existsSync(cookiesPath)) {
      fs.unlinkSync(cookiesPath);
      console.log('已删除旧的cookies文件，将使用新手机号登录');
    }
    
    // 开始登录流程
    await xhsPoster.login(phone);
    
    res.json({ success: true, message: '小红书登录流程已启动，请在浏览器中完成验证' });
    
  } catch (error) {
    console.error('小红书登录失败:', error);
    res.status(500).json({ success: false, message: `登录失败: ${error.message}` });
  }
});

// AI生成内容
app.post('/api/ai_generate', async (req, res) => {
  try {
    const { theme, style, persona } = req.body;
    
    if (!theme || !style || !persona) {
      return res.status(400).json({ status: 'error', message: '缺少主题、风格或人设' });
    }
    
    console.log(`正在调用DeepSeek API生成内容 - 主题: ${theme}, 风格: ${style}, 人设: ${persona}`);
    
    // 调用DeepSeek API生成内容
    const note = await generateNoteWithDeepSeek(theme, style, persona);
    
    console.log('DeepSeek API返回内容:', note);
    res.json({ status: 'success', data: note });
  } catch (error) {
    console.error('AI生成错误:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// 定时发布
app.post('/api/schedule_publish', upload.array('images'), (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ status: 'error', message: '没有图片文件部分' });
    }
    
    const title = req.body.title || '默认标题';
    const content = req.body.content || '';
    const scheduledTimeStr = req.body.scheduled_time;
    
    if (!scheduledTimeStr) {
      return res.status(400).json({ status: 'error', message: '请选择发布时间' });
    }
    
    // 解析时间
    let scheduledTime;
    try {
      scheduledTime = new Date(scheduledTimeStr.replace('T', ' '));
    } catch (error) {
      return res.status(400).json({ status: 'error', message: '时间格式错误' });
    }
    
    // 检查时间是否在未来
    if (scheduledTime <= new Date()) {
      return res.status(400).json({ status: 'error', message: '发布时间必须在未来' });
    }
    
    // 保存图片文件
    const imagePaths = [];
    for (const file of files) {
      if (file.filename) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const ext = path.extname(file.originalname);
        const filename = `${timestamp}_${file.filename}`;
        const savePath = path.join(__dirname, 'uploads', filename);
        
        try {
          // 文件已经通过multer保存，这里记录路径
          imagePaths.push(savePath);
          console.log(`Saved scheduled file: ${savePath}`);
        } catch (error) {
          console.error(`Failed to save file ${filename}:`, error);
          return res.status(500).json({ status: 'error', message: `保存文件失败: ${error.message}` });
        }
      }
    }
    
    if (imagePaths.length === 0) {
      return res.status(400).json({ status: 'error', message: '未成功保存任何图片文件' });
    }
    
    // 创建定时发布记录
    const scheduledPost = batchScheduledPost(
      title,
      content,
      imagePaths,
      scheduledTime
    );
    
    scheduledPosts.push(scheduledPost);
    
    // 安排定时任务
    const success = schedulePostTask(scheduledPost.id, scheduledTime);
    
    if (success) {
      res.json({
        status: 'success',
        message: `定时发布任务已创建，将在 ${scheduledTime.toLocaleString('zh-CN')} 发布`,
        post_id: scheduledPost.id
      });
    } else {
      scheduledPost.status = 'failed';
      scheduledPost.error_message = '时间已过期';
      res.status(400).json({ status: 'error', message: '定时时间已过期' });
    }
  } catch (error) {
    console.error('创建定时发布任务失败:', error);
    res.status(500).json({ status: 'error', message: `创建定时发布任务失败: ${error.message}` });
  }
});

// 获取定时发布列表
app.get('/api/scheduled_posts', (req, res) => {
  try {
    const userPosts = scheduledPosts.map(post => ({
      id: post.id,
      title: post.title,
      content: post.content.length > 100 ? post.content.substring(0, 100) + '...' : post.content,
      scheduled_time: post.publishTime.toLocaleString('zh-CN'),
      status: post.status,
      created_at: post.createdAt.toLocaleString('zh-CN'),
      published_at: post.publishedAt ? post.publishedAt.toLocaleString('zh-CN') : null,
      error_message: post.error_message
    }));
    
    // 按计划时间倒序排列
    userPosts.sort((a, b) => new Date(b.scheduled_time) - new Date(a.scheduled_time));
    
    res.json({ status: 'success', data: userPosts });
  } catch (error) {
    console.error('获取定时发布列表失败:', error);
    res.status(500).json({ status: 'error', message: `获取定时发布列表失败: ${error.message}` });
  }
});

// 取消定时发布
app.delete('/api/cancel_scheduled_post/:post_id', (req, res) => {
  try {
    const postId = parseInt(req.params.post_id);
    const postIndex = scheduledPosts.findIndex(post => post.id === postId);
    
    if (postIndex === -1) {
      return res.status(404).json({ status: 'error', message: '定时发布任务不存在' });
    }
    
    const post = scheduledPosts[postIndex];
    
    if (post.status !== 'scheduled') {
      return res.status(400).json({ status: 'error', message: '只能取消待发布的任务' });
    }
    
    // 取消定时器
    if (scheduledTasks[postId]) {
      scheduledTasks[postId].cancel();
      delete scheduledTasks[postId];
    }
    
    // 更新状态
    post.status = 'cancelled';
    
    res.json({ status: 'success', message: '定时发布任务已取消' });
  } catch (error) {
    console.error('取消定时发布任务失败:', error);
    res.status(500).json({ status: 'error', message: `取消失败: ${error.message}` });
  }
});

// 发布笔记
app.post('/api/publish', upload.array('images'), async (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ status: 'error', message: '没有图片文件部分' });
    }
    
    const title = req.body.title || '默认标题';
    const content = req.body.content || '';
    
    console.log(`Files received: ${files.map(file => file.filename)}`);
    
    const imagePaths = [];
    for (const file of files) {
      if (file.filename) {
        const savePath = path.join(__dirname, 'uploads', file.filename);
        imagePaths.push(savePath);
        console.log(`Saved file: ${savePath}`);
      }
    }
    
    if (imagePaths.length === 0) {
      return res.status(400).json({ status: 'error', message: '未成功保存任何图片文件' });
    }
    
    // 保存发布数据到latest_publish.json
    const latestData = {
      title,
      content,
      images: imagePaths
    };
    
    try {
      fs.writeFileSync('latest_publish.json', JSON.stringify(latestData, null, 2), 'utf8');
      console.log('已保存 latest_publish.json');
    } catch (error) {
      console.error('保存 latest_publish.json 失败:', error);
    }
    
    // 启动自动化发文流程
    publishStatus.status = 'pending';
    
    // 使用已登录的xhsPoster实例发布
    try {
      // 检查是否已有登录的实例
      if (!xhsPoster) {
        publishStatus.status = 'failed';
        publishStatus.message = '请先登录小红书';
        return res.json({ status: 'error', message: '请先登录小红书' });
      }
      
      console.log('开始使用Puppeteer自动发布...');
      
      // 执行发布
      const result = await xhsPoster.postArticle(title, content, imagePaths);
      
      if (result.success) {
        console.log('Puppeteer自动发布成功');
        publishStatus.status = 'success';
        publishStatus.message = '发布成功';
        res.json({ status: 'success', message: '发布成功' });
      } else {
        console.error('Puppeteer自动发布失败:', result.message);
        publishStatus.status = 'failed';
        publishStatus.message = result.message;
        res.json({ status: 'error', message: result.message });
      }
    } catch (error) {
      console.error('执行Puppeteer自动发布异常:', error);
      publishStatus.status = 'failed';
      publishStatus.message = `发布异常: ${error.message}`;
      res.json({ status: 'error', message: `发布异常: ${error.message}` });
    }
  } catch (error) {
    console.error('Publish error:', error);
    res.status(500).json({ status: 'error', message: '发布失败' });
  }
});

// 定时发布任务执行函数
async function executeScheduledPost(postId) {
  try {
    const post = scheduledPosts.get(postId);
    if (!post || post.status !== 'pending') {
      console.log(`定时任务 ${postId} 已取消或不存在`);
      return;
    }
    
    console.log(`开始执行定时发布任务 ${postId}`);
    post.status = 'publishing';
    
    // 执行发布 (使用Puppeteer自动发布)
    publishStatus.status = 'pending';
    
    try {
      // 检查是否已有登录的实例
      if (!xhsPoster) {
        console.error('定时发布失败: 未登录小红书');
        publishStatus.status = 'failed';
        publishStatus.message = '请先登录小红书';
        post.status = 'failed';
        post.error_message = '请先登录小红书';
        return;
      }
      
      console.log('开始使用Puppeteer定时发布...');
      
      // 构建图片路径
      const imageFileNames = JSON.parse(post.image_paths);
      const imagePaths = imageFileNames.map(img => path.join(__dirname, 'uploads', img));
      
      // 执行发布
      const result = await xhsPoster.postArticle(post.title, post.content, imagePaths);
      
      if (result.success) {
        console.log('Puppeteer定时发布成功');
        publishStatus.status = 'success';
        publishStatus.message = '发布成功';
      } else {
        console.error('Puppeteer定时发布失败:', result.message);
        publishStatus.status = 'failed';
        publishStatus.message = result.message;
      }
    } catch (error) {
      console.error('执行Puppeteer定时发布异常:', error);
      publishStatus.status = 'failed';
      publishStatus.message = `发布异常: ${error.message}`;
    }
    
    if (publishStatus.status === 'success') {
      post.status = 'published';
      post.published_at = new Date();
      console.log(`定时任务 ${postId} 发布成功`);
    } else {
      post.status = 'failed';
      post.error_message = `发布失败，状态: ${publishStatus.status}`;
      console.log(`定时任务 ${postId} 发布失败`);
    }
    
    publishStatus.status = 'idle';
    
  } catch (error) {
    console.error(`定时发布任务 ${postId} 执行异常:`, error);
    const post = scheduledPosts.get(postId);
    if (post) {
      post.status = 'failed';
      post.error_message = error.message;
    }
  } finally {
    if (scheduledTasks[postId]) {
      delete scheduledTasks[postId];
    }
  }
}

// 安排定时发布任务
function schedulePostTask(postId, scheduledTime) {
  const job = schedule.scheduleJob(scheduledTime, () => {
    executeScheduledPost(postId);
  });
  
  if (job) {
    scheduledTasks[postId] = job;
    console.log(`定时任务 ${postId} 已安排，将在 ${scheduledTime} 执行`);
    return true;
  } else {
    console.log(`定时任务 ${postId} 安排失败`);
    return false;
  }
}

// 添加计划发布
app.post('/api/schedule', async (req, res) => {
  try {
    const { title, content, images, publishTime, contentStyle, persona } = req.body;
    
    if (!title || !content || !publishTime) {
      return res.status(400).json({ error: '标题、内容和发布时间不能为空' });
    }
    
    const post = await ScheduledPost.create({
      title,
      content,
      images: JSON.stringify(images || []),
      publishTime: new Date(publishTime),
      contentStyle: contentStyle || '生活记录',
      persona: persona || '学生党',
      status: 'scheduled',
      userId: req.user.id
    });
    
    // 安排定时任务
    schedule.scheduleJob(post.publishTime, async () => {
      console.log(`发布计划内容: ${post.title}`);
      // 这里可以添加实际的发布逻辑
      await post.update({ status: 'published' });
    });
    
    res.json({ 
      message: '计划发布添加成功',
      post: {
        id: post.id,
        title: post.title,
        content: post.content,
        publishTime: post.publishTime,
        contentStyle: post.contentStyle,
        persona: post.persona,
        status: post.status,
        images: JSON.parse(post.images).length
      }
    });
  } catch (error) {
    console.error('添加计划发布错误:', error);
    res.status(500).json({ error: '添加计划发布失败' });
  }
});

// 获取计划发布列表
app.get('/api/schedule', async (req, res) => {
  try {
    const formattedPosts = scheduledPosts.map(post => ({
      id: post.id,
      title: post.title,
      content: post.content,
      publishTime: post.scheduled_time,
      status: post.status,
      createdAt: post.created_at,
      images: post.images ? post.images.length : 0
    }));
    
    res.json({ posts: formattedPosts });
  } catch (error) {
    console.error('获取计划发布列表错误:', error);
    res.status(500).json({ error: '获取计划发布列表失败' });
  }
});

// 删除计划发布
app.delete('/api/schedule/:id', async (req, res) => {
  try {
    const postId = parseInt(req.params.id);
    
    const postIndex = scheduledPosts.findIndex(post => post.id === postId);
    
    if (postIndex === -1) {
      return res.status(404).json({ error: '计划发布不存在' });
    }
    
    const post = scheduledPosts[postIndex];
    
    // 取消定时任务
    if (scheduledTasks[postId]) {
      scheduledTasks[postId].cancel();
      delete scheduledTasks[postId];
    }
    
    // 从数组中移除
    scheduledPosts.splice(postIndex, 1);
    
    res.json({ message: '计划发布删除成功' });
  } catch (error) {
    console.error('删除计划发布错误:', error);
    res.status(500).json({ error: '删除计划发布失败' });
  }
});

// 小红书发布相关路由
const { MCPServer } = require('./mcp-server');
const mcpServer = new MCPServer(3001);

// 启动 MCP 服务器
mcpServer.start().catch(error => {
  console.error('启动 MCP Server 失败:', error);
});

app.post('/api/publish-xiaohongshu', async (req, res) => {
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
app.post('/api/xiaohongshu-login', async (req, res) => {
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
app.post('/api/xiaohongshu-send-code', async (req, res) => {
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
app.post('/api/xiaohongshu-login-code', async (req, res) => {
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

// 批量生成图片API
app.post('/api/batch_generate_images', async (req, res) => {
  try {
    const { theme, style, persona, count } = req.body;
    
    if (!theme || !count || count > 10) {
      return res.status(400).json({
        status: 'error',
        message: '参数错误：主题不能为空，数量不能超过10'
      });
    }
    
    const { generateImage } = require('./api');
    const images = [];
    
    for (let i = 0; i < count; i++) {
      try {
        const prompt = `${theme}，${style}风格，${persona}视角，小红书配图，高质量，美观`;
        const imageData = await generateImage(prompt);
        
        // 保存图片到文件系统
        if (imageData && imageData.buffer && imageData.filename) {
          const imagePath = path.join(__dirname, 'uploads', imageData.filename);
          fs.writeFileSync(imagePath, imageData.buffer);
          console.log(`图片已保存到: ${imagePath}`);
          
          // 只返回文件名，不返回buffer数据
          images.push({
            filename: imageData.filename,
            base64: imageData.base64
          });
        } else {
          console.error(`生成第${i+1}张图片数据无效`);
          images.push(null);
        }
      } catch (error) {
        console.error(`生成第${i+1}张图片失败:`, error);
        images.push(null);
      }
    }
    
    res.json({
      status: 'success',
      data: { images: images.filter(img => img !== null) }
    });
  } catch (error) {
    console.error('批量生成图片错误:', error);
    res.status(500).json({
      status: 'error',
      message: '批量生成图片失败'
    });
  }
});

// 批量生成内容API
app.post('/api/batch_generate_content', async (req, res) => {
  try {
    const { theme, style, persona, count } = req.body;
    
    if (!theme || !count || count > 10) {
      return res.status(400).json({
        status: 'error',
        message: '参数错误：主题不能为空，数量不能超过10'
      });
    }
    
    const contents = [];
    
    for (let i = 0; i < count; i++) {
      try {
        const prompt = `请以${persona}的身份，写一篇小红书风格的笔记，主题是"${theme}"，风格为"${style}"。请给出合适的标题和正文，标题不超过20个字符，正文不超过1000个字符，正文不少于200字。每次生成的内容要有所不同，可以从不同角度或细节来写。输出格式：\n标题：xxx\n正文：yyy`;
        
        const result = await generateNoteWithDeepSeek(theme, style, persona);
        if (result && result.title && result.content) {
          contents.push(result);
        }
      } catch (error) {
        console.error(`生成第${i+1}条内容失败:`, error);
      }
    }
    
    res.json({
      status: 'success',
      data: { contents }
    });
  } catch (error) {
    console.error('批量生成内容错误:', error);
    res.status(500).json({
      status: 'error',
      message: '批量生成内容失败'
    });
  }
});

// 批量定时发布API
app.post('/api/batch_schedule_publish', async (req, res) => {
  try {
    const { count, interval, images, contents } = req.body;
    
    // 添加详细的调试日志
    console.log('批量定时发布: 接收到的参数:', {
      count,
      interval,
      imagesLength: images ? images.length : 0,
      contentsLength: contents ? contents.length : 0
    });
    
    console.log('批量定时发布: 原始images数据:', images);
    
    if (!count || !interval || !images || !contents) {
      return res.status(400).json({
        status: 'error',
        message: '参数不完整'
      });
    }
    
    if (images.length < count || contents.length < count) {
      return res.status(400).json({
        status: 'error',
        message: '图片或内容数量不足'
      });
    }
    
    const now = new Date();
    const createdTasks = [];
    
    for (let i = 0; i < count; i++) {
      // 第一个任务从15秒后开始，避免立即过期
      const publishTime = new Date(now.getTime() + 15000 + (i * interval * 60 * 1000));
      const content = contents[i];
      const image = images[i];
      
      // 直接使用图片文件名构建完整路径
      let imagePaths = [];
      if (image && image.filename) {
        const imagePath = path.join(__dirname, 'uploads', image.filename);
        // 验证图片文件是否存在
        if (fs.existsSync(imagePath)) {
          console.log(`批量定时发布: 图片文件验证成功: ${imagePath}`);
          imagePaths = [imagePath];
        } else {
          console.log(`批量定时发布: 图片文件不存在: ${imagePath}`);
        }
      } else {
        console.log(`批量定时发布: 第${i+1}个任务无图片数据`);
      }
      
      console.log(`批量定时发布: 创建任务 ${i + 1}:`, {
        title: content.title,
        imagePaths: imagePaths,
        publishTime: publishTime.toISOString()
      });
      
      const scheduledPost = batchScheduledPost(
        content.title,
        content.content,
        imagePaths,
        publishTime
      );
      
      scheduledPosts.push(scheduledPost);
      
      // 创建定时任务
      const job = schedule.scheduleJob(publishTime, async function() {
        try {
          console.log(`开始执行定时发布任务 ${scheduledPost.id}`);
          
          // 更新任务状态
          const taskIndex = scheduledPosts.findIndex(p => p.id === scheduledPost.id);
          if (taskIndex !== -1) {
            scheduledPosts[taskIndex].status = 'publishing';
          }
          
          // 检查是否已有登录的实例
          if (!xhsPoster) {
            console.error(`定时发布任务 ${scheduledPost.id} 失败: 未登录小红书`);
            if (taskIndex !== -1) {
              scheduledPosts[taskIndex].status = 'failed';
              scheduledPosts[taskIndex].error_message = '请先登录小红书';
            }
            return;
          }
          
          console.log(`开始使用Puppeteer执行定时发布任务 ${scheduledPost.id}...`);
                    
          // 执行发布
          const result = await xhsPoster.postArticle(
            scheduledPost.title, 
            scheduledPost.content, 
            imagePaths
          );
          
          if (result.success) {
            console.log(`定时发布任务 ${scheduledPost.id} 成功`);
            if (taskIndex !== -1) {
              scheduledPosts[taskIndex].status = 'published';
              scheduledPosts[taskIndex].publishedAt = new Date();
            }
            
            // 清理图片文件
            for (const imgPath of imagePaths) {
              try {
                if (fs.existsSync(imgPath)) {
                  fs.unlinkSync(imgPath);
                  console.log('批量定时发布: 已清理图片文件:', imgPath);
                }
              } catch (error) {
                console.error('批量定时发布: 清理图片文件失败:', error);
              }
            }
          } else {
            console.error(`定时发布任务 ${scheduledPost.id} 失败:`, result.message);
            if (taskIndex !== -1) {
              scheduledPosts[taskIndex].status = 'failed';
              scheduledPosts[taskIndex].error_message = result.message;
            }
          }
        } catch (error) {
          console.error(`定时发布任务 ${scheduledPost.id} 异常:`, error);
          const taskIndex = scheduledPosts.findIndex(p => p.id === scheduledPost.id);
          if (taskIndex !== -1) {
            scheduledPosts[taskIndex].status = 'failed';
            scheduledPosts[taskIndex].error_message = `发布异常: ${error.message}`;
          }
        }
      });
      
      createdTasks.push({
        id: scheduledPost.id,
        publishTime: publishTime,
        title: content.title
      });
    }
    
    res.json({
      status: 'success',
      data: { tasks: createdTasks }
    });
  } catch (error) {
    console.error('批量定时发布错误:', error);
    res.status(500).json({
      status: 'error',
      message: '批量定时发布失败'
    });
  }
});

// 查看定时任务状态API
app.get('/api/scheduled_tasks', (req, res) => {
  try {
    const tasks = scheduledPosts.map(post => ({
      id: post.id,
      title: post.title,
      publishTime: post.publishTime ? post.publishTime.toISOString() : null,
      status: post.status,
      createdAt: post.createdAt ? post.createdAt.toISOString() : null,
      publishedAt: post.publishedAt ? post.publishedAt.toISOString() : null,
      error_message: post.error_message || null
    }));
    
    res.json({
      status: 'success',
      data: { tasks }
    });
  } catch (error) {
    console.error('获取定时任务状态错误:', error);
    res.status(500).json({
      status: 'error',
      message: '获取定时任务状态失败'
    });
  }
});

// 启动服务器
function startServer() {
  try {
    console.log('使用内存存储，无需数据库连接');
    
    app.listen(PORT, () => {
      console.log(`JavaScript backend server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('启动服务器失败:', error);
  }
}

startServer();

module.exports = app;