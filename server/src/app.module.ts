import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { HealthController } from './health.controller';

// Serves the Vite build of the client (../client/dist). Set CLIENT_DIST to override.
const clientDist = process.env.CLIENT_DIST || join(__dirname, '..', '..', 'client', 'dist');

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: clientDist,
      exclude: ['/api/{*path}'],
      serveStaticOptions: { maxAge: '7d', index: 'index.html' },
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
