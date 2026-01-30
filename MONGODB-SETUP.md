# MongoDB Atlas Setup Guide

Since MongoDB is not installed locally, use **MongoDB Atlas** (free cloud MongoDB).

## Quick Setup (5 minutes):

1. **Create Account**
   - Go to: https://cloud.mongodb.com/
   - Sign up with Google/GitHub or email

2. **Create Free Cluster**
   - Choose "Build a Database"
   - Select FREE (M0) tier
   - Choose closest region (Mumbai for India)
   - Click "Create"

3. **Create Database User**
   - Security → Database Access
   - Add New Database User
   - Username: `voicead_user`
   - Password: (generate or create strong password)
   - Database User Privileges: Read and write to any database
   - Add User

4. **Allow Network Access**
   - Security → Network Access
   - Add IP Address
   - Choose "Allow Access from Anywhere" (0.0.0.0/0)
   - Confirm

5. **Get Connection String**
   - Click "Connect" on your cluster
   - Choose "Connect your application"
   - Copy the connection string (looks like):
     ```
     mongodb+srv://voicead_user:<password>@cluster0.xxxxx.mongodb.net/voicead_db?retryWrites=true&w=majority
     ```
   - Replace `<password>` with your actual password

6. **Update .env file**
   - Edit `backend/.env`
   - Replace DATABASE_URL with your connection string
   - Make sure to replace `<password>` and add `/voicead_db` before the `?`

## Example:
```env
DATABASE_URL=mongodb+srv://voicead_user:MyPassword123@cluster0.abc123.mongodb.net/voicead_db?retryWrites=true&w=majority
```

## Then run:
```bash
cd backend
npm run dev
```

The predev script will check Redis (which is running) and your app will connect to MongoDB Atlas!

## Alternative: Local MongoDB Installation
If you prefer local MongoDB:
```bash
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt-get update
sudo apt-get install -y mongodb-org
sudo mkdir -p /data/db
sudo mongod --fork --logpath /var/log/mongodb.log --dbpath /data/db
```
