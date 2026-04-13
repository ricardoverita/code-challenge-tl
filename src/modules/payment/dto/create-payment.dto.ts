import { IsISO31661Alpha2, IsNumber, IsPositive, IsString, Length } from 'class-validator';

export class CreatePaymentDto {
  @IsString()
  @Length(3, 64)
  walletId!: string;

  @IsISO31661Alpha2()
  countryCode!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @IsString()
  @Length(3, 3)
  currency!: string;
}
