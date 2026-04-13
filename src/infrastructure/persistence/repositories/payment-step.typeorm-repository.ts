import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PaymentStep, StepStatus } from 'src/domain/entities/payment-step';
import { PaymentStepRepository } from 'src/domain/repositories/payment-step.repository';
import { PaymentStepOrmEntity } from 'src/infrastructure/persistence/entities/payment-step.orm-entity';
import { TransactionContext } from 'src/infrastructure/persistence/transaction-context';

@Injectable()
export class TypeOrmPaymentStepRepository implements PaymentStepRepository {
  constructor(
    private readonly dataSource: DataSource,
    private readonly transactionContext: TransactionContext,
  ) {}

  async init(paymentId: string): Promise<void> {
    const manager = this.transactionContext.getEntityManager() ?? this.dataSource.manager;
    await manager.getRepository(PaymentStepOrmEntity).save({
      paymentId,
      fraudStatus: StepStatus.Pending,
      ledgerStatus: StepStatus.Pending,
      failureReason: null,
    });
  }

  async markFraud(paymentId: string, status: StepStatus, reason?: string): Promise<void> {
    const manager = this.transactionContext.getEntityManager() ?? this.dataSource.manager;
    await manager.getRepository(PaymentStepOrmEntity).update(
      { paymentId },
      {
        fraudStatus: status,
        failureReason: status === StepStatus.Failed ? reason ?? 'fraud_rejected' : null,
      },
    );
  }

  async markLedger(paymentId: string, status: StepStatus, reason?: string): Promise<void> {
    const manager = this.transactionContext.getEntityManager() ?? this.dataSource.manager;
    await manager.getRepository(PaymentStepOrmEntity).update(
      { paymentId },
      {
        ledgerStatus: status,
        failureReason: status === StepStatus.Failed ? reason ?? 'ledger_failed' : null,
      },
    );
  }

  async getByPaymentId(paymentId: string): Promise<PaymentStep | null> {
    const manager = this.transactionContext.getEntityManager() ?? this.dataSource.manager;
    const row = await manager.getRepository(PaymentStepOrmEntity).findOneBy({ paymentId });
    if (!row) {
      return null;
    }

    return {
      paymentId: row.paymentId,
      fraudStatus: row.fraudStatus,
      ledgerStatus: row.ledgerStatus,
      failureReason: row.failureReason,
      updatedAt: row.updatedAt,
    };
  }
}
