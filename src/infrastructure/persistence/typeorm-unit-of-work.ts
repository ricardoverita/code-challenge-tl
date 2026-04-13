import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UnitOfWork } from 'src/domain/repositories/unit-of-work';
import { TransactionContext } from 'src/infrastructure/persistence/transaction-context';

@Injectable()
export class TypeOrmUnitOfWork implements UnitOfWork {
  constructor(
    private readonly dataSource: DataSource,
    private readonly transactionContext: TransactionContext,
  ) {}

  async execute<T>(work: () => Promise<T>): Promise<T> {
    return this.dataSource.transaction((manager) => {
      return this.transactionContext.runInTransaction(manager, work);
    });
  }
}
