import { Worker } from 'bullmq';
import { redisConnection } from '../services/queue.service';

// We use the existing redis connection for the worker too.
// Note: BullMQ recommends separate connections for Queue and Worker,
// but passing the same host/config by duplicating connection config is easy.
import Redis from 'ioredis';
import dotenv from 'dotenv';
dotenv.config();

const workerRedis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
});

// A separate redis connection specifically for pub/sub publishing
const pubSubRedis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

export const propagationWorker = new Worker(
  'propagation',
  async (job) => {
    // This is a stub for Person 3's Congestion Propagation Engine
    const { eventId, initialSeverity } = job.data;
    
    // BullMQ repeatable jobs use the same base data for every run. 
    // To track state across runs, we use Redis to increment a counter.
    const tickKey = `propagation_tick:${eventId}`;
    const currentTick = await workerRedis.incr(tickKey);

    console.log(`[Worker] Processing propagation tick ${currentTick} for event ${eventId}`);
    
    // Simulate some logic
    const intensity = Math.max(0, initialSeverity - (currentTick * 0.05));
    
    // Publish to Redis channel so WebSocket server can broadcast
    const payload = JSON.stringify({
      event: 'propagation:tick',
      data: {
        eventId,
        tick: currentTick,
        simulatedIntensity: intensity,
        timestamp: new Date().toISOString()
      }
    });

    await pubSubRedis.publish('gridlock:events', payload);
    
    // Return data can be inspected if needed
    return { success: true, tick: currentTick };
  },
  { connection: workerRedis as any }
);

propagationWorker.on('completed', (job) => {
  // console.log(`Job ${job.id} has completed!`);
});

propagationWorker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} has failed with ${err.message}`);
});
