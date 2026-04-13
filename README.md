# Challenge 1 - Payment settlement pipeline

## ¿Por qué elegí este challenge?

Elegí el **Challenge 1 - Payment settlement pipeline** porque representa mejor los problemas que aparecen en un sistema fintech real: escrituras dobles, entrega confiable de eventos, redelivery, idempotencia, fallas parciales y consistencia eventual.

No lo tomé como un ejercicio de endpoints CRUD. Lo tomé como un problema de garantías distribuidas: cómo crear un pago sin perder eventos, cómo procesarlo aunque Kafka reentregue mensajes, cómo responder un estado honesto mientras los consumidores terminan, y cómo aislar el impacto entre países cuando un servicio crítico falla o tiene alto tráfico.

También elegí este reto porque permite explicar trade-offs importantes de arquitectura. En pagos no basta con que el happy path funcione; el diseño debe seguir siendo correcto si el relay se cae, si un consumer procesa dos veces el mismo mensaje, si un país se degrada o si un mensaje termina siendo imposible de procesar.

## Resumen de la solución

La solución implementa un pipeline de settlement basado en eventos con estos componentes:

```text
Payment API -> PostgreSQL outbox -> Outbox Relay -> Kafka -> Fraud / Ledger -> Status Saga -> settled | failed | DLT
```

Los procesos principales son:

```text
payment-api
outbox-relay
fraud-consumer
ledger-consumer
status-saga
```

La solución también incluye Docker Compose, scripts de bootstrap local, tests automatizados, namespace por país, configuración por país y un demo visual tipo Yape que permite ejecutar escenarios reales y ver eventos Kafka, evidencia en base de datos y disponibilidad por país.

## Decisiones arquitectónicas

### 1. Transactional Outbox

Decidí usar el patrón **Transactional Outbox** para evitar el problema clásico de dual write:

```text
DB commit OK, pero Kafka publish falla
```

Cuando se crea un pago, el `PaymentService` guarda en la misma transacción local:

```text
payments
outbox_events
```

El broker no se llama dentro de esa transacción. Esto es importante porque llamar Kafka dentro de una transacción SQL no hace que Kafka participe de esa transacción; solo crea una falsa sensación de atomicidad.

La alternativa rechazada fue publicar directamente a Kafka desde el API durante la creación del pago. Es más simple de programar, pero puede producir pérdida silenciosa de eventos si la base de datos confirma y el broker falla después.

### 2. Relay separado del API

El `outbox-relay` corre como proceso separado. Lee filas pendientes de `outbox_events`, publica a Kafka y marca la fila como publicada.

Esta separación permite que el ciclo de vida del relay no dependa del API HTTP. También hace más claro el modelo de fallas:

```text
Si el relay muere antes de publicar, la fila queda pending y se reintenta.
Si el relay publica pero muere antes de marcar published, el evento puede publicarse otra vez.
Ese duplicado es aceptable porque los consumers son idempotentes.
```

Para concurrencia en el relay se usa locking pesimista con `FOR UPDATE SKIP LOCKED`, de forma que varias instancias puedan reclamar lotes sin procesar la misma fila al mismo tiempo.

### 3. PostgreSQL como base de datos local

Elegí PostgreSQL porque ofrece garantías ACID sólidas para la transacción local `payment + outbox`. Además soporta locks transaccionales como `FOR UPDATE SKIP LOCKED`, que encajan bien con un relay concurrente basado en polling.

La alternativa de usar una base más simple o almacenamiento en memoria habría reducido la complejidad inicial, pero no demostraría bien las garantías transaccionales que el challenge busca evaluar.

### 4. Kafka con topics por país

Implementé namespace por país para los topics:

```text
pe.payments.payment.created.v1
mx.payments.payment.created.v1
pe.payments.fraud.assessed.v1
mx.payments.fraud.assessed.v1
pe.payments.ledger.posted.v1
mx.payments.ledger.posted.v1
```

Esto permite separar tráfico, lag, DLTs y operación por país. Si MX tiene alto tráfico o una falla operativa, PE no debe quedar bloqueado por compartir el mismo flujo crítico.

La alternativa rechazada fue usar un único topic global con `countryCode` dentro del payload. Esa opción simplifica nombres de topics, pero mezcla lag y operación entre países, lo cual complica aislamiento y respuesta ante incidentes.

### 5. Estrategia híbrida multi-país

No elegí que todo fuera global ni que todo fuera aislado por país. Elegí una estrategia híbrida:

```text
Globales:
payment-api
outbox-relay
fraud-consumer

Aislados por país:
ledger-consumer
status-saga
```

`fraud-consumer` se mantiene global porque en esta solución representa una evaluación compartida y de menor costo operativo. En cambio, `ledger-consumer` y `status-saga` están aislados por país porque son parte crítica del settlement y del cierre del estado del pago.

La alternativa de aislar todo por país aumenta control operativo, pero también multiplica costo y complejidad desde el inicio. La alternativa de dejar todo global reduce costo, pero debilita el aislamiento ante picos o fallas localizadas.

### 6. Consumer groups por país

Los consumers críticos usan grupos por país:

```text
challenge.ledger-consumer.pe
challenge.ledger-consumer.mx
challenge.status-saga.pe
challenge.status-saga.mx
```

El consumer global usa un grupo global:

```text
challenge.fraud-consumer.global
```

Esto permite que el offset y el lag de los procesos críticos estén separados por país. También deja el sistema preparado para escalar horizontalmente un país sin tocar otro.

Por ejemplo, si MX recibe más tráfico, puedo escalar los workers de MX sin escalar PE:

```bash
docker compose -p yape-mx -f docker-compose.country.yml --env-file .env --env-file .env.mx --profile country up -d --scale ledger-consumer=3 --scale status-saga=2
```

No implementé autoscaling automático porque el reto apunta a un entorno local con Docker Compose. En producción agregaría HPA basado en consumer lag, retry rate, CPU y latencia por país.

### 7. Idempotencia del lado consumidor

La idempotencia vive del lado consumidor, no del productor. Cada consumer registra una marca en `processed_events` antes de generar efectos observables.

La clave lógica es:

```text
consumerName + countryCode + eventId
```

Esto es más seguro que usar solo `eventId`, porque en un sistema multi-país se evita una colisión accidental entre eventos de distintos países. También es más correcto que deduplicar por `paymentId`, porque un mismo pago puede producir varios eventos distintos.

La alternativa rechazada fue confiar solo en Kafka o en el productor para evitar duplicados. Kafka puede entregar más de una vez bajo ciertos escenarios; por eso cada consumer debe ser capaz de recibir el mismo evento nuevamente sin duplicar side effects.

### 8. Status Saga basada en eventos

Implementé una `status-saga` que escucha:

```text
fraud.assessed.v1
ledger.posted.v1
```

La saga actualiza `payment_steps` y reconcilia el estado final del pago:

```text
fraud succeeded + ledger succeeded -> payment.settled.v1
fraud failed o ledger failed -> payment.failed.v1
faltan ACKs -> payment sigue pending
```

Esto hace que el endpoint de status sea honesto con la consistencia eventual. Un pago recién creado puede devolver `pending` hasta que los consumidores confirmen.

La alternativa rechazada fue marcar el pago como `settled` inmediatamente después de publicarlo a Kafka. Eso sería incorrecto porque publicar un evento no significa que fraude y ledger ya hayan terminado.

### 9. DLT por topic original

Si un consumer agota su presupuesto de retries, el mensaje se envía a un Dead Letter Topic:

```text
{original-topic}.dlt
```

Ejemplos:

```text
pe.payments.payment.created.v1.dlt
mx.payments.ledger.posted.v1.dlt
```

Esto evita perder mensajes silenciosamente. También conserva trazabilidad por país y por tipo de evento.

Separé conceptualmente DLT de `payment.failed.v1`. El DLT representa una falla técnica de procesamiento o un mensaje inválido. `payment.failed.v1` representa un resultado de negocio o de saga donde el pago sí llegó a un estado terminal fallido.

### 10. Configuración de país y moneda

Cada país tiene su propio archivo de configuración:

```text
.env.pe -> COUNTRY_CODE=pe, COUNTRY_CURRENCY=PEN
.env.mx -> COUNTRY_CODE=mx, COUNTRY_CURRENCY=MXN
.env.co -> COUNTRY_CODE=co, COUNTRY_CURRENCY=COP
```

Decidí guardar la moneda en `.env.<pais>` porque la moneda default es una propiedad operativa del proceso país. Si mañana se agrega Colombia, no debería tocarse el código central para saber que `co` usa `COP`.

Los scripts `init-local.sh` y `add-new-country.sh` preguntan y validan la moneda usando formato ISO de tres letras.

### 11. Docker Compose reproducible

Incluí un entorno local con Docker Compose para levantar infraestructura y servicios sin depender de instalaciones locales de Node o npm.

La estructura está separada en dos capas:

```text
docker-compose.yml -> core compartido
docker-compose.country.yml -> workers aislados por país
```

Esto evita duplicar YAML por cada país. Para agregar un país nuevo se crea `.env.<pais>` y se levanta el mismo compose con otro project name:

```bash
docker compose -p yape-co -f docker-compose.country.yml --env-file .env --env-file .env.co --profile country up -d --build
```

### 12. Visual demo para explicar el sistema

Además de los tests, agregué un demo visual tipo Yape. No lo hice como reemplazo de pruebas, sino como herramienta de explicación.

El demo permite ver al mismo tiempo:

```text
pantalla de usuario
estado de servicios
línea de tiempo del pipeline
eventos Kafka
evidencia en Postgres
estado por país
```

También incluye escenarios como:

```text
success
fraud rejected
ledger down + retry
timeout pending
DLT invalid payload
replay idempotente
país aislado
MX caído, PE disponible
```

El escenario `MX caído, PE disponible` apaga workers críticos de MX y ejecuta un pago PE. La intención es demostrar visualmente que una caída operativa en MX no afecta la disponibilidad del settlement de PE.

## Alternativas rechazadas

### Publicar en Kafka dentro de la transacción SQL

La rechacé porque no garantiza atomicidad real entre PostgreSQL y Kafka. Si una parte falla, el sistema puede quedar inconsistente.

### Usar una transacción distribuida o 2PC

La rechacé porque aumenta complejidad y no es una solución práctica para este escenario local. El outbox ofrece una garantía suficiente y más operable: persistir primero, publicar después, y tolerar duplicados con idempotencia.

### Usar Debezium o CDC desde el inicio

CDC sería una buena evolución para reducir polling y mejorar throughput, pero para el challenge preferí una implementación explícita del relay. Es más fácil de revisar y deja clara la decisión de no llamar Kafka dentro del transaction boundary.

### Usar Temporal

Temporal sería útil para sagas más largas, con timers, compensaciones complejas y pasos externos ambiguos. Para este challenge, una saga ligera basada en eventos era suficiente y mantiene menos moving parts.

### Hacer todos los servicios por país

Lo rechacé como primera versión porque multiplica despliegues y costo operativo. Preferí aislar los procesos críticos y mantener globales los componentes que no necesitan aislamiento fuerte en esta etapa.

### Hacer todo global

También lo rechacé porque debilita el aislamiento. Si un país genera lag o tiene una falla de ledger, no debería impactar el cierre de pagos de otro país.

### Usar BIAN como eje principal

No modelé la solución bajo BIAN porque el challenge no lo pedía. Preferí concentrarme en garantías distribuidas, idempotencia, DLT, outbox y operación multi-país. Si la organización usa BIAN como marco de gobierno, los módulos podrían mapearse posteriormente a dominios como Payments, Fraud, Ledger y Notifications.

## Qué pasa ante fallas

### Si Kafka falla cuando se crea el pago

No se pierde el pago ni el evento, porque el API no llama Kafka. El pago y la fila outbox ya quedaron persistidos en PostgreSQL. El relay seguirá intentando publicar cuando Kafka vuelva.

### Si el relay muere antes de publicar

La fila queda pendiente en `outbox_events`. Al reiniciar el relay, la fila se toma nuevamente y se publica.

### Si el relay publica y muere antes de marcar published

El evento puede publicarse otra vez. Este duplicado es tolerado porque Fraud, Ledger y Status Saga son idempotentes por `consumerName + countryCode + eventId`.

### Si un consumer recibe el mismo evento dos veces

Consulta `processed_events`. Si ya existe la marca de procesamiento, no ejecuta de nuevo el side effect.

### Si un consumer agota retries

El mensaje se envía al DLT correspondiente. No se descarta silenciosamente.

### Si MX cae o tiene alto tráfico

Los workers críticos de PE siguen con su propio consumer group y sus propios topics. El diseño permite operar y escalar por país.

## Qué haría diferente con más tiempo

- Agregaría migraciones TypeORM versionadas en lugar de depender de sincronización automática de esquema en local.
- Agregaría Schema Registry o validación formal de contratos para eventos, con reglas de compatibilidad backward/forward.
- Agregaría OpenTelemetry para trazabilidad end-to-end desde `POST /payments` hasta `payment.settled.v1` o DLT.
- Agregaría métricas por país: consumer lag, retry rate, DLT rate, tiempo en pending y throughput por topic.
- Agregaría dashboards y alertas por país para detectar degradación localizada.
- Agregaría limpieza/retención de `processed_events` para controlar crecimiento de la tabla de idempotencia.
- Evaluaría CDC con Debezium para reemplazar polling del outbox si el volumen crece.
- Implementaría autoscaling en Kubernetes con HPA basado en Kafka lag por país.
- Separaría físicamente bases o esquemas por dominio si el sistema evolucionara hacia microservicios más independientes.
- Agregaría runbooks de replay de DLT y procedimientos seguros para reprocesamiento.

## Limitaciones conocidas

- Uso una sola base PostgreSQL para simplificar el entorno local del challenge. En producción, Ledger, Fraud y Payments podrían tener ownership de datos más separado.
- Los eventos downstream de algunos workers se publican directamente desde el consumer. Con más tiempo aplicaría outbox también para esos eventos si se requiere la misma garantía fuerte que en `payment.created.v1`.
- El entorno Kafka local usa una topología simple de desarrollo, no un cluster productivo multi-broker.
- El relay usa polling. Es correcto para el challenge, pero en producción evaluaría CDC o tuning de polling/backoff.
- El fraud scoring es intencionalmente simple. El foco del reto está en garantías distribuidas, no en un motor real de riesgo.
- No implementé autenticación/autorización porque no era el foco del challenge.
- No implementé autoscaling automático; dejé la arquitectura lista para escalar por país, pero las reglas productivas vivirían en Kubernetes/observabilidad.
- El visual demo monta Docker socket para controlar containers en laboratorio local. Es útil para demostrar fallas, pero no es un patrón recomendado para producción.

## Cómo validé la solución

Incluí pruebas automatizadas para los puntos críticos:

```text
payment-service
idempotency-consumers
status-saga
DLT handler
```

También agregué scripts para operación local:

```bash
./scripts/init-local.sh
./scripts/run-test.sh
./scripts/run-kafka-scenario.sh
./scripts/add-new-country.sh
./scripts/cleanup-docker.sh
```

Y un demo visual en:

```text
http://localhost:4000
```

El objetivo del demo visual es facilitar la explicación en entrevista: se puede ejecutar un pago, ver el evento en Kafka, ver las filas reales en Postgres y demostrar qué ocurre bajo fallas parciales.

## Cierre

La decisión principal fue priorizar garantías operativas sobre simplicidad superficial. El sistema acepta que Kafka puede redeliver, que los consumidores pueden fallar, que la consistencia es eventual y que un país puede degradarse sin bloquear a otro.

La promesa de esta solución no es consistencia inmediata. La promesa es:

```text
no perder eventos,
no duplicar efectos,
reflejar el estado honestamente,
y aislar fallas críticas por país.
```
