const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');

class XiaohongshuPoster {
  constructor(options = {}) {
    this.browser = null;
    this.page = null;
    this.projectRoot = options.path || __dirname;
    this.tokenFile = path.join(this.projectRoot, 'xiaohongshu_token.json');
    this.cookiesFile = path.join(this.projectRoot, 'xiaohongshu_cookies.json');
    this.token = this.loadToken();
  }

  async init() {
    try {
      // 启动浏览器
      this.browser = await puppeteer.launch({
        headless: false, // 设为 false 以便调试
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-extensions',
          '--disable-popup-blocking',
          '--lang=zh-CN',
          '--ignore-certificate-errors',
          '--ignore-ssl-errors'
        ]
      });

      this.page = await this.browser.newPage();
      
      // 设置用户代理
      await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      // 设置视口
      await this.page.setViewport({ width: 1280, height: 720 });
      
      console.log('浏览器初始化完成，导航到小红书创作者平台...');
      await this.page.goto('https://creator.xiaohongshu.com', { waitUntil: 'networkidle2' });
      
      return true;
    } catch (error) {
      console.error('初始化浏览器失败:', error);
      throw error;
    }
  }

  loadToken() {
    if (fs.existsSync(this.tokenFile)) {
      try {
        const tokenData = JSON.parse(fs.readFileSync(this.tokenFile, 'utf8'));
        if (tokenData.expire_time && tokenData.expire_time > Date.now()) {
          return tokenData.token;
        }
      } catch (error) {
        console.error('加载token失败:', error);
      }
    }
    return null;
  }

  saveToken(token) {
    const tokenData = {
      token: token,
      expire_time: Date.now() + 30 * 24 * 60 * 60 * 1000 // 30天后过期
    };
    fs.writeFileSync(this.tokenFile, JSON.stringify(tokenData, null, 2));
  }

  async loadCookies() {
    if (fs.existsSync(this.cookiesFile)) {
      try {
        const cookies = JSON.parse(fs.readFileSync(this.cookiesFile, 'utf8'));
        if (cookies && cookies.length > 0) {
          console.log(`从 ${this.cookiesFile} 加载 ${cookies.length} 个 cookies`);
          await this.page.setCookie(...cookies);
          console.log('Cookies 加载完成');
          return true;
        }
      } catch (error) {
        console.error('加载cookies失败:', error);
      }
    }
    console.log('Cookies文件不存在或为空');
    return false;
  }

  async saveCookies() {
    try {
      const cookies = await this.page.cookies();
      if (cookies && cookies.length > 0) {
        fs.writeFileSync(this.cookiesFile, JSON.stringify(cookies, null, 2));
        console.log(`成功将 ${cookies.length} 个 cookies 保存到 ${this.cookiesFile}`);
      } else {
        console.log('没有获取到cookies，无法保存');
      }
    } catch (error) {
      console.error('保存cookies失败:', error);
    }
  }

  async navigateToLoginIfNeeded() {
    const currentUrl = this.page.url();
    if (!currentUrl.includes('login')) {
      console.log('当前不在登录页，导航到登录页...');
      await this.page.goto('https://creator.xiaohongshu.com/login', { waitUntil: 'networkidle2' });
      
      try {
        await this.page.waitForSelector('input[placeholder="手机号"]', { timeout: 10000 });
        console.log('已导航到登录页面');
        return true;
      } catch (error) {
        console.error('导航到登录页面失败或超时');
        return false;
      }
    }
    return true;
  }

  async sendLoginCode(phone) {
    console.log(`准备向手机号 ${phone} 发送验证码...`);
    
    if (!(await this.navigateToLoginIfNeeded())) {
      throw new Error('无法导航到小红书登录页面');
    }

    try {
      // 输入手机号
      const phoneInput = await this.page.waitForSelector('input[placeholder="手机号"]', { timeout: 10000 });
      await phoneInput.click();
      await phoneInput.evaluate(el => el.value = '');
      await phoneInput.type(phone);
      console.log('手机号已输入');

      // 点击发送验证码按钮
      const sendCodeBtn = await this.page.waitForSelector('button:has-text("发送验证码")', { timeout: 10000 });
      await sendCodeBtn.click();
      console.log('已点击发送验证码按钮');
      
      return true;
    } catch (error) {
      console.error('发送验证码过程中发生错误:', error);
      throw error;
    }
  }

  async loginWithCode(code) {
    console.log('尝试使用验证码登录...');
    
    try {
      // 输入验证码
      const codeInput = await this.page.waitForSelector('input[placeholder="验证码"]', { timeout: 10000 });
      await codeInput.click();
      await codeInput.type(code);
      console.log('验证码已输入');

      // 点击登录按钮
      const loginBtn = await this.page.waitForSelector('button:has-text("登录")', { timeout: 10000 });
      await loginBtn.click();
      console.log('已点击登录按钮');

      // 等待登录成功
      await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
      
      // 保存cookies
      await this.saveCookies();
      
      console.log('登录成功');
      return true;
    } catch (error) {
      console.error('登录过程中发生错误:', error);
      throw error;
    }
  }

  async login(phone) {
    if (!this.browser) {
      await this.init();
    }

    // 尝试加载已保存的cookies
    if (await this.loadCookies()) {
      // 刷新页面检查是否已登录
      await this.page.reload({ waitUntil: 'networkidle2' });
      
      // 检查是否已登录（可以根据页面元素判断）
      try {
        await this.page.waitForSelector('.creator-header', { timeout: 5000 });
        console.log('使用已保存的cookies登录成功');
        return true;
      } catch (error) {
        console.log('已保存的cookies无效，需要重新登录');
      }
    }

    // 如果cookies无效，导航到登录页面让用户手动登录
    if (!(await this.navigateToLoginIfNeeded())) {
      throw new Error('无法导航到小红书登录页面');
    }
    
    console.log('已导航到登录页面，请手动输入手机号和验证码完成登录...');
    
    // 等待登录成功（检测URL变化或特定元素出现）
    try {
      await this.page.waitForFunction(
        () => !window.location.href.includes('login'),
        { timeout: 60000 }
      );
      
      await this.saveCookies();
      console.log('登录成功');
      return true;
    } catch (error) {
      console.error('登录超时或失败:', error);
      throw error;
    }
  }

  async postArticle(title, content, imagePaths = []) {
    try {
      console.log(`开始发布笔记: ${title}`);
      console.log('调试信息 - 传入参数:');
      console.log('title:', title);
      console.log('content:', content);
      console.log('imagePaths:', imagePaths);
      
      if (!this.browser) {
        await this.init();
      }

      // 检查页面状态，如果页面已分离则重新初始化
      try {
        await this.page.evaluate(() => document.title);
      } catch (error) {
        console.log('页面已分离，重新初始化浏览器...');
        await this.close();
        await this.init();
      }

      // 先加载保存的cookies以保持登录状态
      console.log('加载保存的cookies...');
      await this.loadCookies();

      // 导航到发布页面
      await this.page.goto('https://creator.xiaohongshu.com/publish/publish', { waitUntil: 'networkidle2' });
      
      // 等待页面加载完成，检查是否需要重新登录
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // 1. 先点击"上传图文"按钮
      console.log('点击上传图文按钮...');
      console.log('当前页面URL:', this.page.url());
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 尝试多种选择器来定位上传图文按钮
      let uploadBtn = null;
      const selectors = [
        '#web > div:nth-child(1) > div > div > div:nth-child(1) > div:nth-child(3)',
        'div[class*="upload"]',
        'button[class*="upload"]',
        '[data-testid*="upload"]',
        'div:contains("上传图文")',
        '.upload-btn, .upload-button',
        '[aria-label*="上传"]',
        'div[role="button"]:contains("上传图文")'
      ];
      
      for (const selector of selectors) {
        try {
          uploadBtn = await this.page.$(selector);
          if (uploadBtn) {
            console.log(`找到上传按钮，使用选择器: ${selector}`);
            break;
          }
        } catch (e) {
          console.log(`选择器 ${selector} 失败:`, e.message);
        }
      }
      
      if (uploadBtn) {
        await uploadBtn.click();
        console.log('已点击上传图文按钮');
        
        // 等待页面跳转或状态变化
        await new Promise(resolve => setTimeout(resolve, 3000));
        console.log('点击后页面URL:', this.page.url());
      } else {
        console.log('未找到上传图文按钮，尝试通过文本查找...');
        
        // 获取页面所有可点击元素的信息
        const clickableElements = await this.page.evaluate(() => {
          const elements = Array.from(document.querySelectorAll('div, button, a, span'));
          return elements
            .filter(el => el.textContent && (el.textContent.includes('上传') || el.textContent.includes('图文')))
            .map(el => ({
              tagName: el.tagName,
              textContent: el.textContent.trim(),
              className: el.className,
              id: el.id
            }));
        });
        
        console.log('找到的可能的上传元素:', clickableElements);
        
        // 通过文本内容查找并点击
        const clicked = await this.page.evaluate(() => {
          const elements = Array.from(document.querySelectorAll('*'));
          const uploadElement = elements.find(el => 
            el.textContent && el.textContent.includes('上传图文')
          );
          if (uploadElement) {
            uploadElement.click();
            return true;
          }
          return false;
        });
        
        if (clicked) {
          console.log('通过文本查找成功点击上传按钮');
          await new Promise(resolve => setTimeout(resolve, 3000));
        } else {
          throw new Error('无法找到上传图文按钮');
        }
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // 2. 上传图片
      if (imagePaths && imagePaths.length > 0) {
        console.log(`准备上传 ${imagePaths.length} 张图片`);
        console.log('图片路径列表:', imagePaths);
        
        // 验证图片文件是否存在
        for (const imgPath of imagePaths) {
          if (!fs.existsSync(imgPath)) {
            console.error(`图片文件不存在: ${imgPath}`);
            throw new Error(`图片文件不存在: ${imgPath}`);
          }
          console.log(`图片文件验证通过: ${imgPath}`);
        }
        
        // 查找文件输入框
        let fileInput = null;
        const fileInputSelectors = [
          '#web > div.outarea.upload-c > div > div > div.upload-content > div.upload-wrapper > div > input',
          '#web input[type="file"]',
          'input[type="file"]',
          'input[accept*="image"]',
          '[data-testid*="file"] input',
          '.upload-input input'
        ];
        
        for (const selector of fileInputSelectors) {
          try {
            fileInput = await this.page.$(selector);
            if (fileInput) {
              console.log(`找到文件输入框，使用选择器: ${selector}`);
              break;
            }
          } catch (e) {
            console.log(`文件输入选择器 ${selector} 失败:`, e.message);
          }
        }
        
        if (!fileInput) {
          // 等待文件输入框出现
          try {
            console.log('等待文件输入框出现...');
            fileInput = await this.page.waitForSelector('input[type="file"]', { timeout: 10000 });
            console.log('通过等待找到文件输入框');
          } catch (e) {
            console.log('未找到文件输入框:', e.message);
            
            // 获取页面HTML调试信息
            const pageContent = await this.page.content();
            console.log('页面HTML片段:', pageContent.substring(0, 1000));
            
            // 检查页面中所有input元素
            const allInputs = await this.page.evaluate(() => {
              const inputs = Array.from(document.querySelectorAll('input'));
              return inputs.map(input => ({
                type: input.type,
                accept: input.accept,
                className: input.className,
                id: input.id
              }));
            });
            console.log('页面中所有input元素:', allInputs);
            
            throw new Error('无法找到文件上传输入框');
          }
        }
        
        // 转换相对路径为绝对路径
        const absolutePaths = imagePaths.map(imgPath => {
          if (path.isAbsolute(imgPath)) {
            return imgPath;
          }
          return path.join(this.projectRoot, imgPath.replace(/^\//, ''));
        });
        
        console.log('转换后的绝对路径:', absolutePaths);
        
        try {
          await fileInput.uploadFile(...absolutePaths);
          console.log('图片文件上传API调用完成');
        } catch (uploadError) {
          console.error('图片上传失败:', uploadError);
          throw new Error(`图片上传失败: ${uploadError.message}`);
        }
        
        // 等待图片处理完成 - 增加等待时间并添加验证
        console.log('等待图片处理...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // 验证图片是否真正上传完成
        let uploadComplete = false;
        for (let i = 0; i < 10; i++) {
          try {
            // 检查是否有图片预览或上传完成的标识
            const uploadedImages = await this.page.$$('img[src*="blob:"], .image-preview, .uploaded-image, [class*="image"][class*="preview"]');
            if (uploadedImages.length > 0) {
              console.log(`检测到 ${uploadedImages.length} 张图片预览，上传完成`);
              uploadComplete = true;
              break;
            }
            
            // 检查是否有标题输入框出现（这通常表示可以进入下一步）
            const titleExists = await this.page.$('input[placeholder*="标题"], input[placeholder*="title"]');
            if (titleExists) {
              console.log('标题输入框已出现，图片上传应该完成');
              uploadComplete = true;
              break;
            }
          } catch (e) {
            console.log(`第${i+1}次检查图片上传状态失败:`, e.message);
          }
          
          console.log(`等待图片上传完成... (${i+1}/10)`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        if (!uploadComplete) {
          console.log('警告：无法确认图片是否上传完成，继续执行...');
        }
        
        // 额外等待确保页面稳定
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // 3. 输入标题
      console.log('输入标题...');
      let titleInput = null;
      const titleSelectors = [
        'input[placeholder*="标题"]',
        'input[placeholder*="title"]',
        '#web input[type="text"]',
        '.title-input input',
        '[data-testid*="title"] input',
        'input[class*="title"]'
      ];
      
      for (const selector of titleSelectors) {
        try {
          titleInput = await this.page.$(selector);
          if (titleInput) {
            console.log(`找到标题输入框，使用选择器: ${selector}`);
            break;
          }
        } catch (e) {
          console.log(`标题输入选择器 ${selector} 失败:`, e.message);
        }
      }
      
      if (!titleInput) {
        try {
          titleInput = await this.page.waitForSelector('input[placeholder*="标题"]', { timeout: 10000 });
          console.log('通过等待找到标题输入框');
        } catch (e) {
          console.log('未找到标题输入框:', e.message);
          throw new Error('无法找到标题输入框');
        }
      }
      await titleInput.click();
      await titleInput.evaluate(el => el.value = '');
      console.log('准备输入标题:', title);
      await titleInput.type(title);
      console.log('标题已输入');

      // 4. 输入内容
      console.log('输入内容...');
      let contentEditor = null;
      const contentSelectors = [
        '#quillEditor div[contenteditable="true"]',
        '#quillEditor div',
        'div[class*="editor"]',
        'textarea[placeholder*="内容"]',
        '[data-testid*="content"] div',
        '.content-editor',
        'div[contenteditable="true"]',
        'textarea[class*="content"]'
      ];
      
      for (const selector of contentSelectors) {
        try {
          contentEditor = await this.page.$(selector);
          if (contentEditor) {
            console.log(`找到内容编辑器，使用选择器: ${selector}`);
            break;
          }
        } catch (e) {
          console.log(`内容编辑器选择器 ${selector} 失败:`, e.message);
        }
      }
      
      if (!contentEditor) {
        try {
          contentEditor = await this.page.waitForSelector('div[class*="editor"], textarea[placeholder*="内容"]', { timeout: 10000 });
          console.log('通过等待找到内容编辑器');
        } catch (e) {
          console.log('未找到内容编辑器:', e.message);
          throw new Error('无法找到内容编辑器');
        }
      }
      await contentEditor.click();
      await contentEditor.evaluate(el => el.innerHTML = '');
      console.log('准备输入内容:', content);
      await contentEditor.type(content);
      console.log('内容已输入');

      // 5. 点击发布按钮
      console.log('点击发布按钮...');
      let publishBtn = null;
      const publishSelectors = [
        'button[class*="publish"]',
        'button:contains("发布")',
        '[data-testid*="publish"] button',
        '.publish-btn',
        'button[type="submit"]',
        '#web button:last-child'
      ];
      
      for (const selector of publishSelectors) {
        try {
          publishBtn = await this.page.$(selector);
          if (publishBtn) {
            console.log(`找到发布按钮，使用选择器: ${selector}`);
            break;
          }
        } catch (e) {
          console.log(`发布按钮选择器 ${selector} 失败:`, e.message);
        }
      }
      
      if (!publishBtn) {
        // 通过文本内容查找发布按钮
        console.log('通过文本内容查找发布按钮...');
        publishBtn = await this.page.evaluateHandle(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          return buttons.find(btn => 
            btn.textContent && (btn.textContent.includes('发布') || btn.textContent.includes('提交'))
          );
        });
      }
      
      if (!publishBtn) {
        throw new Error('无法找到发布按钮');
      }
      await publishBtn.click();
      console.log('已点击发布按钮');

      // 等待发布完成
      await new Promise(resolve => setTimeout(resolve, 8000));
      
      // 6. 发布成功后清空标题和内容
      console.log('清空表单内容...');
      try {
        // 清空标题
        const titleInputClear = await this.page.$('input[placeholder*="标题"]');
        if (titleInputClear) {
          await titleInputClear.evaluate(el => el.value = '');
          console.log('标题已清空');
        } else {
          console.log('未找到标题输入框进行清空');
        }
        
        // 清空内容
        const contentEditorClear = await this.page.$('#quillEditor div, div[class*="editor"], textarea[placeholder*="内容"]');
        if (contentEditorClear) {
          await contentEditorClear.evaluate(el => {
            if (el.tagName === 'TEXTAREA') {
              el.value = '';
            } else {
              el.innerHTML = '';
            }
          });
          console.log('内容已清空');
        } else {
          console.log('未找到内容编辑器进行清空');
        }
        
        console.log('表单内容已清空');
      } catch (error) {
        console.log('清空表单时出现错误:', error.message);
      }
      
      console.log('笔记发布成功');
      
      // 发布成功后自动关闭浏览器窗口
      try {
        console.log('发布成功，正在关闭浏览器窗口...');
        await this.close();
        console.log('浏览器窗口已关闭');
      } catch (closeError) {
        console.log('关闭浏览器时出现错误:', closeError.message);
      }
      
      return { success: true, message: '笔记发布成功' };
      
    } catch (error) {
      console.error('发布笔记失败:', error);
      return { success: false, message: `发布失败: ${error.message}` };
    }
  }

  async downloadImage(url) {
    return new Promise((resolve, reject) => {
      const fileName = path.basename(url);
      const localPath = path.join('/tmp', fileName);
      const file = fs.createWriteStream(localPath);
      
      https.get(url, (response) => {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve(localPath);
        });
      }).on('error', (error) => {
        fs.unlink(localPath, () => {});
        reject(error);
      });
    });
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      console.log('浏览器已关闭');
    }
  }
}

module.exports = { XiaohongshuPoster };