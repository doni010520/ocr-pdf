const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const util = require('util');
const axios = require('axios');
const sharp = require('sharp');
const FormData = require('form-data');

const execPromise = util.promisify(exec);

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4545;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configuração do Multer
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = 'uploads/';
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueName + path.extname(file.originalname));
  }
});

const upload = multer({  
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB max
  }
});

// ==================== FUNÇÕES DE PROCESSAMENTO DE ARQUIVO ====================

/**
 * Detecta se o PDF tem texto extraível ou é baseado em imagem
 */
async function analyzePDF(pdfPath) {
  try {
    // Tentar extrair texto com pdftotext
    const { stdout: textContent } = await execPromise(`pdftotext "${pdfPath}" - 2>/dev/null | head -c 1000`);
    
    // Contar caracteres úteis (não apenas espaços)
    const meaningfulChars = textContent.replace(/\s/g, '').length;
    
    // Obter informações do PDF
    const { stdout: pdfInfo } = await execPromise(`pdfinfo "${pdfPath}" 2>/dev/null || echo ""`);
    
    // Verificar tamanho do arquivo
    const stats = await fs.stat(pdfPath);
    const fileSizeKB = stats.size / 1024;
    
    return {
      hasText: meaningfulChars > 50, // Se tem mais de 50 caracteres, provavelmente tem texto
      textContent: textContent,
      fileSize: stats.size,
      fileSizeKB: fileSizeKB,
      needsOCR: meaningfulChars <= 50,
      shouldConvertToImage: fileSizeKB > 1024, // Se > 1MB e precisa OCR
      pdfInfo: pdfInfo
    };
  } catch (error) {
    console.error('Erro ao analisar PDF:', error);
    // Se não conseguir analisar, assumir que precisa OCR
    return {
      hasText: false,
      textContent: '',
      fileSize: 0,
      fileSizeKB: 0,
      needsOCR: true,
      shouldConvertToImage: true,
      error: error.message
    };
  }
}

/**
 * Converte PDF para imagem de forma otimizada
 */
async function pdfToImageOptimized(pdfPath, targetSizeKB = 900) {
  const outputPath = pdfPath.replace('.pdf', '.jpg');
  
  try {
    // Começar com resolução alta e ir diminuindo se necessário
    const resolutions = [200, 150, 120, 100, 80];
    
    for (const resolution of resolutions) {
      await execPromise(`pdftoppm -jpeg -r ${resolution} -f 1 -l 1 "${pdfPath}" "${pdfPath.replace('.pdf', '')}"`);
      await execPromise(`mv "${pdfPath.replace('.pdf', '')}-1.jpg" "${outputPath}"`);
      
      // Verificar tamanho do arquivo gerado
      const stats = await fs.stat(outputPath);
      const sizeKB = stats.size / 1024;
      
      console.log(`Imagem gerada com resolução ${resolution}dpi: ${sizeKB.toFixed(2)}KB`);
      
      if (sizeKB <= targetSizeKB) {
        return outputPath;
      }
    }
    
    // Se ainda estiver grande, comprimir com sharp
    const buffer = await fs.readFile(outputPath);
    const compressed = await sharp(buffer)
      .jpeg({ quality: 70 })
      .toBuffer();
    
    await fs.writeFile(outputPath, compressed);
    return outputPath;
    
  } catch (error) {
    console.log('Erro na conversão PDF->Imagem:', error.message);
    throw error;
  }
}

/**
 * OCR inteligente que escolhe o melhor método
 */
async function smartOCR(filePath, fileInfo = {}) {
  const apiKey = process.env.OCR_SPACE_API_KEY || 'K84834179488957';
  
  // Se o arquivo já tem texto, extrair diretamente
  if (fileInfo.hasText && fileInfo.textContent) {
    console.log('PDF tem texto nativo, extraindo diretamente...');
    const { stdout } = await execPromise(`pdftotext "${filePath}" -`);
    return stdout;
  }
  
  // Se precisa OCR e é maior que 1MB, converter para imagem
  if (fileInfo.needsOCR && fileInfo.fileSizeKB > 1024) {
    console.log('PDF baseado em imagem e > 1MB, convertendo...');
    const imagePath = await pdfToImageOptimized(filePath);
    const result = await ocrFile(imagePath, apiKey);
    await fs.unlink(imagePath).catch(() => {}); // Limpar imagem temporária
    return result;
  }
  
  // Se é pequeno o suficiente, enviar direto
  console.log('Enviando arquivo direto para OCR...');
  return await ocrFile(filePath, apiKey);
}

/**
 * OCR de arquivo (PDF ou imagem)
 */
async function ocrFile(filePath, apiKey) {
  const fileBuffer = await fs.readFile(filePath);
  const base64File = fileBuffer.toString('base64');
  const isImage = /\.(jpg|jpeg|png|gif|bmp)$/i.test(filePath);
  
  const params = new URLSearchParams();
  params.append('apikey', apiKey);
  params.append('base64Image', `data:${isImage ? 'image/jpeg' : 'application/pdf'};base64,${base64File}`);
  params.append('language', 'por');
  params.append('isTable', 'true');
  params.append('OCREngine', '2');
  params.append('scale', 'true');
  params.append('detectOrientation', 'true');
  
  try {
    const response = await axios.post('https://api.ocr.space/parse/image', params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      maxBodyLength: Infinity,
      timeout: 60000 // 60 segundos timeout
    });

    if (response.data.IsErroredOnProcessing) {
      throw new Error(response.data.ErrorMessage?.join(', ') || 'Erro no OCR');
    }

    return response.data.ParsedResults[0]?.ParsedText || '';
  } catch (error) {
    throw new Error(`OCR Error: ${error.message}`);
  }
}

// ==================== ROTAS ====================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/status', (req, res) => {
  res.json({ 
    status: 'online',
    version: '2.1.0-simple',
    capabilities: [
      'Análise inteligente de PDF',
      'Conversão automática quando necessário',
      'Extração de texto bruto para qualquer documento'
    ]
  });
});

/**
 * Rota principal de processamento - SIMPLIFICADA
 */
app.post('/process', upload.single('file'), async (req, res) => {
  let filePath = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    filePath = req.file.path;
    
    console.log(`
    ========================================
    📄 Processando: ${req.file.originalname}
    📊 Tamanho: ${(req.file.size / 1024).toFixed(2)} KB
    ========================================
    `);

    let ocrText = '';
    
    // Analisar o PDF primeiro (se for PDF)
    if (req.file.mimetype === 'application/pdf') {
      console.log('🔍 Analisando estrutura do PDF...');
      const pdfAnalysis = await analyzePDF(filePath);
      
      console.log(`
      📊 Análise do PDF:
      - Tem texto extraível: ${pdfAnalysis.hasText ? 'SIM ✅' : 'NÃO ❌'}
      - Precisa OCR: ${pdfAnalysis.needsOCR ? 'SIM' : 'NÃO'}
      `);
      
      ocrText = await smartOCR(filePath, pdfAnalysis);

    } else {
      // É uma imagem, fazer OCR direto
      console.log('🖼️ Processando imagem...');
      ocrText = await ocrFile(filePath, process.env.OCR_SPACE_API_KEY);
    }

    // =========================================================================
    // MODIFICAÇÃO: Retornar a resposta simples com o texto bruto
    // =========================================================================
    console.log(`
    ========================================
    ✅ Processamento concluído!
    📄 Retornando texto bruto extraído.
    ========================================
    `);
    
    const simpleResult = {
        success: true,
        file: {
            name: req.file.originalname,
            size: req.file.size
        },
        raw_text: ocrText
    };

    res.json(simpleResult);

  } catch (error) {
    console.error('❌ Erro no processamento:', error);
    res.status(500).json({ 
      error: error.message,
      details: 'Verifique se o arquivo é válido e tente novamente.'
    });
  } finally {
    // Limpar arquivo temporário
    if (filePath) {
      await fs.unlink(filePath).catch(() => {});
    }
  }
});

/**
 * Rota para processar arquivo via URL - SIMPLIFICADA
 */
app.post('/process-url', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL não fornecida' });
  }

  let tempFile = null;
  
  try {
    console.log(`📥 Baixando arquivo de: ${url}`);
    
    // Baixar arquivo da URL
    const response = await axios.get(url, { 
      responseType: 'arraybuffer',
      maxContentLength: 50 * 1024 * 1024, // 50MB max
      timeout: 30000 // 30 segundos
    });
    
    // Determinar extensão do arquivo
    const contentType = response.headers['content-type'];
    let extension = '.pdf';
    
    if (contentType) {
      if (contentType.includes('image')) {
        if (contentType.includes('jpeg') || contentType.includes('jpg')) extension = '.jpg';
        else if (contentType.includes('png')) extension = '.png';
        else if (contentType.includes('gif')) extension = '.gif';
      }
    } else {
      const urlPath = new URL(url).pathname;
      const urlExt = path.extname(urlPath);
      if (urlExt) extension = urlExt;
    }
    
    // Salvar arquivo temporário
    tempFile = `uploads/url-${Date.now()}${extension}`;
    await fs.mkdir('uploads', { recursive: true });
    await fs.writeFile(tempFile, response.data);
    
    console.log(`✅ Arquivo baixado: ${(response.data.length / 1024).toFixed(2)} KB`);
    
    // Processar arquivo como se fosse upload
    let ocrText = '';
    
    // Analisar se for PDF
    if (extension === '.pdf') {
      console.log('🔍 Analisando PDF baixado...');
      const pdfAnalysis = await analyzePDF(tempFile);
      ocrText = await smartOCR(tempFile, pdfAnalysis);
    } else {
      // É uma imagem
      console.log('🖼️ Processando imagem baixada...');
      ocrText = await ocrFile(tempFile, process.env.OCR_SPACE_API_KEY);
    }
    
    // =========================================================================
    // MODIFICAÇÃO: Retornar a resposta simples com o texto bruto
    // =========================================================================
    console.log('✅ Processamento de URL concluído! Retornando texto bruto.');
    
    res.json({
      success: true,
      url: url,
      file_info: {
        size: response.data.length,
        type: contentType || 'application/octet-stream'
      },
      raw_text: ocrText
    });
    
  } catch (error) {
    console.error('❌ Erro ao processar URL:', error);
    res.status(500).json({ 
      error: error.message,
      details: 'Verifique se a URL é válida e acessível'
    });
  } finally {
    // Limpar arquivo temporário
    if (tempFile) {
      await fs.unlink(tempFile).catch(() => {});
    }
  }
});

// Tratamento de erros
app.use((error, req, res, next) => {
  console.error('Erro não tratado:', error);
  res.status(500).json({
    error: 'Erro interno do servidor',
    message: error.message
  });
});

// Inicializar servidor
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
🚀 Servidor Universal PDF OCR v2.1 (Modo Simples)
📍 URL: http://localhost:${PORT}
🧠 Extração de texto bruto para qualquer documento.

📄 Endpoints:
   GET  /             → Interface Web (se houver)
   GET  /status       → Status da API
   POST /process      → Processar arquivo via upload
   POST /process-url  → Processar arquivo via URL
  `);
});

// Verificar dependências na inicialização
async function checkDependencies() {
  console.log('🔍 Verificando dependências...');
  
  try {
    await execPromise('pdftotext -v');
    console.log('✅ poppler-utils (pdftotext) instalado');
  } catch {
    console.log('⚠️  poppler-utils não encontrado - extração de texto nativo de PDF pode falhar.');
    console.log('   Instale com: sudo apt-get install poppler-utils (Debian/Ubuntu) ou brew install poppler (macOS)');
  }
}

checkDependencies();
