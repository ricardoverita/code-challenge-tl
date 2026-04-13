import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ProcessedEventRepository } from 'src/domain/repositories/processed-event.repository';
import { ProcessedEventOrmEntity } from 'src/infrastructure/persistence/entities/processed-event.orm-entity';

@Injectable()
export class TypeOrmProcessedEventRepository implements ProcessedEventRepository {
  constructor(private readonly dataSource: DataSource) {}

  async tryMarkProcessed(consumerName: string, countryCode: string, eventId: string): Promise<boolean> {
    try {
      await this.dataSource.getRepository(ProcessedEventOrmEntity).insert({
        consumerName,
        countryCode,
        eventId,
      });
      return true;
    } catch {
      return false;
    }
  }
}
