import { Inject, Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PaymentStatus } from 'src/domain/entities/payment';
import { EventTypes } from 'src/domain/events/event-types';
import { OUTBOX_REPOSITORY, OutboxRepository } from 'src/domain/repositories/outbox.repository';
import { PAYMENT_REPOSITORY, PaymentRepository } from 'src/domain/repositories/payment.repository';
import { PAYMENT_STEP_REPOSITORY, PaymentStepRepository } from 'src/domain/repositories/payment-step.repository';
import { UNIT_OF_WORK, UnitOfWork } from 'src/domain/repositories/unit-of-work';
import { TopicResolver } from 'src/domain/services/topic-resolver';

export interface CreatePaymentCommand {
  walletId: string;
  countryCode: string;
  amount: number;
  currency: string;
}

export interface PaymentCreationResult {
  paymentId: string;
  status: PaymentStatus;
}

@Injectable()
export class PaymentService {
  constructor(
    @Inject(UNIT_OF_WORK)
    private readonly unitOfWork: UnitOfWork,
    @Inject(PAYMENT_REPOSITORY)
    private readonly paymentRepository: PaymentRepository,
    @Inject(PAYMENT_STEP_REPOSITORY)
    private readonly paymentStepRepository: PaymentStepRepository,
    @Inject(OUTBOX_REPOSITORY)
    private readonly outboxRepository: OutboxRepository,
    private readonly topicResolver: TopicResolver,
  ) {}

  async createPayment(command: CreatePaymentCommand): Promise<PaymentCreationResult> {
    const paymentId = uuidv4();
    const eventId = uuidv4();
    const outboxId = uuidv4();
    const occurredAt = new Date().toISOString();

    await this.unitOfWork.execute(async () => {
      await this.paymentRepository.createPending({
        id: paymentId,
        walletId: command.walletId,
        countryCode: command.countryCode,
        amount: command.amount,
        currency: command.currency,
      });

      await this.paymentStepRepository.init(paymentId);

      const topic = this.topicResolver.resolve(EventTypes.PaymentCreatedV1, command.countryCode);

      await this.outboxRepository.enqueue({
        id: outboxId,
        aggregateId: paymentId,
        eventId,
        eventType: EventTypes.PaymentCreatedV1,
        topic,
        countryCode: command.countryCode,
        payload: JSON.stringify({
          eventId,
          type: EventTypes.PaymentCreatedV1,
          aggregateId: paymentId,
          occurredAt,
          countryCode: command.countryCode,
          schemaVersion: 1,
          payload: {
            paymentId,
            walletId: command.walletId,
            amount: command.amount,
            currency: command.currency,
          },
        }),
      });
    });

    return {
      paymentId,
      status: PaymentStatus.Pending,
    };
  }
}
