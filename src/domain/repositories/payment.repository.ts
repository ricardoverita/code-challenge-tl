import { Payment, PaymentStatus } from 'src/domain/entities/payment';

export interface CreatePaymentParams {
  id: string;
  walletId: string;
  countryCode: string;
  amount: number;
  currency: string;
}

export const PAYMENT_REPOSITORY = Symbol('PAYMENT_REPOSITORY');

export interface PaymentRepository {
  createPending(params: CreatePaymentParams): Promise<Payment>;
  updateStatus(paymentId: string, status: PaymentStatus): Promise<void>;
  getById(paymentId: string): Promise<Payment | null>;
}
