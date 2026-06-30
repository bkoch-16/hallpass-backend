import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import { prisma } from '@hallpass/db';
import { schedulePassExpiry } from '../lib/queue.js';
import { periodEndDate } from '../lib/time.js';
import { UserRole } from '@hallpass/types';

const router = Router();

router.post('/reconcile-expiry', requireAuth, requireRole(UserRole.SERVICE), async (req, res) => {
  const activePasses = await prisma.pass.findMany({
    where: { status: { in: ['PENDING', 'WAITING', 'ACTIVE'] }, periodId: { not: null } },
    include: { period: { include: { scheduleType: true } } },
  });

  let scheduled = 0;
  const errors: { passId: number; error: string }[] = [];
  const now = Date.now();

  for (const pass of activePasses) {
    if (!pass.period) continue;
    try {
      const endTime = periodEndDate(pass.period.endTime, pass.period.scheduleType?.endBuffer ?? 0);
      if (endTime.getTime() > now) {
        await schedulePassExpiry(pass.id, endTime);
        scheduled++;
      }
    } catch (err) {
      errors.push({ passId: pass.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  res.json({ scheduled, ...(errors.length > 0 ? { errors } : {}) });
});

export default router;
