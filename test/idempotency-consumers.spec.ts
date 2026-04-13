import { EventTypes } from 'src/domain/events/event-types';
import { FraudConsumerService } from 'src/domain/services/fraud-consumer.service';
import { LedgerConsumerService } from 'src/domain/services/ledger-consumer.service';
import { TopicResolver } from 'src/domain/services/topic-resolver';
import { FakeEventPublisher, FakeProcessedEventRepository } from 'test/helpers/fakes';

const paymentCreatedEvent = JSON.stringify({
  eventId: 'evt-100',
  type: EventTypes.PaymentCreatedV1,
  aggregateId: 'payment-1',
  occurredAt: new Date().toISOString(),
  countryCode: 'PE',
  schemaVersion: 1,
  payload: {
    paymentId: 'payment-1',
    walletId: 'wallet-1',
    amount: 100,
    currency: 'PEN',
  },
});

const paymentCreatedEventMxSameId = JSON.stringify({
  eventId: 'evt-100',
  type: EventTypes.PaymentCreatedV1,
  aggregateId: 'payment-2',
  occurredAt: new Date().toISOString(),
  countryCode: 'MX',
  schemaVersion: 1,
  payload: {
    paymentId: 'payment-2',
    walletId: 'wallet-2',
    amount: 150,
    currency: 'MXN',
  },
});

describe('Idempotent consumers', () => {
  it('fraud consumer should not publish duplicate side effects', async () => {
    const processed = new FakeProcessedEventRepository();
    const publisher = new FakeEventPublisher();
    const service = new FraudConsumerService(processed, publisher, new TopicResolver(false));

    await service.handlePaymentCreated(paymentCreatedEvent);
    await service.handlePaymentCreated(paymentCreatedEvent);

    expect(publisher.published).toHaveLength(1);
  });

  it('ledger consumer should not publish duplicate side effects', async () => {
    const processed = new FakeProcessedEventRepository();
    const publisher = new FakeEventPublisher();
    const service = new LedgerConsumerService(processed, publisher, new TopicResolver(false));

    await service.handlePaymentCreated(paymentCreatedEvent);
    await service.handlePaymentCreated(paymentCreatedEvent);

    expect(publisher.published).toHaveLength(1);
  });

  it('fraud consumer should process same eventId for different countries independently', async () => {
    const processed = new FakeProcessedEventRepository();
    const publisher = new FakeEventPublisher();
    const service = new FraudConsumerService(processed, publisher, new TopicResolver(true));

    await service.handlePaymentCreated(paymentCreatedEvent);
    await service.handlePaymentCreated(paymentCreatedEventMxSameId);

    expect(publisher.published).toHaveLength(2);
    expect(publisher.published[0].topic).toBe('pe.payments.fraud.assessed.v1');
    expect(publisher.published[1].topic).toBe('mx.payments.fraud.assessed.v1');
  });
});
