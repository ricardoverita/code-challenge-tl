# run-kafka-scenario.sh

Script de demo E2E para ver eventos reales del pipeline en Kafka, con salida guiada en consola.

## Qué hace

`./scripts/run-kafka-scenario.sh` automatiza:

1. Verifica/levanta servicios base necesarios (`kafka`, `payment-api`, `outbox-relay`, `fraud-consumer`, `ledger-consumer`, `status-saga`).
2. Crea un pago real vía `POST /payments`.
3. Observa topics Kafka del país seleccionado.
4. Consulta estado en `GET /payments/:id/status` hasta estado final o timeout.
5. Muestra resumen final del escenario.

## Escenarios

## 1) `success` (implementado)

Flujo normal:
- `payment.created.v1`
- `fraud.assessed.v1`
- `ledger.posted.v1`
- `payment.settled.v1`

Ejemplo:

```bash
./scripts/run-kafka-scenario.sh --scenario success --country pe
```

## 2) `failure-stop-ledger` (implementado)

Fallo operacional controlado:
- Detiene `ledger-consumer` del país.
- Crea el pago (debe quedarse `pending` mientras ledger está caído).
- Vuelve a levantar `ledger-consumer`.
- Verifica recuperación y cierre eventual.

Ejemplo:

```bash
./scripts/run-kafka-scenario.sh --scenario failure-stop-ledger --country pe
```

Alias válido:

```bash
./scripts/run-kafka-scenario.sh --scenario failure --country pe
```

## 3) Escenarios recomendados a futuro (no implementados aún)

- `failure-stop-fraud`: simular caída de fraude.
- `failure-dlt-invalid-payload`: inyectar payload inválido para observar retries + DLT.
- `country-parallel`: disparar pagos simultáneos en `pe` y `mx` para mostrar aislamiento por país.

## Parámetros útiles

```bash
./scripts/run-kafka-scenario.sh \
  --scenario success \
  --country pe \
  --wallet-id wallet-e2e-001 \
  --amount 10.50 \
  --currency PEN \
  --api-url http://localhost:3000 \
  --timeout 90 \
  --failure-hold 12 \
  --watch-timeout-ms 120000
```

## Requisitos

- Docker + Docker Compose
- `curl`
- `node`
- `.env` y `.env.<pais>` existentes

## Salida esperada

El script imprime:
- `paymentId` creado
- snapshots del estado eventual
- topics con eventos capturados para ese `paymentId`
- enlaces/comandos de logs para troubleshooting

Kafka UI:
- [http://localhost:8080](http://localhost:8080)
