import mongoose from 'mongoose';
import { logger } from './logger';

const DATABASE_URL = process.env.DATABASE_URL || 'mongodb://localhost:27017/voicead_db';

export const connectDB = async () => {
  try {
    await mongoose.connect(DATABASE_URL);
    logger.info('MongoDB connected successfully via Mongoose');
  } catch (error: any) {
    logger.error('MongoDB connection error:', error.message);
    process.exit(1);
  }
};

export default mongoose;
