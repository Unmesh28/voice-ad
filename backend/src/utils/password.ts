import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, SALT_ROUNDS);
};

export const comparePassword = async (
  password: string,
  hashedPassword: string | undefined | null
): Promise<boolean> => {
  if (password == null || hashedPassword == null || hashedPassword === '') {
    return false;
  }
  return bcrypt.compare(password, hashedPassword);
};
