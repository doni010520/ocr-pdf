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

// ==================== FUNÇÕES INTELIGENTES ====================

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
    const result = await ocrImage(imagePath, apiKey);
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

/**
 * OCR específico para imagens
 */
async function ocrImage(imagePath, apiKey) {
  return ocrFile(imagePath, apiKey);
}

/**
 * Extração inteligente de dados usando padrões e heurísticas
 */
function smartDataExtraction(text) {
  const data = {
    tipo_documento: null,
    dados_extraidos: {},
    valores_monetarios: [],
    datas: [],
    numeros_documento: [],
    emails: [],
    telefones: [],
    cpf_cnpj: [],
    enderecos: [],
    nomes_proprios: [],
    empresas: [],
    palavras_chave: []
  };
  
  // Normalizar texto
  const normalizedText = text.replace(/\s+/g, ' ');
  
  // ========== IDENTIFICAR TIPO DE DOCUMENTO ==========
  
  if (/(?:CONTA|FATURA).*(?:ENERGIA|LUZ|ELETRICA|ELÉTRICA)/i.test(text)) {
    data.tipo_documento = 'Conta de Energia';
  } else if (/(?:NOTA\s*FISCAL|NF-?e|DANFE)/i.test(text)) {
    data.tipo_documento = 'Nota Fiscal';
  } else if (/(?:BOLETO|COBRANÇA|PAGAMENTO)/i.test(text)) {
    data.tipo_documento = 'Boleto';
  } else if (/(?:CONTRATO|ACORDO|TERMO)/i.test(text)) {
    data.tipo_documento = 'Contrato';
  } else if (/(?:EXTRATO|SALDO|MOVIMENTAÇÃO)/i.test(text)) {
    data.tipo_documento = 'Extrato Bancário';
  } else if (/(?:CURRICULUM|CURRÍCULO|RESUME|CV)/i.test(text)) {
    data.tipo_documento = 'Currículo';
  } else if (/(?:RECEITA|PRESCRIÇÃO|MÉDICA?O)/i.test(text)) {
    data.tipo_documento = 'Receita Médica';
  } else if (/(?:CERTIDÃO|CERTIFICADO|DIPLOMA)/i.test(text)) {
    data.tipo_documento = 'Certidão/Certificado';
  } else if (/(?:ORÇAMENTO|PROPOSTA|COTAÇÃO)/i.test(text)) {
    data.tipo_documento = 'Orçamento';
  } else if (/(?:RECIBO|COMPROVANTE)/i.test(text)) {
    data.tipo_documento = 'Recibo';
  }
  
  // ========== EXTRAÇÕES GENÉRICAS ==========
  
  // Valores monetários
  const valoresRegex = /R\$\s*[\d.,]+|(?:R\$|RS)\s*\d+(?:[.,]\d{3})*(?:[.,]\d{2})?|\d+(?:[.,]\d{3})*(?:[.,]\d{2})\s*(?:reais|REAIS)/g;
  const valores = text.match(valoresRegex) || [];
  data.valores_monetarios = valores.map(v => {
    const numero = v.replace(/[^\d.,]/g, '').replace(',', '.');
    return {
      texto_original: v,
      valor_numerico: parseFloat(numero) || 0
    };
  });
  
  // Datas
  const datasRegex = /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/g;
  data.datas = [...new Set(text.match(datasRegex) || [])];
  
  // CPF/CNPJ
  const cpfRegex = /\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11}/g;
  const cnpjRegex = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14}/g;
  data.cpf_cnpj = [
    ...(text.match(cpfRegex) || []).map(cpf => ({ tipo: 'CPF', valor: cpf })),
    ...(text.match(cnpjRegex) || []).map(cnpj => ({ tipo: 'CNPJ', valor: cnpj }))
  ];
  
  // Emails
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  data.emails = [...new Set(text.match(emailRegex) || [])];
  
  // Telefones
  const telefoneRegex = /(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\s?)?\d{4}[-\s]?\d{4}/g;
  data.telefones = [...new Set(text.match(telefoneRegex) || [])];
  
  // Números de documentos (NF, protocolo, etc)
  const numeroDocRegex = /(?:NF|NOTA|PROTOCOLO|CÓDIGO|REGISTRO|REF|Nº|N°|#)\s*:?\s*(\d+[\d\-\.\/]*)/gi;
  const numerosDoc = [];
  let matchNum;
  while ((matchNum = numeroDocRegex.exec(text)) !== null) {
    numerosDoc.push({
      tipo: matchNum[0].split(/\s*:?\s*/)[0],
      numero: matchNum[1]
    });
  }
  data.numeros_documento = numerosDoc;
  
  // ========== EXTRAÇÕES ESPECÍFICAS POR TIPO ==========
  
  if (data.tipo_documento === 'Conta de Energia') {
    data.dados_extraidos = extractEnergiaData(text);
  } else if (data.tipo_documento === 'Nota Fiscal') {
    data.dados_extraidos = extractNotaFiscalData(text);
  } else if (data.tipo_documento === 'Boleto') {
    data.dados_extraidos = extractBoletoData(text);
  }
  
  // ========== PALAVRAS-CHAVE E ENTIDADES ==========
  
  // Identificar possíveis nomes de empresas (palavras em maiúscula)
  const empresasRegex = /[A-Z][A-Z\s]{3,}(?:S\.?A\.?|LTDA|ME|EPP|EIRELI|S\/A|IND(?:ÚSTRIA)?|COM(?:ÉRCIO)?)/g;
  data.empresas = [...new Set(text.match(empresasRegex) || [])].map(e => e.trim());
  
  // Palavras importantes (maiúsculas com mais de 4 letras)
  const palavrasImportantes = text.match(/\b[A-Z]{4,}\b/g) || [];
  data.palavras_chave = [...new Set(palavrasImportantes)].slice(0, 20);
  
  // ========== ANÁLISE DE CONFIANÇA ==========
  
  data.qualidade_extracao = {
    total_caracteres: text.length,
    tem_dados_estruturados: Object.keys(data.dados_extraidos).length > 0,
    quantidade_valores: data.valores_monetarios.length,
    quantidade_datas: data.datas.length,
    confianca: calculateConfidence(data)
  };
  
  return data;
}

/**
 * Calcula confiança na extração
 */
function calculateConfidence(data) {
  let score = 0;
  
  if (data.tipo_documento) score += 20;
  if (data.valores_monetarios.length > 0) score += 15;
  if (data.datas.length > 0) score += 15;
  if (data.cpf_cnpj.length > 0) score += 15;
  if (Object.keys(data.dados_extraidos).length > 3) score += 20;
  if (data.empresas.length > 0) score += 15;
  
  return Math.min(score, 100);
}

/**
 * Extração específica para conta de energia
 */
function extractEnergiaData(text) {
  const data = {};
  
  // Cliente
  const clienteMatch = text.match(/(?:CLIENTE|NOME|TITULAR)[:\s]+([^\n]+)/i);
  if (clienteMatch) data.cliente = clienteMatch[1].trim();
  
  // Vencimento
  const vencMatch = text.match(/(?:VENCIMENTO|VENCE)[:\s]*(\d{2}[\/\-]\d{2}[\/\-]\d{4})/i);
  if (vencMatch) data.vencimento = vencMatch[1];
  
  // Valor
  const valorMatch = text.match(/(?:TOTAL|VALOR)\s*:?\s*R\$\s*([\d.,]+)/i);
  if (valorMatch) data.valor_total = 'R$ ' + valorMatch[1];
  
  // Consumo
  const consumoMatch = text.match(/(\d+)\s*KWH/i);
  if (consumoMatch) data.consumo_kwh = consumoMatch[1];
  
  // Número instalação
  const instalacaoMatch = text.match(/(?:INSTALAÇÃO|UC|CONTA)[:\s]*(\d{6,})/i);
  if (instalacaoMatch) data.numero_instalacao = instalacaoMatch[1];
  
  return data;
}

/**
 * Extração específica para nota fiscal
 */
function extractNotaFiscalData(text) {
  const data = {};
  
  // Número da NF
  const nfMatch = text.match(/(?:NF-?e?|NOTA FISCAL)[:\s]*(\d+)/i);
  if (nfMatch) data.numero_nf = nfMatch[1];
  
  // Chave de acesso
  const chaveMatch = text.match(/(\d{44})/);
  if (chaveMatch) data.chave_acesso = chaveMatch[1];
  
  // Data emissão
  const emissaoMatch = text.match(/(?:EMISSÃO|EMITIDA)[:\s]*(\d{2}[\/\-]\d{2}[\/\-]\d{4})/i);
  if (emissaoMatch) data.data_emissao = emissaoMatch[1];
  
  // Valor total
  const valorMatch = text.match(/(?:VALOR TOTAL|TOTAL)[:\s]*R\$\s*([\d.,]+)/i);
  if (valorMatch) data.valor_total = 'R$ ' + valorMatch[1];
  
  return data;
}

/**
 * Extração específica para boleto
 */
function extractBoletoData(text) {
  const data = {};
  
  // Código de barras
  const barrasMatch = text.match(/(\d{5}\.\d{5}\s\d{5}\.\d{6}\s\d{5}\.\d{6}\s\d{1}\s\d{14})/);
  if (barrasMatch) data.codigo_barras = barrasMatch[1];
  
  // Vencimento
  const vencMatch = text.match(/(?:VENCIMENTO)[:\s]*(\d{2}[\/\-]\d{2}[\/\-]\d{4})/i);
  if (vencMatch) data.vencimento = vencMatch[1];
  
  // Valor
  const valorMatch = text.match(/(?:VALOR)[:\s]*R\$\s*([\d.,]+)/i);
  if (valorMatch) data.valor = 'R$ ' + valorMatch[1];
  
  return data;
}

// ==================== ROTAS ====================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/status', (req, res) => {
  res.json({ 
    status: 'online',
    version: '2.0.0',
    capabilities: [
      'Análise inteligente de PDF',
      'Detecção automática de tipo de documento',
      'Conversão automática quando necessário',
      'Extração de dados genérica',
      'Suporte a múltiplos tipos de documento'
    ]
  });
});

/**
 * Rota principal de processamento - INTELIGENTE
 */
app.post('/process', upload.single('file'), async (req, res) => {
  let filePath = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    }

    filePath = req.file.path;
    const extractionMode = req.body.mode || 'smart'; // smart, ocr_only, text_only
    
    console.log(`
    ========================================
    📄 Processando: ${req.file.originalname}
    📊 Tamanho: ${(req.file.size / 1024).toFixed(2)} KB
    🔍 Modo: ${extractionMode}
    ========================================
    `);

    let ocrText = '';
    let processInfo = {};
    
    // Analisar o PDF primeiro (se for PDF)
    if (req.file.mimetype === 'application/pdf') {
      console.log('🔍 Analisando estrutura do PDF...');
      const pdfAnalysis = await analyzePDF(filePath);
      processInfo = pdfAnalysis;
      
      console.log(`
      📊 Análise do PDF:
      - Tem texto extraível: ${pdfAnalysis.hasText ? 'SIM ✅' : 'NÃO ❌'}
      - Precisa OCR: ${pdfAnalysis.needsOCR ? 'SIM' : 'NÃO'}
      - Tamanho: ${pdfAnalysis.fileSizeKB.toFixed(2)} KB
      - Deve converter: ${pdfAnalysis.shouldConvertToImage ? 'SIM' : 'NÃO'}
      `);
      
      // Decidir estratégia baseada na análise
      if (extractionMode === 'smart') {
        ocrText = await smartOCR(filePath, pdfAnalysis);
      } else if (extractionMode === 'ocr_only') {
        // Forçar OCR mesmo que tenha texto
        if (pdfAnalysis.fileSizeKB > 1024) {
          const imagePath = await pdfToImageOptimized(filePath);
          ocrText = await ocrImage(imagePath, process.env.OCR_SPACE_API_KEY);
          await fs.unlink(imagePath).catch(() => {});
        } else {
          ocrText = await ocrFile(filePath, process.env.OCR_SPACE_API_KEY);
        }
      } else if (extractionMode === 'text_only' && pdfAnalysis.hasText) {
        // Extrair apenas texto nativo
        const { stdout } = await execPromise(`pdftotext "${filePath}" -`);
        ocrText = stdout;
      }
    } else {
      // É uma imagem, fazer OCR direto
      console.log('🖼️ Processando imagem...');
      ocrText = await ocrFile(filePath, process.env.OCR_SPACE_API_KEY);
      processInfo.isImage = true;
    }

    // Extrair dados de forma inteligente
    console.log('🧠 Extraindo dados inteligentemente...');
    const extractedData = smartDataExtraction(ocrText);

    // Montar resposta
    const result = {
      success: true,
      file: {
        name: req.file.originalname,
        size: req.file.size,
        type: req.file.mimetype
      },
      processing_info: {
        mode: extractionMode,
        pdf_has_text: processInfo.hasText || false,
        used_ocr: processInfo.needsOCR || !processInfo.hasText,
        converted_to_image: processInfo.shouldConvertToImage && processInfo.needsOCR,
        processing_time: new Date().toISOString()
      },
      document_type: extractedData.tipo_documento || 'Não identificado',
      extracted_data: extractedData,
      raw_text: req.body.include_raw_text === 'true' ? ocrText : ocrText.substring(0, 500) + '...',
      confidence_score: extractedData.qualidade_extracao?.confianca || 0
    };

    console.log(`
    ✅ Processamento concluído!
    📄 Tipo identificado: ${result.document_type}
    🎯 Confiança: ${result.confidence_score}%
    ========================================
    `);

    res.json(result);

  } catch (error) {
    console.error('❌ Erro no processamento:', error);
    res.status(500).json({ 
      error: error.message,
      details: 'Verifique se o arquivo é válido',
      suggestion: 'Tente com mode=ocr_only se o PDF for baseado em imagem'
    });
  } finally {
    // Limpar arquivo temporário
    if (filePath) {
      await fs.unlink(filePath).catch(() => {});
    }
  }
});

/**
 * Rota para informações sobre capacidades
 */
app.get('/capabilities', (req, res) => {
  res.json({
    supported_formats: ['PDF', 'JPG', 'JPEG', 'PNG', 'GIF', 'BMP'],
    max_file_size: '50MB',
    document_types: [
      'Conta de Energia',
      'Nota Fiscal',
      'Boleto',
      'Contrato',
      'Extrato Bancário',
      'Currículo',
      'Receita Médica',
      'Certidão/Certificado',
      'Orçamento',
      'Recibo',
      'Documento Genérico'
    ],
    extraction_modes: {
      smart: 'Detecta automaticamente o melhor método',
      ocr_only: 'Força uso de OCR mesmo com texto',
      text_only: 'Extrai apenas texto nativo (PDFs)'
    },
    data_extracted: [
      'valores_monetarios',
      'datas',
      'cpf_cnpj',
      'emails',
      'telefones',
      'numeros_documento',
      'empresas',
      'palavras_chave',
      'dados_especificos_por_tipo'
    ]
  });
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
🚀 Servidor Universal PDF OCR v2.0
📍 URL: http://localhost:${PORT}
🧠 Modo: Inteligente com detecção automática

📄 Endpoints:
   GET  /              → Interface Web
   GET  /status        → Status da API
   GET  /capabilities  → Capacidades do sistema
   POST /process       → Processar arquivo

🎯 Recursos:
   ✅ Detecção automática de tipo de documento
   ✅ Decisão inteligente de conversão
   ✅ Extração genérica de dados
   ✅ Suporte a múltiplos formatos
   ✅ Análise de confiança
  `);
});

// Verificar dependências na inicialização
async function checkDependencies() {
  console.log('🔍 Verificando dependências...');
  
  try {
    await execPromise('pdftoppm -version');
    console.log('✅ poppler-utils instalado');
  } catch {
    console.log('⚠️  poppler-utils não encontrado - conversão PDF limitada');
    console.log('    Instale com: apk add poppler-utils');
  }
  
  try {
    await execPromise('tesseract --version');
    console.log('✅ tesseract instalado');
  } catch {
    console.log('⚠️  tesseract não encontrado - OCR local indisponível');
  }
}

checkDependencies();
