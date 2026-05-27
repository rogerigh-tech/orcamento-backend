require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const axios = require('axios');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const app = express();

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(bodyParser.json());

// ─── KEEP-ALIVE: impede o Render de hibernar ──────────────────────────────────
// Faz um ping em si mesmo a cada 10 minutos
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 10000}`;
setInterval(() => {
  axios.get(`${SELF_URL}/health`)
    .then(() => console.log('💓 Keep-alive ping OK'))
    .catch(err => console.log('⚠️ Keep-alive ping falhou:', err.message));
}, 10 * 60 * 1000); // 10 minutos

// ─── TABELA DE PREÇOS ─────────────────────────────────────────────────────────
const CURRENCY_INFO = {
  br:     { symbol: 'R$',  currency: 'brl', unlock: 4990 },
  us:     { symbol: 'USD', currency: 'usd', unlock: 990  },
  eu:     { symbol: '€',   currency: 'eur', unlock: 990  },
  global: { symbol: 'USD', currency: 'usd', unlock: 990  }
};

const SERVICE_PRICES = {
  br: {
    pintura:      { basico: 18,   medio: 28,   alto: 45,   unidade: 'm²' },
    banheiro:     { basico: 900,  medio: 1400, alto: 2200, unidade: 'm²' },
    cozinha:      { basico: 800,  medio: 1300, alto: 2000, unidade: 'm²' },
    reforma_geral:{ basico: 850,  medio: 1300, alto: 2000, unidade: 'm²' },
    eletrica:     { basico: 90,   medio: 130,  alto: 200,  unidade: 'pt' },
    hidraulica:   { basico: 120,  medio: 180,  alto: 280,  unidade: 'pt' },
    piso:         { basico: 80,   medio: 130,  alto: 220,  unidade: 'm²' },
    construcao:   { basico: 1600, medio: 2300, alto: 3800, unidade: 'm²' },
    fachada:      { basico: 120,  medio: 200,  alto: 350,  unidade: 'm²' },
    ar_condicionado: { basico: 800, medio: 1400, alto: 2500, unidade: 'un' }
  },
  us: {
    pintura:      { basico: 2,    medio: 4,    alto: 7,    unidade: 'm²' },
    banheiro:     { basico: 800,  medio: 1400, alto: 2500, unidade: 'm²' },
    cozinha:      { basico: 700,  medio: 1200, alto: 2200, unidade: 'm²' },
    reforma_geral:{ basico: 900,  medio: 1500, alto: 2800, unidade: 'm²' },
    eletrica:     { basico: 150,  medio: 220,  alto: 350,  unidade: 'pt' },
    hidraulica:   { basico: 200,  medio: 300,  alto: 480,  unidade: 'pt' },
    piso:         { basico: 60,   medio: 100,  alto: 180,  unidade: 'm²' },
    construcao:   { basico: 1200, medio: 1800, alto: 3200, unidade: 'm²' },
    fachada:      { basico: 100,  medio: 180,  alto: 320,  unidade: 'm²' },
    ar_condicionado: { basico: 500, medio: 900, alto: 1800, unidade: 'un' }
  },
  eu: {
    pintura:      { basico: 8,    medio: 15,   alto: 25,   unidade: 'm²' },
    banheiro:     { basico: 700,  medio: 1200, alto: 2200, unidade: 'm²' },
    cozinha:      { basico: 600,  medio: 1100, alto: 2000, unidade: 'm²' },
    reforma_geral:{ basico: 800,  medio: 1400, alto: 2500, unidade: 'm²' },
    eletrica:     { basico: 120,  medio: 180,  alto: 280,  unidade: 'pt' },
    hidraulica:   { basico: 160,  medio: 240,  alto: 380,  unidade: 'pt' },
    piso:         { basico: 50,   medio: 90,   alto: 160,  unidade: 'm²' },
    construcao:   { basico: 1100, medio: 1700, alto: 3000, unidade: 'm²' },
    fachada:      { basico: 90,   medio: 160,  alto: 280,  unidade: 'm²' },
    ar_condicionado: { basico: 600, medio: 1100, alto: 2000, unidade: 'un' }
  },
  global: {
    pintura:      { basico: 2,    medio: 4,    alto: 7,    unidade: 'm²' },
    banheiro:     { basico: 600,  medio: 1000, alto: 1800, unidade: 'm²' },
    cozinha:      { basico: 500,  medio: 900,  alto: 1600, unidade: 'm²' },
    reforma_geral:{ basico: 700,  medio: 1100, alto: 2000, unidade: 'm²' },
    eletrica:     { basico: 100,  medio: 150,  alto: 250,  unidade: 'pt' },
    hidraulica:   { basico: 130,  medio: 200,  alto: 320,  unidade: 'pt' },
    piso:         { basico: 40,   medio: 75,   alto: 140,  unidade: 'm²' },
    construcao:   { basico: 900,  medio: 1400, alto: 2500, unidade: 'm²' },
    fachada:      { basico: 70,   medio: 130,  alto: 220,  unidade: 'm²' },
    ar_condicionado: { basico: 400, medio: 800, alto: 1500, unidade: 'un' }
  }
};

const SERVICE_LABELS = {
  reforma_geral: 'Reforma Geral', banheiro: 'Banheiro', cozinha: 'Cozinha',
  pintura: 'Pintura', eletrica: 'Instalação Elétrica', hidraulica: 'Instalação Hidráulica',
  piso: 'Piso / Revestimento', construcao: 'Construção Nova',
  fachada: 'Fachada / Área Externa', ar_condicionado: 'Ar Condicionado'
};

const TIMELINES = {
  reforma_geral: ['Levantamento e projeto (3 dias)', 'Demolição e preparação (5 dias)', 'Estrutura e alvenaria (7 dias)', 'Instalações elétricas e hidráulicas (5 dias)', 'Revestimentos e acabamentos (8 dias)', 'Pintura e limpeza final (4 dias)'],
  banheiro:      ['Demolição e remoção (2 dias)', 'Impermeabilização (2 dias)', 'Instalações hidráulicas (3 dias)', 'Revestimento e louças (4 dias)', 'Acabamento final (2 dias)'],
  cozinha:       ['Projeto e marcenaria (3 dias)', 'Instalação elétrica/hidráulica (3 dias)', 'Revestimentos (3 dias)', 'Móveis e equipamentos (4 dias)', 'Acabamento (2 dias)'],
  pintura:       ['Preparação de superfícies (2 dias)', 'Primeira demão (2 dias)', 'Correções e massa corrida (1 dia)', 'Segunda demão e acabamento (2 dias)'],
  eletrica:      ['Projeto elétrico (2 dias)', 'Abertura de rasgos (2 dias)', 'Passagem de conduítes (3 dias)', 'Cabeamento e conexões (3 dias)', 'Quadro elétrico e testes (2 dias)'],
  hidraulica:    ['Projeto hidráulico (1 dia)', 'Abertura de rasgos (2 dias)', 'Tubulação e conexões (3 dias)', 'Testes de pressão (1 dia)', 'Acabamentos e louças (2 dias)'],
  piso:          ['Retirada do piso existente (2 dias)', 'Regularização de contrapiso (2 dias)', 'Assentamento (4 dias)', 'Rejuntamento e limpeza (2 dias)'],
  construcao:    ['Fundação (15 dias)', 'Estrutura (20 dias)', 'Alvenaria (12 dias)', 'Cobertura (8 dias)', 'Instalações (10 dias)', 'Acabamentos (15 dias)', 'Vistoria final (3 dias)'],
  fachada:       ['Andaimes e segurança (2 dias)', 'Limpeza e preparação (3 dias)', 'Reparos estruturais (3 dias)', 'Aplicação de revestimento (5 dias)', 'Pintura e acabamento (4 dias)'],
  ar_condicionado: ['Vistoria técnica e projeto (1 dia)', 'Instalação das unidades (1 dia)', 'Passagem de tubulação e elétrica (1 dia)', 'Teste e comissionamento (1 dia)']
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

// ─── GERAR PDF ────────────────────────────────────────────────────────────────
async function generatePDF(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const filePath = path.join('/tmp', `orcamento_${Date.now()}.pdf`);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const GREEN = '#1D9E75', DARK = '#085041', GRAY = '#5F5E5A', LIGHT = '#E1F5EE';

    doc.rect(0, 0, doc.page.width, 80).fill(GREEN);
    doc.fillColor('white').fontSize(22).font('Helvetica-Bold')
       .text('Orçamento de Obra Rápido', 50, 20);
    doc.fontSize(10).font('Helvetica')
       .text('Análise técnica profissional · orcamentodeobrarapido.com', 50, 50);
    doc.moveDown(3);
    doc.fillColor(GRAY).fontSize(9).text('Gerado em: ' + new Date().toLocaleDateString('pt-BR'), { align: 'right' });
    doc.moveDown(0.5);

    doc.fillColor(GREEN).fontSize(11).font('Helvetica-Bold').text('DADOS DO CLIENTE');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(GREEN).lineWidth(1).stroke();
    doc.moveDown(0.3);
    doc.fillColor(DARK).fontSize(10).font('Helvetica');
    doc.text(`Nome: ${data.name}`);
    doc.text(`Email: ${data.email}`);
    if (data.phone) doc.text(`WhatsApp: ${data.phone}`);
    doc.text(`País: ${data.countryLabel}`);
    doc.moveDown(0.8);

    doc.fillColor(GREEN).fontSize(11).font('Helvetica-Bold').text('ESCOPO DA OBRA');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(GREEN).lineWidth(1).stroke();
    doc.moveDown(0.3);
    doc.fillColor(DARK).fontSize(10).font('Helvetica');
    doc.text(`Tipo de serviço: ${data.serviceLabel}`);
    doc.text(`Área: ${data.area} m²`);
    doc.text(`Padrão: ${data.standardLabel}`);
    doc.text(`Material incluso: ${data.material === 'sim' ? 'Sim' : 'Não'}`);
    doc.text(`Demolição: ${data.demolition === 'sim' ? 'Sim' : 'Não'}`);
    if (data.description) { doc.moveDown(0.3); doc.fillColor(GRAY).text('Descrição: ' + data.description, { width: 495 }); }
    doc.moveDown(0.8);

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
    doc.moveDown(0.3);
    doc.fillColor(DARK).fontSize(13).font('Helvetica-Bold')
       .text(`TOTAL ESTIMADO:  ${formatMoney(data.costs.total, data.country)}`, 60, totalY + 10, { width: 475 });
    doc.moveDown(1.8);

    const timeline = TIMELINES[data.service] || TIMELINES.reforma_geral;
    doc.fillColor(GREEN).fontSize(11).font('Helvetica-Bold').text('CRONOGRAMA DE EXECUÇÃO');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(GREEN).lineWidth(1).stroke();
    doc.moveDown(0.3);
    timeline.forEach((step, i) => {
      doc.fillColor(DARK).fontSize(10).font('Helvetica').text(`${i + 1}. ${step}`, 50, doc.y, { width: 495 });
      doc.moveDown(0.2);
    });
    doc.moveDown(0.6);

    doc.fillColor(GREEN).fontSize(11).font('Helvetica-Bold').text('RECOMENDAÇÕES TÉCNICAS');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(GREEN).lineWidth(1).stroke();
    doc.moveDown(0.3);
    doc.fillColor(DARK).fontSize(10).font('Helvetica')
       .text('• Solicite nota fiscal de todos os materiais adquiridos.')
       .text('• Verifique se o profissional possui registro no CREA ou CAU.')
       .text('• Documente cada etapa com fotos para controle de qualidade.')
       .text('• Solicite pelo menos 3 orçamentos de mão de obra.')
       .text('• Recomenda-se acompanhamento técnico de engenheiro ou arquiteto.');
    doc.moveDown(1);

    doc.rect(0, doc.page.height - 45, doc.page.width, 45).fill(GREEN);
    doc.fillColor('white').fontSize(8)
       .text('Este orçamento é uma estimativa baseada em parâmetros médios de mercado (SINAPI/CUB). Os valores podem variar conforme condições locais, mão de obra e escopo definitivo.', 50, doc.page.height - 38, { width: 495, align: 'center' });

    doc.end();
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

// ─── ENVIAR EMAIL ─────────────────────────────────────────────────────────────
async function sendEmail(toEmail, name, pdfPath) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
  });
  await transporter.sendMail({
    from: `"Orçamento de Obra Rápido" <${process.env.EMAIL_USER}>`,
    to: toEmail,
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
            <li>✅ Estimativa de custo com base técnica</li>
            <li>📅 Cronograma completo por etapas</li>
            <li>💡 Recomendações do especialista</li>
            <li>⚠️ Alertas de custos adicionais</li>
          </ul>
          <p style="color:#888;font-size:12px">Este orçamento é uma estimativa. Recomendamos vistoria técnica presencial antes da contratação.</p>
          <p><strong>Equipe Orçamento de Obra Rápido</strong></p>
        </div>
      </div>`,
    attachments: [{ filename: 'orcamento-tecnico.pdf', path: pdfPath }]
  });
}

// ─── ENVIAR WHATSAPP ──────────────────────────────────────────────────────────
async function sendWhatsApp(phone, name, pdfPath) {
  if (!process.env.ZAPI_INSTANCE || !process.env.ZAPI_TOKEN) return;
  const cleanPhone = phone.replace(/\D/g, '');
  await axios.post(
    `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}/send-text`,
    { phone: cleanPhone, message: `🏗️ Olá, ${name}! Seu orçamento técnico profissional está pronto. Em instantes você receberá o PDF completo.\n\n— Orçamento de Obra Rápido` }
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

// ─── ROTA: ACESSO GRATUITO ────────────────────────────────────────────────────
app.post('/free-access', async (req, res) => {
  try {
    const { name, email, phone, country, service, area, standard, material, demolition, description } = req.body;
    if (!FREE_ACCESS_EMAILS.includes((email || '').toLowerCase().trim())) {
      return res.status(403).json({ error: 'Email não autorizado para acesso gratuito.' });
    }
    const costs = calcValue(country, standard, parseFloat(area), material, demolition, service);
    const data = {
      name, email, phone, country,
      countryLabel: { br: 'Brasil', us: 'Estados Unidos', eu: 'Europa', global: 'Internacional' }[country] || country,
      service, serviceLabel: SERVICE_LABELS[service] || service,
      area: parseFloat(area), standard,
      standardLabel: { basico: 'Básico', medio: 'Médio', alto: 'Alto Padrão' }[standard] || standard,
      material, demolition, description: description || '', costs
    };
    const pdfPath = await generatePDF(data);
    await sendEmail(email, name, pdfPath);
    if (phone) await sendWhatsApp(phone, name, pdfPath);
    fs.unlinkSync(pdfPath);
    console.log(`✅ Acesso gratuito entregue para ${email}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro no acesso gratuito:', err);
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
      metadata: { name, email, phone, country, service, area, standard, material, demolition, description: description || '' }
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── ROTA: WEBHOOK STRIPE ─────────────────────────────────────────────────────
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
    const costs = calcValue(m.country, m.standard, parseFloat(m.area), m.material, m.demolition, m.service);
    const data = {
      name: m.name, email: m.email, phone: m.phone, country: m.country,
      countryLabel: { br: 'Brasil', us: 'Estados Unidos', eu: 'Europa', global: 'Internacional' }[m.country] || m.country,
      service: m.service, serviceLabel: SERVICE_LABELS[m.service] || m.service,
      area: parseFloat(m.area), standard: m.standard,
      standardLabel: { basico: 'Básico', medio: 'Médio', alto: 'Alto Padrão' }[m.standard] || m.standard,
      material: m.material, demolition: m.demolition, description: m.description, costs
    };
    try {
      const pdfPath = await generatePDF(data);
      await sendEmail(data.email, data.name, pdfPath);
      if (data.phone) await sendWhatsApp(data.phone, data.name, pdfPath);
      fs.unlinkSync(pdfPath);
      console.log(`✅ Orçamento entregue para ${data.email}`);
    } catch (err) {
      console.error('Erro na entrega:', err);
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
