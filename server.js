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

// ─── ANÁLISE IA COM GEMINI (PROMPT ATUALIZADO) ────────────────────────────────
async function analisarComIA(data) {
  const { service, area, standard, material, demolition, description, photos, pdf } = data;
  const temMidia = (photos && photos.length > 0) || pdf;

  const prompt = `Você é um engenheiro civil especialista em elaboração de orçamentos técnicos detalhados para obras comerciais e residenciais no Brasil.
Sua função é gerar um orçamento técnico extremamente profissional, detalhado e organizado, transmitindo credibilidade e alto valor percebido ao cliente final.
O orçamento deve ser escrito em português do Brasil, com linguagem técnica profissional, clara e objetiva.

REGRAS IMPORTANTES:
1. Nunca gere respostas curtas ou genéricas.
2. Sempre detalhe cada etapa da obra individualmente.
3. Explique tecnicamente os serviços que serão executados.
4. Descreva materiais, mão de obra e finalidade de cada etapa.
5. Gere um orçamento com aparência profissional semelhante aos elaborados por empresas de engenharia.
6. O texto deve passar sensação de análise técnica personalizada.
7. Sempre considere boas práticas de engenharia civil.
8. Utilize estrutura organizada com títulos e subtítulos.
9. O orçamento deve parecer elaborado manualmente por um especialista.
10. Sempre aumentar o nível de detalhamento conforme a complexidade da obra.

DADOS DA OBRA PARA GERAR O ORÇAMENTO:
- Cliente: ${data.name || 'Não informado'}
- Tipo de serviço: ${SERVICE_LABELS[service] || service}
- Área aproximada: ${area} m²
- Padrão da obra: ${standard}
- Material incluso: ${material === 'sim' ? 'Sim' : 'Não'}
- Demolição inclusa: ${demolition === 'sim' ? 'Sim' : 'Não'}
- Objetivo da reforma / Descrição do cliente: ${description || 'Não informada'}
${temMidia ? '- Arquivos enviados: analisados acima (fotos/PDF do local da obra)' : ''}

Responda APENAS com um JSON válido, sem texto adicional, sem markdown, com EXATAMENTE esta estrutura:
{
  "analise_tecnica_inicial": "Faça uma análise técnica descritiva e robusta (3-5 frases) explicando: condições gerais da obra, necessidades estruturais, adaptações necessárias, possíveis desafios técnicos e cuidados específicos para execução com base nas características do ambiente.",
  "alertas": [
    "Alerta técnico detalhado 1 — descrever o problema e consequência",
    "Alerta técnico detalhado 2 — descrever o problema e consequência"
  ],
  "escopo_detalhado": {
    "demolicoes_preparacao": "Descrever detalhadamente remoções, descarte de entulho legalizado, proteção de áreas e preparação do ambiente.",
    "alvenaria_adequacoes": "Descrever detalhadamente construção ou remoção de paredes, regularizações, reforços estruturais e fechamentos.",
    "instalacoes_eletricas": "Descrever detalhadamente novos pontos, iluminação, tomadas, quadro elétrico, infraestrutura técnica e normas técnicas aplicáveis (ex: NBR 5410).",
    "instalacoes_hidraulicas": "Descrever detalhadamente pontos de água, esgoto, tubulações e adequações sanitárias necessárias.",
    "revestimentos_acabamentos": "Descrever detalhadamente a execução de pisos, paredes, forros, pintura técnica e acabamento final.",
    "limpeza_tecnica_entrega": "Descrever detalhadamente o processo de limpeza pós-obra, testes finais de funcionamento, conferência técnica e entrega oficial do ambiente."
  },
  "cronograma_previsional": [
    {
      "etapa": "Nome da etapa do escopo",
      "prazo_estimado": "X dias",
      "sequencia_executiva": "Explicação detalhada sobre a sequência de execução e dependência técnica entre os serviços desta fase."
    }
  ],
  "recomendacoes_tecnicas": [
    "Recomendação profissional sobre acompanhamento técnico / Emissão de ART ou RRT.",
    "Recomendação sobre normas de segurança do trabalho e EPIs.",
    "Recomendação sobre compatibilização de projetos e controle de qualidade dos materiais."
  ],
  "consideracoes_finais": "Texto profissional robusto reforçando a importância da vistoria técnica presencial, a possibilidade de ajustes finos após a visita técnica, variações de custos conforme escolhas de acabamento e a necessidade de um levantamento executivo completo."
}

REGRAS ADICIONAIS DE CONTEÚDO:
- Se houver infiltração, mofo, trincas, descascamento nas fotos — cite e detalhe o tratamento específico.
- Forneça descrições técnicas reais e profissionais em cada uma das chaves do escopo — nunca use termos genéricos.
- Responda APENAS o JSON válido para evitar quebras de sistema.`;

  const parts = [];

  if (photos && photos.length > 0) {
    photos.forEach(photo => {
      parts.push({ inline_data: { mime_type: photo.mediaType, data: photo.base64 } });
    });
  }

  if (pdf) {
    parts.push({ inline_data: { mime_type: 'application/pdf', data: pdf.base64 } });
  }

  parts.push({ text: prompt });

  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      { contents: [{ parts }], generationConfig: { temperature: 0.3, maxOutputTokens: 2500 } },
      { timeout: 60000 }
    );

    const text = response.data.candidates[0].content.parts[0].text.trim();
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const result = JSON.parse(clean);
    console.log('✅ Análise IA concluída com Gemini no novo formato');
    return result;

  } catch (err) {
    console.error('Erro na análise Gemini, aplicando Fallback estruturado:', err.message);
    return {
      analise_tecnica_inicial: `Projeto de ${SERVICE_LABELS[service] || service} em área de ${area} m², padrão ${standard}. Condições gerais avaliadas com base nas informações preliminares fornecidas pelo cliente.`,
      alertas: ['Verifique a necessidade de impermeabilização regulamentar antes de iniciar.'],
      escopo_detalhado: {
        demolicoes_preparacao: "Remoção de entulhos superficiais, isolamento e proteção das áreas limítrofes da intervenção.",
        alvenaria_adequacoes: "Regularização de superfícies e reparos estruturais preliminares conforme a demanda padrão.",
        instalacoes_eletricas: "Revisão e adequação técnica de pontos de energia respeitando as normas vigentes de segurança.",
        instalacoes_hidraulicas: "Mapeamento e teste de estanqueidade em ramais internos de água e esgoto.",
        revestimentos_acabamentos: "Preparação de substrato seguido da aplicação de revestimentos e pintura técnica de acabamento.",
        limpeza_tecnica_entrega: "Limpeza fina pós-obra, remoção de resíduos técnicos e vistoria de entrega."
      },
      cronograma_previsional: [
        { etapa: 'Preparação e Infraestrutura', prazo_estimado: '3 dias', sequencia_executiva: 'Início imediato após liberação técnica da área.' },
        { etapa: 'Acabamentos e Testes', prazo_estimado: '5 dias', sequencia_executiva: 'Depende diretamente da finalização e cura das etapas de infraestrutura.' }
      ],
      recomendacoes_tecnicas: [
        'É altamente recomendada a emissão de ART/RRT antes do início da execução.',
        'Assegurar o cumprimento das normas de segurança e uso de EPIs.'
      ],
      consideracoes_finais: "Este documento constitui uma estimativa de viabilidade técnica. Mudanças finas de acabamento ou surpresas estruturais pós-demolição podem gerar variações de escopo. Essencial vistoria presencial."
    };
  }
}

// ─── GERAR PDF (MOLDE ADAPTADO PARA A NOVA ESTRUTURA) ─────────────────────────
async function generatePDF(data, escopo) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const filePath = path.join('/tmp', `orcamento_${Date.now()}.pdf`);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const GREEN = '#1D9E75', DARK = '#085041', GRAY = '#5F5E5A', LIGHT = '#E1F5EE';

    // Cabeçalho Principal
    doc.rect(0, 0, doc.page.width, 80).fill(GREEN);
    doc.fillColor('white').fontSize(22).font('Helvetica-Bold').text('ORÇAMENTO TÉCNICO DE OBRA', 50, 20);
    doc.fontSize(10).font('Helvetica').text('Análise Técnica Personalizada · Engenharia Especializada', 50, 50);
    doc.moveDown(3);
    doc.fillColor(GRAY).fontSize(9).text('Data de emissão: ' + new Date().toLocaleDateString('pt-BR'), { align: 'right' });
    doc.moveDown(0.5);

    // 1. DADOS GERAIS DA OBRA
    doc.fillColor(GREEN).fontSize(12).font('Helvetica-Bold').text('1. DADOS GERAIS DA OBRA');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(GREEN).lineWidth(1).stroke();
    doc.moveDown(0.4);
    doc.fillColor(DARK).fontSize(10).font('Helvetica');
    doc.text(`• Cliente Final: ${data.name}`);
    doc.text(`• Tipo de Serviço: ${data.serviceLabel}`);
    doc.text(`• Área Aproximada: ${data.area} m²`);
    doc.text(`• Padrão da Obra: ${data.standardLabel}`);
    doc.text(`• Inclusão de Materiais: ${data.material === 'sim' ? 'Sim (Inclusos)' : 'Não (Apenas Mão de Obra)'}`);
    doc.text(`• Demolição Inclusa: ${data.demolition === 'sim' ? 'Sim' : 'Não'}`);
    if (data.description) {
      doc.text(`• Características / Objetivo: ${data.description}`, { width: 495 });
    }
    doc.moveDown(1);

    // 2. ANÁLISE TÉCNICA INICIAL
    if (doc.y > 650) doc.addPage();
    doc.fillColor(GREEN).fontSize(12).font('Helvetica-Bold').text('2. ANÁLISE TÉCNICA INICIAL');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(GREEN).lineWidth(1).stroke();
    doc.moveDown(0.4);
    doc.fillColor(DARK).fontSize(10).font('Helvetica').text(escopo.analise_tecnica_inicial, { width: 495, align: 'justify' });
    doc.moveDown(0.8);

    // Alertas Técnicos (Se houver)
    if (escopo.alertas && escopo.alertas.length > 0) {
      doc.fillColor('#856404').fontSize(10).font('Helvetica-Bold').text('⚠ ALERTAS TÉCNICOS IDENTIFICADOS:');
      escopo.alertas.forEach(alerta => {
        doc.fillColor('#856404').font('Helvetica').text(`  - ${alerta}`, { width: 495 });
      });
      doc.moveDown(0.8);
    }

    // 3. ESCOPO DETALHADO DOS SERVIÇOS
    if (doc.y > 600) doc.addPage();
    doc.fillColor(GREEN).fontSize(12).font('Helvetica-Bold').text('3. ESCOPO DETALHADO DOS SERVIÇOS');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(GREEN).lineWidth(1).stroke();
    doc.moveDown(0.4);

    const esc = escopo.escopo_detalhado || {};
    doc.fontSize(10).fillColor(DARK);
    
    doc.font('Helvetica-Bold').text('3.1 Demolições e Preparação do Ambiente');
    doc.font('Helvetica').text(esc.demolicoes_preparacao || 'Não aplicável para este escopo.', { width: 495, indent: 10 });
    doc.moveDown(0.4);

    doc.font('Helvetica-Bold').text('3.2 Alvenaria e Adequações Estruturais');
    doc.font('Helvetica').text(esc.alvenaria_adequacoes || 'Não aplicável para este escopo.', { width: 495, indent: 10 });
    doc.moveDown(0.4);

    if (doc.y > 680) doc.addPage();
    doc.font('Helvetica-Bold').text('3.3 Instalações Elétricas e Infraestrutura');
    doc.font('Helvetica').text(esc.instalacoes_eletricas || 'Não aplicável para este escopo.', { width: 495, indent: 10 });
    doc.moveDown(0.4);

    doc.font('Helvetica-Bold').text('3.4 Instalações Hidráulicas e Sanitárias');
    doc.font('Helvetica').text(esc.instalacoes_hidraulicas || 'Não aplicável para este escopo.', { width: 495, indent: 10 });
    doc.moveDown(0.4);

    if (doc.y > 680) doc.addPage();
    doc.font('Helvetica-Bold').text('3.5 Revestimentos e Acabamentos');
    doc.font('Helvetica').text(esc.revestimentos_acabamentos || 'Não aplicável para este escopo.', { width: 495, indent: 10 });
    doc.moveDown(0.4);

    doc.font('Helvetica-Bold').text('3.6 Limpeza Técnica e Entrega');
    doc.font('Helvetica').text(esc.limpeza_tecnica_entrega || 'Processo padrão de pós-obra e testes operacionais.', { width: 495, indent: 10 });
    doc.moveDown(1);

    // 4. ESTIMATIVA FINANCEIRA DETALHADA
    if (doc.y > 550) doc.addPage();
    doc.fillColor(GREEN).fontSize(12).font('Helvetica-Bold').text('4. ESTIMATIVA FINANCEIRA PREVISTA');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(GREEN).lineWidth(1).stroke();
    doc.moveDown(0.4);
    doc.fillColor(DARK).fontSize(10).font('Helvetica');
    
    doc.text(`• Custo Técnico Base (Mão de Obra): ${formatMoney(data.costs.base, data.country)}`);
    if (data.costs.matAdd > 0) doc.text(`• Insumos / Materiais Diretos (+20%): ${formatMoney(data.costs.matAdd, data.country)}`);
    if (data.costs.demAdd > 0) doc.text(`• Complexidade Adicional de Demolição (+10%): ${formatMoney(data.costs.demAdd, data.country)}`);
    doc.text(`• Percentual de BDI Estimado e Taxas: Incluso nas margens de referência.`);
    doc.moveDown(0.5);

    const totalY = doc.y;
    doc.rect(50, totalY, 495, 36).fill(LIGHT);
    doc.fillColor(DARK).fontSize(12).font('Helvetica-Bold')
       .text(`VALOR TOTAL ESTIMADO DA OBRA:  ${formatMoney(data.costs.total, data.country)}`, 60, totalY + 12, { width: 475 });
    doc.moveDown(2);

    // 5. CRONOGRAMA PREVISIONAL
    if (doc.y > 600) doc.addPage();
    doc.fillColor(GREEN).fontSize(12).font('Helvetica-Bold').text('5. CRONOGRAMA PREVISIONAL DE EXECUÇÃO');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(GREEN).lineWidth(1).stroke();
    doc.moveDown(0.4);
    if (escopo.cronograma_previsional && escopo.cronograma_previsional.length > 0) {
      escopo.cronograma_previsional.forEach(cron => {
        doc.fillColor(DARK).font('Helvetica-Bold').fontSize(10).text(`• ${cron.etapa} — Prazo: ${cron.prazo_estimated || cron.prazo_estimado || 'A definir'}`);
        doc.font('Helvetica').fontSize(9).text(`  Logística: ${cron.sequencia_executiva}`, { width: 480 });
        doc.moveDown(0.3);
      });
    } else {
      doc.text('Cronograma sequencial padrão estimado em 8 a 15 dias úteis com base na metragem fornecida.');
    }
    doc.moveDown(0.8);

    // 6. RECOMENDAÇÕES TÉCNICAS
    if (doc.y > 600) doc.addPage();
    doc.fillColor(GREEN).fontSize(12).font('Helvetica-Bold').text('6. RECOMENDAÇÕES TÉCNICAS PROFISSIONAIS');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(GREEN).lineWidth(1).stroke();
    doc.moveDown(0.4);
    doc.fillColor(DARK).fontSize(10).font('Helvetica');
    if (escopo.recomendacoes_tecnicas && escopo.recomendacoes_tecnicas.length > 0) {
      escopo.recomendacoes_tecnicas.forEach(rec => {
        doc.text(`• ${rec}`, { width: 495 });
        doc.moveDown(0.2);
      });
    } else {
      doc.text('• Providenciar emissão de ART ou RRT junto aos conselhos de classe (CREA/CAU).\n• Certificar o uso correto de EPIs.\n• Executar compatibilização fina de projetos.');
    }
    doc.moveDown(0.8);

    // 7. CONSIDERAÇÕES FINAIS
    if (doc.y > 600) doc.addPage();
    doc.fillColor(GREEN).fontSize(12).font('Helvetica-Bold').text('7. CONSIDERAÇÕES FINAIS');
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(GREEN).lineWidth(1).stroke();
    doc.moveDown(0.4);
    doc.fillColor(DARK).fontSize(10).font('Helvetica').text(escopo.consideracoes_finais || 'Este orçamento considera tabelas de custos de referência padrão (SINAPI/CUB). Mudanças nos padrões de acabamento escolhidos pelo comprador impactam diretamente o valor real de aquisição.', { width: 495, align: 'justify' });

    // Rodapé
    doc.rect(0, doc.page.height - 40, doc.page.width, 40).fill(GREEN);
    doc.fillColor('white').fontSize(7.5)
       .text('Este documento constitui uma estimativa de custos paramétrica. Indispensável a realização de vistoria em campo e elaboração do projeto executivo final antes da contratação dos serviços.', 50, doc.page.height - 32, { width: 495, align: 'center' });

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
          <p>Seu orçamento técnico profissional completo foi gerado e segue em anexo em formato PDF oficial.</p>
          <ul>
            <li>✅ 1. Dados Gerais e Parâmetros</li>
            <li>📊 2. Análise Técnica Inicial</li>
            <li>🧱 3. Escopo Detalhado (Subitens Técnicos)</li>
            <li>💰 4. Estimativa Financeira Paramétrica</li>
            <li>📅 5. Cronograma Executivo e Recomendações</li>
          </ul>
          <p style="color:#888;font-size:12px">Este orçamento é estruturado de forma automatizada por inteligência artificial avançada.</p>
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
