import { ConsumerExecutorService } from 'src/domain/services/consumer-executor.service';
import { FakeDeadLetterPublisher } from 'test/helpers/fakes';

describe('DLT handler', () => {
  it('sends event to DLT after retry budget is exhausted', async () => {
    const dltPublisher = new FakeDeadLetterPublisher();
    const service = new ConsumerExecutorService(dltPublisher);

    let attempts = 0;
    await service.executeWithRetry(
      {
        consumerName: 'fraud-consumer',
        sourceTopic: 'payment.created.v1',
        eventId: 'evt-1',
        payload: JSON.stringify({ eventId: 'evt-1' }),
      },
      3,
      async () => {
        attempts += 1;
        throw new Error('simulated_failure');
      },
    );

    expect(attempts).toBe(3);
    expect(dltPublisher.dlt).toHaveLength(1);
    expect(dltPublisher.dlt[0].originalTopic).toBe('payment.created.v1');
  });
});
