import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.disable('x-powered-by');
  app.use((_req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => {
    // Files never leave the browser, so the page needs no outbound connections
    // except the OCR language data CDN used by Tesseract.js.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    next();
  });
  const port = Number(process.env.PORT) || 3000;
  await app.listen(port);
  console.log(`PDF Toolkit running on http://localhost:${port}`);
}
bootstrap();
