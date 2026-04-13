import { Injectable } from '@nestjs/common';
import { Brackets, DataSource } from 'typeorm';
import { OutboxStatus } from 'src/domain/entities/outbox-event';
import { EnqueueOutboxEventParams, OutboxRepository } from 'src/domain/repositories/outbox.repository';
import { OutboxEventOrmEntity } from 'src/infrastructure/persistence/entities/outbox-event.orm-entity';
import { TransactionContext } from 'src/infrastructure/persistence/transaction-context';

@Injectable()
export class TypeOrmOutboxRepository implements OutboxRepository {
  private static readonly CLAIM_TIMEOUT_MS = 60_000;

  constructor(
    private readonly dataSource: DataSource,
    private readonly transactionContext: TransactionContext,
  ) {}

  async enqueue(params: EnqueueOutboxEventParams): Promise<void> {
    const manager = this.transactionContext.getEntityManager() ?? this.dataSource.manager;
    const repository = manager.getRepository(OutboxEventOrmEntity);
    await repository.save({
      id: params.id,
      aggregateId: params.aggregateId,
      eventId: params.eventId,
      eventType: params.eventType,
      topic: params.topic,
      countryCode: params.countryCode,
      payload: params.payload,
      status: OutboxStatus.Pending,
      attempts: 0,
      nextAttemptAt: new Date(),
      publishedAt: null,
    });
  }

  async lockPendingBatch(limit: number, now: Date): Promise<OutboxEventOrmEntity[]> {
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(OutboxEventOrmEntity);
      const staleProcessingBefore = new Date(now.getTime() - TypeOrmOutboxRepository.CLAIM_TIMEOUT_MS);

      const claimable = await repository
        .createQueryBuilder('outbox')
        .where(
          new Brackets((qb) => {
            qb.where('outbox.status = :pendingStatus AND outbox.nextAttemptAt <= :now', {
              pendingStatus: OutboxStatus.Pending,
              now,
            }).orWhere('outbox.status = :processingStatus AND outbox.updatedAt <= :staleProcessingBefore', {
              processingStatus: OutboxStatus.Processing,
              staleProcessingBefore,
            });
          }),
        )
        .orderBy('outbox.createdAt', 'ASC')
        .limit(limit)
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .getMany();

      if (claimable.length === 0) {
        return [];
      }

      const claimableIds = claimable.map((event) => event.id);

      await repository
        .createQueryBuilder()
        .update(OutboxEventOrmEntity)
        .set({
          status: OutboxStatus.Processing,
          nextAttemptAt: now,
        })
        .whereInIds(claimableIds)
        .execute();

      return claimable.map((event) => ({
        ...event,
        status: OutboxStatus.Processing,
        nextAttemptAt: now,
      }));
    });
  }

  async markPublished(outboxId: string, publishedAt: Date): Promise<void> {
    await this.dataSource
      .getRepository(OutboxEventOrmEntity)
      .createQueryBuilder()
      .update(OutboxEventOrmEntity)
      .set({
        status: OutboxStatus.Published,
        attempts: () => 'attempts + 1',
        publishedAt,
      })
      .where('id = :outboxId', { outboxId })
      .andWhere('status = :processingStatus', { processingStatus: OutboxStatus.Processing })
      .execute();
  }

  async markForRetry(outboxId: string, nextAttemptAt: Date): Promise<void> {
    await this.dataSource
      .getRepository(OutboxEventOrmEntity)
      .createQueryBuilder()
      .update(OutboxEventOrmEntity)
      .set({
        status: OutboxStatus.Pending,
        attempts: () => 'attempts + 1',
        nextAttemptAt,
      })
      .where('id = :outboxId', { outboxId })
      .andWhere('status = :processingStatus', { processingStatus: OutboxStatus.Processing })
      .execute();
  }
}
