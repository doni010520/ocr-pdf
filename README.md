# 🚀 OCR Conta de Energia

Sistema completo para extração automática de dados de contas de energia elétrica usando OCR (Reconhecimento Óptico de Caracteres).

![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![Docker](https://img.shields.io/badge/Docker-Ready-blue)
![License](https://img.shields.io/badge/License-MIT-yellow)

## ✨ Funcionalidades

- 📄 **Upload de PDFs e Imagens** - Suporta PDF, JPG, PNG
- 🔍 **OCR Inteligente** - Usa OCR.space API ou Tesseract local
- 📊 **Extração Estruturada** - Extrai automaticamente:
  - Valor total
  - Data de vencimento
  - Nome do cliente
  - CPF/CNPJ
  - Consumo em kWh
  - Número da instalação
  - Leituras (anterior/atual)
  - E muito mais!
- 🌐 **Interface Web Responsiva** - Funciona em desktop e mobile
- 🔗 **API REST** - Integre com outros sistemas
- 🐳 **Docker Ready** - Deploy fácil no EasyPanel

## 🛠️ Instalação

### Opção 1: Deploy no EasyPanel (Recomendado)

1. **Fork este repositório no GitHub**

2. **No EasyPanel:**
   - Clique em "Add Service"
   - Escolha "GitHub"
   - Conecte seu repositório
   - Configure:
     ```
     Port: 4545
     Build Command: (deixe vazio, vai usar o Dockerfile)
     Start Command: (deixe vazio, vai usar o Dockerfile)
     ```

3. **Adicione as variáveis de ambiente:**
   ```
   OCR_SPACE_API_KEY=sua_chave_aqui
   PORT=4545
   ```

4. **Deploy!**

### Opção 2: Deploy Manual com Docker

```bash
# Clone o repositório
git clone https://github.com/seu-usuario/ocr-conta-energia.git
cd ocr-conta-energia

# Build da imagem
docker build -t ocr-conta-energia .

# Rodar container
docker run -d \
  -p 4545:4545 \
  -e OCR_SPACE_API_KEY=sua_chave_aqui \
  --name ocr-app \
  ocr-conta-energia
```

### Opção 3: Instalação Local

```bash
# Clone o repositório
git clone https://github.com/seu-usuario/ocr-conta-energia.git
cd ocr-conta-energia

# Instalar dependências do sistema (Linux)
sudo apt-get update
sudo apt-get install -y poppler-utils tesseract-ocr tesseract-ocr-por

# Ou no Alpine Linux
apk add poppler-utils tesseract-ocr tesseract-ocr-data-por

# Instalar dependências Node.js
npm install

# Copiar e configurar .env
cp .env.example .env
# Edite .env e adicione sua OCR_SPACE_API_KEY

# Iniciar servidor
npm start
```

## 🔑 Obter API Key Gratuita

1. Acesse https://ocr.space/ocrapi
2. Clique em "Get Free API Key"
3. Preencha o formulário (só precisa email)
4. Receba a key no email
5. Adicione no `.env` ou variável de ambiente

**Limite gratuito:** 25.000 requisições/mês

## 📖 Como Usar

### Interface Web

1. Acesse http://seu-servidor:4545
2. Faça upload da conta (PDF ou imagem)
3. Clique em "Processar Conta"
4. Veja os dados extraídos
5. Baixe o JSON com os resultados

### API REST

#### Upload de arquivo
```bash
curl -X POST http://localhost:4545/process \
  -F "file=@conta.pdf" \
  -F "method=auto"
```

#### Processar de URL
```bash
curl -X POST http://localhost:4545/process-url \
  -H "Content-Type: application/json" \
  -d '{"url": "https://exemplo.com/conta.pdf"}'
```

#### Resposta esperada
```json
{
  "success": true,
  "file": {
    "name": "conta.pdf",
    "size": 1234567,
    "type": "application/pdf"
  },
  "method_used": "OCR.space API",
  "extracted_data": {
    "empresa": "Equatorial Goiás",
    "cliente": "JOÃO SILVA",
    "cpf_cnpj": "123.456.789-00",
    "vencimento": "15/12/2024",
    "valor_total": "R$ 250,00",
    "consumo_kwh": 350,
    "numero_instalacao": "12345678",
    "referencia": "11/2024"
  },
  "processed_at": "2024-12-19T10:30:00.000Z"
}
```

## 🔌 Integração com n8n

Use o node HTTP Request:

```yaml
Method: POST
URL: http://seu-servidor:4545/process
Authentication: None
Body Content Type: Form-Data
Send Binary Data: ✓
Binary Property: data
```

## 📊 Campos Extraídos

| Campo | Descrição |
|-------|-----------|
| `empresa` | Distribuidora de energia |
| `cliente` | Nome do cliente |
| `cpf_cnpj` | Documento do cliente |
| `endereco` | Endereço da instalação |
| `numero_instalacao` | Código da unidade consumidora |
| `vencimento` | Data de vencimento |
| `valor_total` | Valor a pagar |
| `consumo_kwh` | Consumo em kWh |
| `leitura_anterior` | Leitura do mês anterior |
| `leitura_atual` | Leitura atual |
| `dias_faturamento` | Período faturado |
| `nota_fiscal` | Número da NF |
| `bandeira_tarifaria` | Verde/Amarela/Vermelha |

## 🐛 Troubleshooting

### Erro: "File size exceeds limit"
- PDFs no OCR.space têm limite de 1MB
- A aplicação converte automaticamente para JPG se necessário
- Considere comprimir o PDF antes do upload

### Erro: "pdftoppm not found"
- Instale poppler-utils:
  ```bash
  # Debian/Ubuntu
  sudo apt-get install poppler-utils
  
  # Alpine
  apk add poppler-utils
  ```

### OCR com baixa precisão
- Verifique a qualidade da imagem/PDF
- Tente diferentes engines (OCREngine 1 ou 2)
- Para melhor resultado, use imagens com 300 DPI

## 📁 Estrutura do Projeto

```
ocr-conta-energia/
├── server.js           # Servidor Express principal
├── package.json        # Dependências Node.js
├── Dockerfile         # Container Docker
├── .env.example       # Variáveis de ambiente
├── public/
│   └── index.html     # Interface web
├── uploads/           # Arquivos temporários
└── README.md         # Este arquivo
```

## 🤝 Contribuindo

1. Fork o projeto
2. Crie sua branch (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## 📝 Licença

Distribuído sob a licença MIT. Veja `LICENSE` para mais informações.

## 🙏 Agradecimentos

- [OCR.space](https://ocr.space) - API OCR gratuita
- [Tesseract](https://github.com/tesseract-ocr/tesseract) - OCR open source
- [Poppler](https://poppler.freedesktop.org/) - Utilitários PDF

## 📞 Suporte

- Issues: https://github.com/seu-usuario/ocr-conta-energia/issues
- Email: seu-email@exemplo.com

---

**Feito com ❤️ para automatizar a leitura de contas de energia**
