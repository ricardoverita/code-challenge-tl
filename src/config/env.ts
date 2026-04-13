export interface AppEnv {
  nodeEnv: string;
  port: number;
  dbHost: string;
  dbPort: number;
  dbUser: string;
  dbPassword: string;
  dbName: string;
  kafkaBrokers: string[];
  kafkaClientId: string;
  kafkaGroupIdPrefix: string;
  supportedCountries: string[];
  relayPollMs: number;
  maxConsumerRetries: number;
  countryNamespaceEnabled: boolean;
}

const parseCountries = (raw: string): string[] =>
  raw
    .split(',')
    .map((country) => country.trim().toLowerCase())
    .filter((country) => country.length > 0);

export function loadEnv(): AppEnv {
  return {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 3000),
    dbHost: process.env.DB_HOST ?? '127.0.0.1',
    dbPort: Number(process.env.DB_PORT ?? 5432),
    dbUser: process.env.DB_USER ?? 'postgres',
    dbPassword: process.env.DB_PASSWORD ?? 'postgres',
    dbName: process.env.DB_NAME ?? 'yape',
    kafkaBrokers: (process.env.KAFKA_BROKERS ?? '127.0.0.1:9092').split(','),
    kafkaClientId: process.env.KAFKA_CLIENT_ID ?? 'payment-platform',
    kafkaGroupIdPrefix: process.env.KAFKA_GROUP_PREFIX ?? 'challenge',
    supportedCountries: parseCountries(process.env.SUPPORTED_COUNTRIES ?? 'pe,mx'),
    relayPollMs: Number(process.env.RELAY_POLL_MS ?? 1000),
    maxConsumerRetries: Number(process.env.MAX_CONSUMER_RETRIES ?? 3),
    countryNamespaceEnabled: (process.env.COUNTRY_NAMESPACE_ENABLED ?? 'false') === 'true',
  };
}
