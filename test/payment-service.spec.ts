import { PaymentStatus } from 'src/domain/entities/payment';
import { PaymentService } from 'src/domain/services/payment.service';
import { TopicResolver } from 'src/domain/services/topic-resolver';
import {
  FakeOutboxRepository,
  FakePaymentRepository,
  FakePaymentStepRepository,
  FakeUnitOfWork,
} from 'test/helpers/fakes';

describe('PaymentService', () => {
  it('stores payment and outbox in one local transaction', async () => {
    const payments = new FakePaymentRepository();
    const steps = new FakePaymentStepRepository();
    const outbox = new FakeOutboxRepository();
    const uow = new FakeUnitOfWork(payments, steps, outbox);

    const service = new PaymentService(uow, payments, steps, outbox, new TopicResolver(false));

    const result = await service.createPayment({
      walletId: 'wallet-01',
      countryCode: 'PE',
      amount: 250,
      currency: 'PEN',
    });

    expect(result.status).toBe(PaymentStatus.Pending);
    expect(payments.items.size).toBe(1);
    expect(steps.items.size).toBe(1);
    expect(outbox.items.size).toBe(1);
  });

  it('rolls back payment write when outbox enqueue fails', async () => {
    const payments = new FakePaymentRepository();
    const steps = new FakePaymentStepRepository();
    const outbox = new FakeOutboxRepository();
    outbox.failEnqueue = true;

    const uow = new FakeUnitOfWork(payments, steps, outbox);
    const service = new PaymentService(uow, payments, steps, outbox, new TopicResolver(false));

    await expect(
      service.createPayment({
        walletId: 'wallet-01',
        countryCode: 'PE',
        amount: 250,
        currency: 'PEN',
      }),
    ).rejects.toThrow('outbox_enqueue_failed');

    expect(payments.items.size).toBe(0);
    expect(steps.items.size).toBe(0);
    expect(outbox.items.size).toBe(0);
  });
});
