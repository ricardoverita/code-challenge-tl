export enum StepStatus {
  Pending = 'pending',
  Succeeded = 'succeeded',
  Failed = 'failed',
}

export interface PaymentStep {
  paymentId: string;
  fraudStatus: StepStatus;
  ledgerStatus: StepStatus;
  failureReason?: string | null;
  updatedAt: Date;
}
