import mongoose, { Document, Schema } from 'mongoose';

export interface IScript extends Document {
  projectId: mongoose.Types.ObjectId;
  title: string;
  content: string;
  metadata?: any;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const ScriptSchema = new Schema<IScript>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
    },
    version: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: true,
  }
);

export const Script = mongoose.model<IScript>('Script', ScriptSchema);
