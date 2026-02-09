import winston from 'winston';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'voice-ad-backend' },
  transports: [
    // Console output
    new winston.transports.Console({
      format: consoleFormat
    }),
    // Error log file
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // Combined log file
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

// Dedicated logger for TTM (Text-to-Music) prompts - logs FULL prompts without truncation
const ttmPromptFormat = winston.format.printf(({ timestamp, message, ...meta }: any) => {
  // Custom format for TTM prompts - no truncation, clean formatting
  let output = `\n${'='.repeat(80)}\n`;
  output += `[${timestamp}] TTM PROMPT\n`;
  output += `${'='.repeat(80)}\n`;
  if (meta.pipelineId) output += `Pipeline ID: ${meta.pipelineId}\n`;
  if (meta.jobId) output += `Job ID: ${meta.jobId}\n`;
  if (meta.provider) output += `Provider: ${meta.provider}\n`;
  if (meta.mode) output += `Mode: ${meta.mode}\n`;
  if (typeof meta.segmentIndex === 'number') output += `Segment: ${meta.segmentIndex + 1}/${meta.totalSegments}\n`;
  if (meta.segmentLabel) output += `Segment Label: ${meta.segmentLabel}\n`;
  output += `${'-'.repeat(80)}\n`;
  output += `${message}\n`;
  output += `${'='.repeat(80)}\n`;
  return output;
});

export const ttmPromptLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    ttmPromptFormat
  ),
  transports: [
    // Console output for development
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        ttmPromptFormat
      )
    }),
    // File output for permanent storage
    new winston.transports.File({
      filename: 'logs/ttm-prompts.log',
      maxsize: 10485760, // 10MB (larger since prompts can be long)
      maxFiles: 10
    })
  ]
});

// Create logs directory if it doesn't exist
import fs from 'fs';
import path from 'path';

const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}
