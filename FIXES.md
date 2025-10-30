# 🛠️ CORREÇÕES RÁPIDAS - EasyPanel

## ❌ Erro: "npm ci command can only install with existing package-lock.json"

### Solução 1: Use o Dockerfile já corrigido
O Dockerfile principal já foi atualizado para usar `npm install` ao invés de `npm ci`.

### Solução 2: Use o Dockerfile simplificado
Se ainda tiver problemas, renomeie os arquivos:
```bash
mv Dockerfile Dockerfile.backup
mv Dockerfile.simple Dockerfile
```

## ❌ Erro: "File size exceeds limit"

A aplicação já resolve isso automaticamente!
- PDFs > 1MB são convertidos para JPG
- JPGs têm limite de 5MB no OCR.space

## ❌ Erro: "OCR_SPACE_API_KEY not configured"

1. Obtenha sua chave gratuita em: https://ocr.space/ocrapi
2. No EasyPanel, adicione nas variáveis de ambiente:
   ```
   OCR_SPACE_API_KEY=sua_chave_aqui
   ```

## 🔧 Comandos Úteis no Terminal do EasyPanel

### Verificar se poppler está instalado:
```bash
pdftoppm -version
```

### Instalar poppler manualmente (se necessário):
```bash
apk add --no-cache poppler-utils
```

### Testar OCR local:
```bash
tesseract --version
```

### Ver logs em tempo real:
```bash
tail -f /app/uploads/*.log
```

## 📝 Variáveis de Ambiente

Certifique-se de ter todas configuradas no EasyPanel:

```env
PORT=4545
OCR_SPACE_API_KEY=K84834179488957
NODE_ENV=production
```

## 🚀 Deploy Alternativo (se tudo falhar)

1. **Fork o repositório corrigido:**
   ```
   https://github.com/[seu-usuario]/ocr-conta-energia-fixed
   ```

2. **No EasyPanel, use Docker Hub ao invés de GitHub:**
   - Build local: `docker build -t seu-usuario/ocr-conta:latest .`
   - Push: `docker push seu-usuario/ocr-conta:latest`
   - No EasyPanel: Use a imagem do Docker Hub

3. **Ou use comando direto no EasyPanel:**
   ```
   Command: npx nodemon server.js
   ```

## ✅ Checklist de Verificação

- [ ] package-lock.json existe no repositório
- [ ] OCR_SPACE_API_KEY configurada
- [ ] Porta 4545 configurada
- [ ] Dockerfile usando `npm install` (não `npm ci`)
- [ ] Memória alocada: mínimo 512MB

## 🆘 Ainda com problemas?

1. Use o Dockerfile.simple (mais estável)
2. Verifique os logs completos no EasyPanel
3. Teste localmente primeiro:
   ```bash
   docker build -t test .
   docker run -p 4545:4545 -e OCR_SPACE_API_KEY=sua_key test
   ```

## 📧 Suporte

Se nada funcionar, abra uma issue com:
- Screenshot do erro
- Logs completos
- Versão do EasyPanel

---
**A chave OCR.space no exemplo (K84834179488957) é apenas demonstração. Use sua própria!**
