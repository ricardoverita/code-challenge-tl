import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentRepository, PAYMENT_REPOSITORY } from 'src/domain/repositories/payment.repository';
import {
  PaymentStepRepository,
  PAYMENT_STEP_REPOSITORY,
} from 'src/domain/repositories/payment-step.repository';

@Injectable()
export class PaymentStatusQuery {
  constructor(
    @Inject(PAYMENT_REPOSITORY)
    private readonly paymentRepository: PaymentRepository,
    @Inject(PAYMENT_STEP_REPOSITORY)
    private readonly paymentStepRepository: PaymentStepRepository,
  ) {}

  async getStatus(paymentId: string): Promise<{
    paymentId: string;
    status: string;
    fraudStep: string;
    ledgerStep: string;
    consistency: 'eventual';
    note: string;
    lastUpdatedAt: string;
  }> {
    const payment = await this.paymentRepository.getById(paymentId);
    if (!payment) {
      throw new NotFoundException(`payment ${paymentId} not found`);
    }

    const step = await this.paymentStepRepository.getByPaymentId(paymentId);

    return {
      paymentId,
      status: payment.status,
      fraudStep: step?.fraudStatus ?? 'pending',
      ledgerStep: step?.ledgerStatus ?? 'pending',
      consistency: 'eventual',
      note:
        'This endpoint is eventually consistent. A recently created payment can remain pending until fraud and ledger consumers acknowledge.',
      lastUpdatedAt: payment.updatedAt.toISOString(),
    };
  }
}
