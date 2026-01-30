import mongoose, { Document, Schema } from 'mongoose';

export enum ProductionStatus {
  PENDING = 'PENDING',
  GENERATING_VOICE = 'GENERATING_VOICE',
  GENERATING_MUSIC = 'GENERATING_MUSIC',
  MIXING = 'MIXING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export interface IProduction extends Document {
  projectId: mongoose.Types.ObjectId;
  scriptId?: mongoose.Types.ObjectId;
  voiceId?: string;
  musicId?: mongoose.Types.ObjectId;
  status: ProductionStatus;
  settings?: any;
  outputUrl?: string;
  duration?: number;
  errorMessage?: string;
  progress: number;
  createdAt: Date;
  updatedAt: Date;
}

const ProductionSchema = new Schema<IProduction>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    scriptId: {
      type: Schema.Types.ObjectId,
      ref: 'Script',
    },
    voiceId: {
      type: String,
    },
    musicId: {
      type: Schema.Types.ObjectId,
      ref: 'MusicTrack',
    },
    status: {
      type: String,
      enum: Object.values(ProductionStatus),
      default: ProductionStatus.PENDING,
    },
    settings: {
      type: Schema.Types.Mixed,
    },
    outputUrl: {
      type: String,
    },
    duration: {
      type: Number,
    },
    errorMessage: {
      type: String,
    },
    progress: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

export const Production = mongoose.model<IProduction>('Production', ProductionSchema);
