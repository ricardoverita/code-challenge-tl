const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PORT = Number(process.env.PORT || 4000);
const PAYMENT_API_URL = process.env.PAYMENT_API_URL || 'http://payment-api:3000';
const KAFKA_CONTAINER = process.env.KAFKA_CONTAINER || 'yape-kafka';
const POSTGRES_CONTAINER = process.env.POSTGRES_CONTAINER || 'yape-postgres';
const DB_USER = process.env.DB_USER || 'postgres';
const DB_PASSWORD = process.env.DB_PASSWORD || 'postgres';
const DB_NAME = process.env.DB_NAME || 'yape';
const PUBLIC_DIR = path.join(__dirname, 'public');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const TOPIC_SUFFIXES = [
  'payment.created.v1',
  'fraud.assessed.v1',
  'ledger.posted.v1',
  'payment.settled.v1',
  'payment.failed.v1',
  'payment.created.v1.dlt',
  'fraud.assessed.v1.dlt',
  'ledger.posted.v1.dlt',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      resolve({ code: 1, stdout, stderr: error.message });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

async function containerStatus(name) {
  const result = await run('docker', ['inspect', '-f', '{{.State.Status}}', name]);
  if (result.code !== 0) {
    return 'missing';
  }

  return result.stdout.trim() || 'unknown';
}

async function countryContainerId(country, service) {
  const result = await run('docker', [
    'ps',
    '-a',
    '--filter',
    `label=com.docker.compose.project=yape-${country}`,
    '--filter',
    `label=com.docker.compose.service=${service}`,
    '--format',
    '{{.ID}}',
  ]);

  return result.stdout.trim().split('\n').filter(Boolean)[0] || '';
}

async function countryServiceStatus(country, service) {
  const id = await countryContainerId(country, service);
  if (!id) {
    return 'missing';
  }

  const result = await run('docker', ['inspect', '-f', '{{.State.Status}}', id]);
  return result.code === 0 ? result.stdout.trim() : 'unknown';
}

async function countryServiceEnv(country, service, key) {
  const id = await countryContainerId(country, service);
  if (!id) {
    return '';
  }

  const result = await run('docker', [
    'inspect',
    '-f',
    `{{range .Config.Env}}{{println .}}{{end}}`,
    id,
  ]);

  if (result.code !== 0) {
    return '';
  }

  const prefix = `${key}=`;
  const line = result.stdout
    .split('\n')
    .find((entry) => entry.startsWith(prefix));

  return line ? line.slice(prefix.length).trim() : '';
}

async function countryCurrency(country) {
  const fromLedger = await countryServiceEnv(country, 'ledger-consumer', 'COUNTRY_CURRENCY');
  const fromSaga = fromLedger || (await countryServiceEnv(country, 'status-saga', 'COUNTRY_CURRENCY'));
  return fromSaga || defaultCurrencyForCountry(country);
}

function availabilityFrom(ledgerStatus, sagaStatus) {
  if (ledgerStatus === 'running' && sagaStatus === 'running') {
    return 'available';
  }
  if (ledgerStatus === 'missing' && sagaStatus === 'missing') {
    return 'missing';
  }
  return 'degraded';
}

async function stopCountryService(country, service) {
  const id = await countryContainerId(country, service);
  if (!id) {
    throw new Error(`${service} container for ${country} was not found`);
  }

  await run('docker', ['stop', id]);
}

async function startCountryService(country, service) {
  const id = await countryContainerId(country, service);
  if (!id) {
    throw new Error(`${service} container for ${country} was not found`);
  }

  await run('docker', ['start', id]);
}

async function health() {
  const [api, kafka, relay, fraud] = await Promise.all([
    containerStatus('yape-payment-api'),
    containerStatus(KAFKA_CONTAINER),
    containerStatus('yape-outbox-relay'),
    containerStatus('yape-fraud-consumer'),
  ]);

  const countries = {};
  for (const country of supportedCountries()) {
    const [ledgerConsumer, statusSaga, currency] = await Promise.all([
      countryServiceStatus(country, 'ledger-consumer'),
      countryServiceStatus(country, 'status-saga'),
      countryCurrency(country),
    ]);

    countries[country] = {
      currency,
      ledgerConsumer,
      statusSaga,
      availability: availabilityFrom(ledgerConsumer, statusSaga),
    };
  }

  return {
    paymentApi: api,
    kafka,
    outboxRelay: relay,
    fraudConsumer: fraud,
    countries,
  };
}

function topic(country, suffix) {
  return `${country}.payments.${suffix}`;
}

function paymentIdFromEvent(event) {
  return event?.payload?.paymentId || event?.aggregateId || '';
}

function normalizeCountry(country) {
  return String(country || 'pe').trim().toLowerCase();
}

function supportedCountries() {
  return String(process.env.SUPPORTED_COUNTRIES || 'pe,mx')
    .split(',')
    .map((country) => normalizeCountry(country))
    .filter((country) => /^[a-z]{2}$/.test(country));
}

function defaultCurrencyForCountry(country) {
  return {
    pe: 'PEN',
    mx: 'MXN',
    co: 'COP',
    cl: 'CLP',
    ar: 'ARS',
    br: 'BRL',
    ec: 'USD',
  }[country] || country.toUpperCase();
}

function writeEvent(res, event) {
  res.write(`data: ${JSON.stringify({ at: new Date().toISOString(), ...event })}\n\n`);
}

function serviceEvent(service, status, detail) {
  return { type: 'service', service, status, detail };
}

function narrative(message, level = 'info') {
  return { type: 'narrative', level, message };
}

function phoneState(status, title, detail, action = 'reset') {
  return { type: 'phone-state', status, title, detail, action };
}

async function psql(query) {
  const result = await run('docker', [
    'exec',
    '-e',
    `PGPASSWORD=${DB_PASSWORD}`,
    POSTGRES_CONTAINER,
    'psql',
    '-U',
    DB_USER,
    '-d',
    DB_NAME,
    '-t',
    '-A',
    '-F',
    '|',
    '-c',
    query,
  ]);

  if (result.code !== 0) {
    throw new Error(`psql failed: ${result.stderr || result.stdout}`);
  }

  return result.stdout.trim();
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function psqlJson(query, fallback) {
  const raw = await psql(query);
  if (!raw) {
    return fallback;
  }

  return JSON.parse(raw);
}

async function readOutbox(paymentId) {
  const rows = await psql(
    `select status, attempts, topic, "eventId" from outbox_events where "aggregateId"=${sqlLiteral(paymentId)} order by "createdAt" desc limit 1;`,
  );
  const [row] = rows.split('\n').filter(Boolean);
  if (!row) {
    return null;
  }

  const [status, attempts, outboxTopic, eventId] = row.split('|');
  return { status, attempts: Number(attempts), topic: outboxTopic, eventId };
}

async function processedRows(country, eventIds) {
  const ids = eventIds.map((id) => sqlLiteral(id)).join(',');
  if (!ids) {
    return [];
  }

  const rows = await psql(
    `select "consumerName", "countryCode", "eventId" from processed_events where lower("countryCode")=lower(${sqlLiteral(country)}) and "eventId" in (${ids}) order by "consumerName", "eventId";`,
  );

  return rows
    .split('\n')
    .filter(Boolean)
    .map((row) => {
      const [consumerName, countryCode, eventId] = row.split('|');
      return { consumerName, countryCode, eventId };
    });
}

async function dbSnapshot(paymentId, stage, note) {
  if (!paymentId) {
    return {
      stage,
      note,
      payment: null,
      paymentStep: null,
      outboxEvents: [],
      processedEvents: [],
      summary: ['No hay paymentId: este escenario inyecta un mensaje directo en Kafka, por eso la evidencia principal vive en el DLT.'],
    };
  }

  const paymentIdSql = sqlLiteral(paymentId);
  const payment = await psqlJson(
    `select coalesce((select row_to_json(t)::text from (
      select id, "walletId", "countryCode", amount::text as amount, currency, status, "createdAt", "updatedAt"
      from payments
      where id=${paymentIdSql}
    ) t), 'null');`,
    null,
  );
  const paymentStep = await psqlJson(
    `select coalesce((select row_to_json(t)::text from (
      select "paymentId", "fraudStatus", "ledgerStatus", "failureReason", "updatedAt"
      from payment_steps
      where "paymentId"=${paymentIdSql}
    ) t), 'null');`,
    null,
  );
  const outboxEvents = await psqlJson(
    `select coalesce((select json_agg(t)::text from (
      select id, "eventId", "eventType", topic, "countryCode", status, attempts, "publishedAt", "createdAt", "updatedAt"
      from outbox_events
      where "aggregateId"=${paymentIdSql}
      order by "createdAt"
    ) t), '[]');`,
    [],
  );
  const processedEvents = await psqlJson(
    `with base as (
      select "eventId"::varchar as id
      from outbox_events
      where "aggregateId"=${paymentIdSql}
    )
    select coalesce((select json_agg(t)::text from (
      select "consumerName", "countryCode", "eventId", "processedAt"
      from processed_events pe
      where exists (
        select 1
        from base
        where pe."eventId" = base.id
          or pe."eventId" like base.id || '.%'
      )
      order by "consumerName", "processedAt"
    ) t), '[]');`,
    [],
  );

  const latestOutbox = outboxEvents[outboxEvents.length - 1];
  const summary = [
    payment ? `payments.status=${payment.status}` : 'payments: todavia no hay fila visible',
    latestOutbox ? `outbox.status=${latestOutbox.status}, attempts=${latestOutbox.attempts}` : 'outbox: sin fila',
    paymentStep ? `fraud=${paymentStep.fraudStatus}, ledger=${paymentStep.ledgerStatus}` : 'payment_steps: pendiente de consumidores',
    `processed_events=${processedEvents.length}`,
  ];

  return {
    stage,
    note,
    payment,
    paymentStep,
    outboxEvents,
    processedEvents,
    summary,
  };
}

async function emitDbSnapshot({ paymentId, stage, note, emit }) {
  try {
    const snapshot = await dbSnapshot(paymentId, stage, note);
    emit({ type: 'db-snapshot', snapshot });
  } catch (error) {
    emit({
      type: 'log',
      source: 'db',
      level: 'warn',
      message: `Could not read DB evidence: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

async function pollOutbox({ paymentId, emit, timeoutMs = 12000 }) {
  const start = Date.now();
  let last = null;

  while (Date.now() - start < timeoutMs) {
    const row = await readOutbox(paymentId);
    if (row && (!last || row.status !== last.status || row.attempts !== last.attempts)) {
      emit({ type: 'outbox', ...row });
      last = row;
    }

    if (row?.status === 'published') {
      return row;
    }

    await sleep(900);
  }

  return last;
}

function startWatcher({ res, country, paymentIdRef, acceptDlt, onKafkaEvent }) {
  const children = [];
  const seen = new Set();

  for (const suffix of TOPIC_SUFFIXES) {
    const topicName = topic(country, suffix);
    const child = spawn('docker', [
      'exec',
      KAFKA_CONTAINER,
      '/opt/kafka/bin/kafka-console-consumer.sh',
      '--bootstrap-server',
      'localhost:9092',
      '--topic',
      topicName,
      '--timeout-ms',
      '90000',
    ]);

    children.push(child);
    let buffer = '';

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        let parsed = null;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          parsed = { raw: trimmed };
        }

        const eventPaymentId = paymentIdFromEvent(parsed);
        const isRelevantPayment = paymentIdRef.value && eventPaymentId === paymentIdRef.value;
        const isRelevantDlt = acceptDlt && topicName.endsWith('.dlt');

        if (!isRelevantPayment && !isRelevantDlt) {
          continue;
        }

        const key = `${topicName}:${trimmed}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);

        writeEvent(res, {
          type: 'kafka-event',
          topic: topicName,
          level: topicName.endsWith('.dlt') ? 'error' : 'ok',
          message: `Kafka event on ${topicName}`,
          event: parsed,
        });
        onKafkaEvent?.({ topic: topicName, suffix, event: parsed, raw: trimmed });

        const step = suffix.includes('dlt')
          ? 'dlt'
          : suffix === 'payment.created.v1'
            ? 'created'
            : suffix === 'fraud.assessed.v1'
              ? 'fraud'
              : suffix === 'ledger.posted.v1'
                ? 'ledger'
                : suffix === 'payment.settled.v1' || suffix === 'payment.failed.v1'
                  ? 'saga'
                    : '';

        if (step) {
          writeEvent(res, { type: 'step', step, status: topicName.endsWith('.dlt') ? 'failed' : 'ok' });
        }
      }
    });
  }

  return () => {
    for (const child of children) {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    }
  };
}

async function createPayment({ country, walletId, amount, currency, emit }) {
  const payload = {
    walletId,
    countryCode: country.toUpperCase(),
    amount: Number(amount),
    currency,
  };

  emit({ type: 'log', source: 'api', level: 'info', message: `POST /payments ${JSON.stringify(payload)}` });

  const response = await fetch(`${PAYMENT_API_URL}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const body = await response.json();
  if (!response.ok || !body.paymentId) {
    throw new Error(`Payment API rejected request: ${JSON.stringify(body)}`);
  }

  emit({ type: 'log', source: 'api', level: 'ok', message: `Payment created: ${body.paymentId}` });
  emit({ type: 'step', step: 'api', status: 'ok' });
  return body.paymentId;
}

async function readStatus(paymentId) {
  const response = await fetch(`${PAYMENT_API_URL}/payments/${paymentId}/status`);
  return response.json();
}

async function pollStatus({ paymentId, timeoutMs, emit, expectedFinal = true }) {
  const start = Date.now();
  let lastStatus = '';

  while (Date.now() - start < timeoutMs) {
    const status = await readStatus(paymentId);
    lastStatus = status.status;
    emit({ type: 'status', level: 'info', message: `Payment status: ${status.status}`, status });

    if (expectedFinal && (status.status === 'settled' || status.status === 'failed')) {
      emit({
        type: 'step',
        step: 'saga',
        status: status.status === 'settled' ? 'ok' : 'failed',
      });
      return status;
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  return { status: lastStatus || 'timeout' };
}

async function publishInvalidPayload(country, emit) {
  const topicName = topic(country, 'payment.created.v1');
  const child = spawn('docker', [
    'exec',
    '-i',
    KAFKA_CONTAINER,
    '/opt/kafka/bin/kafka-console-producer.sh',
    '--bootstrap-server',
    'localhost:9092',
    '--topic',
    topicName,
  ]);

  const malformed = `not-json-${Date.now()}`;
  emit({ type: 'log', source: 'kafka', level: 'warn', message: `Publishing malformed payload to ${topicName}` });
  child.stdin.write(`${malformed}\n`);
  child.stdin.end();

  await new Promise((resolve) => child.on('close', resolve));
  emit({ type: 'step', step: 'created', status: 'failed' });
}

async function publishPayload(topicName, payload, emit, label = 'payload') {
  const child = spawn('docker', [
    'exec',
    '-i',
    KAFKA_CONTAINER,
    '/opt/kafka/bin/kafka-console-producer.sh',
    '--bootstrap-server',
    'localhost:9092',
    '--topic',
    topicName,
  ]);

  emit({ type: 'log', source: 'kafka', level: 'warn', message: `Publishing ${label} to ${topicName}` });
  child.stdin.write(`${payload}\n`);
  child.stdin.end();

  await new Promise((resolve) => child.on('close', resolve));
}

async function runScenario(req, res) {
  const body = await parseBody(req);
  const scenario = body.scenario || 'success';
  let country = normalizeCountry(body.country);
  if (scenario === 'mx-outage-pe-available') {
    country = 'pe';
  }
  const paymentIdRef = { value: '' };
  const amount = scenario === 'fraud-rejected' ? 1500 : Number(body.amount || 25);
  const currency = body.currency || (country === 'mx' ? 'MXN' : 'PEN');
  const walletId = body.walletId || `visual-${country}-${Date.now()}`;
  const restore = [];
  const emit = (event) => writeEvent(res, event);
  const captured = {
    paymentCreatedRaw: '',
    paymentCreatedEventId: '',
    fraudEventId: '',
    ledgerEventId: '',
  };

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  emit({ type: 'hello', message: 'Visual demo scenario started' });
  emit(phoneState('processing', 'Procesando tu yape', 'Estamos creando el pago y esperando confirmacion de los servicios.', 'none'));
  emit(narrative('Esta demo sigue un pago real: primero API y outbox, luego Kafka, fraude, ledger y saga.'));
  const stopWatchers = startWatcher({
    res,
    country,
    paymentIdRef,
    acceptDlt: scenario === 'dlt-invalid-payload',
    onKafkaEvent: ({ suffix, event, raw }) => {
      if (suffix === 'payment.created.v1') {
        captured.paymentCreatedRaw = raw;
        captured.paymentCreatedEventId = event.eventId || '';
        emit(serviceEvent('kafka', 'ok', `published ${event.type || suffix}`));
        emit(serviceEvent('relay', 'ok', 'relay published the outbox event to Kafka'));
      }
      if (suffix === 'fraud.assessed.v1') {
        captured.fraudEventId = event.eventId || '';
        const approved = event?.payload?.approved;
        emit(serviceEvent('fraud', approved ? 'ok' : 'failed', approved ? 'approved by risk rules' : `rejected: ${event?.payload?.reason || 'risk rule'}`));
        emit(narrative(approved ? 'FraudConsumer respondio OK. Es independiente del ledger y puede reprocesar sin doble efecto.' : 'FraudConsumer rechazo el pago. La saga debe cerrar failed sin esperar un falso settled.', approved ? 'ok' : 'warn'));
      }
      if (suffix === 'ledger.posted.v1') {
        captured.ledgerEventId = event.eventId || '';
        emit(serviceEvent('ledger', 'ok', `entryId=${event?.payload?.entryId || 'created'}`));
        emit(narrative('LedgerConsumer confirmo la escritura. En produccion aqui viviria la doble entrada contable.', 'ok'));
      }
      if (suffix === 'payment.settled.v1') {
        emit(serviceEvent('saga', 'ok', 'fraud + ledger succeeded'));
        emit(narrative('StatusSaga vio ambos ACKs y cerro el pago como settled.', 'ok'));
      }
      if (suffix === 'payment.failed.v1') {
        emit(serviceEvent('saga', 'failed', event?.payload?.reason || 'consumer failure'));
        emit(narrative('StatusSaga cerro failed porque uno de los pasos criticos fallo.', 'warn'));
      }
      if (suffix.includes('dlt')) {
        emit(serviceEvent('dlt', 'failed', event?.reason || 'retry budget exhausted'));
        emit(narrative('El mensaje agoto retries y fue a DLT. No se borro silenciosamente.', 'warn'));
      }
    },
  });
  await sleep(1000);

  try {
    emit({ type: 'log', source: 'scenario', level: 'info', message: `Scenario: ${scenario} / country: ${country}` });
    emit(serviceEvent('api', 'running', 'creating payment request'));
    emit(serviceEvent('outbox', 'running', 'waiting for local transaction'));

    if (scenario === 'country-isolation') {
      const blockedCountry = country === 'pe' ? 'mx' : 'pe';
      emit(narrative(`Aislaremos ${blockedCountry.toUpperCase()} apagando su ledger. El pago se hara en ${country.toUpperCase()} y debe seguir normal.`, 'warn'));
      await stopCountryService(blockedCountry, 'ledger-consumer');
      restore.push(() => startCountryService(blockedCountry, 'ledger-consumer'));
      emit({
        type: 'country-status',
        country: blockedCountry,
        availability: 'degraded',
        detail: 'ledger-consumer stopped for isolation demo',
      });
      emit({ type: 'log', source: 'country', level: 'warn', message: `${blockedCountry} ledger stopped; ${country} should keep processing.` });
    }

    if (scenario === 'mx-outage-pe-available') {
      emit(narrative('Simularemos caida critica de MX: ledger y status-saga de MX se apagan. PE debe seguir yapeando.', 'warn'));
      await stopCountryService('mx', 'ledger-consumer');
      restore.push(() => startCountryService('mx', 'ledger-consumer'));
      await stopCountryService('mx', 'status-saga');
      restore.push(() => startCountryService('mx', 'status-saga'));
      emit({
        type: 'country-status',
        country: 'mx',
        availability: 'degraded',
        detail: 'MX ledger-consumer and status-saga stopped',
      });
      emit({
        type: 'country-status',
        country: 'pe',
        availability: 'available',
        detail: 'PE critical workers remain available',
      });
      emit({ type: 'log', source: 'country', level: 'warn', message: 'MX critical workers stopped; PE payment should still settle.' });
    }

    if (scenario === 'ledger-down-recovery' || scenario === 'timeout-pending') {
      emit({ type: 'log', source: 'ledger', level: 'warn', message: `Stopping ledger-consumer for ${country}` });
      await stopCountryService(country, 'ledger-consumer');
      restore.push(() => startCountryService(country, 'ledger-consumer'));
      emit({ type: 'step', step: 'ledger', status: 'retrying' });
      emit(serviceEvent('ledger', 'retrying', 'consumer stopped; Kafka keeps the message'));
      emit(narrative('Ledger esta caido. El pago no se pierde: Kafka conserva el evento y el status debe seguir pending.', 'warn'));
    }

    if (scenario === 'dlt-invalid-payload') {
      await publishInvalidPayload(country, emit);
      await emitDbSnapshot({
        paymentId: '',
        stage: 'DLT direct Kafka injection',
        note: 'No se creo payment ni outbox porque este caso salta la API para probar DLT con payload invalido.',
        emit,
      });
      await sleep(8000);
      emit(phoneState('failed', 'Error tecnico controlado', 'El mensaje agoto retries y fue enviado al DLT para investigacion.', 'reset'));
      emit({ type: 'summary', level: 'error', message: 'Malformed event should appear in payment.created.v1.dlt.' });
      return;
    }

    paymentIdRef.value = await createPayment({ country, walletId, amount, currency, emit });
    emit(serviceEvent('api', 'ok', `paymentId=${paymentIdRef.value}`));
    await emitDbSnapshot({
      paymentId: paymentIdRef.value,
      stage: 'After local DB transaction',
      note: 'PaymentService ya hizo commit de payment + outbox. Kafka todavia no fue llamado dentro de esa transaccion.',
      emit,
    });
    emit(serviceEvent('outbox', 'running', 'claiming outbox row'));
    await pollOutbox({ paymentId: paymentIdRef.value, emit });
    await emitDbSnapshot({
      paymentId: paymentIdRef.value,
      stage: 'After outbox relay',
      note: 'El relay, en otro proceso, publico el evento y marco el outbox como published.',
      emit,
    });

    if (scenario === 'ledger-down-recovery') {
      await sleep(8000);
      const pending = await readStatus(paymentIdRef.value);
      emit({ type: 'status', level: 'warn', message: 'Ledger is down, status should still be pending.', status: pending });
      await emitDbSnapshot({
        paymentId: paymentIdRef.value,
        stage: 'While ledger is down',
        note: 'Fraud puede estar listo, pero ledger sigue pendiente; por eso el payment no debe mentir con settled.',
        emit,
      });
      emit(phoneState('pending', 'Tu yape esta en proceso', 'Ledger esta temporalmente caido; el pago queda pendiente sin perderse.', 'reset'));
      emit({ type: 'log', source: 'ledger', level: 'info', message: `Restarting ledger-consumer for ${country}` });
      await startCountryService(country, 'ledger-consumer');
      restore.pop();
      emit({ type: 'step', step: 'ledger', status: 'running' });
      emit(serviceEvent('ledger', 'running', 'consumer restored; waiting for redelivery'));
      const finalStatus = await pollStatus({ paymentId: paymentIdRef.value, timeoutMs: 60000, emit });
      await emitDbSnapshot({
        paymentId: paymentIdRef.value,
        stage: 'After ledger recovery',
        note: 'Al volver ledger, Kafka entrega el pendiente y la saga puede cerrar el pago.',
        emit,
      });
      emit(phoneState(
        finalStatus.status === 'settled' ? 'success' : 'failed',
        finalStatus.status === 'settled' ? 'Yape exitoso' : 'No pudimos completar tu yape',
        finalStatus.status === 'settled' ? 'El pago pendiente se recupero y fue liquidado correctamente.' : 'El pago no pudo cerrarse luego de la recuperacion.',
        'reset',
      ));
      emit({ type: 'summary', level: finalStatus.status === 'settled' ? 'ok' : 'error', message: `Final status: ${finalStatus.status}` });
      return;
    }

    if (scenario === 'timeout-pending') {
      const pending = await pollStatus({ paymentId: paymentIdRef.value, timeoutMs: 16000, emit, expectedFinal: false });
      await emitDbSnapshot({
        paymentId: paymentIdRef.value,
        stage: 'Timeout window ended',
        note: 'La consulta de estado es honestamente eventual: muestra pending mientras falta un ACK critico.',
        emit,
      });
      emit(phoneState('pending', 'Tu yape esta en proceso', 'Aun esperamos confirmacion de un servicio critico. El estado sigue pending honestamente.', 'reset'));
      emit({
        type: 'summary',
        level: 'warn',
        message: `Timeout window ended with status: ${pending.status}. This demonstrates honest eventual consistency.`,
      });
      return;
    }

    const finalStatus = await pollStatus({ paymentId: paymentIdRef.value, timeoutMs: 60000, emit });
    await emitDbSnapshot({
      paymentId: paymentIdRef.value,
      stage: `Final DB state: ${finalStatus.status}`,
      note: 'Estado persistido final despues de que la saga reconciliara los ACKs de fraud y ledger.',
      emit,
    });
    emit(phoneState(
      finalStatus.status === 'settled' ? 'success' : 'failed',
      finalStatus.status === 'settled' ? 'Yape exitoso' : 'No pudimos completar tu yape',
      finalStatus.status === 'settled' ? 'Tu pago fue procesado y liquidado correctamente.' : 'El pago fue rechazado o fallo durante la liquidacion.',
      'reset',
    ));

    if (scenario === 'idempotency-replay') {
      emit(narrative('Ahora republicamos el mismo payment.created.v1 con el mismo eventId. Fraud y ledger deben ignorarlo.', 'warn'));
      await publishPayload(topic(country, 'payment.created.v1'), captured.paymentCreatedRaw, emit, 'duplicate payment.created.v1');
      await sleep(5000);
      const rows = await processedRows(country, [
        captured.paymentCreatedEventId,
        captured.fraudEventId,
        captured.ledgerEventId,
      ].filter(Boolean));

      emit({
        type: 'idempotency',
        level: 'ok',
        message: `Replay enviado. processed_events mantiene una fila por consumer/eventId (${rows.length} marcas encontradas).`,
        fraud: 'duplicate payment.created ignored by fraud-consumer',
        ledger: 'duplicate payment.created ignored by ledger-consumer',
        rows,
      });
      await emitDbSnapshot({
        paymentId: paymentIdRef.value,
        stage: 'After duplicate replay',
        note: 'processed_events mantiene una marca por consumer/eventId; no se crea otro efecto observable.',
        emit,
      });
      emit(narrative('Este es el punto clave de redelivery: repetir el evento no genera otro scoring ni otro asiento ledger.', 'ok'));
    }

    emit({ type: 'summary', level: finalStatus.status === 'settled' ? 'ok' : 'error', message: `Final status: ${finalStatus.status}` });
  } catch (error) {
    emit(phoneState('failed', 'No pudimos completar tu yape', error instanceof Error ? error.message : String(error), 'retry'));
    emit({
      type: 'summary',
      level: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    for (const action of restore.reverse()) {
      try {
        await action();
        emit({ type: 'log', source: 'cleanup', level: 'ok', message: 'Service restored for the next demo.' });
      } catch (error) {
        emit({ type: 'log', source: 'cleanup', level: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    }

    setTimeout(() => {
      stopWatchers();
      emit({ type: 'done', message: 'Scenario finished' });
      res.end();
    }, 1200);
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(filePath)] || 'text/plain; charset=utf-8' });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, await health());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/scenario') {
      await runScenario(req, res);
      return;
    }

    if (req.method === 'GET') {
      serveStatic(req, res);
      return;
    }

    sendJson(res, 405, { error: 'method_not_allowed' });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, () => {
  console.log(`Visual demo listening on http://localhost:${PORT}`);
});
