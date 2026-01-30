# Redis Eviction Policy Fix

## Issue

When starting the backend, you see repeated warnings:
```
IMPORTANT! Eviction policy is allkeys-lru. It should be "noeviction"
```

## Why This Matters

BullMQ (the job queue system) requires Redis to use the **"noeviction"** policy to ensure job data is never evicted from memory. If Redis evicts data, jobs can be lost, causing production failures.

## Quick Fix

### Option 1: Automated Fix (Recommended)

Run the automated fix script:

```bash
cd voice-ad
./scripts/fix-redis-eviction.sh
```

This script will:
- ✅ Detect your Redis configuration file
- ✅ Backup the current configuration
- ✅ Update eviction policy to "noeviction"
- ✅ Restart Redis
- ✅ Verify the fix

### Option 2: Manual Fix

#### macOS (Homebrew)

1. Find your Redis config:
   ```bash
   # Usually at one of these locations:
   /opt/homebrew/etc/redis.conf  # Apple Silicon
   /usr/local/etc/redis.conf     # Intel
   ```

2. Edit the config:
   ```bash
   nano /opt/homebrew/etc/redis.conf
   ```

3. Find and change the line:
   ```
   # Change this:
   maxmemory-policy allkeys-lru

   # To this:
   maxmemory-policy noeviction
   ```

4. Restart Redis:
   ```bash
   brew services restart redis
   ```

#### Linux (Ubuntu/Debian)

1. Edit Redis config:
   ```bash
   sudo nano /etc/redis/redis.conf
   ```

2. Find and change the line:
   ```
   # Change this:
   maxmemory-policy allkeys-lru

   # To this:
   maxmemory-policy noeviction
   ```

3. Restart Redis:
   ```bash
   sudo systemctl restart redis-server
   ```

#### Windows (WSL)

Same as Linux instructions above.

## Verify the Fix

Check if the policy is correctly set:

```bash
redis-cli CONFIG GET maxmemory-policy
```

Expected output:
```
1) "maxmemory-policy"
2) "noeviction"
```

## After Fixing

1. Stop your backend server (Ctrl+C)
2. Restart it:
   ```bash
   cd backend
   npm run dev
   ```

The warnings should be gone!

## Understanding Eviction Policies

| Policy | Behavior | Use Case |
|--------|----------|----------|
| **noeviction** | Never evict, return errors when full | Job queues, critical data |
| **allkeys-lru** | Evict least recently used keys | Caching systems |
| **volatile-lru** | Evict LRU keys with expiry set | Mixed workloads |

For BullMQ job queues, **noeviction** is required because:
- Job data must never be lost
- Queue integrity is critical
- Failed jobs need retry capability
- Job history must be preserved

## Troubleshooting

### Redis not found

If Redis isn't installed:

**macOS:**
```bash
brew install redis
brew services start redis
```

**Ubuntu/Linux:**
```bash
sudo apt update
sudo apt install redis-server
sudo systemctl start redis-server
```

### Permission denied

Use `sudo` for editing config files:
```bash
sudo nano /etc/redis/redis.conf
```

### Changes not taking effect

1. Make sure you restarted Redis:
   ```bash
   # macOS
   brew services restart redis

   # Linux
   sudo systemctl restart redis-server
   ```

2. Verify with:
   ```bash
   redis-cli CONFIG GET maxmemory-policy
   ```

### Redis won't start

Check Redis logs:

**macOS:**
```bash
tail -f /opt/homebrew/var/log/redis.log
```

**Linux:**
```bash
sudo journalctl -u redis-server -f
```

## Additional Resources

- [BullMQ Documentation](https://docs.bullmq.io/)
- [Redis Eviction Policies](https://redis.io/docs/manual/eviction/)
- [Redis Configuration](https://redis.io/docs/manual/config/)
