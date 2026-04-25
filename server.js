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

// ─── CORS: permite Netlify + localhost ───────────────────────────────────────
app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type'] }));

// Raw body para webhook do Stripe (DEVE vir antes do bodyParser.json)
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(bodyParser.json());

// ─── TABELA GLOBAL DE PREÇOS ─────────────────────────────────────────────────
const PRICES = {
  br: { basico: 900,  medio: 1300, alto: 2000, symbol: 'R$',  currency: 'brl', unlock: 4990  }, // R$49,90
  us: { basico: 1000, medio: 1600, alto: 2800, symbol: 'USD', currency: 'usd', unlock: 990   }, // $9,90
  eu: { basico: 900,  medio: 1500, alto: 2700, symbol: '€',   currency: 'eur', unlock: 990   }, // €9,90
  global: { basico: 700, medio: 1200, alto: 2000, symbol: 'USD', currency: 'usd', unlock: 990 }
};

const SERVICE_LABELS = {
  reforma_geral: 'Reforma Geral',
  banheiro: 'Banheiro',
  cozinha: 'Cozinha',
  pintura: 'Pintura',
  eletrica: 'Instalação Elétrica',
  hidraulica: 'Instalação Hidráulica',
  piso: 'Piso / Revestimento',
  construcao: 'Construção Nova',
  fachada: 'Fachada / Área Externa'
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
  fachada:       ['Andaimes e segurança (2 dias)', 'Limpeza e preparação (3 dias)', 'Reparos estruturais (3 dias)', 'Aplicação de revestimento (5 dias)', 'Pintura e acabamento (4 dias)']
};

// ─── CÁLCULO DE VALOR ────────────────────────────────────────────────────────
function calcValue(country, standard, area, material, demolition) {
  const p = PRICES[country] || PRICES.global;
  let base = p[standard] * area;
  let matAdd = material === 'sim' ? base * 0.2 : 0;
  let demAdd = demolition === 'sim' ? (base + matAdd) * 0.1 : 0;
  return {
    base: Math.round(base),
    matAdd: Math.round(matAdd),
    demAdd: Math.round(demAdd),
    total: Math.round(base + matAdd + demAdd)
  };
}

function formatMoney(val, country) {
  const p = PRICES[country] || PRICES.global;
  if (country === 'br') return 'R$ ' + val.toLocaleString('pt-BR');
  return p.symbol + ' ' + val.toLocaleString('en-US');
}

// ─── GERAR PDF ───────────────────────────────────────────────────────────────
async function generatePDF(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const filePath = path.join('/tmp', `orcamento_${Date.now()}.pdf`);
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);

    const GREEN = '#1D9E75';
    const DARK  = '#085041';
    const GRAY  = '#5F5E5A';
    const LIGHT = '#E1F5EE';

    // Cabeçalho
    doc.rect(0, 0, doc.page.width, 80).fill(GREEN);
    doc.fillColor('white').fontSize(22).font('Helvetica-Bold')
       .text('Orçamento de Obra Rápido', 50, 20);
    doc.fontSize(10).font('Helvetica')
       .text('Análise técnica profissional · orcamentodeobrarapido.com', 50, 50);

    doc.moveDown(3);

    // Data
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

    // Escopo
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

    // Custo
    doc.fillColor(GREEN).fontSize(11).font('Helvetica-Bold').text('ESTIMATIVA DE CUSTO');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(GREEN).lineWidth(1).stroke();
    doc.moveDown(0.3);
    doc.fillColor(DARK).fontSize(10).font('Helvetica');
    doc.text(`Custo base (${data.area} m² × ${formatMoney(PRICES[data.country]?.[data.standard] || 1200, data.country)}/m²):  ${formatMoney(data.costs.base, data.country)}`);
    if (data.costs.matAdd > 0)
      doc.text(`Material incluso (+20%):  ${formatMoney(data.costs.matAdd, data.country)}`);
    if (data.costs.demAdd > 0)
      doc.text(`Demolição (+10%):  ${formatMoney(data.costs.demAdd, data.country)}`);

    doc.moveDown(0.5);
    doc.rect(50, doc.y, 495, 36).fill(LIGHT);
    doc.fillColor(DARK).fontSize(13).font('Helvetica-Bold')
       .text(`TOTAL ESTIMADO:  ${formatMoney(data.costs.total, data.country)}`, 60, doc.y - 28);
    doc.moveDown(1.5);

    // Cronograma
    const timeline = TIMELINES[data.service] || TIMELINES.reforma_geral;
    doc.fillColor(GREEN).fontSize(11).font('Helvetica-Bold').text('CRONOGRAMA DE EXECUÇÃO');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(GREEN).lineWidth(1).stroke();
    doc.moveDown(0.3);
    timeline.forEach((step, i) => {
      doc.fillColor(GREEN).fontSize(10).font('Helvetica-Bold').text(`${i + 1}.`, 50, doc.y, { continued: true, width: 20 });
      doc.fillColor(DARK).font('Helvetica').text(` ${step}`);
    });
    doc.moveDown(0.8);

    // Recomendações
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

    // Rodapé
    doc.rect(0, doc.page.height - 45, doc.page.width, 45).fill(GREEN);
    doc.fillColor('white').fontSize(8)
       .text('Este orçamento é uma estimativa baseada em parâmetros médios de mercado (SINAPI/CUB para Brasil). Os valores podem variar conforme condições locais, mão de obra e escopo definitivo. Recomendada vistoria técnica presencial antes da contratação.', 50, doc.page.height - 38, { width: 495, align: 'center' });

    doc.end();
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

// ─── ENVIAR EMAIL ─────────────────────────────────────────────────────────────
async function sendEmail(toEmail, name, pdfPath) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS  // App Password do Gmail
    }
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
          <p>O documento contém:</p>
          <ul>
            <li>✅ Estimativa de custo com base técnica</li>
            <li>📅 Cronograma completo por etapas</li>
            <li>💡 Recomendações do especialista</li>
            <li>⚠️ Alertas de custos adicionais</li>
          </ul>
          <p style="color:#888;font-size:12px">Este orçamento é uma estimativa. Recomendamos vistoria técnica presencial antes da contratação.</p>
          <p>Obrigado pela confiança!</p>
          <p><strong>Equipe Orçamento de Obra Rápido</strong></p>
        </div>
      </div>
    `,
    attachments: [{ filename: 'orcamento-tecnico.pdf', path: pdfPath }]
  });
}

// ─── ENVIAR WHATSAPP (via Z-API) ──────────────────────────────────────────────
async function sendWhatsApp(phone, name, pdfPath) {
  if (!process.env.ZAPI_INSTANCE || !process.env.ZAPI_TOKEN) return;

  // Limpa o número
  const cleanPhone = phone.replace(/\D/g, '');

  // Mensagem de texto
  await axios.post(
    `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}/send-text`,
    { phone: cleanPhone, message: `🏗️ Olá, ${name}! Seu orçamento técnico profissional está pronto. Em instantes você receberá o PDF completo. Qualquer dúvida, estamos à disposição!\n\n— Orçamento de Obra Rápido` }
  );

  // PDF como documento
  const pdfBase64 = fs.readFileSync(pdfPath).toString('base64');
  await axios.post(
    `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE}/token/${process.env.ZAPI_TOKEN}/send-document/pdf`,
    { phone: cleanPhone, document: pdfBase64, fileName: 'orcamento-tecnico.pdf', caption: 'Seu orçamento técnico completo 📄' }
  );
}

// ─── ROTA: CRIAR SESSÃO STRIPE ────────────────────────────────────────────────
app.post('/create-checkout', async (req, res) => {
  try {
    const { name, email, phone, country, service, area, standard, material, demolition, description } = req.body;

    const p = PRICES[country] || PRICES.global;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [{
        price_data: {
          currency: p.currency,
          product_data: {
            name: 'Orçamento Técnico Profissional',
            description: `${SERVICE_LABELS[service] || service} · ${area} m² · Padrão ${standard}`
          },
          unit_amount: p.unlock
        },
        quantity: 1
      }],
      mode: 'payment',
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

// ─── ROTA: WEBHOOK STRIPE (dispara após pagamento confirmado) ─────────────────
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const m = session.metadata;

    const costs = calcValue(m.country, m.standard, parseFloat(m.area), m.material, m.demolition);

    const data = {
      name: m.name,
      email: m.email,
      phone: m.phone,
      country: m.country,
      countryLabel: { br: 'Brasil', us: 'Estados Unidos', eu: 'Europa', global: 'Internacional' }[m.country] || m.country,
      service: m.service,
      serviceLabel: SERVICE_LABELS[m.service] || m.service,
      area: parseFloat(m.area),
      standard: m.standard,
      standardLabel: { basico: 'Básico', medio: 'Médio', alto: 'Alto Padrão' }[m.standard] || m.standard,
      material: m.material,
      demolition: m.demolition,
      description: m.description,
      costs
    };

    try {
      const pdfPath = await generatePDF(data);
      await sendEmail(data.email, data.name, pdfPath);
      if (data.phone) await sendWhatsApp(data.phone, data.name, pdfPath);
      fs.unlinkSync(pdfPath); // Remove PDF temporário
      console.log(`✅ Orçamento entregue para ${data.email}`);
    } catch (err) {
      console.error('Erro na entrega:', err);
    }
  }

  res.json({ received: true });
});

// ─── ROTA: HEALTH CHECK ───────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Servidor rodando na porta ${PORT}`));
