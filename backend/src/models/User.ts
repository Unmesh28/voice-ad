import mongoose, { Document, Schema } from 'mongoose';

/**
 * User model. Uses snake_case field names to match MongoDB collection "users"
 * (unique index on api_key, etc.).
 */
export interface IUser extends Document {
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  api_key: string;
  role: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

const UserSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password_hash: {
      type: String,
      required: true,
    },
    first_name: {
      type: String,
      required: true,
    },
    last_name: {
      type: String,
      required: true,
    },
    api_key: {
      type: String,
      required: true,
      unique: true,
    },
    role: {
      type: String,
      default: 'user',
      enum: ['user', 'admin'],
    },
    is_active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'users',
  }
);

export const User = mongoose.model<IUser>('User', UserSchema);
