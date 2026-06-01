require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const axios = require('axios');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const app = express();

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// ─── KEEP-ALIVE ───────────────────────────────────────────────────────────────
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 10000}`;
setInterval(() => {
  axios.get(`${SELF_URL}/health`)
    .then(() => console.log('💓 Keep-alive ping OK'))
    .catch(err => console.log('⚠️ Keep-alive ping falhou:', err.message));
}, 10 * 60 * 1000);

// ─── TABELA DE PREÇOS ─────────────────────────────────────────────────────────
const CURRENCY_INFO = {
  br:     { symbol: 'R$',  currency: 'brl', unlock: 4990 },
  us:     { symbol: 'USD', currency: 'usd', unlock: 990  },
  eu:     { symbol: '€',   currency: 'eur', unlock: 990  },
  global: { symbol: 'USD', currency: 'usd', unlock: 990  }
};

const SERVICE_PRICES = {
  br: {
    pintura:         { basico: 18,   medio: 28,   alto: 45,   unidade: 'm²' },
    banheiro:        { basico: 900,  medio: 1400, alto: 2200, unidade: 'm²' },
    cozinha:         { basico: 800,  medio: 1300, alto: 2000, unidade: 'm²' },
    reforma_geral:   { basico: 850,  medio: 1300, alto: 2000, unidade: 'm²' },
    eletrica:        { basico: 90,   medio: 130,  alto: 200,  unidade: 'pt' },
    hidraulica:      { basico: 120,  medio: 180,  alto: 280,  unidade: 'pt' },
    piso:            { basico: 80,   medio: 130,  alto: 220,  unidade: 'm²' },
    construcao:      { basico: 1600, medio: 2300, alto: 3800, unidade: 'm²' },
    fachada:         { basico: 120,  medio: 200,  alto: 350,  unidade: 'm²' },
    ar_condicionado: { basico: 800,  medio: 1400, alto: 2500, unidade: 'un' }
  },
  us: {
    pintura:         { basico: 2,    medio: 4,    alto: 7,    unidade: 'm²' },
    banheiro:        { basico: 800,  medio: 1400, alto: 2500, unidade: 'm²' },
    cozinha:         { basico: 700,  medio: 1200, alto: 2200, unidade: 'm²' },
    reforma_geral:   { basico: 900,  medio: 1500, alto: 2800, unidade: 'm²' },
    eletrica:        { basico: 150,  medio: 220,  alto: 350,  unidade: 'pt' },
    hidraulica:      { basico: 200,  medio: 300,  alto: 480,  unidade: 'pt' },
    piso:            { basico: 60,   medio: 100,  alto: 180,  unidade: 'm²' },
    construcao:      { basico: 1200, medio: 1800, alto: 3200, unidade: 'm²' },
    fachada:         { basico: 100,  medio: 180,  alto: 320,  unidade: 'm²' },
    ar_condicionado: { basico: 500,  medio: 900,  alto: 1800, unidade: 'un' }
  },
  eu: {
    pintura:         { basico: 8,    medio: 15,   alto: 25,   unidade: 'm²' },
    banheiro:        { basico: 700,  medio: 1200, alto: 2200, unidade: 'm²' },
    cozinha:         { basico: 600,  medio: 1100, alto: 2000, unidade: 'm²' },
    reforma_geral:   { basico: 800,  medio: 1400, alto: 2500, unidade: 'm²' },
    eletrica:        { basico: 120,  medio: 180,  alto: 280,  unidade: 'pt' },
    hidraulica:      { basico: 160,  medio: 240,  alto: 380,  unidade: 'pt' },
    piso:            { basico: 50,   medio: 90,   alto: 160,  unidade: 'm²' },
    construcao:      { basico: 1100, medio: 1700, alto: 3000, unidade: 'm²' },
    fachada:         { basico: 90,   medio: 160,  alto: 280,  unidade: 'm²' },
    ar_condicionado: { basico: 600,  medio: 1100, alto: 2000, unidade: 'un' }
  },
  global: {
    pintura:         { basico: 2,    medio: 4,    alto: 7,    unidade: 'm²' },
    banheiro:        { basico: 600,  medio: 1000, alto: 1800, unidade: 'm²' },
    cozinha:         { basico: 500,  medio: 900,  alto: 1600, unidade: 'm²' },
    reforma_geral:   { basico: 700,  medio: 1100, alto: 2000, unidade: 'm²' },
    eletrica:        { basico: 100,  medio: 150,  alto: 250,  unidade: 'pt' },
    hidraulica:      { basico: 130,  medio: 200,  alto: 320,  unidade: 'pt' },
    piso:            { basico: 40,   medio: 75,   alto: 140,  unidade: 'm²' },
    construcao:      { basico: 900,  medio: 1400, alto: 2500, unidade: 'm²' },
    fachada:         { basico: 70,   medio: 130,  alto: 220,  unidade: 'm²' },
    ar_condicionado: { basico: 400,  medio: 800,  alto: 1500, unidade: 'un' }
  }
};

const SERVICE_LABELS = {
  reforma_geral: 'Reforma Geral', banheiro: 'Banheiro', cozinha: 'Cozinha',
  pintura: 'Pintura', eletrica: 'Instalação Elétrica', hidraulica: 'Instalação Hidráulica',
  piso: 'Piso / Revestimento', construcao: 'Construção Nova',
  fachada: 'Fachada / Área Externa', ar_condicionado: 'Ar Condicionado'
};

// ─── CÁLCULO DE VALOR ─────────────────────────────────────────────────────────
function calcValue(country, standard, area, material, demolition, service) {
  const region = SERVICE_PRICES[country] || SERVICE_PRICES.global;
  const svc = region[service] || region['reforma_geral'];
  const pricePerUnit = svc[standard] || svc.medio;
  let base = pricePerUnit * area;
  let matAdd = material === 'sim' ? base * 0.2 : 0;
  let demAdd = demolition === 'sim' ? (base + matAdd) * 0.1 : 0;
  return {
    base: Math.round(base), matAdd: Math.round(matAdd), demAdd: Math.round(demAdd),
    total: Math.round(base + matAdd + demAdd), pricePerUnit, unidade: svc.unidade
  };
}

function formatMoney(val, country) {
  const info = CURRENCY_INFO[country] || CURRENCY_INFO.global;
  if (country === 'br') return 'R$ ' + val.toLocaleString('pt-BR');
  return info.symbol + ' ' + val.toLocaleString('en-US');
}

// ─── ANÁLISE IA COM GEMINI ────────────────────────────────────────────────────
async function analisarComIA(data) {
  const { service, area, standard, material, demolition, description, photos, pdf } = data;
  const temMidia = (photos && photos.length > 0) || pdf;

  const prompt = `Você é o Eng. Rafael, engenheiro civil sênior com 20 anos de experiência, CREA ativo.

DADOS DO PROJETO:
- Serviço: ${SERVICE_LABELS[service] || service}
- Área: ${area} m²
- Padrão: ${standard}
- Material incluso: ${material === 'sim' ? 'Sim' : 'Não'}
- Demolição: ${demolition === 'sim' ? 'Sim' : 'Não'}
- Descrição do cliente: ${description || 'Não informada'}
${temMidia ? '- Arquivos enviados: analisados acima (fotos/PDF)' : ''}

Gere um ESCOPO TÉCNICO DETALHADO em JSON com EXATAMENTE este formato (responda APENAS o JSON, sem texto adicional, sem markdown):
{
  "diagnostico": "Diagnóstico técnico objetivo em 2-3 frases, citando problemas específicos identificados nas imagens/documentos",
  "alertas": ["alerta técnico específico 1", "alerta técnico específico 2", "alerta técnico específico 3"],
  "etapas": [
    {"numero": 1, "titulo": "Nome da etapa", "descricao": "Descrição técnica detalhada: o que será feito, como, com quais materiais e técnica", "prazo": "X dias"},
    {"numero": 2, "titulo": "Nome da etapa", "descricao": "...", "prazo": "X dias"}
  ],
  "recomendacoes": ["recomendação específica 1", "recomendação específica 2", "recomendação específica 3", "recomendação específica 4"]
}

REGRAS:
- Seja ESPECÍFICO ao que foi visto nas fotos/PDF/descrição
- Se houver infiltração, mofo, trincas, descascamento — cite e detalhe o tratamento (ex: raspagem, selador antimofo, impermeabilizante)
- Mínimo 4 etapas, máximo 8
- Cada etapa com descrição técnica real e detalhada
- Responda APENAS o JSON válido`;

  // Monta parts do Gemini
  const parts = [];

  // Adiciona fotos
  if (photos && photos.length > 0) {
    photos.forEach(photo => {
      parts.push({
        inline_data: {
          mime_type: photo.mediaType,
          data: photo.base64
        }
      });
    });
  }

  // Adiciona PDF
  if (pdf) {
    parts.push({
      inline_data: {
        mime_type: 'application/pdf',
        data: pdf.base64
      }
    });
  }

  // Adiciona o prompt de texto
  parts.push({ text: prompt });

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2000
        }
      },
      { timeout: 60000 }
    );

    const text = response.data.candidates[0].content.parts[0].text.trim();
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const result = JSON.parse(clean);
    console.log('✅ Análise IA concluída com Gemini');
    return result;

  } catch (err) {
    console.error('Erro na análise Gemini:', err.response?.data || err.message);
    // Fallback escopo genérico
    return {
      diagnostico: `Projeto de ${SERVICE_LABELS[service] || service} em área de ${area} m², padrão ${standard}. Análise baseada nas informações fornecidas pelo cliente.`,
      alertas: [
        'Verifique a necessidade de impermeabilização antes de iniciar',
        'Confirme o estado das instalações existentes',
        'Avalie a necessidade de tratamento de umidade ou mofo'
      ],
      etapas: [
        { numero: 1, titulo: 'Vistoria e preparação', descricao: 'Vistoria técnica detalhada do local, remoção de materiais soltos, limpeza geral e proteção de áreas adjacentes', prazo: '1 dia' },
        { numero: 2, titulo: 'Tratamentos especiais', descricao: `Tratamento de patologias identificadas: raspagem de tinta solta, aplicação de selador e correção de irregularidades superficiais`, prazo: '2 dias' },
        { numero: 3, titulo: 'Execução principal', descricao: `Execução do serviço de ${SERVICE_LABELS[service] || service} conforme especificações técnicas e padrão ${standard}`, prazo: '4 dias' },
        { numero: 4, titulo: 'Acabamento e entrega', descricao: 'Aplicação de acabamentos finais, verificação de qualidade, limpeza geral e entrega da obra ao cliente', prazo: '1 dia' }
      ],
      recomendacoes: [
        'Solicite nota fiscal de todos os materiais adquiridos',
        'Verifique registro do profissional no CREA ou CAU',
        'Documente cada etapa com fotos para controle de qualidade',
        'Obtenha ao menos 3 orçamentos de mão de obra antes de contratar'
      ]
    };
  }
}

// ─── GERAR PDF COM ESCOPO PERSONALIZADO ──────────────────────────────────────
async function generatePDF(data, escopo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const filePath = path.join('/tmp', `orcamento_${Date.now()}.pdf`);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const GREEN = '#1D9E75', DARK = '#085041', GRAY = '#5F5E5A', LIGHT = '#E1F5EE';

    // Cabeçalho
    doc.rect(0, 0, doc.page.width, 80).fill(GREEN);
    doc.fillColor('white').fontSize(22).font('Helvetica-Bold')
       .text('Orçamento de Obra Rápido', 50, 20);
    doc.fontSize(10).font('Helvetica')
       .text('Análise técnica profissional · orcamentodeobrarapido.com', 50, 50);
    doc.moveDown(3);
    doc.fillColor(GRAY).fontSize(9)
       .text('Gerado em: ' + new Date().toLocaleDateString('pt-BR'), { align: 'right' });
    doc.moveDown(0.5);

    // Dados do cliente
    doc.fillColor(GREEN).fontSize(11).font('Helvetica-Bold').text('DADOS DO CLIENTE');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(GREEN).lineWidth(1).stroke();
    doc.moveDown(0.3);
    doc.fillColor(DARK).fontSize(10).font('Helvetica');
    doc.text(`Nome: ${data.name}`);
    doc.text(`Email: ${data.email}`);
    if (data.phone) doc.text(`WhatsApp: ${data.phone}`);
    doc.text(`País: ${data.countryLabel}`);
    doc.moveDown(0.8);

    // Escopo da obra
    doc.fillColor(GREEN).fontSize(11).font('Helvetica-Bold').text('ESCOPO DA OBRA');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(GREEN).lineWidth(1).stroke();
    doc.moveDown(0.3);
    doc.fillColor(DARK).fontSize(10).font('Helvetica');
    doc.text(`Tipo de serviço: ${data.serviceLabel}`);
    doc.text(`Área: ${data.area} m²`);
    doc.text(`Padrão: ${data.standardLabel}`);
    doc.text(`Material incluso: ${data.material === 'sim' ? 'Sim' : 'Não'}`);
    doc.text(`Demolição: ${data.demolition === 'sim' ? 'Sim' : 'Não'}`);
    if (data.description) {
      doc.moveDown(0.3);
      doc.fillColor(GRAY).text('Descrição: ' + data.description, { width: 495 });
    }
    doc.moveDown(0.8);

    // Diagnóstico técnico
    doc.fillColor(GREEN).fontSize(11).font('Helvetica-Bold').text('DIAGNÓSTICO TÉCNICO');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(GREEN).lineWidth(1).stroke();
    doc.moveDown(0.3);
    doc.fillColor(DARK).fontSize(10).font('Helvetica')
       .text(escopo.diagnostico, { width: 495 });
    doc.moveDown(0.8);

    // Alertas técnicos
    if (escopo.alertas && escopo.alertas.length > 0) {
      doc.fillColor('#856404').fontSize(11).font('Helvetica-Bold').text('⚠ ALERTAS TÉCNICOS');
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#856404').lineWidth(1).stroke();
      doc.moveDown(0.3);
      escopo.alertas.forEach(alerta => {
        doc.fillColor('#856404').fontSize(10).font('Helvetica')
           .text(`• ${alerta}`, { width: 495 });
        doc.moveDown(0.2);
      });
      doc.moveDown(0.6);
    }

    // Estimativa de custo
    doc.fillColor(GREEN).fontSize(11).font('Helvetica-Bold').text('ESTIMATIVA DE CUSTO');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(GREEN).lineWidth(1).stroke();
    doc.moveDown(0.3);
    doc.fillColor(DARK).fontSize(10).font('Helvetica');
    doc.text(`Custo base (${data.area} ${data.costs.unidade || 'm²'} × ${formatMoney(data.costs.pricePerUnit || 0, data.country)}/${data.costs.unidade || 'm²'}):  ${formatMoney(data.costs.base, data.country)}`);
    if (data.costs.matAdd > 0) doc.text(`Material incluso (+20%):  ${formatMoney(data.costs.matAdd, data.country)}`);
    if (data.costs.demAdd > 0) doc.text(`Demolição (+10%):  ${formatMoney(data.costs.demAdd, data.country)}`);
    doc.moveDown(0.8);
    const totalY = doc.y;
    doc.rect(50, totalY, 495, 36).fill(LIGHT);
    doc.fillColor(DARK).fontSize(13).font('Helvetica-Bold')
       .text(`TOTAL ESTIMADO:  ${formatMoney(data.costs.total, data.country)}`, 60, totalY + 10, { width: 475 });
    doc.moveDown(1.8);

    // Cronograma detalhado
    if (doc.y > 650) doc.addPage();
    doc.fillColor(GREEN).fontSize(11).font('Helvetica-Bold').text('CRONOGRAMA DETALHADO DE EXECUÇÃO');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(GREEN).lineWidth(1).stroke();
    doc.moveDown(0.3);
    escopo.etapas.forEach(etapa => {
      if (doc.y > 680) doc.addPage();
      doc.fillColor(GREEN).fontSize(10).font('Helvetica-Bold')
         .text(`${etapa.numero}. ${etapa.titulo}  (${etapa.prazo})`, { width: 495 });
      doc.fillColor(DARK).fontSize(10).font('Helvetica')
         .text(etapa.descricao, { width: 480, indent: 15 });
      doc.moveDown(0.5);
    });
    doc.moveDown(0.4);

    // Recomendações
    if (doc.y > 650) doc.addPage();
    doc.fillColor(GREEN).fontSize(11).font('Helvetica-Bold').text('RECOMENDAÇÕES TÉCNICAS');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(GREEN).lineWidth(1).stroke();
    doc.moveDown(0.3);
    escopo.recomendacoes.forEach(rec => {
      doc.fillColor(DARK).fontSize(10).font('Helvetica').text(`• ${rec}`, { width: 495 });
      doc.moveDown(0.2);
    });
    doc.moveDown(1);

    // Rodapé
    doc.rect(0, doc.page.height - 45, doc.page.width, 45).fill(GREEN);
    doc.fillColor('white').fontSize(8)
       .text('Este orçamento é uma estimativa baseada em análise técnica e parâmetros de mercado (SINAPI/CUB). Os valores podem variar conforme condições locais e escopo definitivo. Recomendada vistoria técnica presencial antes da contratação.', 50, doc.page.height - 38, { width: 495, align: 'center' });

    doc.end();
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

// ─── ENVIAR EMAIL VIA RESEND ──────────────────────────────────────────────────
async function sendEmail(toEmail, name, pdfPath) {
  const pdfBase64 = fs.readFileSync(pdfPath).toString('base64');
  const response = await axios.post('https://api.resend.com/emails', {
    from: 'Orçamento de Obra Rápido <onboarding@resend.dev>',
    to: [toEmail],
    subject: '🏗️ Seu orçamento técnico está pronto!',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:auto">
        <div style="background:#1D9E75;padding:24px;border-radius:12px 12px 0 0">
          <h1 style="color:white;margin:0;font-size:22px">Orçamento de Obra Rápido</h1>
        </div>
        <div style="background:#f9f9f9;padding:24px;border-radius:0 0 12px 12px;border:1px solid #eee">
          <p>Olá, <strong>${name}</strong>!</p>
          <p>Seu orçamento técnico profissional está pronto e segue em anexo.</p>
          <ul>
            <li>✅ Diagnóstico técnico personalizado</li>
            <li>⚠️ Alertas de problemas identificados</li>
            <li>📅 Cronograma detalhado por etapas</li>
            <li>💡 Recomendações do especialista</li>
          </ul>
          <p style="color:#888;font-size:12px">Este orçamento é uma estimativa. Recomendamos vistoria técnica presencial.</p>
          <p><strong>Equipe Orçamento de Obra Rápido</strong></p>
        </div>
      </div>`,
    attachments: [{ filename: 'orcamento-tecnico.pdf', content: pdfBase64 }]
  }, {
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  console.log('📧 Email enviado via Resend:', response.data.id);
}

// ─── ENVIAR WHATSAPP ──────────────────────────────────────────────────────────
async function sendWhatsApp(phone, name, pdfPath) {
  if (!process.env.ZAPI_INSTANCE || !process.env.ZAPI_TOKEN) return;
  const cleanPhone = phone.replace(/\D/g, '');
  await axios.post(
    `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}/send-text`,
    { phone: cleanPhone, message: `🏗️ Olá, ${name}! Seu orçamento técnico profissional está pronto.\n\n— Orçamento de Obra Rápido` }
  );
  const pdfBase64 = fs.readFileSync(pdfPath).toString('base64');
  await axios.post(
    `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}/send-document/pdf`,
    { phone: cleanPhone, document: pdfBase64, fileName: 'orcamento-tecnico.pdf', caption: 'Seu orçamento técnico completo 📄' }
  );
}

// ─── EMAILS COM ACESSO GRATUITO ───────────────────────────────────────────────
const FREE_ACCESS_EMAILS = [
  'roger.igh@gmail.com',
  'roger.igh@hotmail.com',
  'rogerio@orcamentodeobrarapido.com.br'
];

// ─── HELPER ───────────────────────────────────────────────────────────────────
function buildData(fields) {
  const { name, email, phone, country, service, area, standard, material, demolition, description, photos, pdf } = fields;
  const costs = calcValue(country, standard, parseFloat(area), material, demolition, service);
  return {
    name, email, phone, country,
    countryLabel: { br: 'Brasil', us: 'Estados Unidos', eu: 'Europa', global: 'Internacional' }[country] || country,
    service, serviceLabel: SERVICE_LABELS[service] || service,
    area: parseFloat(area), standard,
    standardLabel: { basico: 'Básico', medio: 'Médio', alto: 'Alto Padrão' }[standard] || standard,
    material, demolition, description: description || '',
    photos: photos || [], pdf: pdf || null, costs
  };
}

// ─── ROTA: ACESSO GRATUITO ────────────────────────────────────────────────────
app.post('/free-access', async (req, res) => {
  try {
    const data = buildData(req.body);
    if (!FREE_ACCESS_EMAILS.includes((data.email || '').toLowerCase().trim())) {
      return res.status(403).json({ error: 'Email não autorizado para acesso gratuito.' });
    }
    console.log(`🔍 Analisando projeto com Gemini para ${data.email}...`);
    const escopo = await analisarComIA(data);
    console.log(`📄 Gerando PDF personalizado...`);
    const pdfPath = await generatePDF(data, escopo);
    console.log(`📧 Enviando email...`);
    await sendEmail(data.email, data.name, pdfPath);
    if (data.phone) await sendWhatsApp(data.phone, data.name, pdfPath);
    fs.unlinkSync(pdfPath);
    console.log(`✅ Acesso gratuito entregue para ${data.email}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro no acesso gratuito:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── ROTA: CRIAR SESSÃO STRIPE ────────────────────────────────────────────────
app.post('/create-checkout', async (req, res) => {
  try {
    const { name, email, phone, country, service, area, standard, material, demolition, description } = req.body;
    const info = CURRENCY_INFO[country] || CURRENCY_INFO.global;
    const paymentMethods = info.currency === 'brl' ? ['card', 'boleto'] : ['card'];
    const session = await stripe.checkout.sessions.create({
      payment_method_types: paymentMethods,
      customer_email: email,
      line_items: [{
        price_data: {
          currency: info.currency,
          product_data: { name: 'Orçamento Técnico Profissional', description: `${SERVICE_LABELS[service] || service} · ${area} m² · Padrão ${standard}` },
          unit_amount: info.unlock
        },
        quantity: 1
      }],
      mode: 'payment',
      payment_method_options: info.currency === 'brl' ? { boleto: { expires_after_days: 3 } } : {},
      success_url: `${process.env.FRONTEND_URL}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}`,
      metadata: { name, email, phone: phone || '', country, service, area: String(area), standard, material, demolition, description: description || '' }
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── WEBHOOK STRIPE ───────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const m = session.metadata;
    const data = buildData({ ...m, photos: [], pdf: null });
    try {
      const escopo = await analisarComIA(data);
      const pdfPath = await generatePDF(data, escopo);
      await sendEmail(data.email, data.name, pdfPath);
      if (data.phone) await sendWhatsApp(data.phone, data.name, pdfPath);
      fs.unlinkSync(pdfPath);
      console.log(`✅ Orçamento entregue para ${data.email}`);
    } catch (err) {
      console.error('Erro na entrega:', err.message);
    }
  }
  res.json({ received: true });
});

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`💓 Keep-alive ativo — ping a cada 10 minutos`);
});
