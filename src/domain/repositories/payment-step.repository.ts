import { PaymentStep, StepStatus } from 'src/domain/entities/payment-step';

export const PAYMENT_STEP_REPOSITORY = Symbol('PAYMENT_STEP_REPOSITORY');

export interface PaymentStepRepository {
  init(paymentId: string): Promise<void>;
  markFraud(paymentId: string, status: StepStatus, reason?: string): Promise<void>;
  markLedger(paymentId: string, status: StepStatus, reason?: string): Promise<void>;
  getByPaymentId(paymentId: string): Promise<PaymentStep | null>;
}
