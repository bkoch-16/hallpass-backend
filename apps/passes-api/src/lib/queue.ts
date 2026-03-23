import { Queue, Worker, type Job, type ConnectionOptions } from 'bullmq';
import Redis from 'ioredis';
import { env } from '../env.js';
import { prisma } from '@hallpass/db';
import { releaseSlot, promoteFromQueue } from './slots.js';
import { emitPassEvent } from './socket.js';

const bullmqConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }) as unknown as ConnectionOptions;

export const passExpiryQueue = new Queue('pass-expiry', {
  connection: bullmqConnection,
  defaultJobOptions: { removeOnComplete: 100, removeOnFail: 50 },
});

export async function schedulePassExpiry(passId: number, periodEndTime: Date): Promise<void> {
  const delay = Math.max(0, periodEndTime.getTime() - Date.now());
  await passExpiryQueue.add(
    'expire',
    { passId },
    { jobId: `pass-${passId}`, delay },
  );
}

export async function processPassExpiry(job: Job): Promise<void> {
  const { passId } = job.data as { passId: number };
  const pass = await prisma.pass.findUnique({ where: { id: passId }, include: { period: true } });
  if (!pass) return;

  const terminal = ['COMPLETED', 'CANCELLED', 'DENIED', 'EXPIRED'];
  if (terminal.includes(pass.status)) return;

  if (pass.status === 'PENDING' || pass.status === 'WAITING') {
    const updated = await prisma.pass.update({
      where: { id: passId },
      data: { status: 'EXPIRED', expiredAt: new Date() },
    });
    emitPassEvent(updated, 'pass:expired');
    return;
  }

  if (pass.status === 'ACTIVE') {
    const isLastPeriod = await checkIsLastPeriod(pass);
    const destination = await prisma.destination.findUnique({ where: { id: pass.destinationId } });

    if (isLastPeriod) {
      const updated = await prisma.pass.update({
        where: { id: passId },
        data: { status: 'COMPLETED', returnedAt: new Date() },
      });
      emitPassEvent(updated, 'pass:returned');
      await releaseSlot(pass.destinationId, destination?.maxOccupancy ?? null);
      await promoteFromQueue(pass.destinationId, destination?.maxOccupancy ?? null);
    } else {
      const updated = await prisma.pass.update({
        where: { id: passId },
        data: { status: 'EXPIRED', expiredAt: new Date() },
      });
      emitPassEvent(updated, 'pass:expired');
      await releaseSlot(pass.destinationId, destination?.maxOccupancy ?? null);
      await promoteFromQueue(pass.destinationId, destination?.maxOccupancy ?? null);
    }
  }
}

export function startExpiryWorker(): Worker {
  const worker = new Worker('pass-expiry', processPassExpiry, {
    connection: new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }) as unknown as ConnectionOptions,
  });

  worker.on('error', (err) => console.error('[queue] worker error:', err.message));
  return worker;
}

async function checkIsLastPeriod(pass: { periodId: number | null; schoolId: number }): Promise<boolean> {
  if (!pass.periodId) return true;
  const currentPeriod = await prisma.period.findUnique({ where: { id: pass.periodId } });
  if (!currentPeriod) return true;

  const today = new Date().toISOString().split('T')[0];
  const calendar = await prisma.schoolCalendar.findFirst({
    where: { schoolId: pass.schoolId, date: new Date(today) },
  });
  if (!calendar?.scheduleTypeId) return true;

  const laterPeriods = await prisma.period.findMany({
    where: {
      scheduleTypeId: calendar.scheduleTypeId,
      startTime: { gt: currentPeriod.endTime },
    },
  });
  return laterPeriods.length === 0;
}
