#!/bin/bash

# Script de teste da API OCR Conta de Energia
# Uso: ./test-api.sh [arquivo.pdf]

API_URL=${API_URL:-"http://localhost:4545"}
TEST_FILE=${1:-"conta_teste.pdf"}

echo "🧪 Testando API OCR Conta de Energia"
echo "=================================="
echo "URL: $API_URL"
echo ""

# Teste 1: Status da API
echo "1️⃣ Testando status da API..."
STATUS=$(curl -s "$API_URL/status")
if [ $? -eq 0 ]; then
    echo "✅ API online"
    echo "$STATUS" | python3 -m json.tool
else
    echo "❌ API offline"
    exit 1
fi

echo ""
echo "2️⃣ Testando processamento de arquivo..."

# Teste 2: Upload e processamento
if [ -f "$TEST_FILE" ]; then
    echo "📄 Enviando arquivo: $TEST_FILE"
    
    RESPONSE=$(curl -s -X POST \
        -F "file=@$TEST_FILE" \
        -F "method=auto" \
        "$API_URL/process")
    
    if [ $? -eq 0 ]; then
        echo "✅ Arquivo processado com sucesso!"
        echo ""
        echo "Resposta da API:"
        echo "$RESPONSE" | python3 -m json.tool
        
        # Extrair dados importantes
        echo ""
        echo "📊 Dados extraídos:"
        echo "==================="
        echo "$RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if 'extracted_data' in data:
    ed = data['extracted_data']
    print(f'Cliente: {ed.get(\"cliente\", \"N/A\")}')
    print(f'Valor: {ed.get(\"valor_total\", \"N/A\")}')
    print(f'Vencimento: {ed.get(\"vencimento\", \"N/A\")}')
    print(f'Consumo: {ed.get(\"consumo_kwh\", \"N/A\")} kWh')
"
    else
        echo "❌ Erro ao processar arquivo"
    fi
else
    echo "⚠️ Arquivo não encontrado: $TEST_FILE"
    echo "Testando com URL de exemplo..."
    
    # Teste 3: Processar de URL
    echo ""
    echo "3️⃣ Testando processamento via URL..."
    
    RESPONSE=$(curl -s -X POST \
        -H "Content-Type: application/json" \
        -d '{"url": "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"}' \
        "$API_URL/process-url")
    
    echo "$RESPONSE" | python3 -m json.tool
fi

echo ""
echo "✨ Teste concluído!"
