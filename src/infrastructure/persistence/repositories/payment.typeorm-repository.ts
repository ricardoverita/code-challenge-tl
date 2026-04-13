import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Payment, PaymentStatus } from 'src/domain/entities/payment';
import { CreatePaymentParams, PaymentRepository } from 'src/domain/repositories/payment.repository';
import { PaymentOrmEntity } from 'src/infrastructure/persistence/entities/payment.orm-entity';
import { TransactionContext } from 'src/infrastructure/persistence/transaction-context';

@Injectable()
export class TypeOrmPaymentRepository implements PaymentRepository {
  constructor(
    private readonly dataSource: DataSource,
    private readonly transactionContext: TransactionContext,
  ) {}

  async createPending(params: CreatePaymentParams): Promise<Payment> {
    const manager = this.transactionContext.getEntityManager() ?? this.dataSource.manager;
    const repository = manager.getRepository(PaymentOrmEntity);

    const entity = repository.create({
      id: params.id,
      walletId: params.walletId,
      countryCode: params.countryCode,
      amount: params.amount.toFixed(2),
      currency: params.currency,
      status: PaymentStatus.Pending,
    });

    const saved = await repository.save(entity);
    return this.toDomain(saved);
  }

  async updateStatus(paymentId: string, status: PaymentStatus): Promise<void> {
    const manager = this.transactionContext.getEntityManager() ?? this.dataSource.manager;
    await manager.getRepository(PaymentOrmEntity).update({ id: paymentId }, { status });
  }

  async getById(paymentId: string): Promise<Payment | null> {
    const manager = this.transactionContext.getEntityManager() ?? this.dataSource.manager;
    const row = await manager.getRepository(PaymentOrmEntity).findOneBy({ id: paymentId });
    if (!row) {
      return null;
    }

    return this.toDomain(row);
  }

  private toDomain(row: PaymentOrmEntity): Payment {
    return {
      id: row.id,
      walletId: row.walletId,
      countryCode: row.countryCode,
      amount: Number(row.amount),
      currency: row.currency,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
