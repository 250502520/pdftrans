import { PDFDocument } from 'pdf-lib';

// 严格资源限制
const MAX_IMAGES = 50; // 最多5张图片
const MAX_FILE_SIZE = 8 * 1024 * 1024; // 单文件最大5MB
const MAX_TOTAL_SIZE = 100* 1024 * 1024; // 总大小限制15MB
const MEMORY_THRESHOLD = 110 * 1024 * 1024; // 50MB内存阈值

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // 处理CORS预检请求
    if (request.method === "OPTIONS") {
      return handleCors();
    }
    
    // 提供前端页面
    if (request.method === 'GET' && url.pathname === '/') {
      return serveFrontend();
    }
    
    // 处理转换请求
    if (request.method === 'POST' && url.pathname === '/convert') {
      return handleConversion(request);
    }
    
    return new Response('Not Found', { 
      status: 404,
      headers: corsHeaders()
    });
  }
};

// CORS处理函数
function handleCors() {
  return new Response(null, {
    headers: {
      ...corsHeaders(),
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    }
  });
}

// CORS头部
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Credentials': 'true'
  };
}

// 提供前端HTML页面
async function serveFrontend() {
  return new Response(FRONTEND_HTML, {
    headers: { 
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      ...corsHeaders()
    }
  });
}

// 处理转换请求
async function handleConversion(request) {
  const startTime = Date.now();
  let memoryStart = 0;
  
  try {
    // 记录内存使用情况
    if (typeof performance !== 'undefined' && performance.memory) {
      memoryStart = performance.memory.usedJSHeapSize;
      console.log(`开始内存使用: ${Math.round(memoryStart / 1024 / 1024)}MB`);
    }
    
    console.log('收到转换请求');
    
    const formData = await request.formData();
    const files = formData.getAll('images');
    const fileName = formData.get('fileName') || 'converted_images';
    
    // 验证图片数量
    if (files.length === 0) {
      return new Response('未选择任何图片', {
        status: 400,
        headers: {
          ...corsHeaders(),
          'Content-Type': 'text/plain'
        }
      });
    }
    
    if (files.length > MAX_IMAGES) {
      return new Response(`最多支持 ${MAX_IMAGES} 张图片`, {
        status: 400,
        headers: {
          ...corsHeaders(),
          'Content-Type': 'text/plain'
        }
      });
    }
    
    // 检查总大小
    let totalSize = 0;
    for (const file of files) {
      totalSize += file.size;
    }
    
    if (totalSize > MAX_TOTAL_SIZE) {
      return new Response(`图片总大小超过 ${MAX_TOTAL_SIZE / 1024 / 1024}MB 限制`, {
        status: 400,
        headers: {
          ...corsHeaders(),
          'Content-Type': 'text/plain'
        }
      });
    }

    // 创建PDF文档
    const pdfDoc = await PDFDocument.create();
    
    // 使用更轻量的WebP解码方式
    let webpDecoderPromise = null;
    
    // 处理每张图片（使用流式处理）
    for (const file of files) {
      if (!file || typeof file.arrayBuffer !== 'function') {
        console.warn('无效的文件对象:', file);
        continue;
      }
      
      // 检查文件大小
      if (file.size > MAX_FILE_SIZE) {
        console.warn(`文件 ${file.name} 超过大小限制`);
        continue;
      }
      
      try {
        // 内存检查
        checkMemoryUsage();
        
        const chunks = [];
        const reader = file.stream().getReader();
        let totalBytes = 0;
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          totalBytes += value.length;
          chunks.push(value);
          
          // 每处理100KB释放一次事件循环
          if (totalBytes % (100 * 1024) === 0) {
            await new Promise(resolve => setTimeout(resolve, 10));
            checkMemoryUsage();
          }
        }
        
        const imageBytes = concatUint8Arrays(chunks);
        
        // 根据图片类型处理
        if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
          const image = await pdfDoc.embedJpg(imageBytes);
          addImagePage(pdfDoc, image);
          console.log(`已处理JPEG图片: ${file.name}`);
        } 
        else if (file.type === 'image/png') {
          const image = await pdfDoc.embedPng(imageBytes);
          addImagePage(pdfDoc, image);
          console.log(`已处理PNG图片: ${file.name}`);
        }
        else if (file.type === 'image/webp') {
          // 按需加载webp解码器
          if (!webpDecoderPromise) {
            console.log('初始化WebP解码器...');
            webpDecoderPromise = (async () => {
              const { decode } = await import('https://unpkg.com/webp-wasm@0.2.1/webp_wasm.js');
              await decode.ready;
              return decode;
            })();
          }
          
          const decode = await webpDecoderPromise;
          const { data, width, height } = decode(imageBytes);
          
          // 释放事件循环
          await new Promise(resolve => setTimeout(resolve, 0));
          
          const pngImage = await pdfDoc.embedPng({
            width,
            height,
            data: new Uint8Array(data),
            colorSpace: 'rgb'
          });
          
          addImagePage(pdfDoc, pngImage);
          console.log(`已处理WebP图片: ${file.name}`);
          
          // 显式释放WebP内存
          if (decode.free) decode.free();
        }
        else {
          console.warn(`不支持的图片类型: ${file.type} - ${file.name}`);
        }
        
        // 显式释放内存
        chunks.length = 0;
      } catch (err) {
        console.error(`图片处理错误: ${err.message} - ${file.name}`);
      }
      
      // 释放事件循环
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    // 检查是否有有效页面
    if (pdfDoc.getPageCount() === 0) {
      return new Response('未添加任何有效图片', {
        status: 400,
        headers: {
          ...corsHeaders(),
          'Content-Type': 'text/plain'
        }
      });
    }

    // 生成PDF文件
    const pdfBytes = await pdfDoc.save();
    console.log(`PDF生成成功，文件名: ${fileName}.pdf`);
    
    // 返回PDF文件
    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${cleanFileName(fileName)}.pdf"`,
        ...corsHeaders()
      }
    });

  } catch (err) {
    console.error('转换处理错误:', err);
    return new Response(`服务器错误: ${err.message}`, { 
      status: 500,
      headers: {
        ...corsHeaders(),
        'Content-Type': 'text/plain'
      }
    });
  } finally {
    // 记录处理结束信息
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    if (typeof performance !== 'undefined' && performance.memory && memoryStart) {
      const memoryEnd = performance.memory.usedJSHeapSize;
      const memoryDiff = Math.round((memoryEnd - memoryStart) / 1024 / 1024);
      console.log(`处理完成，耗时: ${duration}ms, 内存变化: ${memoryDiff}MB`);
    } else {
      console.log(`处理完成，耗时: ${duration}ms`);
    }
  }
}

// 辅助函数：合并Uint8Arrays
function concatUint8Arrays(arrays) {
  const totalLength = arrays.reduce((acc, value) => acc + value.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// 添加图片到PDF页面
function addImagePage(pdfDoc, image) {
  const page = pdfDoc.addPage([image.width, image.height]);
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: image.width,
    height: image.height,
  });
}

// 清理文件名中的非法字符
function cleanFileName(name) {
  return name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5\-_]/g, '_');
}

// 内存监控函数
function checkMemoryUsage() {
  if (typeof performance !== 'undefined' && performance.memory) {
    const usedMB = performance.memory.usedJSHeapSize / 1024 / 1024;
    
    if (usedMB > MEMORY_THRESHOLD * 0.8) {
      console.warn(`内存使用过高: ${usedMB.toFixed(2)}MB`);
      // 尝试触发垃圾回收
      if (typeof global.gc === 'function') {
        global.gc();
        console.log("主动触发垃圾回收");
      }
    }
  }
}

// 前端HTML内容
const FRONTEND_HTML = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>图片转PDF工具 - 优化版</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    }
    
    body {
      background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
      min-height: 100vh;
      padding: 20px;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    
    .container {
      width: 100%;
      max-width: 800px;
      background: white;
      border-radius: 16px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
      overflow: hidden;
      padding: 30px;
    }
    
    h1 {
      text-align: center;
      color: #2c3e50;
      margin-bottom: 10px;
      font-size: 2.2rem;
    }
    
    .subtitle {
      text-align: center;
      color: #7f8c8d;
      margin-bottom: 30px;
      font-size: 1.1rem;
    }
    
    .info-cards {
      display: flex;
      gap: 15px;
      margin-bottom: 25px;
      flex-wrap: wrap;
    }
    
    .info-card {
      flex: 1;
      min-width: 200px;
      background: #f8f9fa;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
    }
    
    .info-card h3 {
      color: #3498db;
      margin-bottom: 15px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .info-card h3 i {
      font-size: 1.3rem;
    }
    
    .info-card ul {
      padding-left: 20px;
    }
    
    .info-card li {
      margin-bottom: 8px;
      color: #34495e;
    }
    
    .upload-area {
      border: 3px dashed #3498db;
      border-radius: 12px;
      padding: 40px 20px;
      text-align: center;
      background: #f8fafc;
      cursor: pointer;
      transition: all 0.3s ease;
      margin-bottom: 25px;
    }
    
    .upload-area:hover {
      background: #e8f4fe;
      border-color: #2980b9;
    }
    
    .upload-area h3 {
      color: #2c3e50;
      margin-bottom: 10px;
      font-size: 1.4rem;
    }
    
    .upload-area p {
      color: #7f8c8d;
      font-size: 1rem;
    }
    
    .file-input {
      display: none;
    }
    
    .preview-container {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 15px;
      margin-bottom: 25px;
    }
    
    .preview-item {
      position: relative;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
      aspect-ratio: 4/3;
    }
    
    .preview-item img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    
    .size-info {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 5px;
      font-size: 0.75rem;
      text-align: center;
    }
    
    .remove {
      position: absolute;
      top: 5px;
      right: 5px;
      width: 24px;
      height: 24px;
      background: #e74c3c;
      color: white;
      border-radius: 50%;
      display: flex;
      justify-content: center;
      align-items: center;
      cursor: pointer;
      font-weight: bold;
      font-size: 1.1rem;
    }
    
    .input-group {
      margin-bottom: 25px;
    }
    
    .input-group label {
      display: block;
      margin-bottom: 8px;
      color: #2c3e50;
      font-weight: 500;
    }
    
    .input-group input {
      width: 100%;
      padding: 14px;
      border: 2px solid #e0e6ed;
      border-radius: 10px;
      font-size: 1rem;
      transition: border-color 0.3s;
    }
    
    .input-group input:focus {
      border-color: #3498db;
      outline: none;
      box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.2);
    }
    
    .btn {
      display: block;
      width: 100%;
      padding: 16px;
      background: linear-gradient(135deg, #3498db 0%, #2980b9 100%);
      color: white;
      border: none;
      border-radius: 10px;
      font-size: 1.1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      box-shadow: 0 4px 6px rgba(52, 152, 219, 0.3);
    }
    
    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 10px rgba(52, 152, 219, 0.4);
    }
    
    .btn:disabled {
      background: #bdc3c7;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }
    
    .status {
      margin-top: 20px;
      padding: 15px;
      border-radius: 10px;
      text-align: center;
      font-weight: 500;
      opacity: 0;
      max-height: 0;
      overflow: hidden;
      transition: all 0.4s ease;
    }
    
    .status.visible {
      opacity: 1;
      max-height: 100px;
      margin-top: 25px;
    }
    
    .status.success {
      background: #e8f7ef;
      color: #27ae60;
      border: 1px solid #2ecc71;
    }
    
    .status.error {
      background: #fceae9;
      color: #c0392b;
      border: 1px solid #e74c3c;
    }
    
    .status.loading {
      background: #ebf5fb;
      color: #2980b9;
      border: 1px solid #3498db;
    }
    
    .progress-container {
      margin: 20px 0;
      background: #ecf0f1;
      border-radius: 10px;
      overflow: hidden;
      height: 20px;
      display: none;
    }
    
    .progress-bar {
      height: 100%;
      background: linear-gradient(90deg, #3498db, #2ecc71);
      width: 0%;
      transition: width 0.5s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 0.8rem;
      font-weight: bold;
    }
    
    .memory-info {
      margin-top: 15px;
      text-align: center;
      font-size: 0.9rem;
      color: #7f8c8d;
    }
    
    @media (max-width: 600px) {
      .container {
        padding: 20px 15px;
      }
      
      h1 {
        font-size: 1.8rem;
      }
      
      .info-cards {
        flex-direction: column;
      }
      
      .preview-container {
        grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📷 图片转PDF工具</h1>
    <p class="subtitle">优化版 - 最多5张图片，每张不超过5MB</p>
    
    <div class="info-cards">
      <div class="info-card">
        <h3><i>✅</i> 支持格式</h3>
        <ul>
          <li>JPEG/JPG - 完全支持</li>
          <li>PNG - 完全支持</li>
          <li>WebP - 实验性支持</li>
        </ul>
      </div>
      
      <div class="info-card">
        <h3><i>⚠️</i> 使用限制</h3>
        <ul>
          <li>最多5张图片</li>
          <li>每张图片≤5MB</li>
          <li>总大小≤15MB</li>
        </ul>
      </div>
    </div>
    
    <div class="upload-area" id="uploadArea">
      <h3>点击或拖放图片到此处</h3>
      <p>支持JPG, PNG, WebP格式（最多5张，每张≤5MB）</p>
      <input type="file" id="fileInput" class="file-input" accept="image/*" multiple>
    </div>
    
    <div class="preview-container" id="previewContainer"></div>
    
    <div class="progress-container" id="progressContainer">
      <div class="progress-bar" id="progressBar">0%</div>
    </div>
    
    <div class="input-group">
      <label for="fileName">PDF文件名称（可选）</label>
      <input type="text" id="fileName" placeholder="例如：我的文档">
    </div>
    
    <button id="convertBtn" class="btn" disabled>生成PDF</button>
    
    <div class="status" id="statusMsg"></div>
    
    <div class="memory-info" id="memoryInfo">内存优化处理中，大文件可能需要10-20秒</div>
  </div>

  <script>
    // 获取DOM元素
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    const previewContainer = document.getElementById('previewContainer');
    const fileNameInput = document.getElementById('fileName');
    const convertBtn = document.getElementById('convertBtn');
    const statusMsg = document.getElementById('statusMsg');
    const progressContainer = document.getElementById('progressContainer');
    const progressBar = document.getElementById('progressBar');
    const memoryInfo = document.getElementById('memoryInfo');
    
    // 存储选择的文件
    let selectedFiles = [];
    
    // 拖放功能
    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.style.borderColor = '#27ae60';
      uploadArea.style.backgroundColor = '#eafaf1';
    });
    
    uploadArea.addEventListener('dragleave', () => {
      uploadArea.style.borderColor = '#3498db';
      uploadArea.style.backgroundColor = '#f8fafc';
    });
    
    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.style.borderColor = '#3498db';
      uploadArea.style.backgroundColor = '#f8fafc';
      
      if (e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
    });
    
    // 点击上传区域触发文件选择
    uploadArea.addEventListener('click', () => {
      fileInput.click();
    });
    
    // 文件选择处理
    fileInput.addEventListener('change', function() {
      if (this.files.length === 0) return;
      handleFiles(this.files);
    });
    
    function handleFiles(files) {
      // 重置选择
      selectedFiles = [];
      
      // 添加新文件（带限制检查）
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        if (selectedFiles.length >= 5) {
          showStatus('最多只能选择5张图片', 'error');
          break;
        }
        
        if (file.size > 5 * 1024 * 1024) {
          showStatus(`图片 ${file.name} 超过5MB限制`, 'error');
          continue;
        }
        
        if (file.type.startsWith('image/')) {
          selectedFiles.push(file);
        }
      }
      
      renderPreviews();
      convertBtn.disabled = selectedFiles.length === 0;
      
      if (selectedFiles.length > 0) {
        showStatus(`已选择 ${selectedFiles.length} 张图片`, 'success');
      }
    }
    
    // 渲染预览
    function renderPreviews() {
      previewContainer.innerHTML = '';
      
      selectedFiles.forEach((file, index) => {
        const reader = new FileReader();
        
        reader.onload = function(e) {
          const previewItem = document.createElement('div');
          previewItem.className = 'preview-item';
          
          const img = document.createElement('img');
          img.src = e.target.result;
          img.alt = file.name;
          
          const sizeInfo = document.createElement('div');
          sizeInfo.className = 'size-info';
          sizeInfo.textContent = `${(file.size / 1024 / 1024).toFixed(2)}MB`;
          
          const removeBtn = document.createElement('div');
          removeBtn.className = 'remove';
          removeBtn.innerHTML = '×';
          removeBtn.onclick = () => removeFile(index);
          
          previewItem.appendChild(img);
          previewItem.appendChild(sizeInfo);
          previewItem.appendChild(removeBtn);
          previewContainer.appendChild(previewItem);
        };
        
        reader.readAsDataURL(file);
      });
    }
    
    // 移除文件
    function removeFile(index) {
      selectedFiles.splice(index, 1);
      renderPreviews();
      convertBtn.disabled = selectedFiles.length === 0;
    }
    
    // 转换按钮点击
    convertBtn.addEventListener('click', async function() {
      if (selectedFiles.length === 0) {
        showStatus('请先选择图片', 'error');
        return;
      }
      
      try {
        showStatus('正在转换中，请稍候...', 'loading');
        convertBtn.disabled = true;
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';
        progressBar.textContent = '0%';
        
        const formData = new FormData();
        const fileName = fileNameInput.value.trim() || '我的文档';
        formData.append('fileName', fileName);
        
        // 添加所有图片
        for (let i = 0; i < selectedFiles.length; i++) {
          formData.append('images', selectedFiles[i]);
          
          // 更新进度条
          const percent = Math.round(((i + 1) / selectedFiles.length) * 100);
          progressBar.style.width = `${percent}%`;
          progressBar.textContent = `${percent}%`;
          
          // 添加延迟让UI更新
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        // 发送请求
        const response = await fetch('/convert', {
          method: 'POST',
          body: formData
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`转换失败: ${errorText}`);
        }
        
        // 创建下载
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `${fileName}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        
        showStatus(`转换成功！已下载 ${fileName}.pdf`, 'success');
        
      } catch (err) {
        console.error('转换错误:', err);
        showStatus(`错误: ${err.message}`, 'error');
      } finally {
        convertBtn.disabled = false;
        progressContainer.style.display = 'none';
      }
    });
    
    // 显示状态消息
    function showStatus(message, type) {
      statusMsg.textContent = message;
      statusMsg.className = `status visible ${type}`;
      
      // 自动隐藏成功消息
      if (type === 'success') {
        setTimeout(() => {
          statusMsg.className = 'status';
        }, 5000);
      }
    }
    
    // 初始化
    memoryInfo.textContent = "优化内存处理，大图片转换可能需要10-20秒";
  </script>
</body>
</html>
`;
