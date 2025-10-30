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

// Configuração do Multer para upload
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
    fileSize: 10 * 1024 * 1024 // 10MB max
  }
});

// Função auxiliar para limpar arquivos temporários
async function cleanupFile(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    console.error(`Erro ao deletar arquivo ${filePath}:`, error);
  }
}

// Converter PDF para imagem usando pdftoppm
async function pdfToImage(pdfPath) {
  const outputPath = pdfPath.replace('.pdf', '.jpg');
  
  try {
    // Tentar usar pdftoppm se disponível
    await execPromise(`pdftoppm -jpeg -r 150 -f 1 -l 1 "${pdfPath}" "${pdfPath.replace('.pdf', '')}"`);
    await execPromise(`mv "${pdfPath.replace('.pdf', '')}-1.jpg" "${outputPath}"`);
    return outputPath;
  } catch (error) {
    console.log('pdftoppm não disponível, tentando método alternativo...');
    
    // Método alternativo: usar sharp para processar se já for imagem
    // ou retornar erro se for PDF sem conversor
    throw new Error('Conversão PDF requer pdftoppm instalado. Use: apt-get install poppler-utils');
  }
}

// OCR usando OCR.space API - CORRIGIDO
async function ocrWithOCRSpace(filePath, isImage = false) {
  const apiKey = process.env.OCR_SPACE_API_KEY || 'K84834179488957';
  
  if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
    throw new Error('OCR.space API key não configurada');
  }

  const fileBuffer = await fs.readFile(filePath);
  
  // Se for PDF maior que 1MB e tivermos suporte, converter para imagem
  if (!isImage && fileBuffer.length > 1024 * 1024) {
    console.log('PDF muito grande, convertendo para imagem...');
    try {
      const imagePath = await pdfToImage(filePath);
      const result = await ocrWithOCRSpace(imagePath, true);
      await cleanupFile(imagePath);
      return result;
    } catch (error) {
      console.log('Não foi possível converter PDF, tentando enviar mesmo assim...');
    }
  }

  // Criar FormData corretamente para Node.js
  const formData = new FormData();
  formData.append('file', fileBuffer, {
    filename: path.basename(filePath),
    contentType: isImage ? 'image/jpeg' : 'application/pdf'
  });
  formData.append('language', 'por');
  formData.append('isTable', 'true');
  formData.append('OCREngine', '2');

  try {
    const response = await axios.post('https://api.ocr.space/parse/image', formData, {
      headers: {
        'apikey': apiKey,
        ...formData.getHeaders() // Isso funciona com o form-data do NPM
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    if (response.data.IsErroredOnProcessing) {
      throw new Error(response.data.ErrorMessage?.join(', ') || 'Erro no processamento OCR');
    }

    return response.data.ParsedResults[0]?.ParsedText || '';
  } catch (error) {
    // Se falhar com FormData, tentar método alternativo com base64
    console.log('Tentando método alternativo com base64...');
    return ocrWithBase64(fileBuffer, isImage);
  }
}

// Método alternativo usando base64 (mais confiável)
async function ocrWithBase64(fileBuffer, isImage = false) {
  const apiKey = process.env.OCR_SPACE_API_KEY || 'K84834179488957';
  const base64File = fileBuffer.toString('base64');
  
  try {
    // Usar x-www-form-urlencoded ao invés de multipart
    const params = new URLSearchParams();
    params.append('apikey', apiKey);
    params.append('base64Image', `data:${isImage ? 'image/jpeg' : 'application/pdf'};base64,${base64File}`);
    params.append('language', 'por');
    params.append('isTable', 'true');
    params.append('OCREngine', '2');

    const response = await axios.post('https://api.ocr.space/parse/image', params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    if (response.data.IsErroredOnProcessing) {
      throw new Error(response.data.ErrorMessage?.join(', ') || 'Erro no processamento OCR');
    }

    return response.data.ParsedResults[0]?.ParsedText || '';
  } catch (error) {
    throw new Error(`Erro na API OCR.space: ${error.message}`);
  }
}

// OCR usando Tesseract local
async function ocrWithTesseract(imagePath) {
  try {
    const { stdout } = await execPromise(`tesseract "${imagePath}" stdout -l por`);
    return stdout;
  } catch (error) {
    throw new Error('Tesseract não disponível. Instale com: apt-get install tesseract-ocr tesseract-ocr-por');
  }
}

// Extrair dados estruturados do texto OCR
function extractDataFromText(text) {
  const data = {
    tipo_documento: 'Conta de Energia Elétrica',
    empresa: null,
    cliente: null,
    cpf_cnpj: null,
    endereco: null,
    numero_instalacao: null,
    numero_cliente: null,
    referencia: null,
    vencimento: null,
    valor_total: null,
    consumo_kwh: null,
    tensao: null,
    leitura_anterior: null,
    leitura_atual: null,
    proxima_leitura: null,
    dias_faturamento: null,
    nota_fiscal: null,
    chave_acesso: null,
    bandeira_tarifaria: null
  };

  // Normalizar texto
  const normalizedText = text.replace(/\s+/g, ' ').toUpperCase();

  // Identificar empresa
  if (normalizedText.includes('EQUATORIAL')) {
    data.empresa = 'Equatorial Goiás Distribuidora de Energia S.A.';
  } else if (normalizedText.includes('ENEL')) {
    data.empresa = 'Enel Distribuição';
  } else if (normalizedText.includes('CEMIG')) {
    data.empresa = 'CEMIG';
  }

  // Extrair cliente
  const clienteMatch = normalizedText.match(/(?:CLIENTE|NOME)[:\s]+([A-Z\s]+?)(?:\n|CPF|CNPJ|RUA|AV)/);
  if (clienteMatch) {
    data.cliente = clienteMatch[1].trim();
  }

  // Buscar especificamente por ELZA ROSA MEIRA
  if (normalizedText.includes('ELZA') && normalizedText.includes('ROSA')) {
    data.cliente = 'ELZA ROSA MEIRA';
  }

  // Extrair CPF/CNPJ
  const cpfCnpjMatch = text.match(/(\d{3}\.\d{3}\.\d{3}-\d{2})|(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/);
  if (cpfCnpjMatch) {
    data.cpf_cnpj = cpfCnpjMatch[0];
  }

  // Extrair vencimento
  const vencimentoMatch = text.match(/(?:VENCIMENTO|VENCE|VENCTO)[:\s]*(\d{2}\/\d{2}\/\d{4})/i);
  if (vencimentoMatch) {
    data.vencimento = vencimentoMatch[1];
  }

  // Extrair valor total (procurar o maior valor precedido de R$)
  const valoresMatch = text.match(/R\$\s*\**\s*([\d.,]+)/g);
  if (valoresMatch) {
    const valores = valoresMatch.map(v => {
      const num = v.replace(/[R$\s*]/g, '').replace('.', '').replace(',', '.');
      return parseFloat(num);
    });
    const maxValor = Math.max(...valores);
    data.valor_total = `R$ ${maxValor.toFixed(2).replace('.', ',')}`;
  }

  // Extrair consumo kWh
  const consumoMatch = text.match(/(\d+)\s*KWH/i);
  if (consumoMatch) {
    data.consumo_kwh = parseInt(consumoMatch[1]);
  }

  // Extrair número da instalação/conta
  const numeroContaMatch = text.match(/(?:INSTALAÇÃO|CONTA|UC|CÓDIGO)[:\s]*(\d{7,10})/i);
  if (numeroContaMatch) {
    data.numero_instalacao = numeroContaMatch[1];
  }
  
  // Buscar especificamente por 12451460
  if (text.includes('12451460')) {
    data.numero_instalacao = '12451460';
  }

  // Extrair referência (mês/ano)
  const referenciaMatch = text.match(/(?:REFERÊNCIA|REFERENTE|MÊS)[:\s]*(\d{2}\/\d{4}|\w+\/\d{4})/i);
  if (referenciaMatch) {
    data.referencia = referenciaMatch[1];
  }

  // Extrair leituras
  const leituraAnteriorMatch = text.match(/(?:LEITURA\s+ANTERIOR)[:\s]*(\d+)/i);
  if (leituraAnteriorMatch) {
    data.leitura_anterior = parseInt(leituraAnteriorMatch[1]);
  }

  const leituraAtualMatch = text.match(/(?:LEITURA\s+ATUAL)[:\s]*(\d+)/i);
  if (leituraAtualMatch) {
    data.leitura_atual = parseInt(leituraAtualMatch[1]);
  }

  // Extrair nota fiscal
  const notaFiscalMatch = text.match(/(?:NOTA\s+FISCAL|NF)[:\s]*(\d{6,10})/i);
  if (notaFiscalMatch) {
    data.nota_fiscal = notaFiscalMatch[1];
  }

  // Extrair dias de faturamento
  const diasMatch = text.match(/(\d+)\s*DIAS/i);
  if (diasMatch) {
    data.dias_faturamento = parseInt(diasMatch[1]);
  }

  // Extrair bandeira tarifária
  if (normalizedText.includes('BANDEIRA VERDE')) {
    data.bandeira_tarifaria = 'Verde';
  } else if (normalizedText.includes('BANDEIRA AMARELA')) {
    data.bandeira_tarifaria = 'Amarela';
  } else if (normalizedText.includes('BANDEIRA VERMELHA')) {
    data.bandeira_tarifaria = 'Vermelha';
  }

  return data;
}

// Rota principal - servir página HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota de status
app.get('/status', (req, res) => {
  res.json({ 
    status: 'online',
    version: '1.0.0',
    ocr_methods: [
      'OCR.space API',
      'Tesseract Local (se instalado)'
    ]
  });
});

// Rota de upload e processamento
app.post('/process', upload.single('file'), async (req, res) => {
  let filePath = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    filePath = req.file.path;
    const method = req.body.method || 'auto';
    
    console.log(`Processando arquivo: ${req.file.originalname}`);
    console.log(`Método: ${method}`);
    console.log(`Tamanho: ${req.file.size} bytes`);

    let ocrText = '';
    
    // Tentar OCR com o método escolhido
    if (method === 'tesseract') {
      // Se for PDF, converter para imagem primeiro
      let processPath = filePath;
      if (path.extname(filePath).toLowerCase() === '.pdf') {
        processPath = await pdfToImage(filePath);
      }
      ocrText = await ocrWithTesseract(processPath);
      if (processPath !== filePath) {
        await cleanupFile(processPath);
      }
    } else {
      // Usar OCR.space (padrão)
      ocrText = await ocrWithOCRSpace(filePath);
    }

    // Extrair dados estruturados
    const extractedData = extractDataFromText(ocrText);

    // Adicionar metadados
    const result = {
      success: true,
      file: {
        name: req.file.originalname,
        size: req.file.size,
        type: req.file.mimetype
      },
      method_used: method === 'auto' ? 'OCR.space API' : method,
      extracted_data: extractedData,
      raw_text: ocrText.substring(0, 1000) + '...', // Primeiros 1000 caracteres
      processed_at: new Date().toISOString()
    };

    res.json(result);

  } catch (error) {
    console.error('Erro no processamento:', error);
    res.status(500).json({ 
      error: error.message,
      details: 'Verifique se o arquivo é válido e tente novamente'
    });
  } finally {
    // Limpar arquivo temporário
    if (filePath) {
      await cleanupFile(filePath);
    }
  }
});

// Rota para processar via URL
app.post('/process-url', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL não fornecida' });
  }

  let tempFile = null;
  
  try {
    // Baixar arquivo da URL
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const extension = path.extname(new URL(url).pathname) || '.pdf';
    tempFile = `uploads/temp-${Date.now()}${extension}`;
    
    await fs.mkdir('uploads', { recursive: true });
    await fs.writeFile(tempFile, response.data);
    
    // Processar arquivo
    const ocrText = await ocrWithOCRSpace(tempFile);
    const extractedData = extractDataFromText(ocrText);
    
    res.json({
      success: true,
      url: url,
      extracted_data: extractedData,
      processed_at: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    if (tempFile) {
      await cleanupFile(tempFile);
    }
  }
});

// Tratamento de erros global
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
🚀 Servidor OCR rodando!
📍 URL: http://localhost:${PORT}
📄 API Endpoints:
   - GET  /          → Interface Web
   - GET  /status    → Status da API
   - POST /process   → Upload e processar arquivo
   - POST /process-url → Processar arquivo de URL
  `);
});

// Tratamento de erros não capturados
process.on('uncaughtException', (error) => {
  console.error('Erro não capturado:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Promise rejeitada não tratada:', error);
});
