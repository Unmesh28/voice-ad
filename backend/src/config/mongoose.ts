import mongoose from 'mongoose';
import { logger } from './logger';

const DATABASE_URL = process.env.DATABASE_URL || 'mongodb://localhost:27017/voicead_db';

export const connectDB = async () => {
  try {
    await mongoose.connect(DATABASE_URL);
    logger.info('MongoDB connected successfully via Mongoose');
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('MongoDB connection failed: %s', msg);
    logger.error(
      'Make sure MongoDB is running. Start it with: mongod (or Docker: docker run -p 27017:27017 mongo). DATABASE_URL=%s',
      DATABASE_URL.replace(/\/\/[^@]+@/, '//***@') // hide credentials in log
    );
    process.exit(1);
  }
};

export default mongoose;
