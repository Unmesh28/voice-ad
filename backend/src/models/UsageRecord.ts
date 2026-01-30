import mongoose, { Document, Schema } from 'mongoose';

export enum ResourceType {
  TTS_CHARACTERS = 'TTS_CHARACTERS',
  MUSIC_GENERATION = 'MUSIC_GENERATION',
  SCRIPT_GENERATION = 'SCRIPT_GENERATION',
  AUDIO_MIXING = 'AUDIO_MIXING',
}

export interface IUsageRecord extends Document {
  userId: mongoose.Types.ObjectId;
  resourceType: ResourceType;
  quantity: number;
  cost?: number;
  metadata?: any;
  createdAt: Date;
}

const UsageRecordSchema = new Schema<IUsageRecord>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    resourceType: {
      type: String,
      enum: Object.values(ResourceType),
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
    },
    cost: {
      type: Number,
    },
    metadata: {
      type: Schema.Types.Mixed,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

export const UsageRecord = mongoose.model<IUsageRecord>('UsageRecord', UsageRecordSchema);
