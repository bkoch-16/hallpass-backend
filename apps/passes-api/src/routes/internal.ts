import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/roleGuard.js';
import { prisma } from '@hallpass/db';
import { schedulePassExpiry } from '../lib/queue.js';
import { UserRole } from '@hallpass/types';

const router = Router();

router.post('/reconcile-expiry', requireAuth, requireRole(UserRole.SERVICE), async (req, res) => {
  const activePasses = await prisma.pass.findMany({
    where: { status: { in: ['PENDING', 'WAITING', 'ACTIVE'] }, periodId: { not: null } },
    include: { period: { include: { scheduleType: true } } },
  });

  let scheduled = 0;
  const now = Date.now();
  for (const pass of activePasses) {
    if (!pass.period) continue;
    const [hours, minutes] = pass.period.endTime.split(':').map(Number);
    const endBuffer = pass.period.scheduleType?.endBuffer ?? 0;
    const endTime = new Date();
    endTime.setHours(hours, minutes + endBuffer, 0, 0);
    if (endTime.getTime() > now) {
      await schedulePassExpiry(pass.id, endTime);
      scheduled++;
    }
  }

  res.json({ scheduled });
});

export default router;
