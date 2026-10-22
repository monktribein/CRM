import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import type { EnvironmentVariables } from '../../config/env.js';
import { TOKEN_MODELS } from '../../database/models.js';
import { TokenService } from './token.service.js';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: { algorithm: 'HS256', issuer: 'bizwoke-nova', audience: 'bizwoke-nova-web' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'bizwoke-nova', audience: 'bizwoke-nova-web' },
      }),
    }),
    MongooseModule.forFeature(TOKEN_MODELS),
  ],
  providers: [TokenService],
  exports: [TokenService],
})
export class TokensModule {}
