import { PaymentStatus } from 'src/domain/entities/payment';
import { EventTypes } from 'src/domain/events/event-types';
import { StatusSagaService } from 'src/domain/services/status-saga.service';
import { TopicResolver } from 'src/domain/services/topic-resolver';
import {
  FakeEventPublisher,
  FakePaymentRepository,
  FakePaymentStepRepository,
  FakeProcessedEventRepository,
} from 'test/helpers/fakes';

describe('StatusSagaService', () => {
  it('marks payment as settled when both downstream consumers succeed', async () => {
    const processed = new FakeProcessedEventRepository();
    const payments = new FakePaymentRepository();
    const steps = new FakePaymentStepRepository();
    const publisher = new FakeEventPublisher();

    await payments.createPending({
      id: 'payment-1',
      walletId: 'wallet-1',
      countryCode: 'PE',
      amount: 20,
      currency: 'PEN',
    });
    await steps.init('payment-1');

    const service = new StatusSagaService(processed, payments, steps, publisher, new TopicResolver(false));

    await service.onFraudAssessed(
      JSON.stringify({
        eventId: 'evt-fraud',
        type: EventTypes.FraudAssessedV1,
        aggregateId: 'payment-1',
        countryCode: 'PE',
        payload: {
          paymentId: 'payment-1',
          approved: true,
        },
      }),
    );

    await service.onLedgerPosted(
      JSON.stringify({
        eventId: 'evt-ledger',
        type: EventTypes.LedgerPostedV1,
        aggregateId: 'payment-1',
        countryCode: 'PE',
        payload: {
          paymentId: 'payment-1',
          success: true,
          entryId: 'entry-1',
        },
      }),
    );

    const payment = await payments.getById('payment-1');
    expect(payment?.status).toBe(PaymentStatus.Settled);
    expect(publisher.published.some((event) => event.topic === EventTypes.PaymentSettledV1)).toBe(true);
  });

  it('marks payment as failed when one step fails', async () => {
    const processed = new FakeProcessedEventRepository();
    const payments = new FakePaymentRepository();
    const steps = new FakePaymentStepRepository();
    const publisher = new FakeEventPublisher();

    await payments.createPending({
      id: 'payment-2',
      walletId: 'wallet-2',
      countryCode: 'PE',
      amount: 1200,
      currency: 'PEN',
    });
    await steps.init('payment-2');

    const service = new StatusSagaService(processed, payments, steps, publisher, new TopicResolver(false));

    await service.onFraudAssessed(
      JSON.stringify({
        eventId: 'evt-fraud-2',
        type: EventTypes.FraudAssessedV1,
        aggregateId: 'payment-2',
        countryCode: 'PE',
        payload: {
          paymentId: 'payment-2',
          approved: false,
          reason: 'risk_threshold_exceeded',
        },
      }),
    );

    const payment = await payments.getById('payment-2');
    expect(payment?.status).toBe(PaymentStatus.Failed);
    expect(publisher.published.some((event) => event.topic === EventTypes.PaymentFailedV1)).toBe(true);
  });
});
