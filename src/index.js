import { PDFDocument } from 'pdf-lib';

// 配置参数
const MAX_IMAGES = 100;
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB

export default {
  async fetch(request) {
    const url = new URL(request.url);
    
    // 提供前端页面
    if (request.method === 'GET' && url.pathname === '/') {
      return serveFrontend();
    }
    
    // 处理转换请求
    if (request.method === 'POST' && url.pathname === '/convert') {
      return handleConversion(request);
    }
    
    return new Response('Not Found', { status: 404 });
  }
};

// 提供前端HTML页面
async function serveFrontend() {
  const html = `
  <!DOCTYPE html>
  <html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>图片转PDF工具</title>
    <style>
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      
      body {
        background: linear-gradient(135deg, #6a11cb 0%, #2575fc 100%);
        min-height: 100vh;
        padding: 20px;
        display: flex;
        justify-content: center;
        align-items: center;
      }
      
      .container {
        background-color: rgba(255, 255, 255, 0.95);
        border-radius: 20px;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
        width: 100%;
        max-width: 500px;
        padding: 30px;
      }
      
      h1 {
        color: #2c3e50;
        text-align: center;
        margin-bottom: 15px;
        font-size: 1.8rem;
      }
      
      .subtitle {
        color: #7f8c8d;
        text-align: center;
        margin-bottom: 25px;
        font-size: 1rem;
      }
      
      .upload-area {
        border: 2px dashed #3498db;
        border-radius: 15px;
        padding: 35px 20px;
        margin: 20px 0;
        background-color: #f8f9fa;
        transition: all 0.3s;
        position: relative;
        text-align: center;
      }
      
      .upload-area.active {
        background-color: #e3f2fd;
        border-color: #1e88e5;
      }
      
      .file-input {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        opacity: 0;
        cursor: pointer;
      }
      
      .preview-container {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin: 20px 0;
        max-height: 200px;
        overflow-y: auto;
        justify-content: center;
      }
      
      .preview-item {
        position: relative;
        width: 80px;
        height: 80px;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 3px 6px rgba(0,0,0,0.1);
      }
      
      .preview-item img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      
      .preview-item .remove {
        position: absolute;
        top: 2px;
        right: 2px;
        background: rgba(231, 76, 60, 0.8);
        color: white;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        cursor: pointer;
      }
      
      .input-group {
        margin: 25px 0;
        text-align: left;
      }
      
      label {
        display: block;
        margin-bottom: 8px;
        color: #2c3e50;
        font-weight: 500;
      }
      
      input[type="text"] {
        width: 100%;
        padding: 14px;
        border: 1px solid #ddd;
        border-radius: 10px;
        font-size: 16px;
        transition: border 0.3s;
      }
      
      input[type="text"]:focus {
        border-color: #3498db;
        outline: none;
      }
      
      .btn {
        background: linear-gradient(to right, #3498db, #2c3e50);
        color: white;
        border: none;
        border-radius: 10px;
        padding: 16px;
        font-size: 18px;
        font-weight: 600;
        cursor: pointer;
        width: 100%;
        margin-top: 15px;
        box-shadow: 0 4px 10px rgba(52, 152, 219, 0.3);
        transition: all 0.3s;
      }
      
      .btn:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 6px 15px rgba(52, 152, 219, 0.4);
      }
      
      .btn:disabled {
        background: #95a5a6;
        cursor: not-allowed;
        box-shadow: none;
      }
      
      .status {
        margin-top: 20px;
        padding: 14px;
        border-radius: 10px;
        font-size: 16px;
        display: none;
      }
      
      .status.visible {
        display: block;
      }
      
      .loading {
        background: #fff8e1;
        color: #ff9800;
      }
      
      .error {
        background: #ffebee;
        color: #f44336;
      }
      
      .success {
        background: #e8f5e9;
        color: #4caf50;
      }
      
      .instructions {
        background: #e3f2fd;
        border-left: 4px solid #3498db;
        padding: 12px;
        margin: 20px 0;
        border-radius: 0 8px 8px 0;
        text-align: left;
      }
      
      .instructions h3 {
        color: #2c3e50;
        margin-bottom: 8px;
        font-size: 1.1rem;
      }
      
      .instructions ol {
        padding-left: 20px;
      }
      
      .instructions li {
        margin-bottom: 8px;
      }
      
      .counter {
        position: absolute;
        bottom: 10px;
        right: 10px;
        background: rgba(52, 152, 219, 0.8);
        color: white;
        padding: 3px 8px;
        border-radius: 20px;
        font-size: 0.8rem;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>图片转PDF工具</h1>
      <p class="subtitle">高质量转换 • 无限图片 • 自定义名称</p>
      
      <div class="instructions">
        <h3>使用说明：</h3>
        <ol>
          <li>点击下方区域选择图片（支持多选）</li>
          <li>输入PDF文件名称（可选）</li>
          <li>点击"生成PDF"按钮</li>
          <li>等待转换完成后自动下载</li>
        </ol>
      </div>
      
      <div class="upload-area" id="uploadArea">
        <div class="upload-icon">📁</div>
        <h3>点击或拖放图片到这里</h3>
        <p>支持JPG, PNG, WebP格式</p>
        <input type="file" id="fileInput" class="file-input" accept="image/*" multiple>
        <div class="counter" id="fileCounter">0张图片</div>
      </div>
      
      <div class="preview-container" id="previewContainer"></div>
      
      <div class="input-group">
        <label for="fileName">PDF文件名称（可选）</label>
        <input type="text" id="fileName" placeholder="例如：我的文档">
      </div>
      
      <button id="convertBtn" class="btn" disabled>生成PDF</button>
      
      <div class="status" id="statusMsg"></div>
    </div>

    <script>
      // 获取DOM元素
      const uploadArea = document.getElementById('uploadArea');
      const fileInput = document.getElementById('fileInput');
      const previewContainer = document.getElementById('previewContainer');
      const fileNameInput = document.getElementById('fileName');
      const convertBtn = document.getElementById('convertBtn');
      const statusMsg = document.getElementById('statusMsg');
      const fileCounter = document.getElementById('fileCounter');
      
      // 存储选择的文件
      let selectedFiles = [];
      
      // 文件选择处理
      fileInput.addEventListener('change', handleFileSelect);
      
      // 拖放功能
      uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('active');
      });
      
      uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('active');
      });
      
      uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('active');
        handleFileDrop(e.dataTransfer.files);
      });
      
      // 处理文件选择
      function handleFileSelect(e) {
        handleFiles(e.target.files);
      }
      
      // 处理文件拖放
      function handleFileDrop(files) {
        handleFiles(files);
      }
      
      // 处理文件
      function handleFiles(files) {
        if (files.length === 0) return;
        
        // 添加新文件到已选文件列表
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (file.type.startsWith('image/')) {
            selectedFiles.push(file);
          }
        }
        
        // 更新文件计数器
        updateFileCounter();
        
        // 显示预览
        renderPreviews();
        
        // 启用转换按钮
        convertBtn.disabled = false;
        showStatus(\`已添加 \${files.length} 张图片\`, 'success');
      }
      
      // 更新文件计数器
      function updateFileCounter() {
        fileCounter.textContent = \`\${selectedFiles.length}张图片\`;
      }
      
      // 渲染预览
      function renderPreviews() {
        previewContainer.innerHTML = '';
        
        selectedFiles.forEach((file, index) => {
          const reader = new FileReader();
          
          reader.onload = (e) => {
            const previewItem = document.createElement('div');
            previewItem.className = 'preview-item';
            
            const img = document.createElement('img');
            img.src = e.target.result;
            img.alt = file.name;
            
            const removeBtn = document.createElement('div');
            removeBtn.className = 'remove';
            removeBtn.innerHTML = '×';
            removeBtn.onclick = () => removeFile(index);
            
            previewItem.appendChild(img);
            previewItem.appendChild(removeBtn);
            previewContainer.appendChild(previewItem);
          };
          
          reader.readAsDataURL(file);
        });
      }
      
      // 移除文件
      function removeFile(index) {
        selectedFiles.splice(index, 1);
        updateFileCounter();
        renderPreviews();
        
        if (selectedFiles.length === 0) {
          convertBtn.disabled = true;
        }
      }
      
      // 转换按钮点击
      convertBtn.addEventListener('click', async () => {
        if (selectedFiles.length === 0) {
          showStatus('请先选择图片', 'error');
          return;
        }
        
        try {
          showStatus('正在转换中，请稍候...', 'loading');
          convertBtn.disabled = true;
          
          const formData = new FormData();
          const fileName = fileNameInput.value.trim() || '我的文档';
          formData.append('fileName', fileName);
          
          // 添加所有图片
          selectedFiles.forEach(file => {
            formData.append('images', file);
          });
          
          // 发送请求到当前worker的/convert端点
          const response = await fetch('/convert', {
            method: 'POST',
            body: formData
          });
          
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(\`转换失败: \${errorText}\`);
          }
          
          // 创建下载
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          
          const a = document.createElement('a');
          a.href = url;
          a.download = \`\${fileName}.pdf\`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          
          showStatus(\`转换成功！已下载 \${fileName}.pdf\`, 'success');
          
        } catch (err) {
          console.error('转换错误:', err);
          showStatus(\`错误: \${err.message}\`, 'error');
        } finally {
          convertBtn.disabled = false;
        }
      });
      
      // 显示状态消息
      function showStatus(message, type) {
        statusMsg.textContent = message;
        statusMsg.className = 'status visible';
        statusMsg.classList.add(type);
        
        // 自动隐藏成功消息
        if (type === 'success') {
          setTimeout(() => {
            statusMsg.className = 'status';
          }, 5000);
        }
      }
      
      // 初始化
      updateFileCounter();
    </script>
  </body>
  </html>
  `;
  
  return new Response(html, {
    headers: { 
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}

// 处理转换请求
async function handleConversion(request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('images');
    const fileName = formData.get('fileName') || 'converted_images';
    
    // 验证图片数量
    if (files.length > MAX_IMAGES) {
      return new Response(`最多支持 ${MAX_IMAGES} 张图片`, {
        status: 400,
        headers: { 'Access-Control-Allow-Origin': '*' }
      });
    }

    // 创建PDF文档
    const pdfDoc = await PDFDocument.create();
    
    // 动态导入 webp-wasm（从CDN）
    let webpDecoder = null;
    
    // 处理每张图片
    for (const file of files) {
      if (!file || typeof file.arrayBuffer !== 'function') continue;
      
      // 检查文件大小
      if (file.size > MAX_FILE_SIZE) {
        console.warn(`文件 ${file.name} 超过大小限制`);
        continue;
      }
      
      const imageBytes = new Uint8Array(await file.arrayBuffer());
      
      try {
        // 根据图片类型处理
        if (file.type === 'image/jpeg' || file.type === 'image/jpg') {
          const image = await pdfDoc.embedJpg(imageBytes);
          addImagePage(pdfDoc, image);
        } 
        else if (file.type === 'image/png') {
          const image = await pdfDoc.embedPng(imageBytes);
          addImagePage(pdfDoc, image);
        }
        else if (file.type === 'image/webp') {
          // 按需加载 webp 解码器
          if (!webpDecoder) {
            // 动态加载 WebP 解码器
            const { decode } = await import('https://unpkg.com/webp-wasm@0.2.1/webp_wasm.js');
            await decode.ready;
            webpDecoder = decode;
          }
          
          const { data, width, height } = webpDecoder.decode(imageBytes);
          const pngImage = await pdfDoc.embedPng({
            width,
            height,
            data: new Uint8Array(data),
            colorSpace: 'rgb'
          });
          addImagePage(pdfDoc, pngImage);
        }
        else {
          console.warn(`不支持的图片类型: ${file.type}`);
        }
      } catch (err) {
        console.error(`图片处理错误: ${err}`);
      }
    }

    // 生成PDF文件
    const pdfBytes = await pdfDoc.save();
    
    // 返回PDF文件
    return new Response(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${cleanFileName(fileName)}.pdf"`
      }
    });

  } catch (err) {
    return new Response(`服务器错误: ${err.message}`, { 
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  }
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
