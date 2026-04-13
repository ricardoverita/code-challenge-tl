export enum PaymentStatus {
  Pending = 'pending',
  Settled = 'settled',
  Failed = 'failed',
}

export interface Payment {
  id: string;
  walletId: string;
  countryCode: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  createdAt: Date;
  updatedAt: Date;
}
