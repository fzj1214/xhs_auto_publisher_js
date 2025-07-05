const axios = require('axios');
const crypto = require('crypto');

// 配置参数（从环境变量或配置文件读取）
const ACCESS_KEY_ID = process.env.VOLCENGINE_ACCESS_KEY_ID || "YOUR_ACCESS_KEY_ID";
const SECRET_ACCESS_KEY = process.env.VOLCENGINE_SECRET_ACCESS_KEY || "YOUR_SECRET_ACCESS_KEY";
const SERVICE = "cv"; // 服务名固定
const REGION = "cn-north-1"; // 区域固定
const VERSION = "2022-08-31"; // API版本
const ACTION = "CVProcess"; // 接口名

// 生成签名函数
const sign = (key, msg) => {
  return crypto.createHmac('sha256', key).update(msg).digest();
};

const getSignature = (secretKey, date, region, service, stringToSign) => {
  const kDate = sign(secretKey, date);
  const kRegion = sign(kDate, region);
  const kService = sign(kRegion, service);
  const kSigning = sign(kService, 'request');
  return sign(kSigning, stringToSign).toString('hex');
};

// 主调用函数
const generateImage = async (prompt) => {
  const endpoint = "https://open.volcengineapi.com";
  const now = new Date();
  // 火山引擎要求的时间戳格式：YYYYMMDDTHHMMSSZ
  const timestamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  
  // 确保使用UTC时间，添加调试信息
  console.log('当前UTC时间:', timestamp);
  console.log('当前本地时间:', now.toString());
  console.log('时间戳格式检查:', /^\d{8}T\d{6}Z$/.test(timestamp));
  const payload = {
    req_key: "high_aes_general_v21_L",
    prompt: prompt,
    seed: -1,
    scale: 3.5,
    ddim_steps: 25,
    width: 512,
    height: 512,
    use_pre_llm: true,
    use_sr: true,
    return_url: false,
    logo_info: {
      add_logo: false
    }
  };

  // 1. 构造规范请求
  const hashedPayload = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const canonicalQueryString = `Action=${ACTION}&Version=${VERSION}`;
  const canonicalRequest = `POST\n/\n${canonicalQueryString}\ncontent-type:application/json\nhost:open.volcengineapi.com\nx-content-sha256:${hashedPayload}\nx-date:${timestamp}\n\ncontent-type;host;x-content-sha256;x-date\n${hashedPayload}`;

  // 2. 生成签名
  const date = timestamp.substring(0, 8); // 提取YYYYMMDD部分
  const stringToSign = `HMAC-SHA256\n${timestamp}\n${date}/${REGION}/${SERVICE}/request\n${crypto.createHash('sha256').update(canonicalRequest).digest('hex')}`;
  const signature = getSignature(SECRET_ACCESS_KEY, date, REGION, SERVICE, stringToSign);
  
  // 调试信息
  console.log("CanonicalRequest:\n", canonicalRequest);
  console.log("StringToSign:\n", stringToSign);
  console.log("Signature:", signature);

  // 3. 设置请求头
  const headers = {
    'Content-Type': 'application/json',
    'X-Date': timestamp,
    'X-Content-Sha256': hashedPayload,
    'Authorization': `HMAC-SHA256 Credential=${ACCESS_KEY_ID}/${date}/${REGION}/${SERVICE}/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=${signature}`
  };

  // 4. 发送请求
  try {
    const response = await axios.post(
      `${endpoint}?Action=${ACTION}&Version=${VERSION}`,
      payload,
      { headers }
    );

    console.log('API响应数据:', JSON.stringify(response.data, null, 2));
    
    // 5. 获取JPG图片（Base64格式）
    const responseData = response.data.data;
    if (!responseData) {
      throw new Error('API响应中没有data字段');
    }
    
    // 检查binary_data_base64数组
    if (!responseData.binary_data_base64 || responseData.binary_data_base64.length === 0) {
      throw new Error('API响应中binary_data_base64为空');
    }
    
    const imageData = responseData.binary_data_base64[0];
    if (!imageData) {
      throw new Error('binary_data_base64[0]为空');
    }
    
    const imgBuffer = Buffer.from(imageData, 'base64');
    
    // 保存为文件（可选）
    const fs = require('fs');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `generated_${timestamp}.jpg`;
    const filepath = `uploads/${filename}`;
    fs.writeFileSync(filepath, imgBuffer);
    console.log(`图片生成成功！保存为 ${filename}`);
    console.log(`图片已保存到: ${require('path').resolve(filepath)}`);

    return {
      buffer: imgBuffer,
      filename: filename,
      base64: imageData
    };
  } catch (error) {
    console.error("API调用失败:", error.response?.data || error.message);
  }
};

// 导出函数
module.exports = {
  generateImage
};

// 使用示例（注释掉避免自动执行）
// generateImage("赛博朋克风格的城市夜景，霓虹灯闪烁，雨天街道反射");