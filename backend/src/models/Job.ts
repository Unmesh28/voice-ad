import mongoose, { Document, Schema } from 'mongoose';

export enum JobType {
  SCRIPT_GENERATION = 'SCRIPT_GENERATION',
  TTS_GENERATION = 'TTS_GENERATION',
  MUSIC_GENERATION = 'MUSIC_GENERATION',
  AUDIO_MIXING = 'AUDIO_MIXING',
}

export enum JobStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export interface IJob extends Document {
  type: JobType;
  payload: any;
  status: JobStatus;
  progress: number;
  result?: any;
  errorMessage?: string;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

const JobSchema = new Schema<IJob>(
  {
    type: {
      type: String,
      enum: Object.values(JobType),
      required: true,
    },
    payload: {
      type: Schema.Types.Mixed,
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(JobStatus),
      default: JobStatus.PENDING,
    },
    progress: {
      type: Number,
      default: 0,
    },
    result: {
      type: Schema.Types.Mixed,
    },
    errorMessage: {
      type: String,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 3,
    },
    completedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

export const Job = mongoose.model<IJob>('Job', JobSchema);
