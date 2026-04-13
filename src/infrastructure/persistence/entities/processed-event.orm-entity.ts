import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'processed_events' })
@Index('uniq_consumer_country_event', ['consumerName', 'countryCode', 'eventId'], { unique: true })
export class ProcessedEventOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 128 })
  consumerName!: string;

  @Column({ type: 'char', length: 2 })
  countryCode!: string;

  @Column({ type: 'varchar', length: 128 })
  eventId!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  processedAt!: Date;
}
