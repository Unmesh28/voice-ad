import mongoose, { Document, Schema } from 'mongoose';

export interface IMusicTrack extends Document {
  name: string;
  description?: string;
  genre?: string;
  mood?: string;
  duration: number;
  fileUrl: string;
  isGenerated: boolean;
  metadata?: any;
  createdAt: Date;
}

const MusicTrackSchema = new Schema<IMusicTrack>(
  {
    name: {
      type: String,
      required: true,
    },
    description: {
      type: String,
    },
    genre: {
      type: String,
    },
    mood: {
      type: String,
    },
    duration: {
      type: Number,
      required: true,
    },
    fileUrl: {
      type: String,
      required: true,
    },
    isGenerated: {
      type: Boolean,
      default: false,
    },
    metadata: {
      type: Schema.Types.Mixed,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

export const MusicTrack = mongoose.model<IMusicTrack>('MusicTrack', MusicTrackSchema);
