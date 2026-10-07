import pino from 'pino';
import { config } from '../config.js';

/**
 * Application logger. Fields ending in "authorization", "cookie", "apikey",
 * "accessKeyId", "secretAccessKey", "sessionToken", "token", "password" are
 * automatically redacted so log lines can be safely shipped to CloudWatch.
 */
export const logger = pino({
  level: config.log.level,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-lifeops-api-key"]',
      '*.accessKeyId',
      '*.secretAccessKey',
      '*.sessionToken',
      '*.token',
      '*.password',
      '*.apiKey',
    ],
    censor: '[REDACTED]',
  },
  ...(config.env !== 'production'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, singleLine: false, translateTime: 'HH:MM:ss.l' },
        },
      }
    : {}),
});

export type Logger = typeof logger;
