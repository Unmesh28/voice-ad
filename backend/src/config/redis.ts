import { Queue, Worker, QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { logger } from './logger';

// Redis connection configuration
const redisConnection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

redisConnection.on('connect', () => {
  logger.info('Redis connected successfully');
});

redisConnection.on('error', (error) => {
  logger.error('Redis connection error:', error);
});

// Queue names
export const QUEUE_NAMES = {
  SCRIPT_GENERATION: 'script-generation',
  TTS_GENERATION: 'tts-generation',
  MUSIC_GENERATION: 'music-generation',
  AUDIO_MIXING: 'audio-mixing',
};

// Create queues
export const scriptGenerationQueue = new Queue(QUEUE_NAMES.SCRIPT_GENERATION, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      count: 100, // Keep last 100 completed jobs
      age: 24 * 3600, // Keep for 24 hours
    },
    removeOnFail: {
      count: 200, // Keep last 200 failed jobs
    },
  },
});

export const ttsGenerationQueue = new Queue(QUEUE_NAMES.TTS_GENERATION, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      count: 100,
      age: 24 * 3600,
    },
    removeOnFail: {
      count: 200,
    },
  },
});

export const musicGenerationQueue = new Queue(QUEUE_NAMES.MUSIC_GENERATION, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      count: 100,
      age: 24 * 3600,
    },
    removeOnFail: {
      count: 200,
    },
  },
});

export const audioMixingQueue = new Queue(QUEUE_NAMES.AUDIO_MIXING, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: {
      count: 100,
      age: 24 * 3600,
    },
    removeOnFail: {
      count: 200,
    },
  },
});

// Queue events for monitoring
const setupQueueEvents = (queueName: string) => {
  const queueEvents = new QueueEvents(queueName, { connection: redisConnection });

  queueEvents.on('completed', ({ jobId }) => {
    logger.info(`Job ${jobId} in queue ${queueName} completed`);
  });

  queueEvents.on('failed', ({ jobId, failedReason }) => {
    logger.error(`Job ${jobId} in queue ${queueName} failed:`, failedReason);
  });

  queueEvents.on('progress', ({ jobId, data }) => {
    logger.debug(`Job ${jobId} in queue ${queueName} progress:`, data);
  });
};

// Setup events for all queues
Object.values(QUEUE_NAMES).forEach(setupQueueEvents);

export default redisConnection;
