import { Column, Entity, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { StepStatus } from 'src/domain/entities/payment-step';
import { PaymentOrmEntity } from 'src/infrastructure/persistence/entities/payment.orm-entity';

@Entity({ name: 'payment_steps' })
export class PaymentStepOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  paymentId!: string;

  @OneToOne(() => PaymentOrmEntity)
  payment?: PaymentOrmEntity;

  @Column({ type: 'varchar', length: 16 })
  fraudStatus!: StepStatus;

  @Column({ type: 'varchar', length: 16 })
  ledgerStatus!: StepStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  failureReason!: string | null;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
