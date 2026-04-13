const state = {
  running: false,
  resultAction: 'reset',
  countries: {},
};

const $ = (selector) => document.querySelector(selector);

const els = {
  amount: $('#amount'),
  country: $('#country'),
  currency: $('#currency'),
  scenario: $('#scenario'),
  recipient: $('#recipient'),
  message: $('#message'),
  yapearButton: $('#yapearButton'),
  resetButton: $('#resetButton'),
  consoleOutput: $('#consoleOutput'),
  eventInspector: $('#eventInspector'),
  healthGrid: $('#healthGrid'),
  timeline: $('#timeline'),
  serviceMap: $('#serviceMap'),
  narratorText: $('#narratorText'),
  dbEvidence: $('#dbEvidence'),
  countryAvailability: $('#countryAvailability'),
  paymentForm: $('#paymentForm'),
  phoneResult: $('#phoneResult'),
  phoneResultIcon: $('#phoneResultIcon'),
  phoneResultKicker: $('#phoneResultKicker'),
  phoneResultTitle: $('#phoneResultTitle'),
  phoneResultAmount: $('#phoneResultAmount'),
  phoneResultMeta: $('#phoneResultMeta'),
  phoneResultDetail: $('#phoneResultDetail'),
  phoneResultButton: $('#phoneResultButton'),
};

const currencySymbols = {
  PEN: 'S/',
  MXN: '$',
  USD: 'US$',
  COP: '$',
  CLP: '$',
  ARS: '$',
  BRL: 'R$',
};

const services = {
  api: { title: 'Payment API', subtitle: 'Recibe el yape', state: 'waiting', detail: 'Esperando request' },
  outbox: { title: 'Outbox DB', subtitle: 'Commit local', state: 'waiting', detail: 'payment + outbox en una transaccion' },
  relay: { title: 'Outbox Relay', subtitle: 'Publicador separado', state: 'waiting', detail: 'Kafka se llama despues del commit' },
  kafka: { title: 'Kafka Topic', subtitle: 'Eventos por pais', state: 'waiting', detail: 'pe.payments.* / mx.payments.*' },
  fraud: { title: 'Fraud Consumer', subtitle: 'Riesgo independiente', state: 'waiting', detail: 'Idempotente por eventId' },
  ledger: { title: 'Ledger Consumer', subtitle: 'Doble entrada', state: 'waiting', detail: 'Aislado por pais' },
  saga: { title: 'Status Saga', subtitle: 'Consistencia eventual', state: 'waiting', detail: 'Cierra settled o failed' },
  dlt: { title: 'DLT', subtitle: 'Fallos irreparables', state: 'waiting', detail: 'No se pierden mensajes agotados' },
};

function appendConsole(line, level = 'info') {
  const prefix = {
    info: 'INFO ',
    ok: 'OK   ',
    warn: 'WARN ',
    error: 'ERR  ',
  }[level] || 'INFO ';

  els.consoleOutput.textContent += `\n${new Date().toLocaleTimeString()} ${prefix}${line}`;
  els.consoleOutput.scrollTop = els.consoleOutput.scrollHeight;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function prettyJson(value) {
  if (value === null || value === undefined) {
    return 'null';
  }

  return escapeHtml(JSON.stringify(value, null, 2));
}

function moneyLabel() {
  const currency = els.currency.value;
  const amount = Number(els.amount.value || 0).toFixed(2);
  return `${currencySymbols[currency] || currency} ${amount}`;
}

function showPaymentForm() {
  els.paymentForm.classList.remove('hidden');
  els.phoneResult.classList.add('hidden');
}

function showPhoneState({ status, title, detail, action }) {
  const labels = {
    processing: 'Procesando',
    success: 'Yape exitoso',
    failed: 'No completado',
    pending: 'En proceso',
  };
  const icons = {
    processing: '...',
    success: 'OK',
    failed: '!',
    pending: '...',
  };

  state.resultAction = action || 'reset';
  els.paymentForm.classList.add('hidden');
  els.phoneResult.className = `phone-result ${status || 'processing'}`;
  els.phoneResultIcon.className = `result-icon ${status || 'processing'}`;
  els.phoneResultIcon.textContent = icons[status] || '...';
  els.phoneResultKicker.textContent = labels[status] || 'Procesando';
  els.phoneResultTitle.textContent = title || 'Procesando tu yape';
  els.phoneResultAmount.textContent = moneyLabel();
  els.phoneResultMeta.textContent = `${els.country.value.toUpperCase()} · ${els.currency.value}`;
  els.phoneResultDetail.textContent = detail || `Para ${els.recipient.value}`;
  els.phoneResultButton.textContent = action === 'retry' ? 'Reintentar' : status === 'processing' ? 'Procesando...' : 'Volver a yapear';
  els.phoneResultButton.disabled = status === 'processing';
}

function resetTimeline() {
  els.timeline.querySelectorAll('[data-step]').forEach((node) => {
    node.className = '';
  });
}

function renderServices() {
  els.serviceMap.innerHTML = Object.entries(services)
    .map(([key, service]) => `
      <article class="service-card ${service.state}" data-service="${key}">
        <strong>${service.title}</strong>
        <span>${service.subtitle}</span>
        <p>${service.detail}</p>
      </article>
    `)
    .join('');
}

function setService(service, state, detail) {
  if (!services[service]) return;
  services[service].state = state || services[service].state;
  services[service].detail = detail || services[service].detail;
  renderServices();
}

function setStep(step, status) {
  const node = els.timeline.querySelector(`[data-step="${step}"]`);
  if (!node) return;
  node.className = status;
}

function resetDemo() {
  els.consoleOutput.textContent = 'Listo para yapear...';
  els.eventInspector.textContent = '{}';
  els.dbEvidence.innerHTML = '<article class="db-empty">Ejecuta un escenario para ver payments, outbox_events, payment_steps y processed_events.</article>';
  els.narratorText.textContent = 'Elige un escenario y presiona Yapear.';
  state.resultAction = 'reset';
  els.phoneResultButton.disabled = false;
  showPaymentForm();
  resetTimeline();
  Object.keys(services).forEach((key) => {
    services[key].state = 'waiting';
  });
  renderServices();
}

function renderDbList(title, rows, emptyMessage) {
  const content = rows && rows.length
    ? rows.map((row) => `<pre>${prettyJson(row)}</pre>`).join('')
    : `<p class="muted-row">${escapeHtml(emptyMessage)}</p>`;

  return `
    <article class="db-card">
      <strong>${escapeHtml(title)}</strong>
      ${content}
    </article>
  `;
}

function renderDbObject(title, value, emptyMessage) {
  return renderDbList(title, value ? [value] : [], emptyMessage);
}

function renderDbSnapshot(snapshot) {
  const summary = (snapshot.summary || [])
    .map((item) => `<span>${escapeHtml(item)}</span>`)
    .join('');

  els.dbEvidence.innerHTML = `
    <div class="db-stage">
      <strong>${escapeHtml(snapshot.stage || 'DB snapshot')}</strong>
      <p>${escapeHtml(snapshot.note || 'Snapshot de evidencia persistida.')}</p>
      <div class="db-summary">${summary}</div>
    </div>
    <div class="db-grid">
      ${renderDbObject('payments', snapshot.payment, 'Sin fila payment para este escenario.')}
      ${renderDbObject('payment_steps', snapshot.paymentStep, 'Todavia no hay ACK persistido de fraud/ledger.')}
      ${renderDbList('outbox_events', snapshot.outboxEvents, 'Sin outbox asociado.')}
      ${renderDbList('processed_events', snapshot.processedEvents, 'Aun no hay marcas idempotentes de consumers.')}
    </div>
  `;
}

function statusClass(status) {
  return status === 'running' ? 'running' : status === 'missing' || status === 'exited' ? status : '';
}

function healthItem(name, status) {
  return `<div class="health-item ${statusClass(status)}"><strong>${name}</strong><span>${status}</span></div>`;
}

function availabilityClass(status) {
  return status === 'available' ? 'available' : status === 'missing' ? 'missing' : 'degraded';
}

function renderCountryAvailability() {
  const countries = Object.entries(state.countries);
  if (!countries.length) {
    els.countryAvailability.innerHTML = '';
    return;
  }

  els.countryAvailability.innerHTML = countries
    .map(([country, info]) => `
      <article class="country-card ${availabilityClass(info.availability)}" data-country-card="${country}">
        <strong>${country.toUpperCase()}</strong>
        <span>${escapeHtml(info.availability || 'unknown')}</span>
        <p>${escapeHtml(info.detail || `currency=${info.currency || 'N/A'}, ledger=${info.ledgerConsumer || 'unknown'}, saga=${info.statusSaga || 'unknown'}`)}</p>
      </article>
    `)
    .join('');
}

function syncCountryOptions(countries) {
  const previous = els.country.value;
  const entries = Object.entries(countries);
  if (!entries.length) return;

  els.country.innerHTML = entries
    .map(([country, info]) => `<option value="${country}">${country.toUpperCase()} - ${escapeHtml(info.currency || '')}</option>`)
    .join('');

  els.country.value = countries[previous] ? previous : entries[0][0];
  syncCurrency();
}

function setCountryAvailability(country, availability, detail) {
  const normalized = String(country || '').toLowerCase();
  if (!normalized) return;

  state.countries[normalized] = {
    ...(state.countries[normalized] || {}),
    availability,
    detail,
  };
  renderCountryAvailability();
}

async function loadHealth() {
  try {
    const res = await fetch('/api/health');
    const health = await res.json();
    state.countries = health.countries || {};
    syncCountryOptions(state.countries);
    renderCountryAvailability();

    const countryHealth = Object.entries(state.countries).flatMap(([country, info]) => [
      healthItem(`${country.toUpperCase()} Ledger`, info.ledgerConsumer),
      healthItem(`${country.toUpperCase()} Saga`, info.statusSaga),
    ]);

    els.healthGrid.innerHTML = [
      healthItem('Payment API', health.paymentApi),
      healthItem('Kafka', health.kafka),
      healthItem('Outbox Relay', health.outboxRelay),
      healthItem('Fraud', health.fraudConsumer),
      ...countryHealth,
    ].join('');
  } catch (error) {
    els.healthGrid.innerHTML = healthItem('Health', 'unavailable');
  }
}

function syncCurrency() {
  const country = els.country.value;
  const currency = state.countries[country]?.currency || (country === 'mx' ? 'MXN' : 'PEN');

  if (!Array.from(els.currency.options).some((option) => option.value === currency)) {
    const option = document.createElement('option');
    option.value = currency;
    option.textContent = currencySymbols[currency] || currency;
    els.currency.appendChild(option);
  }

  els.currency.value = currency;
}

function applyScenarioDefaults() {
  const scenario = els.scenario.value;
  if (scenario === 'fraud-rejected') {
    els.amount.value = '1500';
  }
  if (scenario === 'mx-outage-pe-available') {
    els.country.value = 'pe';
    syncCurrency();
  }
  if ((scenario === 'success' || scenario === 'idempotency-replay' || scenario === 'country-isolation' || scenario === 'mx-outage-pe-available') && Number(els.amount.value) > 500) {
    els.amount.value = '25';
  }
}

async function runScenario() {
  if (state.running) return;

  state.running = true;
  els.yapearButton.disabled = true;
  resetDemo();
  syncCurrency();
  applyScenarioDefaults();
  showPhoneState({
    status: 'processing',
    title: 'Procesando tu yape',
    detail: 'Estamos creando el pago y esperando confirmacion del pipeline.',
    action: 'none',
  });

  appendConsole(`Iniciando escenario ${els.scenario.value} para ${els.country.value.toUpperCase()}`, 'info');

  const payload = {
    scenario: els.scenario.value,
    country: els.country.value,
    currency: els.currency.value,
    amount: Number(els.amount.value),
    walletId: `visual-${els.country.value}-${Date.now()}`,
    recipient: els.recipient.value,
    message: els.message.value,
  };

  try {
    const response = await fetch('/api/scenario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.body) {
      throw new Error('El navegador no pudo abrir el stream de eventos.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() || '';

      for (const chunk of chunks) {
        const line = chunk.split('\n').find((part) => part.startsWith('data: '));
        if (!line) continue;

        const event = JSON.parse(line.slice(6));
        handleEvent(event);
      }
    }
  } catch (error) {
    appendConsole(error.message || String(error), 'error');
    showPhoneState({
      status: 'failed',
      title: 'No pudimos completar tu yape',
      detail: error.message || String(error),
      action: 'retry',
    });
  } finally {
    state.running = false;
    els.yapearButton.disabled = false;
    await loadHealth();
  }
}

function handleEvent(event) {
  if (event.type === 'step') {
    setStep(event.step, event.status);
    return;
  }

  if (event.type === 'service') {
    setService(event.service, event.status, event.detail);
    return;
  }

  if (event.type === 'narrative') {
    els.narratorText.textContent = event.message;
    appendConsole(event.message, event.level || 'info');
    return;
  }

  if (event.type === 'phone-state') {
    showPhoneState(event);
    return;
  }

  if (event.type === 'country-status') {
    setCountryAvailability(event.country, event.availability, event.detail);
    appendConsole(`${String(event.country || '').toUpperCase()} availability=${event.availability}: ${event.detail}`, event.availability === 'available' ? 'ok' : 'warn');
    return;
  }

  if (event.type === 'outbox') {
    setService('outbox', event.status === 'published' ? 'ok' : 'running', `status=${event.status}, attempts=${event.attempts}, topic=${event.topic}`);
    appendConsole(`Outbox ${event.status} attempts=${event.attempts} topic=${event.topic}`, event.status === 'published' ? 'ok' : 'info');
    return;
  }

  if (event.type === 'idempotency') {
    appendConsole(event.message, event.level || 'ok');
    setService('fraud', 'ok', event.fraud || 'duplicate ignored');
    setService('ledger', 'ok', event.ledger || 'duplicate ignored');
    els.eventInspector.textContent = JSON.stringify(event.rows || [], null, 2);
    return;
  }

  if (event.type === 'db-snapshot') {
    renderDbSnapshot(event.snapshot);
    appendConsole(`DB snapshot: ${event.snapshot.stage}`, 'ok');
    return;
  }

  if (event.type === 'kafka-event') {
    appendConsole(`${event.topic}`, event.level);
    els.eventInspector.textContent = JSON.stringify(event.event, null, 2);
    return;
  }

  if (event.type === 'status') {
    appendConsole(`${event.message} ${JSON.stringify(event.status)}`, event.level);
    return;
  }

  if (event.type === 'summary') {
    appendConsole(event.message, event.level);
    return;
  }

  if (event.type === 'done') {
    appendConsole('Escenario finalizado.', 'ok');
    return;
  }

  appendConsole(event.message || JSON.stringify(event), event.level || 'info');
}

els.yapearButton.addEventListener('click', runScenario);
els.resetButton.addEventListener('click', resetDemo);
els.phoneResultButton.addEventListener('click', () => {
  if (state.resultAction === 'retry') {
    resetDemo();
    runScenario();
    return;
  }

  resetDemo();
});
els.country.addEventListener('change', syncCurrency);
els.scenario.addEventListener('change', applyScenarioDefaults);

loadHealth();
renderServices();
setInterval(loadHealth, 8000);
