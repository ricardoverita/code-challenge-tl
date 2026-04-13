import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { loadEnv } from 'src/config/env';
import { TopicResolver } from 'src/domain/services/topic-resolver';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [loadEnv],
    }),
  ],
  providers: [
    {
      provide: TopicResolver,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        new TopicResolver(configService.get<boolean>('countryNamespaceEnabled', false)),
    },
  ],
  exports: [ConfigModule, TopicResolver],
})
export class CoreModule {}
