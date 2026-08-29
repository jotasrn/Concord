import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT, RedisService } from './redis.service';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const logger = new Logger('RedisClient');
        const client = new Redis(config.getOrThrow<string>('redisUrl'), {
          maxRetriesPerRequest: 3,
          lazyConnect: false,
        });

        // Without a listener ioredis escalates connection errors to an
        // unhandled 'error' event and kills the process. ioredis retries once
        // per second, so we log only the first failure of each outage.
        let outageReported = false;
        client.on('error', (error: Error) => {
          if (outageReported) return;
          outageReported = true;
          logger.warn(`Redis indisponivel: ${error.message || error.name}. Tentando reconectar...`);
        });
        client.on('ready', () => {
          outageReported = false;
          logger.log('Redis conectado');
        });

        return client;
      },
    },
    RedisService,
  ],
  exports: [RedisService, REDIS_CLIENT],
})
export class RedisModule {}
